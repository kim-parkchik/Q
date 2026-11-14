/**
 * 住民税（個人の市町村民税・道府県民税）の特別徴収の額：年度（6月〜翌年5月）ごとの12か月
 *
 * 市区町村から届く「特別徴収税額の決定通知書」の月ごとの額を、年度ごとに入れる（よく使われている給与ソフトの簡易入力・月別入力と同じ）。
 * 通知書の「6月分」と「7月以降」の2つの額で12か月を埋め、そのあと月ごとに直せる。
 *
 * ■ きまり（地方税法）
 *   ・市区町村は5月31日までに通知する（321条の4第2項）
 *   ・特別徴収税額の12分の1の額を、6月から翌年5月まで、給与の支払をする際に毎月徴収する（321条の5第1項）
 *     → Q では、支給する月（給与の年月）の分の額を引く（6月分は6月に支給する給与から）
 *   ・月割額の100円未満の端数は、最初の月（6月）の分に足す（20条の4の2第6項・第8項。条例で別に定めることもできる）
 *     → 6月分だけ7月以降と額が違うことが多い
 *   ・5月31日より後に通知を受け取ったときは、受け取った月の翌月から翌年5月までの月数で割った額を、その月から徴収する（321条の5第1項）
 *   ・税額が変わったとき（変更の通知）は、通知を受け取った月以後の分を、市区町村長が定める額にする（321条の6第3項）
 *   ・給与を払わなくなった（退職した）月の翌月以降の分は徴収しない。ただし、翌年1月1日〜4月30日に退職した人と、
 *     6月1日〜12月31日に退職して申し出た人は、残りの額を5月31日までに払う給与・退職手当等から一括で徴収する（321条の5第2項）
 *     → 一括徴収は、最後の給与明細の住民税の欄で直す
 * ■ 年度の額を入れていない月は、以前の入れ方の月額（staff.resident_tax）を使う（入れていなければ0円）
 * ■ 納付先：引いた住民税は、その年度の通知をした市区町村に、引いた月の翌月10日までに納める（321条の5第1項）。
 *   年度ごとに納付先（municipality）を持つ。空なら従業員の市区町村（staff.resident_tax_municipality）。
 *   引っ越して従業員の市区町村を次の1月1日の住所に直しても、その年度の残りの月は通知をした市区町村に納める
 * 出典：地方税法 https://laws.e-gov.go.jp/law/325AC0000000226 （第20条の4の2、第321条の4・第321条の5・第321条の6）
 */
import { toWareki } from './wareki';

/** 年度の12か月（6月分〜翌年5月分）の月 */
export const RESIDENT_TAX_MONTHS = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5];

export interface ResidentTaxYear {
  /** 年度（6月が入る年。2026年度は2026年6月分〜2027年5月分） */
  fiscalYear: number;
  /** 6月分〜翌年5月分の額（12個） */
  amounts: number[];
  /** 納付先（その年度の通知をした市区町村の団体コード）。空なら従業員の市区町村 */
  municipality?: string;
}

const nonNeg = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** 支給する年月の分が入る年度（6月〜翌年5月） */
export const fiscalYearOf = (year: number, month: number) => (month >= 6 ? year : year - 1);

/** 年度の中の何番目の月か（6月分が0、翌年5月分が11） */
export const indexInFiscalYear = (month: number) => (month + 6) % 12;

/** 「2026年度（令和8年度）」 */
export const fiscalYearLabel = (fiscalYear: number) => {
  const w = toWareki(`${fiscalYear}-06-01`);
  return w ? `${fiscalYear}年度（${w.era}${w.year === 1 ? '元' : w.year}年度）` : `${fiscalYear}年度`;
};

/** 0円の12か月 */
export const emptyAmounts = (): number[] => Array(12).fill(0);

/** 通知書の「6月分」と「7月以降」の額から、12か月の額を作る */
export const simpleAmounts = (june: number, rest: number): number[] => [nonNeg(june), ...Array(11).fill(nonNeg(rest))];

/** 年税額（12か月の合計） */
export const annualTotal = (amounts: number[]) => amounts.reduce((sum, v) => sum + nonNeg(v), 0);

const sortByYear = (list: ResidentTaxYear[]) => [...list].sort((a, b) => a.fiscalYear - b.fiscalYear);

const normalize = (e: ResidentTaxYear): ResidentTaxYear => {
  const municipality = typeof e.municipality === 'string' ? e.municipality.trim() : '';
  return {
    fiscalYear: Math.floor(Number(e.fiscalYear)),
    amounts: Array.from({ length: 12 }, (_, i) => nonNeg(e.amounts?.[i])),
    ...(municipality ? { municipality } : {}),
  };
};

/** 従業員の resident_tax_schedule（JSON の文字列）を読む。空・壊れているときはなし。同じ年度が2つあれば後のもの */
export const parseResidentTaxSchedule = (json: unknown): ResidentTaxYear[] => {
  if (typeof json !== 'string' || !json.trim()) return [];
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    const byYear = new Map<number, ResidentTaxYear>();
    for (const e of list) {
      if (!Number.isFinite(Number(e?.fiscalYear)) || !Array.isArray(e?.amounts)) continue;
      const entry = normalize(e);
      byYear.set(entry.fiscalYear, entry);
    }
    return sortByYear([...byYear.values()]);
  } catch {
    return [];
  }
};

export const residentTaxScheduleOf = (staff: any): ResidentTaxYear[] => parseResidentTaxSchedule(staff?.resident_tax_schedule);

/** 保存用の JSON（年度の順。年度が1つもなければ null） */
export const stringifyResidentTaxSchedule = (list: ResidentTaxYear[]): string | null =>
  list.length === 0 ? null : JSON.stringify(sortByYear(list.map(normalize)));

/** その年度の納付先（年度の納付先。なければ従業員の市区町村。どちらもなければ空） */
export const paymentMunicipalityOf = (staff: any, fiscalYear: number): string =>
  residentTaxScheduleOf(staff).find((e) => e.fiscalYear === fiscalYear)?.municipality
  || String(staff?.resident_tax_municipality ?? '').trim();

/** その月に支給する給与から引く住民税（年度の額を入れていない月は、以前の入れ方の月額） */
export const residentTaxFor = (staff: any, payYear: number, payMonth: number): number => {
  const entry = residentTaxScheduleOf(staff).find((e) => e.fiscalYear === fiscalYearOf(payYear, payMonth));
  return entry ? entry.amounts[indexInFiscalYear(payMonth)] : nonNeg(staff?.resident_tax);
};
