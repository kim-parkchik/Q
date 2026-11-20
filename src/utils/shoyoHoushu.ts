/**
 * 年4回以上払う賞与（健康保険・厚生年金保険の「賞与に係る報酬」）
 *
 * 決まり（厚生労働省「健康保険法及び厚生年金保険法における賞与に係る報酬の取扱いについて」（昭和53年6月20日 保発第47号・
 * 庁保発第21号）、厚生労働省 事務連絡（令和5年6月12日）の Q&A、日本年金機構「算定基礎届の記入・提出ガイドブック（令和8年度）」の
 * ケース⑦とよくあるご質問 Q24。入手元は shoyo-houshu/README.md。回数・12・7月1日・7〜9月は constants/shoyoHoushu.ts）:
 * ・同じ性質の賞与を、年間を通じ4回以上払う（給与規定などの諸規定で客観的に決めている、または7月1日前の1年間に4回以上払った）と、
 *   その賞与は「賞与」ではなく「報酬」（賞与に係る報酬）になる。賞与支払届は出さず、賞与からは保険料を引かない
 *   （標準報酬月額に入るので、毎月の保険料に入っている。ガイドブック「5.賞与支払届」）
 * ・数え方：名前が違っても同じ性質のものごとに数える。例外的に分けて払ったものは、まとめて1回。その年だけ払ったことが
 *   明らかなものは数えない（通知 1(2)・ガイドブック Q24）
 * ・扱いは毎年7月1日現在で決め、7月2日以降に回数が変わったり、諸規定を新しく作ったりしても、次の定時決定（7・8・9月の随時改定を
 *   含む）の標準報酬月額を使うまでは前の扱いのまま（通知 1(1)・Q&A Q4）
 * ・定時決定（と7・8・9月の随時改定）では、7月1日前の1年間に受けた賞与の額を12で割った額を、毎月の報酬に足す（通知 2(1)ア）。
 *   それまで賞与支払届を出して保険料を払った賞与も入れる（ガイドブック Q24）。7月1日前の1年の間に諸規定が変わって報酬になったときは、
 *   変わった後の諸規定で1年間に受けたであろう賞与の額を12で割った額（通知 2(1)イ・Q&A Q4）
 * ・入社した人（資格取得時）は、同じような仕事をして同じような賞与を受ける人の、賞与に係る報酬の平均額（通知 2(2)）
 * ・賞与に係る報酬の額が変わっただけでは随時改定をしない。ほかの理由で7・8・9月以外の随時改定をするときは、計算し直さずに、
 *   定時決定・資格取得時に決めた額を、変わった後の報酬に足す（通知 2(3)）
 * ・算定基礎届は、各月の報酬に1か月あたりの賞与を足した額を「通貨」に書き、備考の「9.その他」に賞与を払った月と、合計を12で割った
 *   額を書く（ガイドブックのケース⑦。賞与 120,000円（9月）・380,000円（12月）・150,000円（3月）・250,000円（6月）＝900,000円 ÷ 12
 *   ＝ 75,000円を、4〜6月の 270,000円に足して 345,000円。備考は「賞与 9.12.3.6月 75,000円」）
 *
 * Q では:
 * ・同じ性質の「年4回以上払う賞与」の1回1回に、賞与の画面で印を付ける（bonus_settings.shaho_houshu）。印を付けた確定した賞与を、
 *   7月1日前の1年間に何回払ったか（支給日の月で数える。同じ月に2つ以上払っても1回）で、その年の定時決定からの扱いを決める。
 *   4回より少なくても諸規定で年4回以上と決めているときなどは、算定基礎の画面で「報酬として扱う」を選ぶ（company.shoyo_houshu。
 *   年ごとに残す）
 * ・印を付けた賞与は、支給日の月が入る定時決定の期間（9月〜翌年8月）の扱いが「報酬」なら、賞与の保険料をかけず、賞与支払届に書かない。
 *   所得税と雇用保険料は、社会保険とは決まりが別なので、いままでどおり賞与として計算する。
 *   （7・8月から随時改定で新しい標準報酬月額を使う人も、その年の9月からと同じに扱う）
 * ・12で割った額は1円未満を切り捨てる（届書には円で書くため。通知とガイドブックには端数の決まりがない）。画面で直せる
 * ・決めた額は、標準報酬月額の履歴に「うち賞与に係る報酬」（bonus）として残し、7・8・9月以外の随時改定で足す
 * ・産前産後休業・育児休業等の終了時改定は、通知に書かれていないので、随時改定と同じに扱う
 */
import { SHOYO_HOUSHU } from '../constants/shoyoHoushu';
import { SHAHO_SANTEI_APPLY_MONTH } from '../constants/shahoTodoke';
import { remunerationEntryAt } from './standardRemuneration';

const p2 = (n: number) => String(n).padStart(2, '0');
/** 定時決定の標準報酬月額を使い始める月（9月） */
const TEIJI_APPLY_MONTH = Number(SHAHO_SANTEI_APPLY_MONTH);

/** その年の定時決定で数える「7月1日前の1年間」（前の年の7月1日から、その年の6月30日まで。YYYY-MM-DD） */
export const houshuLookback = (year: number): { from: string; to: string } => {
  const { baseMonth, baseDay } = SHOYO_HOUSHU;
  const last = new Date(Date.UTC(year, baseMonth - 1, baseDay - 1));
  return {
    from: `${year - 1}-${p2(baseMonth)}-${p2(baseDay)}`,
    to: `${last.getUTCFullYear()}-${p2(last.getUTCMonth() + 1)}-${p2(last.getUTCDate())}`,
  };
};

/** 年月（YYYY-MM か YYYY-MM-DD）が入る、定時決定の標準報酬月額の期間の年（9月〜翌年8月。8月までは前の年の定時決定） */
export const teijiYearOf = (date: string): number | null => {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  return Number(m[2]) >= TEIJI_APPLY_MONTH ? year : year - 1;
};

/** 賞与（bonus_settings の行のうち、使う列） */
export interface HoushuSetting {
  id: number;
  name?: string;
  payment_date: string | null;
  /** 1 なら、年4回以上払う賞与（同じ性質の賞与）の1回 */
  shaho_houshu?: number | null;
  /** 1 なら確定済み */
  is_closed?: number | null;
}

/** 確定した賞与の1人分（bonus_results の行のうち、使う列） */
export interface HoushuResult {
  bonus_setting_id: number;
  staff_id: string | number;
  total_earnings: number;
  /** 総支給のうち現物で渡した額 */
  in_kind?: number | null;
}

export const isHoushuMarked = (s: Pick<HoushuSetting, 'shaho_houshu'> | null | undefined): boolean => Number(s?.shaho_houshu) === 1;

/** その年の7月1日前の1年間に払った、印を付けた確定した賞与（支給日の順）と、払った月（YYYY-MM） */
export const houshuPaymentsIn = (year: number, settings: HoushuSetting[]): { settings: HoushuSetting[]; months: string[] } => {
  const { from, to } = houshuLookback(year);
  const list = settings
    .filter((s) => isHoushuMarked(s) && Number(s.is_closed) === 1 && !!s.payment_date && s.payment_date >= from && s.payment_date <= to)
    .sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)) || a.id - b.id);
  return { settings: list, months: [...new Set(list.map((s) => String(s.payment_date).slice(0, 7)))] };
};

/** 年ごとに画面で決めた扱い（company.shoyo_houshu。{"2027": true} の形。true：報酬として扱う／false：扱わない） */
export type HoushuOverrides = Record<number, boolean>;

export const parseHoushuOverrides = (json: unknown): HoushuOverrides => {
  if (typeof json !== 'string' || !json.trim()) return {};
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: HoushuOverrides = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/^\d{4}$/.test(k) && typeof v === 'boolean') out[Number(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
};

/** 保存する形（なければ null） */
export const stringifyHoushuOverrides = (o: HoushuOverrides): string | null => {
  const keys = Object.keys(o).map(Number).filter((y) => Number.isInteger(y)).sort((a, b) => a - b);
  return keys.length > 0 ? JSON.stringify(Object.fromEntries(keys.map((y) => [String(y), o[y]]))) : null;
};

/** その年の定時決定（その年の9月〜翌年8月）での、年4回以上払う賞与の扱い */
export interface HoushuClassification {
  year: number;
  /** 7月1日前の1年間 */
  lookback: { from: string; to: string };
  /** 7月1日前の1年間に、印を付けた賞与を払った月（YYYY-MM） */
  months: string[];
  /** 払った回数で決まる扱い（4回以上なら報酬） */
  auto: boolean;
  /** 画面で決めた扱い（決めていなければ null） */
  override: boolean | null;
  /** 報酬として扱うか */
  houshu: boolean;
}

export const houshuClassificationOf = (year: number, settings: HoushuSetting[], overrides: HoushuOverrides): HoushuClassification => {
  const { months } = houshuPaymentsIn(year, settings);
  const auto = months.length >= SHOYO_HOUSHU.minTimes;
  const override = typeof overrides[year] === 'boolean' ? overrides[year] : null;
  return { year, lookback: houshuLookback(year), months, auto, override, houshu: override ?? auto };
};

/** その賞与（支給日）の社会保険の扱い：印を付けていて、支給日の月が入る定時決定の期間の扱いが「報酬」なら、報酬 */
export interface BonusHoushuStatus {
  marked: boolean;
  /** 支給日の月が入る定時決定の年（9月〜翌年8月） */
  teijiYear: number | null;
  classification: HoushuClassification | null;
  houshu: boolean;
}

export const bonusHoushuStatus = (
  setting: Pick<HoushuSetting, 'payment_date' | 'shaho_houshu'> | null | undefined,
  settings: HoushuSetting[],
  overrides: HoushuOverrides,
): BonusHoushuStatus => {
  const marked = isHoushuMarked(setting);
  const teijiYear = setting?.payment_date ? teijiYearOf(setting.payment_date) : null;
  if (!marked || teijiYear === null) return { marked, teijiYear, classification: null, houshu: false };
  const classification = houshuClassificationOf(teijiYear, settings, overrides);
  return { marked, teijiYear, classification, houshu: classification.houshu };
};

/** 1人の、毎月の報酬に足す賞与に係る報酬 */
export interface HoushuAmount {
  /** 7月1日前の1年間に受けた、印を付けた賞与の合計（現物を含む）と、そのうち現物 */
  total: number;
  inKind: number;
  /** 12で割った額（1円未満切り捨て）と、そのうち現物の分 */
  monthly: number;
  monthlyInKind: number;
  /** 受けた月（払った順。届書の備考に書く） */
  months: number[];
}

export const NO_HOUSHU: HoushuAmount = { total: 0, inKind: 0, monthly: 0, monthlyInKind: 0, months: [] };

/** 1人が、その年の7月1日前の1年間に受けた、印を付けた確定した賞与の合計を12で割った額 */
export const houshuAmountFor = (
  staffId: string | number,
  year: number,
  settings: HoushuSetting[],
  results: HoushuResult[],
): HoushuAmount => {
  const paid = houshuPaymentsIn(year, settings).settings;
  const mine = paid
    .map((s) => ({ s, r: results.find((r) => Number(r.bonus_setting_id) === s.id && String(r.staff_id) === String(staffId)) }))
    .filter((x) => !!x.r && (Number(x.r.total_earnings) || 0) > 0);
  const total = mine.reduce((sum, x) => sum + (Number(x.r!.total_earnings) || 0), 0);
  const inKind = mine.reduce((sum, x) => sum + Math.min(Number(x.r!.total_earnings) || 0, Number(x.r!.in_kind) || 0), 0);
  const { divisor } = SHOYO_HOUSHU;
  return {
    total,
    inKind,
    monthly: Math.floor(total / divisor),
    monthlyInKind: Math.floor(inKind / divisor),
    months: [...new Set(mine.map((x) => Number(String(x.s.payment_date).slice(5, 7))))],
  };
};

/** 画面で直した額（null は直していない）に合わせた、足す額と、そのうち現物の分 */
export const houshuMonthlyOf = (auto: HoushuAmount, override: number | null | undefined): { monthly: number; monthlyInKind: number } => {
  if (override === null || override === undefined || !Number.isFinite(override)) return { monthly: auto.monthly, monthlyInKind: auto.monthlyInKind };
  const monthly = Math.max(0, Math.floor(override));
  return { monthly, monthlyInKind: Math.min(monthly, auto.monthlyInKind) };
};

/** 毎月の報酬に足す（給与を払っていない月は足さない） */
export const withHoushu = <M extends { amount: number | null; inKind?: number }>(months: M[], add: { monthly: number; monthlyInKind: number }): M[] =>
  add.monthly > 0
    ? months.map((m) => (m.amount === null ? m : { ...m, amount: m.amount + add.monthly, inKind: (m.inKind ?? 0) + add.monthlyInKind }))
    : months;

/** 算定基礎届・月額変更届の備考に書く文（「賞与9.12.3.6月　75,000円」。月がわからなければ「賞与に係る報酬　75,000円」。足す額が0なら空） */
export const houshuRemark = (months: number[], monthly: number): string =>
  monthly <= 0 ? '' : months.length > 0 ? `賞与${months.join('.')}月　${monthly.toLocaleString()}円` : `賞与に係る報酬　${monthly.toLocaleString()}円`;

/**
 * 随時改定（月変）・休業終了時改定で、毎月の報酬に足す額（改定する月 revisionYear 年 revisionMonth 月）
 * ・改定する月が7・8・9月：その年の定時決定と同じく計算し直す（報酬として扱う年なら、7月1日前の1年間に受けた額 ÷ 12）
 * ・ほかの月：改定の前の月の分の標準報酬月額を決めたときの額（標準報酬月額の履歴の「うち賞与に係る報酬」）を、計算し直さずに足す
 */
export interface RevisionHoushu extends HoushuAmount {
  source: 'recalc' | 'carry';
  /** 計算し直すときの、その年の扱い */
  classification: HoushuClassification | null;
}

export const houshuForRevision = (
  staff: any,
  revisionYear: number,
  revisionMonth: number,
  settings: HoushuSetting[],
  results: HoushuResult[],
  overrides: HoushuOverrides,
): RevisionHoushu => {
  if ((SHOYO_HOUSHU.recalcMonths as readonly number[]).includes(revisionMonth)) {
    const classification = houshuClassificationOf(revisionYear, settings, overrides);
    const amount = classification.houshu ? houshuAmountFor(staff?.id, revisionYear, settings, results) : NO_HOUSHU;
    return { ...amount, source: 'recalc', classification };
  }
  const prev = revisionMonth === 1 ? { y: revisionYear - 1, m: 12 } : { y: revisionYear, m: revisionMonth - 1 };
  const monthly = Math.max(0, Math.floor(Number(remunerationEntryAt(staff, prev.y, prev.m).bonus) || 0));
  return { ...NO_HOUSHU, monthly, source: 'carry', classification: null };
};

/** 7月1日前の1年間に、印を付けていない賞与も含めて、賞与を払った月（4つ以上なら、印の付け忘れを知らせる） */
export const unmarkedBonusMonths = (year: number, settings: HoushuSetting[]): { months: string[]; names: string[] } => {
  const { from, to } = houshuLookback(year);
  const list = settings.filter((s) => !isHoushuMarked(s) && Number(s.is_closed) === 1 && !!s.payment_date && s.payment_date >= from && s.payment_date <= to);
  return {
    months: [...new Set(list.map((s) => String(s.payment_date).slice(0, 7)))].sort(),
    names: [...new Set(list.map((s) => String(s.name ?? '')).filter(Boolean))],
  };
};
