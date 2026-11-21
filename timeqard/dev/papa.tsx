/**
 * Q の産後パパ育休（出生時育児休業）で働かせる日（就業予定日数）と、同じ月のうちに始まって終わる育休の「14日」の数え方
 * （src/utils/leaveExemption.ts の papaLeaveWorkDays・sameMonthChildcareDays）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/papa.html を開く
 * ・従業員の画面の「休業・休職」（src/features/settings/staff/LeaveSection.tsx）：産後 パパ男さんの育児休業の行に
 *   「産後パパ育休（出生時育児休業）」の印と「労使協定で働かせる時間の合計」がある。初めは 11月1日〜15日（15日）に 8時間
 *   → 就業予定日数 8 ÷ 8 ＝ 1日 → 14日で、11月分の社会保険料は免除
 * ・給与明細（src/features/payroll/PayStubModal.tsx）：2026年11月分（末締め当月払い）。働かせる時間を 16時間にすると、
 *   就業予定日数 2日 → 13日で14日に足りず、健康保険料・厚生年金保険料を引く（いままでは働かせる日を除かずに15日として免除していた）
 * ・1日の所定労働時間を 6時間にすると、12時間で2日になる（8時間なら1日）
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import PayStubModal from "../../src/features/payroll/PayStubModal";
import LeaveSection from "../../src/features/settings/staff/LeaveSection";
import { stringifyLeavePeriods, type LeavePeriod } from "../../src/utils/leaveExemption";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd.startsWith("plugin:dialog|")) {
      const b = args?.buttons;
      if (b?.OkCancelCustom) return b.OkCancelCustom[0];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? "Yes" : b === "OkCancel" ? "Ok" : true;
    }
    return null;
  },
  transformCallback: () => 0,
};

const company: Record<string, unknown> = {
  id: 1, name: "パパ育休サンプル株式会社", week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law",
};
const branches = [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
const groups: any[] = [{
  id: 1, name: "全社", closing_day: 99, is_next_month: 0, payment_day: 25, tax_calc_method: "table", social_ins_collection: "current",
  proration_method: "workdays", leave_proration_method: "workdays", fixed_overtime_proration: 0, absence_deduction_method: "workdays", tardy_deduction_method: "none",
  fixed_break: null, flex_rule: null, shutdown_allowance_rate: 60, premium_rates: null, is_active: 1,
}];

const fakeDb = {
  async select(sql: string) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT * FROM branches")) return branches;
    if (q.startsWith("SELECT * FROM payroll_groups")) return groups;
    if (q.startsWith("SELECT COUNT(*) as count FROM staff")) return [{ count: 1 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) return [{ n: 0 }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) {
      return [{ id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null, union_media_seq: 0 }];
    }
    if (q.startsWith("SELECT tax_calc_method")) return [groups[0]];
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
    return [];
  },
  async execute() {
    return { rowsAffected: 1 };
  },
};

const base = {
  id: "7001", name: "産後 パパ男", gender: "male", wage_type: "monthly", base_wage: 300000, standard_remuneration: 300000, birthday: "1990-05-05",
  join_date: "2020-04-01", social_insurance_group_id: 1, payroll_group_id: 1, branch_id: 1, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  dependents: 0, commute_type: "none", commute_amount: 0, is_employment_ins_eligible: 1, status: "active",
  prefecture: "東京", kenpoPrefecture: "東京", periodStart: "2026-11-01", periodEnd: "2026-11-30", periodLabel: "11/1〜11/30",
};
// 11月10日（火）に働かせる予定の日に8時間、16日からの平日に8時間ずつ働いた（確定）
const attendance = ["10", "16", "17", "18", "19", "20", "23", "24", "25", "26", "27", "30"]
  .map((d) => ({ work_date: `2026-11-${d}`, work_hours: 8, night_hours: 0, work_type: "normal", is_finalized: 1 }));

function Page() {
  const [leaves, setLeaves] = useState<LeavePeriod[]>([{
    type: "childcare", start: "2026-11-01", end: "2026-11-15", childName: "産後　陽向", childKana: "サンゴ ヒナタ", childBirthday: "2026-10-25",
    papaLeave: true, plannedWorkHours: 8,
  }]);
  const [daily, setDaily] = useState(8);
  const staff = { ...base, scheduled_work_hours: daily, leave_periods: stringifyLeavePeriods(leaves) };
  const cm: any = { targetLeavePeriods: leaves, setTargetLeavePeriods: setLeaves, targetIsExecutive: 0, targetDailyHours: daily };
  (window as any).__papa = { leaves, staff };
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>産後パパ育休の就業予定日数と「14日」（確かめ用）</h1>
      <section id="staff" style={{ background: "white", borderRadius: 8, padding: 12, maxWidth: 760 }}>
        <h2 style={{ fontSize: 16 }}>1. 従業員の画面の「休業・休職」（産後 パパ男さん）</h2>
        <label style={{ fontSize: 13 }}>
          1日の所定労働時間（従業員の画面の「勤務形態」の欄の代わり）{" "}
          <select value={daily} onChange={(e) => setDaily(Number(e.target.value))} data-dev="daily-hours">
            <option value={8}>8:00</option>
            <option value={6}>6:00</option>
          </select>
        </label>
        <LeaveSection cm={cm} />
      </section>
      <section id="paystub">
        <h2 style={{ fontSize: 16 }}>2. 給与明細（産後 パパ男さん・2026年11月分。11月1日〜15日に産後パパ育休）</h2>
        <div style={{ position: "relative", transform: "translateZ(0)", height: 1500, overflow: "hidden", borderRadius: 8 }}>
          <PayStubModal
            key={`${staff.leave_periods}-${daily}`}
            db={fakeDb} year={2026} month={11} companySettings={company} onClose={() => {}}
            staff={staff}
            attendanceData={attendance}
          />
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MessageDialogProvider>
    <ToastProvider>
      <Page />
    </ToastProvider>
  </MessageDialogProvider>,
);
