/**
 * 年末調整の表・計算式と、源泉徴収票の記載に使う区分（年分ごと）
 * いまは令和8年分だけ。ほかの年分は null（年末調整の計算・源泉徴収票の作成はしない）
 * ただし、手引がまだ出ていないすぐ次の年分（令和9年分）は、年末調整をしない人（年の途中で退職した人など）の源泉徴収票だけを、
 * 前の年分の手引の書き方で作る（getProvisionalSlipMaster）
 */
import { NENCHO_2026 } from './nencho2026';
import { GENSEN_2026 } from './gensen2026';
import type { NenchoMaster, WithholdingSlipMaster } from './nenchoTypes';

export type { NenchoMaster, EmploymentIncomeSegment, InsuranceFormula, WithholdingSlipMaster } from './nenchoTypes';
export { NENCHO_2026, GENSEN_2026 };

const MASTERS: Record<number, NenchoMaster> = { 2026: NENCHO_2026 };
const SLIP_MASTERS: Record<number, WithholdingSlipMaster> = { 2026: GENSEN_2026 };

/** その年分の年末調整の表（まだ用意していない年分は null） */
export const getNenchoMaster = (year: number): NenchoMaster | null => MASTERS[year] ?? null;

/** その年分の源泉徴収票の記載に使う区分（国税庁の手引から作ったもの。まだ用意していない年分は null） */
export const getWithholdingSlipMaster = (year: number): WithholdingSlipMaster | null => SLIP_MASTERS[year] ?? null;

const yen = (n: number) => `${n.toLocaleString()}円`;
const reiwa = (year: number) => `令和${year - 2018}年分`;
/** "2009-01-03" を years 年ずらす（境目は1月2日・3日なので、うるう年の2月29日にはならない） */
const shiftYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

/**
 * 手引がまだ出ていない年分の「仮の書き方」を、前の年分の手引から作ったデータ（gensen20XX.ts）から作る。
 * 年末調整をしない人（年の途中で退職した人・乙欄・丙欄）の源泉徴収票だけに使う
 * （年の途中で退職した人には、退職の日以後1か月以内に源泉徴収票を渡す。所得税法226条1項）。
 * 年で決まるところだけを動かし、ほかは前の年分の手引のまま：
 *   ・未成年者・16歳未満の扶養親族の生年月日の境目：年の差だけずらす（どちらも、その年の12月31日の年齢で決まる）
 *   ・扶養親族の所得の線：1年を通して新しい線（currentIncomeLimit）で読む。令和8年分の「11月30日以前に出された申告書の線（58万円）」は、
 *     令和8年12月1日以後に支払う給与からの所得要件の改正（58万円 → 62万円）のための、令和8年分だけの決まり
 *     （国税庁「源泉所得税の改正のあらまし」令和8年4月 2ページ）
 *   ・区分の番号、源泉控除対象配偶者・特定親族の線などは、前の年分の手引のまま
 *     （受給者交付用の様式は変わっていない。国税庁「F1-1 給与所得の源泉徴収票（同合計表）」令和8年11月）
 * 手引が出て gensen20XX.ts を作ると、そちらを使う。仮の書き方と違うところがあれば、withholdingSlip.test.ts のテストが止まって知らせる
 */
export const deriveProvisionalSlipMaster = (base: WithholdingSlipMaster, year: number): WithholdingSlipMaster => {
  const shift = year - base.year;
  const w = base.withoutAdjustment;
  return {
    ...base,
    year,
    withoutAdjustment: { ...w, earlierUntil: "12-31", earlierIncomeLimit: w.currentIncomeLimit },
    minorBornOnOrAfter: shiftYears(base.minorBornOnOrAfter, shift),
    youngBornOnOrAfter: shiftYears(base.youngBornOnOrAfter, shift),
    provisional: {
      basedOn: base.year,
      notes: [
        `${reiwa(year)}の「給与所得の源泉徴収票等の法定調書の作成と提出の手引」がまだ出ていないので、${reiwa(base.year)}の手引の書き方で作っています。`
        + `手引が出たら（例年は秋）、書き方が変わっていないか確かめてください。`,
        `${reiwa(year)}なので、扶養親族の所得の線は1年を通して${yen(w.currentIncomeLimit)}で読み、`
        + `未成年者・16歳未満の扶養親族の生年月日の境目は${shift}年ずらしています。`,
      ],
    },
  };
};

/** 手引から作った区分がある、いちばん新しい年分 */
const LATEST_SLIP_YEAR = Math.max(...Object.keys(SLIP_MASTERS).map(Number));

/** 手引から作った区分がまだない、すぐ次の年分（いまは令和9年分）。年末調整をしない人の源泉徴収票だけを、仮の書き方で作る */
export const PROVISIONAL_SLIP_YEAR = LATEST_SLIP_YEAR + 1;

const PROVISIONAL_SLIP_MASTER = deriveProvisionalSlipMaster(SLIP_MASTERS[LATEST_SLIP_YEAR], PROVISIONAL_SLIP_YEAR);

/** 手引が出る前の、すぐ次の年分の仮の書き方（ほかの年分は null） */
export const getProvisionalSlipMaster = (year: number): WithholdingSlipMaster | null =>
  year === PROVISIONAL_SLIP_YEAR ? PROVISIONAL_SLIP_MASTER : null;
