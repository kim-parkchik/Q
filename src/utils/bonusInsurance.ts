/**
 * 賞与の標準賞与額の上限（前に支払った賞与との累計）と、賞与の所得税に使う「前月の給与」の状況
 *
 * ■ 健康保険（介護保険・子ども・子育て支援金も）：年度（4月〜翌年3月）の標準賞与額の累計が573万円まで（健康保険法45条1項）
 *   ・累計に入れるのは、その賞与より前に支払った賞与の標準賞与額（1回ごとに1,000円未満を切り捨てた額）。後で支払う賞与は入れない
 *   ・協会けんぽの健康保険の被保険者だった間に決まった標準賞与額を累計する。保険料がかからない賞与
 *     （育児休業等で保険料が免除される期間に支払った賞与・資格喪失日の前日までに支払った資格喪失月の賞与）も累計に入れる
 *   ・入社日（資格取得日）より前・退職日の翌日（資格喪失日）以後・75歳の誕生日（後期高齢者医療制度へ移る日）以後に支払った賞与は、
 *     この会社の健康保険の標準賞与額が決まらないので入れない
 *   ・年度の途中でほかの会社から移ってきた人の、前の会社（同じ協会けんぽ）の標準賞与額は Q ではわからないので入れない
 * ■ 厚生年金：1か月の標準賞与額が150万円まで。同じ月に2回以上支払ったときは、合わせた額で150万円まで（厚生年金保険法24条の4）
 * 出典：日本年金機構「従業員に賞与を支給したときの手続き」（1．手続きの内容、4．留意事項）
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html
 *       日本年金機構「船員保険被保険者賞与支払届」の説明（育児休業等による保険料免除期間に支払われた賞与や資格喪失月に支払われた賞与の
 *       標準賞与額も、年度の累計額に含まれる。健康保険も同じしくみ）
 *       https://www.nenkin.go.jp/shinsei/kounen/seninhoken/hoshu-shoyo/shoyo.files/shouyoshousaisetumei.pdf
 *
 * ■ 賞与の所得税の「前月の給与」：賞与を支払う月の前月中に支払った給与（社会保険料等を引いた額）。
 *   前月中の給与がないとき・賞与が前月の給与の10倍を超えるときは、算出率の表を使わず、月額表を使う方法で計算する
 *   （国税庁「賞与に対する源泉徴収税額の算出率の表」の備考。utils/incomeTax.ts の calcBonusWithholdingTax）。
 *   Q では前月の給与を、確定した給与（salary_results）から読む。前月に給与を払うはずの人（前月に支払う給与の計算期間に在籍していた人）の
 *   給与がまだ確定していないと、前月の給与がないものとして計算してしまうので、知らせる
 */
import dayjs from "dayjs";
import { birthdayAt, checkSocialInsEnrolled } from "./calcSalary";

/** 同じ年度に支払った、ほかの賞与の1人分（標準賞与額は1回ごとに1,000円未満を切り捨てた額。上限で切る前） */
export interface OtherBonus {
  settingId: number;
  /** 支給日（YYYY-MM-DD） */
  paymentDate: string;
  standard: number;
}

/** その賞与より前に支払った賞与か（支給日が前。同じ日なら先に作った賞与） */
export const isEarlierBonus = (b: { settingId: number; paymentDate: string }, current: { settingId: number; paymentDate: string }) =>
  b.paymentDate < current.paymentDate || (b.paymentDate === current.paymentDate && b.settingId < current.settingId);

/** 健康保険の標準賞与額の年度（4月〜翌年3月。4月が入る年） */
export const bonusFiscalYearOf = (date: string): number => {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 ? y : y - 1;
};

/** 入社日〜退職日（資格喪失日の前日）で、社会保険に加入していた日か */
const insuredOn = (staff: any, date: string): boolean => {
  const [y, m] = date.split("-").map(Number);
  if (!checkSocialInsEnrolled(staff, y, m)) return false;
  if (staff.join_date && date < staff.join_date) return false;
  if (staff.retirement_date && date > staff.retirement_date) return false;
  return true;
};

/** その日に、この会社で健康保険の被保険者だったか（標準賞与額が決まる日か。75歳の誕生日から後期高齢者医療制度） */
export const isHealthInsuredOn = (staff: any, date: string): boolean =>
  insuredOn(staff, date) && !(staff.birthday && date >= birthdayAt(staff.birthday, 75).format("YYYY-MM-DD"));

/** その日に、この会社で厚生年金の被保険者だったか（70歳に達した日（誕生日の前日）に資格を失う） */
export const isPensionInsuredOn = (staff: any, date: string): boolean =>
  insuredOn(staff, date) && !(staff.birthday && date >= birthdayAt(staff.birthday, 70).subtract(1, "day").format("YYYY-MM-DD"));

/**
 * その賞与より前に支払った賞与の標準賞与額の累計
 * ・health：同じ年度の健康保険の累計（健康保険の被保険者だった日に支払ったもの）
 * ・pensionSameMonth：同じ月の厚生年金の累計（厚生年金の被保険者だった日に支払ったもの）
 */
export const earlierBonusTotals = (
  staff: any,
  others: OtherBonus[],
  current: { settingId: number; paymentDate: string },
): { health: number; pensionSameMonth: number } => {
  const fiscalYear = bonusFiscalYearOf(current.paymentDate);
  const month = current.paymentDate.slice(0, 7);
  let health = 0;
  let pensionSameMonth = 0;
  for (const b of others) {
    if (b.settingId === current.settingId || !isEarlierBonus(b, current)) continue;
    const standard = Math.max(0, Math.floor(Number(b.standard) || 0));
    if (bonusFiscalYearOf(b.paymentDate) === fiscalYear && isHealthInsuredOn(staff, b.paymentDate)) health += standard;
    if (b.paymentDate.slice(0, 7) === month && isPensionInsuredOn(staff, b.paymentDate)) pensionSameMonth += standard;
  }
  return { health, pensionSameMonth };
};

/** 上限まで（前の賞与で使った分を除いた残り）の標準賞与額 */
export const cappedBonusStandard = (standard: number, earlierTotal: number, limit: number): number =>
  Math.min(standard, Math.max(0, limit - earlierTotal));

/**
 * 賞与の所得税に使う前月の給与の状況
 * confirmed：前月に支払った給与を確定している / none：前月に給与を払っていない（その計算期間に在籍していない） /
 * unconfirmed：前月に給与を払うはずなのに、まだ確定していない（前月の給与がないものとして計算してしまう）
 */
export type PrevSalaryStatus = "confirmed" | "none" | "unconfirmed";

/**
 * @param confirmed 前月に支払った給与の確定結果があるか
 * @param period    前月に支払う給与の計算期間（給与規定グループの締日・当月払い／翌月払い。わからなければ null で前月の1日〜末日）
 * @param prevYear / prevMonth 前月（給与を支払った月）
 */
export const prevSalaryStatusOf = (
  staff: { join_date?: string | null; retirement_date?: string | null },
  confirmed: boolean,
  period: { startStr: string; endStr: string } | null,
  prevYear: number,
  prevMonth: number,
): PrevSalaryStatus => {
  if (confirmed) return "confirmed";
  const first = dayjs(`${prevYear}-${String(prevMonth).padStart(2, "0")}-01`);
  const start = period?.startStr ?? first.format("YYYY-MM-DD");
  const end = period?.endStr ?? first.endOf("month").format("YYYY-MM-DD");
  const employed = !(staff.join_date && staff.join_date > end) && !(staff.retirement_date && staff.retirement_date < start);
  return employed ? "unconfirmed" : "none";
};
