/**
 * 労働保険の年度更新（確定保険料・一般拠出金算定基礎賃金集計表と、労働保険概算・確定保険料申告書の金額）
 *
 * ■ 集計表（保険年度の4月〜翌年3月の、月ごとの人数と賃金。賞与は支払った月ごと）
 *   ・労災保険および一般拠出金：常用労働者（パート・アルバイトで雇用保険の資格のある人を含む）・役員で労働者扱いの人
 *     （実質的な役員報酬分を除く）・臨時労働者（パート・アルバイトで雇用保険の資格のない人）
 *   ・雇用保険：被保険者のうち、常用労働者・役員で労働者扱いの人
 *   ・月は賃金締切日の月（保険年度中に支払いが確定した賃金。3月末締め・4月払いの賃金は3月の分）。賞与は支払った月
 *   ・賃金：支給合計から賃金でない額（労災の待期の休業補償）を除き、雇用保険の賃金に入れる現物（定期券など）を足す（給与から引く
 *     雇用保険料の元と同じ）。法人の役員で、雇用保険に入っていない人の役員報酬は入れない
 *   ・人数は、各月の賃金締切日に在籍している人（常時使用労働者数・雇用保険被保険者数は、その合計 ÷ 12。1人未満は1人）
 * ■ 申告書の金額
 *   ・賃金総額（算定基礎額）は1,000円未満を切り捨て、保険料・一般拠出金は1円未満を切り捨て
 *   ・労災保険と雇用保険の算定基礎額が同じときは、別々に切り捨てず、両保険の率の合計をかけてから切り捨てる（よくある質問 Q3・記入例4）
 *   ・一般拠出金：労災保険の賃金総額（千円未満切り捨て） × 1,000分の0.02
 *   ・概算保険料：今年度の賃金総額の見込み（初めは前年度と同じ額）× 今年度の率
 *   ・延納：概算保険料だけで40万円以上なら3回に分けられる（よくある質問 Q4）。分けて余りが出たら第1期に足す。
 *     確定保険料の不足額と一般拠出金は延納できないので第1期に払う
 *   ・申告済概算保険料が確定保険料より多いときは、その差を充当する（充当意思 1：労働保険料のみ・2：一般拠出金のみ・3：両方）。
 *     第1期の労働保険料に充当して余れば第2期・第3期の順に。3は第1期の労働保険料、一般拠出金、第2期以降の順。残りは還付請求
 * 出典：厚生労働省「令和８年度 労働保険年度更新申告書の書き方（継続事業用）」（9 集計表の書き方・11 申告書の書き方（記入例1〜4）・
 *       12 常時使用労働者数・雇用保険被保険者数計算要領・13 一般拠出金・21 よくある質問・22 申告書作成チェックポイント）
 */
import dayjs from "dayjs";
import { LABOR_INSURANCE_PERIODS, type EmpInsType } from "../constants/insurance/laborInsuranceRates";
import { GENERAL_CONTRIBUTION_RATE, ROUSAI_RATE_PERIODS, type RousaiRateRow } from "../constants/insurance/rousaiRates";
import { getPeriodForPayMonth, type PayrollGroupForPeriod } from "./payrollPeriod";

/** 集計表の人の区分（regular：常用労働者・officer：役員で労働者扱いの人・temporary：臨時労働者） */
export type NendoCategory = "regular" | "officer" | "temporary";

export const NENDO_CATEGORY_LABELS: Record<NendoCategory, string> = {
  regular: "常用労働者",
  officer: "役員で労働者扱いの人",
  temporary: "臨時労働者",
};

export interface NendoCell {
  count: number;
  wages: number;
}

/** 集計表の1行（月か賞与） */
export interface NendoRow {
  kind: "month" | "bonus";
  year: number;
  month: number;
  /** 労災保険および一般拠出金 */
  rousai: Record<NendoCategory, NendoCell> & { total: NendoCell };
  /** 雇用保険（被保険者のうち、常用労働者・役員で労働者扱いの人） */
  koyo: { regular: NendoCell; officer: NendoCell; total: NendoCell };
  /** この行の雇用保険率（1,000分の。月の賃金は賃金締切日の月、賞与は支払った月の率） */
  koyoRate: number;
}

/** 集計に使う従業員 */
export interface NendoStaff {
  id: string;
  name: string;
  is_executive?: number | boolean | null;
  is_employment_ins_eligible?: number | boolean | null;
  join_date?: string | null;
  retirement_date?: string | null;
  death_date?: string | null;
  payroll_group_id?: number | null;
}

/** 確定した給与（支払った年月ごと） */
export interface NendoSalary {
  staff_id: string;
  target_year: number;
  target_month: number;
  total_earnings: number;
  non_remuneration?: number | null;
  in_kind_emp?: number | null;
  emp_insurance?: number | null;
  /** 賃金台帳の内訳（計算期間を読む。なければ給与規定グループの締日から） */
  ledger?: string | null;
}

/** 確定した賞与（支払った日ごと） */
export interface NendoBonus {
  staff_id: string;
  payDate: string;
  total_earnings: number;
  emp_insurance?: number | null;
}

export interface NendoTableInput {
  /** 保険年度（4月から翌年3月。2025 なら令和7年度） */
  fiscalYear: number;
  staff: NendoStaff[];
  groups: (PayrollGroupForPeriod & { id: number })[];
  salaries: NendoSalary[];
  bonuses: NendoBonus[];
  /** 雇用保険の事業の種類（一般・農林水産・清酒製造・建設） */
  empInsType: EmpInsType;
}

export interface NendoTable {
  fiscalYear: number;
  rows: NendoRow[];
  totals: NendoRow["rousai"] & { koyo: NendoRow["koyo"] };
  /** 常時使用労働者数・雇用保険被保険者数（各月の人数の合計 ÷ 12。1人未満は1人） */
  workers: number;
  insured: number;
  notes: string[];
}

const cell = (): NendoCell => ({ count: 0, wages: 0 });
const emptyRow = (kind: "month" | "bonus", year: number, month: number, koyoRate: number): NendoRow => ({
  kind, year, month, koyoRate,
  rousai: { regular: cell(), officer: cell(), temporary: cell(), total: cell() },
  koyo: { regular: cell(), officer: cell(), total: cell() },
});

/** その年月の雇用保険率（合計。1,000分の） */
export const koyoRateOf = (year: number, month: number, type: EmpInsType): number => {
  const key = year * 100 + month;
  const period = [...LABOR_INSURANCE_PERIODS].reverse().find((p) => p.from.year * 100 + p.from.month <= key);
  if (!period) throw new Error(`${year}年${month}月の雇用保険率がありません`);
  return Math.round(period.rates[type][1] * 100000) / 100;
};

/** その年度の労災保険率の表（4月の分の表） */
export const rousaiTableOf = (fiscalYear: number): RousaiRateRow[] => {
  const key = fiscalYear * 100 + 4;
  const period = [...ROUSAI_RATE_PERIODS].reverse().find((p) => p.from.year * 100 + p.from.month <= key);
  return period?.rows ?? [];
};

/** 事業の種類の番号（「98」）から労災保険率（1,000分の）。わからなければ null */
export const rousaiRateOf = (fiscalYear: number, code: string | null | undefined): RousaiRateRow | null =>
  rousaiTableOf(fiscalYear).find((r) => r.codes.includes(String(code ?? "").trim())) ?? null;

const isTrue = (v: unknown) => v === true || Number(v) === 1;
/** 給与・賞与の、労働保険の賃金（支給合計 − 賃金でない額 ＋ 雇用保険の賃金に入れる現物） */
export const laborWageOf = (s: NendoSalary): number =>
  (Number(s.total_earnings) || 0) - (Number(s.non_remuneration) || 0) + (Number(s.in_kind_emp) || 0);

/** 人の区分（役員で雇用保険に入っていない人は入れない：null） */
const categoryOf = (s: NendoStaff, insured: boolean): NendoCategory | null => {
  if (isTrue(s.is_executive)) return insured ? "officer" : null;
  return insured ? "regular" : "temporary";
};

/** その日に在籍しているか（入社日から退職日・死亡日まで） */
const employedOn = (s: NendoStaff, date: string): boolean => {
  if (s.join_date && s.join_date > date) return false;
  const end = [s.retirement_date, s.death_date].filter(Boolean).sort()[0];
  return !end || end >= date;
};

/** 確定した給与の計算期間の終わりの日（賃金締切日） */
const closingOf = (s: NendoSalary, group: PayrollGroupForPeriod | undefined): string | null => {
  try {
    const l = s.ledger ? JSON.parse(s.ledger) : null;
    if (l?.periodEnd) return String(l.periodEnd);
  } catch {
    // 内訳を読めなければ締日から
  }
  return group ? getPeriodForPayMonth(group, Number(s.target_year), Number(s.target_month)).endStr : null;
};

/**
 * 集計表を作る
 */
export const buildNendoTable = (input: NendoTableInput): NendoTable => {
  const { fiscalYear, empInsType } = input;
  const notes: string[] = [];
  const staffById = new Map(input.staff.map((s) => [String(s.id), s]));
  const groupOf = (s: NendoStaff) => input.groups.find((g) => g.id === (Number(s.payroll_group_id) || 1)) ?? input.groups[0];
  const months: NendoRow[] = [];
  for (let i = 0; i < 12; i++) {
    const d = dayjs(new Date(fiscalYear, 3 + i, 1));
    months.push(emptyRow("month", d.year(), d.month() + 1, koyoRateOf(d.year(), d.month() + 1, empInsType)));
  }
  const rowOfMonth = (date: string) => months.find((r) => r.year === Number(date.slice(0, 4)) && r.month === Number(date.slice(5, 7)));
  // 給与：賃金締切日の月に入れる
  const counted = new Set<string>();
  let executiveSkipped = 0;
  for (const s of input.salaries) {
    const staff = staffById.get(String(s.staff_id));
    if (!staff) continue;
    const closing = closingOf(s, groupOf(staff));
    const row = closing ? rowOfMonth(closing) : undefined;
    if (!row) continue;
    const insured = (Number(s.emp_insurance) || 0) > 0 || (laborWageOf(s) === 0 && isTrue(staff.is_employment_ins_eligible));
    const category = categoryOf(staff, insured);
    if (!category) {
      executiveSkipped++;
      continue;
    }
    const wages = laborWageOf(s);
    row.rousai[category].wages += wages;
    row.rousai.total.wages += wages;
    if (category !== "temporary") {
      row.koyo[category].wages += wages;
      row.koyo.total.wages += wages;
    }
    // 人数：賃金締切日に在籍している人
    if (closing && employedOn(staff, closing)) {
      counted.add(`${row.year}-${row.month}:${staff.id}`);
      row.rousai[category].count++;
      row.rousai.total.count++;
      if (category !== "temporary") {
        row.koyo[category].count++;
        row.koyo.total.count++;
      }
    }
  }
  if (executiveSkipped > 0) notes.push("雇用保険に入っていない役員の役員報酬は、労働保険の賃金に入れていません");
  // 賞与：支払った月ごと（保険年度の中）
  const bonusRows = new Map<string, NendoRow>();
  for (const b of input.bonuses) {
    const staff = staffById.get(String(b.staff_id));
    if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(b.payDate)) continue;
    const y = Number(b.payDate.slice(0, 4));
    const m = Number(b.payDate.slice(5, 7));
    const fy = m >= 4 ? y : y - 1;
    if (fy !== fiscalYear) continue;
    const key = `${y}-${m}`;
    if (!bonusRows.has(key)) bonusRows.set(key, emptyRow("bonus", y, m, koyoRateOf(y, m, empInsType)));
    const row = bonusRows.get(key)!;
    const wages = Number(b.total_earnings) || 0;
    const insured = (Number(b.emp_insurance) || 0) > 0;
    const category = categoryOf(staff, insured);
    if (!category) continue;
    row.rousai[category].wages += wages;
    row.rousai[category].count++;
    row.rousai.total.wages += wages;
    row.rousai.total.count++;
    if (category !== "temporary") {
      row.koyo[category].wages += wages;
      row.koyo[category].count++;
      row.koyo.total.wages += wages;
      row.koyo.total.count++;
    }
  }
  const rows = [...months, ...[...bonusRows.values()].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))];
  const sum = (pick: (r: NendoRow) => NendoCell): NendoCell =>
    rows.reduce((t, r) => ({ count: t.count + pick(r).count, wages: t.wages + pick(r).wages }), cell());
  const totals = {
    regular: sum((r) => r.rousai.regular), officer: sum((r) => r.rousai.officer), temporary: sum((r) => r.rousai.temporary),
    total: sum((r) => r.rousai.total),
    koyo: { regular: sum((r) => r.koyo.regular), officer: sum((r) => r.koyo.officer), total: sum((r) => r.koyo.total) },
  };
  const monthCount = (pick: (r: NendoRow) => NendoCell) => months.reduce((t, r) => t + pick(r).count, 0);
  const avg = (n: number) => (n > 0 ? Math.max(1, Math.floor(n / 12)) : 0);
  return {
    fiscalYear, rows, totals, notes,
    workers: avg(monthCount((r) => r.rousai.total)),
    insured: avg(monthCount((r) => r.koyo.total)),
  };
};

// ── 申告書 ─────────────────────────────────────────────

/** 1,000分の rate を千円単位の算定基礎額にかけて、1円未満を切り捨てる（小数の誤差が出ないように、率は100倍の整数にして計算する） */
export const premiumOf = (kiloBase: number, ratePerMille: number): number =>
  Math.floor((kiloBase * Math.round(ratePerMille * 100)) / 100);

/** 賃金総額を千円単位にする（1,000円未満切り捨て） */
export const kiloOf = (yen: number): number => Math.floor(Math.max(0, yen) / 1000);

/** 雇用保険の賃金を、率ごとに分けたもの（年度の途中で率が変わった年は2つ） */
export interface KoyoWagePart {
  ratePerMille: number;
  wages: number;
}

export interface NendoDeclarationInput {
  /** 確定の労災保険の賃金総額（円）と率（1,000分の） */
  rousaiWages: number;
  rousaiRate: number;
  /** 確定の雇用保険の賃金（率ごと） */
  koyoParts: KoyoWagePart[];
  /** 概算：今年度の賃金総額の見込み（円。null は前年度の確定と同じ）と率 */
  estimateRousaiWages: number | null;
  estimateKoyoWages: number | null;
  estimateRousaiRate: number;
  estimateKoyoRate: number;
  /** 申告済概算保険料（前年度に申告した概算保険料。円） */
  declared: number;
  /** 延納する（3回に分ける） */
  installments: boolean;
  /** 充当意思（1：労働保険料のみ・2：一般拠出金のみ・3：両方） */
  allocation: "1" | "2" | "3";
  /** 一般拠出金率（1,000分の） */
  generalRate?: number;
}

export interface NendoDeclaration {
  confirmed: {
    rousaiBase: number; // 千円
    koyoBases: { ratePerMille: number; base: number; premium: number }[];
    /** 労災と雇用の算定基礎額が同じとき、合わせて計算した */
    combined: boolean;
    rousaiPremium: number;
    koyoPremium: number;
    total: number;
  };
  general: { base: number; rate: number; amount: number };
  estimate: { rousaiBase: number; koyoBase: number; combined: boolean; rousaiPremium: number; koyoPremium: number; total: number; usedPrevious: boolean };
  /** 申告済概算保険料との差（プラスは不足額、マイナスは充当できる額） */
  shortage: number;
  surplus: number;
  /** 延納できるか（概算保険料だけで40万円以上） */
  canInstall: boolean;
  /** 第1期〜第3期の、概算保険料（延納しなければ第1期だけ） */
  periods: { premium: number; shortage: number; general: number; applied: number; appliedGeneral: number; pay: number }[];
  refund: number;
  notes: string[];
}

/** 延納できる概算保険料（40万円以上。よくある質問 Q4） */
export const INSTALLMENT_MIN = 400000;

export const calcNendoDeclaration = (input: NendoDeclarationInput): NendoDeclaration => {
  const notes: string[] = [];
  const generalRate = input.generalRate ?? GENERAL_CONTRIBUTION_RATE;
  // 確定保険料
  const rousaiBase = kiloOf(input.rousaiWages);
  const koyoBases = input.koyoParts.filter((p) => p.wages > 0 || input.koyoParts.length === 1)
    .map((p) => ({ ratePerMille: p.ratePerMille, base: kiloOf(p.wages), premium: 0 }));
  const koyoTotalBase = koyoBases.reduce((t, p) => t + p.base, 0);
  const combined = koyoBases.length === 1 && koyoTotalBase === rousaiBase && rousaiBase > 0;
  let rousaiPremium = 0;
  let koyoPremium = 0;
  let total: number;
  if (combined) {
    // 算定基礎額が同じときは、両保険の率の合計をかけてから切り捨てる（記入例4）
    total = premiumOf(rousaiBase, input.rousaiRate + koyoBases[0].ratePerMille);
    rousaiPremium = premiumOf(rousaiBase, input.rousaiRate);
    koyoPremium = total - rousaiPremium;
    koyoBases[0].premium = koyoPremium;
    notes.push("労災保険と雇用保険の算定基礎額が同じなので、両保険の率の合計をかけて計算しました（申告書の（イ）欄に書きます）");
  } else {
    rousaiPremium = premiumOf(rousaiBase, input.rousaiRate);
    for (const p of koyoBases) p.premium = premiumOf(p.base, p.ratePerMille);
    koyoPremium = koyoBases.reduce((t, p) => t + p.premium, 0);
    total = rousaiPremium + koyoPremium;
  }
  // 一般拠出金：労災保険の賃金総額（千円未満切り捨て）× 0.02/1000
  const general = { base: rousaiBase, rate: generalRate, amount: premiumOf(rousaiBase, generalRate) };
  // 概算保険料：見込みがなければ前年度の確定と同じ
  const usedPrevious = input.estimateRousaiWages === null && input.estimateKoyoWages === null;
  const eRousaiBase = input.estimateRousaiWages === null ? rousaiBase : kiloOf(input.estimateRousaiWages);
  const eKoyoBase = input.estimateKoyoWages === null ? koyoTotalBase : kiloOf(input.estimateKoyoWages);
  const eCombined = eRousaiBase === eKoyoBase && eRousaiBase > 0;
  let eRousai: number;
  let eKoyo: number;
  let eTotal: number;
  if (eCombined) {
    eTotal = premiumOf(eRousaiBase, input.estimateRousaiRate + input.estimateKoyoRate);
    eRousai = premiumOf(eRousaiBase, input.estimateRousaiRate);
    eKoyo = eTotal - eRousai;
  } else {
    eRousai = premiumOf(eRousaiBase, input.estimateRousaiRate);
    eKoyo = premiumOf(eKoyoBase, input.estimateKoyoRate);
    eTotal = eRousai + eKoyo;
  }
  const diff = total - input.declared;
  const shortage = Math.max(0, diff);
  const surplus = Math.max(0, -diff);
  const canInstall = eTotal >= INSTALLMENT_MIN;
  const install = input.installments && canInstall;
  if (input.installments && !canInstall) notes.push("概算保険料が40万円未満なので、延納（3回に分けること）はできません");
  const third = Math.floor(eTotal / 3);
  const premiums = install ? [eTotal - third * 2, third, third] : [eTotal];
  const periods = premiums.map((premium, i) => ({
    premium, shortage: i === 0 ? shortage : 0, general: i === 0 ? general.amount : 0, applied: 0, appliedGeneral: 0, pay: 0,
  }));
  // 充当
  let left = surplus;
  const applyPremium = (i: number) => {
    const p = periods[i];
    const a = Math.min(left, p.premium + p.shortage - p.applied);
    p.applied += a;
    left -= a;
  };
  const applyGeneral = () => {
    const p = periods[0];
    const a = Math.min(left, p.general - p.appliedGeneral);
    p.appliedGeneral += a;
    left -= a;
  };
  if (surplus > 0) {
    if (input.allocation === "1") periods.forEach((_, i) => applyPremium(i));
    else if (input.allocation === "2") applyGeneral();
    else {
      applyPremium(0);
      applyGeneral();
      for (let i = 1; i < periods.length; i++) applyPremium(i);
    }
  }
  for (const p of periods) p.pay = p.premium + p.shortage - p.applied + p.general - p.appliedGeneral;
  if (left > 0) notes.push(`充当しても ${left.toLocaleString()}円 余るので、「労働保険料・一般拠出金還付請求書」で還付を請求します`);
  return {
    confirmed: { rousaiBase, koyoBases, combined, rousaiPremium, koyoPremium, total },
    general,
    estimate: { rousaiBase: eRousaiBase, koyoBase: eKoyoBase, combined: eCombined, rousaiPremium: eRousai, koyoPremium: eKoyo, total: eTotal, usedPrevious },
    shortage, surplus, canInstall, periods, refund: left, notes,
  };
};

/** 雇用保険の賃金を、率ごとにまとめる（集計表の行の率で） */
export const koyoPartsOf = (table: NendoTable): KoyoWagePart[] => {
  const map = new Map<number, number>();
  for (const r of table.rows) map.set(r.koyoRate, (map.get(r.koyoRate) ?? 0) + r.koyo.total.wages);
  return [...map.entries()].map(([ratePerMille, wages]) => ({ ratePerMille, wages }));
};

/**
 * 延納の納期限（第1期 7月10日・第2期 10月31日・第3期 翌年1月31日。土日祝日なら次の日。口座振替の日は違う）
 * （令和８年度の書き方の記入例：第1期 7月10日、第2期 11月2日、第3期 2月1日）
 * @param year 申告する年（今年度の4月の年）
 * @param isHoliday 祝日か（土日はここで見る）
 */
export const nendoDueDates = (year: number, isHoliday: (date: string) => boolean = () => false): string[] =>
  [`${year}-07-10`, `${year}-10-31`, `${year + 1}-01-31`].map((d) => {
    let x = dayjs(d);
    while (x.day() === 0 || x.day() === 6 || isHoliday(x.format("YYYY-MM-DD"))) x = x.add(1, "day");
    return x.format("YYYY-MM-DD");
  });
