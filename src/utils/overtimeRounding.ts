/**
 * 残業代（法定内残業・時間外労働・休日労働・深夜労働の手当）の1か月の合計の、1円未満の端数処理（見直しの P11）
 *
 * 割増賃金の端数処理は、次の方法なら「常に労働者の不利となるものではなく、事務簡便を目的としたもの」と認められ、
 * 労働基準法24条（賃金の全額払）・37条（割増賃金）の違反としては扱われない（基発第150号）：
 * 1か月の時間外労働・休日労働・深夜業のおのおのの割増賃金の総額に1円未満の端数があるとき、50銭未満の端数を切り捨て、それ以上を1円に切り上げる。
 * そのため、選べるのは次の2つだけにする（会社設定の「端数処理」）：
 * ・round：50銭未満切り捨て・50銭以上切り上げ（四捨五入。基発第150号の方法。初めの値）
 * ・ceil ：常に切り上げ（働く人に不利にならない）
 * 50銭ちょうどを切り捨てる方法と、いつも切り捨てる方法は、働く人に不利になり（割増賃金の未払い）、通達の方法でもないので選べない。
 * 前の版で選べた値（currency_law：50銭以下切り捨て、floor：切り捨て）が会社ファイルに残っていても、四捨五入で計算する。
 * 出典：厚生労働省「確かめよう労働条件」Q&A（5 端数処理の方法について）https://www.check-roudou.mhlw.go.jp/qa/roudousya/chingin/q3.html
 *       鹿児島労働局「時間外労働・休日労働・深夜労働 Q10」https://jsite.mhlw.go.jp/kagoshima-roudoukyoku/yokuaru_goshitsumon/kyushokuchu/0310.html
 */

export type OvertimeRounding = "round" | "ceil";

export const OVERTIME_ROUNDING_OPTIONS: { value: OvertimeRounding; label: string }[] = [
  { value: "round", label: "50銭未満切り捨て・50銭以上切り上げ（四捨五入。基発第150号の方法）" },
  { value: "ceil", label: "常に切り上げ（働く人に有利）" },
];

/** 会社ファイルの値（company.round_overtime）を読む。「常に切り上げ」のほかは、四捨五入 */
export const toOvertimeRounding = (value: unknown): OvertimeRounding => (value === "ceil" ? "ceil" : "round");
