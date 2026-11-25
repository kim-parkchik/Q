/**
 * 標準報酬月額の入れ忘れ（見直しの P10）
 *
 * 社保規定（健康保険の保険者。「全社」など）を選んでいるのに、標準報酬月額の履歴がずっと0（一度も入れていない）の人を、
 * 社会保険に入る人の入れ忘れとして知らせる（給与の一覧・給与明細・従業員の画面。給与明細は、確定の前に確かめる）。
 * ・新しく入れた従業員は、社保規定が初めの「全社」、標準報酬月額が0から始まるので、入れ忘れるとこの形になる。
 *   いままでは、社会保険料を引かず、給与明細に小さく「未加入のため控除していません」と出るだけで、資格取得届の一覧にも出なかった
 * ・加入しない人は、社保規定を「未加入 / 適用除外」にすれば知らせない（社保規定を空にするのが、加入しないことのしるし。
 *   calcSalary.ts の checkSocialInsEnrolled と同じく、項目がない古い形は、選んでいるとみなす）
 * ・標準報酬月額の履歴に0でない行が1つでもあれば知らせない（加入する前・資格を失った後の0は、入れ忘れではない）
 * ・社会保険料がかからない月は知らせない：入社した月より前と、資格喪失日がある月から（checkInsuredMonth）、
 *   健康保険も厚生年金も対象でない月（年齢・後期高齢者医療の障害認定・社会保障協定などで資格を失った月から。getInsuranceByAge）
 * ・月給の人には、資格取得届の画面と同じ報酬月額の見込み（基本給＋固定残業代＋通勤手当（月額）。utils/shikakuReport.ts の estimatedWageOf）と、
 *   その月の等級表で決めた等級・標準報酬月額を出す（残業代の見込み・現物で払う報酬があれば、それも足して決めてもらう）
 */
import * as Master from "../constants";
import { checkInsuredMonth, getInsuranceByAge } from "./calcSalary";
import { lookupGrade } from "./santei";
import { estimatedWageOf } from "./shikakuReport";
import { remunerationHistoryOf } from "./standardRemuneration";

export interface RemunerationMissing {
  /** 月給の人の報酬月額の見込み（時給・日給の人は null） */
  estimatedWage: number | null;
  /** 見込みから、その月の等級表で決めた等級と標準報酬月額（見込みがなければ null） */
  suggested: { grade: number; standard: number } | null;
}

/** 社保規定を選んでいるか（空・0は「未加入 / 適用除外」。項目がない古い形は選んでいるとみなす） */
const insurerChosen = (staff: any): boolean =>
  staff?.social_insurance_group_id === undefined || Number(staff.social_insurance_group_id) > 0;

/** その月の等級表（料率がない古い月などで表がなければ null） */
const gradeTableOf = (year: number, month: number): [number, number, number][] | null => {
  try {
    return Master.getInsuranceMaster(year, month).HYOJUN_TABLE ?? null;
  } catch {
    return null;
  }
};

/**
 * その月の分で、標準報酬月額を入れ忘れているか（入れ忘れでなければ null）
 * @param staff 従業員（社保規定・標準報酬月額の履歴・入社日・退職日・生年月日・給与形態など）
 */
export const remunerationMissingOf = (staff: any, year: number, month: number): RemunerationMissing | null => {
  if (!staff || !insurerChosen(staff)) return null;
  if (remunerationHistoryOf(staff).some((e) => e.amount > 0)) return null;
  if (!checkInsuredMonth(staff.join_date, staff.retirement_date, year, month)) return null;
  const age = getInsuranceByAge(staff.birthday || "", year, month, staff.kouki_date, staff.kaigo_exempt, staff.shaho_loss);
  if (!age.health && !age.pension) return null;
  const wage = estimatedWageOf(staff);
  const table = gradeTableOf(year, month);
  return { estimatedWage: wage, suggested: wage !== null && wage > 0 && table ? lookupGrade(table, wage) : null };
};

/** 知らせの見出し */
export const REMUNERATION_MISSING_TITLE = "社会保険の標準報酬月額が入っていません";

/**
 * 知らせの文（給与明細・確定の前の確かめ・従業員の画面で同じ文を使う）
 * @param insurerName 選んでいる社保規定の名前
 */
export const remunerationMissingLines = (m: RemunerationMissing, insurerName: string): string[] => [
  `社保規定は「${insurerName || "（名前なし）"}」を選んでいますが、標準報酬月額が一度も入っていないので、健康保険料・厚生年金保険料などを引いていません。`,
  "加入する人なら、従業員の画面の「標準報酬月額」に、資格取得時の標準報酬月額を入れてください（資格取得届も出します）。"
    + "加入しない人（働く時間が短い人・短い期間だけ働く人など）なら、社保規定を「未加入 / 適用除外」にしてください。",
  ...(m.suggested && m.estimatedWage !== null
    ? [`月給の人の報酬月額の見込み（基本給＋固定残業代＋通勤手当）${m.estimatedWage.toLocaleString()}円で決めると、`
      + `${m.suggested.grade}級 ${m.suggested.standard.toLocaleString()}円です（残業代の見込みや現物で払う報酬があれば、それも足して決めます）。`]
    : []),
];
