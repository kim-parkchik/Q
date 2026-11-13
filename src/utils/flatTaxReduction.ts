/**
 * 令和6年分の定額減税（月次減税）で、給与・賞与のそれぞれから引ける額の数え方（減税額の決まりは constants/tax/flatTaxReduction.ts）
 *
 * 令和6年6月1日以後に最初に払う給与等（賞与も含む）の源泉所得税から減税額を引き、引ききれない分は、
 * その年に払う後の給与等から順に引く（国税庁「定額減税について」https://www.nta.go.jp/users/gensen/teigakugenzei/01.htm）。
 * そのため、ある給与・賞与で引ける額は、その人の減税額の合計から、それより前に払った給与・賞与で引いた額を引いた残り。
 * ・給与を払う日は、支給年月と給与規定グループの支払日（99 は末日。その月にない日は末日）
 * ・同じ日に払う給与と賞与は、給与から先に引く（同じ日の順は国税庁の資料に書かれていないので、Q はこう決める。1年の減税額の合計は変わらない）。
 *   同じ日に払う賞与どうしは、先に作った賞与（番号の小さいほう）から引く
 * ・前に払った給与・賞与で引いた額は、確定した給与（salary_results）・賞与（bonus_results）から読む。払う日の順に確定すること。
 *   後に払う給与・賞与を先に確定していたら、知らせる（合わせて減税額の合計を超えて引かないように、その分も引いておく）
 */

export type FlatTaxPaymentKind = "salary" | "bonus";

/** 確定した給与・賞与で引いた月次減税額 */
export interface FlatTaxPayment {
  /** 払う日（YYYY-MM-DD） */
  date: string;
  kind: FlatTaxPaymentKind;
  /** 同じ日に払う賞与の順（賞与の番号）。給与は 0 */
  order: number;
  /** その給与・賞与で引いた月次減税額 */
  reduction: number;
}

/** 計算する給与・賞与（払う日・種類・賞与の番号） */
export type FlatTaxTarget = Omit<FlatTaxPayment, "reduction">;

const pad = (n: number) => String(n).padStart(2, "0");

/** 給与を払う日（支給年月と、給与規定グループの支払日。99・空は末日、その月にない日は末日） */
export const salaryPayDate = (year: number, month: number, paymentDay: unknown): string => {
  const last = new Date(year, month, 0).getDate();
  const day = Math.floor(Number(paymentDay) || 0);
  return `${year}-${pad(month)}-${pad(day <= 0 || day === 99 ? last : Math.min(day, last))}`;
};

/** 同じ給与・賞与か（確定し直すときの、前の確定結果） */
const isSame = (p: FlatTaxTarget, t: FlatTaxTarget) => p.kind === t.kind && p.date === t.date && p.order === t.order;

/** p を t より前に払うか（同じ日なら給与が先、賞与どうしは番号の小さいほうが先） */
const isBefore = (p: FlatTaxTarget, t: FlatTaxTarget) =>
  p.date < t.date
  || (p.date === t.date && p.kind === "salary" && t.kind === "bonus")
  || (p.date === t.date && p.kind === "bonus" && t.kind === "bonus" && p.order < t.order);

export interface FlatTaxRemaining {
  /** この給与・賞与で引ける月次減税額（源泉所得税が少なければ、引くのはその額まで） */
  remaining: number;
  /** この給与・賞与より後に払うのに、もう月次減税額を引いて確定した給与・賞与（払う日の順に確定し直してもらう） */
  laterUsed: FlatTaxPayment[];
}

/**
 * その給与・賞与で引ける月次減税額
 * @param total その人の減税額の合計（月次減税の対象でなければ 0。utils/incomeTax.ts の flatTaxReductionTotal）
 * @param payments その人の、その年の確定した給与・賞与で引いた月次減税額
 */
export const flatTaxRemainingFor = (total: number, payments: FlatTaxPayment[], target: FlatTaxTarget): FlatTaxRemaining => {
  if (total <= 0) return { remaining: 0, laterUsed: [] };
  const others = payments.filter((p) => !isSame(p, target) && p.reduction > 0);
  const usedBefore = others.filter((p) => isBefore(p, target)).reduce((sum, p) => sum + p.reduction, 0);
  const usedAll = others.reduce((sum, p) => sum + p.reduction, 0);
  return {
    remaining: Math.max(0, Math.min(total - usedBefore, total - usedAll)),
    laterUsed: others.filter((p) => !isBefore(p, target)).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order),
  };
};

/** 「2024年6月25日の給与」 */
export const describeFlatTaxPayment = (p: FlatTaxTarget): string => {
  const [y, m, d] = p.date.split("-").map(Number);
  return `${y}年${m}月${d}日の${p.kind === "salary" ? "給与" : "賞与"}`;
};

interface SelectDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/** 会社ファイルから、その年に払った給与・賞与で引いた月次減税額を、人ごとに読む */
export const loadFlatTaxPayments = async (db: SelectDb, year: number): Promise<Map<string, FlatTaxPayment[]>> => {
  const salaries = (await db.select<{ staff_id: string; target_month: number; reduction: number; payment_day: number | null }[]>(
    `SELECT r.staff_id, CAST(r.target_month AS INTEGER) AS target_month, r.flat_tax_reduction AS reduction, g.payment_day
     FROM salary_results r
     LEFT JOIN staff s ON s.id = r.staff_id
     LEFT JOIN payroll_groups g ON g.id = COALESCE(s.payroll_group_id, 1)
     WHERE CAST(r.target_year AS INTEGER) = ? AND COALESCE(r.flat_tax_reduction, 0) > 0`,
    [year],
  )) ?? [];
  const bonuses = (await db.select<{ staff_id: string; id: number; payment_date: string | null; target_month: number; reduction: number }[]>(
    `SELECT b.staff_id, s.id, s.payment_date, CAST(s.target_month AS INTEGER) AS target_month, b.flat_tax_reduction AS reduction
     FROM bonus_results b JOIN bonus_settings s ON s.id = b.bonus_setting_id
     WHERE CAST(s.target_year AS INTEGER) = ? AND COALESCE(b.flat_tax_reduction, 0) > 0`,
    [year],
  )) ?? [];
  const map = new Map<string, FlatTaxPayment[]>();
  const add = (staffId: unknown, p: FlatTaxPayment) => {
    const key = String(staffId);
    map.set(key, [...(map.get(key) ?? []), p]);
  };
  for (const r of salaries) {
    add(r.staff_id, { date: salaryPayDate(year, Number(r.target_month), r.payment_day ?? 25), kind: "salary", order: 0, reduction: Number(r.reduction) || 0 });
  }
  for (const b of bonuses) {
    add(b.staff_id, {
      date: b.payment_date || `${year}-${pad(Number(b.target_month))}-01`, kind: "bonus", order: Number(b.id), reduction: Number(b.reduction) || 0,
    });
  }
  return map;
};
