/**
 * 雇用保険の届書・給付の書類に使うデータを DB から読む（確定した給与・勤怠・会社カレンダー・会社と拠点・給与規定グループ）
 * 計算は utils/wageCertificate.ts・utils/koyoBenefits.ts・utils/koyoReport.ts（DB を使わない）
 */
import { loadCalendarContext, isPrescribedWorkDay } from "./annualWorkDays";
import type { WageCertDay, WageCertSalary } from "./wageCertificate";
import type { LaborBranch, LaborCompany } from "./koyoPlaces";

interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

export interface KoyoBase {
  company: LaborCompany & Record<string, any>;
  branches: LaborBranch[];
  groups: any[];
  /** 従業員ごとの、固定の支給項目の月額（賃金月額の初めの値に足す。「平均賃金での扱い」が「入れない」の項目は除く） */
  fixedItems: Record<string, number>;
}

export const loadKoyoBase = async (db: SelectDb): Promise<KoyoBase> => {
  const [company] = await db.select<any[]>("SELECT * FROM company WHERE id = 1");
  const branches = await db.select<any[]>("SELECT * FROM branches ORDER BY id ASC");
  const groups = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
  const items = await db.select<{ staff_id: string; amount: number; type: string; category: string; average_wage: string | null }[]>(
    `SELECT v.staff_id, v.amount, m.type, m.category, m.average_wage
     FROM staff_salary_values v JOIN salary_item_master m ON m.id = v.item_id`,
  );
  const fixedItems: Record<string, number> = {};
  for (const it of items ?? []) {
    if (it.type !== "earning" || it.category !== "fixed" || it.average_wage === "none") continue;
    fixedItems[String(it.staff_id)] = (fixedItems[String(it.staff_id)] ?? 0) + (Number(it.amount) || 0);
  }
  return { company: company ?? {}, branches: (branches ?? []).map((b) => ({ ...b, id: Number(b.id) })), groups: groups ?? [], fixedItems };
};

/** 従業員の給与規定グループ（なければ最初のグループ） */
export const groupOfStaff = (staff: any, groups: any[]): any =>
  groups.find((g) => Number(g.id) === Number(staff?.payroll_group_id || 1)) ?? groups[0] ?? { closing_day: 99, is_next_month: 1, payment_day: 25 };

export interface WageData {
  salaries: WageCertSalary[];
  attendance: WageCertDay[];
  isWorkDay: (date: string) => boolean;
}

/** 1人の、確定した給与（すべて）と、from〜to の確定した勤怠・所定労働日 */
export const loadWageData = async (db: SelectDb, staff: any, from: string, to: string): Promise<WageData> => {
  const salaries = await db.select<WageCertSalary[]>(
    `SELECT target_year, target_month, ledger, total_earnings, non_remuneration, in_kind_emp
     FROM salary_results WHERE staff_id = ? ORDER BY target_year DESC, target_month DESC`,
    [staff.id],
  );
  const attendance = await db.select<WageCertDay[]>(
    `SELECT work_date, work_type, work_hours, leave_paid, paid_leave_hours, special_leave_hours, scheduled_hours
     FROM attendance WHERE staff_id = ? AND work_date >= ? AND work_date <= ? AND is_finalized = 1`,
    [staff.id, from, to],
  );
  const ctx = await loadCalendarContext(db, staff);
  return {
    salaries: (salaries ?? []).map((s) => ({ ...s, target_year: Number(s.target_year), target_month: Number(s.target_month) })),
    attendance: attendance ?? [],
    isWorkDay: (date: string) => {
      const [y, m, d] = date.split("-").map(Number);
      return isPrescribedWorkDay(new Date(y, m - 1, d), ctx);
    },
  };
};
