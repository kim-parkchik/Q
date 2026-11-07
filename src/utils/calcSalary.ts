/**
 * calcSalary.ts — 給与計算エンジン（2026年度版）
 *
 * 残業計算の法的根拠:
 *  - 1日8時間超 → 法定外残業（割増25%必須）
 *  - 週40時間超 → 法定外残業（割増25%必須）
 *  - 所定時間超〜8時間 → 法定内残業（割増義務なし、基本単価のみ）
 *  - 上記どちらかで月60時間超の分 → 割増50%必須
 *    （中小企業は2023年3月31日までに働いた分は猶予され25%。会社設定の「中小企業」で切り替える）
 *
 * 週40時間の数え方:
 *  - 1週間は、会社設定の週の起算曜日から7日（就業規則に定めがなければ日曜日から土曜日まで。昭和63年1月1日基発第1号）。
 *    その週の労働時間（法定休日の労働を除き、各日8時間まで）を日付順に足し、40時間に達した後の時間を、その日の法定外残業とする
 *  - 計算期間の初めの日がある週は、計算期間より前の日（前の計算期間の確定した勤怠。extras.weekCarryOver）の時間も足す。
 *    その日の給与は前の計算期間で払っているので、ここでは払わない（週の途中で計算期間が変わっても、週40時間を超えた時間を落とさない）
 *  - 法定外残業のうち、所定労働時間の中の時間（所定休日の出勤が週の途中にあって40時間を超えた、週の後のほうの所定労働日の時間・
 *    所定労働時間が週40時間・1日8時間を超えるときの時間）は、月給・日給（と月額の手当）で通常の賃金（1.0倍）を払っているので、
 *    割増分（25%・月60時間超は50%）だけを払う。所定の外の時間は、法定外残業なら1.25倍・1.5倍、法定内なら1.0倍で払う
 *    （労働基準法37条1項：時間外労働の時間について、通常の労働時間の賃金の計算額の2割5分以上の率で計算した割増賃金を払う。
 *     同じ時間に通常の賃金を2回払わない）
 *  出典：労働基準法32条・37条（e-Gov法令検索 https://laws.e-gov.go.jp/law/322AC0000000049）
 *
 * 固定残業代（月給制の人だけ）:
 *  - 時間外労働（1日8時間・週40時間超）の割増賃金に当てる定額の手当として、時間外労働の有無にかかわらず払う
 *  - 労働基準法37条で計算した時間外労働の割増賃金（25%・月60時間超は50%）が固定残業代を超えたら、差額を「超過分」として足して払う
 *  - 法定内残業・休日労働・深夜労働の手当は、固定残業代とは別に払う
 *  出典：厚生労働省「固定残業代を支払うこととすれば、残業や休日勤務をさせても別途に残業代を支払わなくてよいでしょうか？」
 *        https://www.startup-roudou.mhlw.go.jp/qa/zigyonushi/chingin/q11.html
 *        （医療法人康心会事件 最判平29.7.7、平29.7.31 基発0731第27号：固定残業代が37条で計算した額を下回るときは差額を払う）
 *
 * 残業代の対象外（従業員画面の「残業代対象」を外した人。管理監督者など）:
 *  - 労働基準法41条の人（管理監督者・機密の事務を取り扱う者・許可を受けた監視断続的労働の従事者など）は、
 *    労働時間・休日の規定が当てはまらないので、時間外労働（法定内残業を含む）・休日労働の割増賃金を払わない
 *  - 深夜労働の割増賃金（25%）は払う（41条で外れるのは労働時間・休憩・休日の規定だけ）
 *  - 時給制の人の、働いた時間の時給（1.0倍）はそのまま払う
 *  出典：労働基準法41条（e-Gov法令検索 https://laws.e-gov.go.jp/law/322AC0000000049）
 *        厚生労働省「労働基準法における管理監督者の範囲の適正化のために」https://www.mhlw.go.jp/bunya/roudoukijun/dl/kanri.pdf
 *
 * 残業代の時給（割増賃金の基礎）:
 *  - 月給は「1年間における1か月平均所定労働時間」（1年間の所定労働日数 × 1日の所定労働時間 ÷ 12）で割る（労基則19条1項4号）
 *  - 手当も入れる。入れなくてよいのは、家族手当・通勤手当・別居手当・子女教育手当・住宅手当・臨時に支払われた賃金・
 *    1か月を超える期間ごとに支払われる賃金だけ（労基法37条5項・労基則21条。当たるかは名前でなく中身で決まる）
 *    Q では、給与項目（支給）ごとに「残業代の時給に入れる」を選ぶ（固定残業代・通勤手当は入れない）
 *  - 時給制の人の月額の手当は、同じく1年間における1か月平均所定労働時間で割って時給に足す（労基則19条1項7号）。
 *    時給の1.0倍分は働いた時間の賃金で払っているので、手当の分は時間外・休日・深夜の割増に足す（法定内残業には足さない）
 *  - 1年間の所定労働日数は、呼び出し側が会社カレンダーから数えて渡す（extras.annualWorkDays。utils/annualWorkDays.ts）。
 *    渡されないときは、その月の所定労働日数で割る
 *  出典：労働基準法施行規則19条・21条、労働基準法37条（e-Gov法令検索 https://laws.e-gov.go.jp/law/322M40000100023）
 *        厚生労働省「残業、早出や休日出勤による割増賃金のチェック方法を教えてください。」
 *        https://www.check-roudou.mhlw.go.jp/qa/roudousya/chingin/q3.html
 *        （月給（各種手当を含んだ合計）÷ 1年間における1か月平均所定労働時間数）
 *
 * 欠勤控除（月給制の人だけ。absenceDeductionOf）:
 *  - 勤怠で「欠勤」の日の分を、月給から引く。割る日数は給与規定グループで選ぶ（法律では決まっておらず、会社の賃金規程による）
 *    ・計算期間の所定労働日数（会社カレンダーで数える。extras.periodWorkDays）
 *    ・1年間の月平均の所定労働日数（1年間の所定労働日数 ÷ 12。残業代の時給と同じ日数）
 *    ・引かない（完全月給制）
 *  - 1円未満は切り捨て、引く額はその月に払う基本給まで。日割りした月も、日割りする前の月給で計算する
 *  出典：厚生労働省「モデル就業規則（令和7年12月版）」第45条（欠勤等の扱い。月給は 基本給 ÷ 1か月平均所定労働時間数 で1時間あたりを出す）
 *
 * 日給制:
 *  - 所定労働日（出勤・半休）に働いた日に、日給を払う。所定休日・法定休日の労働には日給を払わず、
 *    月給制と同じく、働いた時間を残業（1.0倍・1.25倍）・休日労働（1.35倍）として払う。欠勤・公休の日は払わない
 *  - 残業代の時給は 日給 ÷ 1日の所定労働時間（労基則19条1項2号）＋ 月額の手当を時間あたりにした額（同7号）
 *  - 有給休暇の賃金は日給（労基則25条1項2号）。半休・時間単位の有給は、日給 ÷ 1日の所定労働時間 × 有給の時間（同2項）
 *  - 遅刻・早退の日も日給は満額払う（差し引くかは会社の規程による。月給制も差し引いていない）
 *  出典：労働基準法39条9項・施行規則25条（e-Gov法令検索）
 */
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import { applyRounding } from './payrollUtils';
import { calcPremium } from './socialInsurance';
import { 
  parseToDayjs, 
  getNightMinutesInPeriod, 
  getWeekKey
} from './timeUtils';
import { calcDailyHeiTaxByTable, calcWithholdingTax, toTaxColumn, type TaxCalcMethod, type TaxColumn } from './incomeTax';
import { checkLeaveExemptMonth, exemptLeavePeriodsOf } from './leaveExemption';
import { getStandardRemuneration } from './standardRemuneration';
import { commuteLimitOf, parseCommuteSetting, type CommuteMethod } from './commuteAllowance';
import * as Master from '../constants';

// プラグインの有効化
dayjs.extend(isSameOrAfter);

export interface SalaryExtras {
  allowanceName: string;
  allowanceAmount: number;
  residentTax: number;
  prefecture: string;
  dependents: number;
  /** 給与項目。inOvertimeBase が false の支給項目は、残業代の時給に入れない（省略時は入れる）。fixed は「固定（毎月同額）」の項目（日割りする） */
  customItems: { name: string; amount: number; type: 'earning' | 'deduction'; inOvertimeBase?: boolean; fixed?: boolean }[];
  /** 源泉所得税の計算方法（給与規定グループの設定。省略時は月額表） */
  taxMethod?: TaxCalcMethod;
  /** 定額減税（令和6年分）の、この給与より前に引ききれずに残っている額（対象外・未設定なら 0） */
  flatTaxReductionRemaining?: number;
  /** この給与で精算する年末調整の過不足額（＋なら還付、−なら徴収。なければ 0） */
  yearEndSettlement?: number;
  /** 1年間の所定労働日数（残業代の時給を出す「1年間における1か月平均所定労働時間」に使う。なければその月の所定労働日数で割る） */
  annualWorkDays?: number | null;
  /** 社会保険料の徴収（給与規定グループの設定。省略時は当月徴収） */
  socialInsCollection?: SocialInsCollection;
  /** 翌月徴収で、退職する月の給与から、その月の分の保険料も引く（この後に給与を払わないとき） */
  collectRetirementMonth?: boolean;
  /** 計算期間の途中で入社・退職した人の日割り（給与規定グループの設定。省略時はしない） */
  prorationMethod?: ProrationMethod;
  /** 月給制の人の欠勤控除のしかた（給与規定グループの設定。省略時は計算期間の所定労働日数で割る） */
  absenceDeductionMethod?: AbsenceDeductionMethod;
  /** 給与の計算期間（YYYY-MM-DD。日割りに使う） */
  period?: { start: string; end: string } | null;
  /**
   * 計算期間の所定労働日数と、そのうち在籍した日の所定労働日数（呼び出し側が会社カレンダーから数える）
   * periodWorkDays は、所定労働日数で日割りするときと欠勤控除に使い、確定した結果に残す（算定・月変の支払基礎日数）
   */
  periodWorkDays?: number | null;
  employedWorkDays?: number | null;
  /**
   * 計算期間の初めの日がある週のうち、計算期間より前の日の確定した勤怠（前の計算期間の日。weekCarryOverRange で読む）
   * 週40時間の累計にだけ足し、その日の給与は払わない。undefined は読み込み中（給与明細は、その間は確定しない）
   */
  weekCarryOver?: WeekCarryOverRow[];
}

/** 週40時間の累計に足す、前の計算期間の日の勤怠（attendance の必要な列） */
export interface WeekCarryOverRow {
  work_date: string;
  work_hours: number | string | null;
  work_type?: string | null;
}

export interface SalaryResult {
  workDays: number;
  totalWorkHours: number;
  totalOvertimeHours: number;     // 法定外残業時間合計（週40h超含む）
  totalNightHours: number;
  totalStatutoryOvertimeHours: number; // 法定内残業時間（所定超〜8h）
  standardPremiumHours: number; // ★追加：標準割増（25%）の対象時間
  highPremiumHours: number;     // ★追加：高率割増（50%）の対象時間
  deferredHighPremiumHours: number; // 月60時間超のうち、中小企業の猶予（2023年3月まで）で25%にした時間（standardPremiumHours の内数）
  /**
   * 法定外残業のうち、所定労働時間の中の時間（standardPremiumHours・highPremiumHours の内数）。
   * 通常の賃金は月給・日給（と月額の手当）で払っているので、割増分（25%・50%）だけを払った時間
   */
  overtimeWithinScheduleHours: number;
  /** 週40時間の累計に足した、前の計算期間の日（その期間と、足した時間。足していなければ null） */
  weekCarryOver: { from: string; to: string; hours: number } | null;
  holidayWorkHours: number;     // 法定休日の労働時間
  paidLeaveHours: number;       // 有給休暇の時間（時給制で賃金を払う時間）
  basePay: number;
  /** 欠勤控除（月給制の人だけ。給与規定グループの設定で計算する） */
  absenceDeduction: number;
  /** 欠勤した日数（勤怠で「欠勤」の日） */
  absenceDays: number;
  /** 欠勤控除のしかた（給与規定グループの設定） */
  absenceDeductionMethod: AbsenceDeductionMethod;
  /** 欠勤控除の計算式（明細に出す。月給制で欠勤がなければ null） */
  absenceDeductionDetail: string | null;
  /** 欠勤控除の注意（会社カレンダーを読み込めていない など。なければ null） */
  absenceDeductionNote: string | null;
  /** 計算期間の所定労働日数（会社カレンダーから数えたもの。わからなければ null）。確定した結果に残し、算定・月変の支払基礎日数に使う */
  periodWorkDays: number | null;
  statutoryOvertimePay: number;   // 法定内残業代（割増なし）
  standardOvertimePay: number;
  highOvertimePay: number;
  holidayWorkPay: number;         // 法定休日労働の手当（35%増）
  /** 固定残業代（月給制で設定がある人。なければ 0）。standardOvertimePay・highOvertimePay は、これに当てる法定の計算額になる */
  fixedOvertimeAllowance: number;
  /** 固定残業代が何時間分か（表示用） */
  fixedOvertimeHours: number;
  /** 時間外労働の割増賃金（法定の計算額）が固定残業代を超えた差額（固定残業代の超過分として払う） */
  fixedOvertimeExcess: number;
  /** 残業代の対象か（false なら、時間外・休日の割増賃金を払わず、深夜の割増賃金だけ払う） */
  isOvertimeEligible: boolean;
  /** 残業代の時給（月給制は (月給＋手当) ÷ 時間、時給制は 時給＋手当を時間あたりにした額。割増率を掛ける前） */
  overtimeHourlyRate: number;
  /** 残業代の時給に入れた手当の月額 */
  overtimeBaseAllowances: number;
  /** 月給・手当を割った時間（1か月平均所定労働時間。overtimeBaseHoursIsAnnual が false なら、その月の所定労働時間） */
  overtimeBaseHours: number;
  /** 1年間における1か月平均所定労働時間で割ったか */
  overtimeBaseHoursIsAnnual: boolean;
  /** 日給制で日給を払った日数（半休・時間単位の有給の日は、働いた割合で数える。月給制・時給制は 0） */
  dailyWageDays: number;
  /** 源泉所得税の計算に使った扶養親族等の数（確定した結果に「その時の扶養人数」として残す） */
  appliedDependents: number;
  nightPay: number;
  paidLeavePay: number;           // 有給休暇の賃金（時給制・日給制）
  commutePay: number;
  allowanceAmount: number;
  customEarnings: number;
  /** 給与項目ごとの支給額・控除額（固定の支給項目は日割りした額） */
  customEarningLines: { name: string; amount: number }[];
  customDeductionLines: { name: string; amount: number }[];
  /** 計算期間の途中で入社・退職したときの日割り（日割りしなければ null）。基本給（月給制）と固定の支給項目に使う */
  proration: Proration | null;
  /** 日割りできなかったときの注意 */
  prorationNote: string | null;
  totalEarnings: number;
  /**
   * 支給合計のうち非固定的賃金（残業代・休日や深夜の手当・「変動（毎月入力）」の支給項目）。残りは固定的賃金
   * 月変の年間平均（固定的賃金と非固定的賃金を分けて平均する）のため、確定した結果に残す
   */
  nonFixedEarnings: number;
  /** 通勤手当のうち所得税がかからない額 */
  nonTaxableCommute: number;
  /** 通勤手当の非課税限度額（1か月当たり。通勤の方法・片道の距離などで決まる。utils/commuteAllowance.ts）と、その通勤の方法 */
  commuteTaxFreeLimit: number;
  commuteMethod: CommuteMethod;
  /** 所得税の対象になる支給額（支給合計 − 非課税の通勤手当） */
  taxableAmount: number;
  healthInsurance: number;
  nursingInsurance: number;
  /** 子ども・子育て支援金（令和8年4月分から） */
  childSupport: number;
  welfarePension: number;
  empInsurance: number;
  /** 源泉所得税（定額減税を引いた後の、実際に控除する額） */
  incomeTax: number;
  /** 定額減税を引く前の源泉所得税 */
  incomeTaxBeforeReduction: number;
  /** 源泉所得税の欄（甲欄・乙欄・丙欄） */
  taxColumn: TaxColumn;
  /**
   * 丙欄で計算した日ごとの、社会保険料等控除後の給与等の金額と税額（丙欄でなければ空）
   * date が null は、働いた日がなく1日分として計算したもの
   */
  heiDays: { date: string | null; amount: number; tax: number }[];
  /** 丙欄の注意（入社から2か月を超えて働いた日がある・月給制の人など。なければ空） */
  heiWarnings: string[];
  /** この給与で差し引いた定額減税額 */
  flatTaxReduction: number;
  /** この給与のあとに残る定額減税額（次の給与から引く） */
  flatTaxReductionRemaining: number;
  residentTax: number;
  customDeductions: number;
  totalDeductions: number;
  /** この給与で精算した年末調整の過不足額（＋還付／−徴収）。差引支給額に含む */
  yearEndSettlement: number;
  netPay: number;
  isNursingCareTarget: boolean;
  /** 年齢で健康保険の対象か（75歳の誕生月の分からは false） */
  isHealthInsAgeTarget: boolean;
  /** 年齢で厚生年金の対象か（70歳に達した月の分からは false） */
  isPensionAgeTarget: boolean;
  /** 入社日・退職日で、その月の分の社会保険料がかかるか（入社前の月・資格喪失日がある月の分からは false） */
  isInsuredMonth: boolean;
  /** 産休・育休で、その月の分の社会保険料が免除されるか */
  isLeaveExemptMonth: boolean;
  /** 社会保険料の徴収（当月徴収・翌月徴収） */
  socialInsCollection: SocialInsCollection;
  /** この給与から引いた社会保険料が何年何月分か（YYYY-MM。翌月徴収の退職月は2か月分）。isInsuredMonth などは最初の月の状態 */
  socialInsMonths: string[];
  /** 翌月徴収で、退職する月の分の保険料もこの給与から引けるか（画面で選ぶ） */
  retirementMonthCollectable: boolean;
  hyojunHoshu: number;
  /** 健康保険・厚生年金に加入しているか（標準報酬月額が未設定・社保規定が「未加入」なら false） */
  isSocialInsEnrolled: boolean;
  /** 雇用保険に加入しているか */
  isEmploymentInsEnrolled: boolean;
  /** 健康保険料がかかるのに、都道府県がわからない（extras.prefecture が空・知らない名前）ので、健康保険料・介護保険料を計算していない（0円）。確定できない */
  prefectureUnknown: boolean;
}

/**
 * 勤怠区分ごとの、その日の所定労働時間（これを超えて8時間までが法定内残業）
 * ・出勤：所定どおり
 * ・半休：残りの半日分
 * ・所定休日の出勤など：所定労働時間なし（働いた時間はすべて残業になる）
 * 時間単位の有給を取った時間は、所定労働時間から差し引く
 */
const scheduledHoursOf = (type: string, scheduledHours: number, paidLeaveHours: number): number => {
  const base = type === 'normal' ? scheduledHours
             : type === 'paid_half' ? scheduledHours / 2
             : 0;
  return Math.max(0, base - paidLeaveHours);
};

/**
 * 時給制・日給制で賃金を払う有給休暇の時間（所定労働時間を働いた場合の通常の賃金で払う）
 * ・全休：1日の所定労働時間
 * ・半休：その半分
 * ・時間単位の有給：取った時間
 */
const paidLeaveHoursOf = (type: string, scheduledHours: number, paidLeaveHours: number): number => {
  const days = type === 'paid_full' ? scheduledHours
             : type === 'paid_half' ? scheduledHours / 2
             : 0;
  return days + paidLeaveHours;
};

/**
 * その日の法定外残業を「25%の時間」と「50%の時間（月60時間超）」に分ける
 * ・60時間の累計（hoursSoFar）には、猶予の有無にかかわらず、その月のそれまでの法定外残業をすべて数える
 *   （「起算日からの時間外労働時間数を累計して60時間を超えた時点から」50%）
 * ・中小企業が2023年3月31日までに働かせた分は、60時間を超えても25%（deferred に数える）
 */
export const splitOvertimeHours = (
  todayHours: number,
  hoursSoFar: number,
  workDate: string,
  isSmallBusiness: boolean
) => {
  const over60 = Math.max(0, todayHours - Math.max(0, Master.OVERTIME_PREMIUM_LIMIT_HOURS - hoursSoFar));
  if (isSmallBusiness && workDate < Master.SME_OVERTIME_PREMIUM_FROM) {
    return { standard: todayHours, high: 0, deferred: over60 };
  }
  return { standard: todayHours - over60, high: over60, deferred: 0 };
};

/**
 * その日の働いた時間を、所定労働時間の外の時間で分ける
 * ・beyond：法定外残業のうち、所定労働時間の外の時間（通常の賃金も払っていないので、1.25倍・1.5倍で払う）
 * ・statutory：所定労働時間の外の時間のうち、法定外残業でない時間（法定内残業。1.0倍）
 * 法定外残業のうち beyond を除いた時間は、所定労働時間の中の時間（通常の賃金は月給・日給で払っているので、割増分だけ）
 */
export const splitBySchedule = (workHours: number, scheduled: number, legalOvertime: number) => {
  const outside = Math.max(0, workHours - scheduled);
  const beyond = Math.min(legalOvertime, outside);
  return { beyond, statutory: outside - beyond };
};

/**
 * 法定外残業のうち、所定労働時間の中の時間を、25%の時間と50%の時間（月60時間超）に分ける
 * 法定外残業（1日8時間・週40時間を超えた時間）も、所定労働時間の外の時間も、月60時間を超えた時間も、どれもその日の終わりのほうの
 * 時間なので、月60時間を超えた時間は、所定労働時間の外の時間から先に当たる
 * @param legalOvertime その日の法定外残業
 * @param beyond 法定外残業のうち、所定労働時間の外の時間（splitBySchedule）
 * @param high 法定外残業のうち、月60時間を超えた時間（splitOvertimeHours）
 */
export const withinScheduleSplit = (legalOvertime: number, beyond: number, high: number) => {
  const within = Math.max(0, legalOvertime - beyond);
  const withinHigh = Math.min(within, Math.max(0, high - beyond));
  return { standard: within - withinHigh, high: withinHigh };
};

export const PREFECTURES = Object.keys(Master.INSURANCE_2026.KENPO_RATES);

export const getHyojunHoshu = (
  monthly: number,
  table: [number, number, number][] = Master.INSURANCE_2026.HYOJUN_TABLE
): number => {
  for (const [lo, hi, std] of table) {
    if (monthly >= lo && monthly < hi) return std;
  }
  return table[table.length - 1][2];
};

// 源泉所得税：甲欄は支払った年の月額表、または電算機計算の特例で、乙欄は月額表で計算する（詳しくは utils/incomeTax.ts）
const getGensenTax = (taxBase: number, dependents: number, payYear: number, method: TaxCalcMethod | undefined, column: TaxColumn): number =>
  calcWithholdingTax(taxBase, dependents, payYear, method ?? "table", column);

/** その年齢になる誕生日（2月29日生まれで、うるう年でない年は3月1日） */
export const birthdayAt = (birthday: string, age: number) => {
  const b = dayjs(birthday);
  return dayjs(new Date(b.year() + age, b.month(), b.date()));
};
/** その年齢に達する日（誕生日の前日。年齢計算ニ関スル法律）がある月の初日 */
const monthReachingAge = (birthday: string, age: number) =>
  birthdayAt(birthday, age).subtract(1, 'day').startOf('month');

/**
 * 年齢で決まる、その月の分の社会保険料がかかるかどうか（給与・賞与の両方で使う）
 * 資格を失った月の分の保険料はかからず、その月に支払った賞与にもかからない。
 * ・健康保険（子ども・子育て支援金も）：75歳の誕生日当日に後期高齢者医療制度へ移って資格を失う → 誕生日がある月の前月分まで
 * ・介護保険：40歳に達した日がある月の分から、65歳に達した日がある月の前月分まで
 * ・厚生年金：70歳に達した日（誕生日の前日）に資格を失う → その日がある月の前月分まで（その後は70歳以上被用者）
 * 年齢に達するのは誕生日の前日なので、1日生まれの人は誕生月の前月が区切りになる
 * （例：1986年4月1日生まれ → 2026年3月31日に40歳に達する → 2026年3月分から介護保険）
 * 出典：日本年金機構 https://www.nenkin.go.jp/section/faq/kounen/jigyonushi/70hiyosha.html
 *      （「厚生年金保険は70歳（70歳の誕生日前日が属する月の前月まで）、健康保険は75歳まで（75歳誕生日当日が属する月の前月まで）」）
 *       賞与：https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html （資格喪失月に支払われた賞与は保険料賦課の対象とならない）
 */
export const getInsuranceByAge = (birthday: string, year: number, month: number) => {
  if (!birthday) return { health: true, nursing: false, pension: true };
  const target = dayjs(new Date(year, month - 1, 1));
  return {
    health: target.isBefore(birthdayAt(birthday, Master.INSURANCE_2026.HEALTH_INS_END_AGE).startOf('month')),
    nursing: target.isSameOrAfter(monthReachingAge(birthday, Master.INSURANCE_2026.NURSING_CARE_START_AGE))
      && target.isBefore(monthReachingAge(birthday, Master.INSURANCE_2026.NURSING_CARE_END_AGE)),
    pension: target.isBefore(monthReachingAge(birthday, Master.INSURANCE_2026.PENSION_END_AGE)),
  };
};

/** 介護保険の対象（第2号被保険者）かどうか */
export const checkNursingCare = (birthday: string, year: number, month: number): boolean =>
  getInsuranceByAge(birthday, year, month).nursing;

/**
 * 健康保険・厚生年金に加入しているか
 * （その月の標準報酬月額が0＝未加入・対象外、または社保規定が「未加入 / 適用除外」なら加入していない）
 */
export const checkSocialInsEnrolled = (staff: any, year: number, month: number): boolean => {
  const socialGroupId = staff.social_insurance_group_id;
  return getStandardRemuneration(staff, year, month) > 0 && (socialGroupId === undefined || Number(socialGroupId) > 0);
};

/** 雇用保険に加入しているか（従業員画面の「雇用保険加入」を外した人＝役員など は加入していない） */
export const checkEmploymentInsEnrolled = (staff: any): boolean =>
  Number(staff.is_employment_ins_eligible ?? 1) !== 0;

/** 資格喪失日（退職日の翌日）。退職日が空なら null */
const lossDateOf = (retirementDate?: string | null) =>
  retirementDate ? dayjs(retirementDate).add(1, 'day') : null;

/**
 * 入社日・退職日で決まる、その月の分の健康保険・厚生年金（介護保険・子ども・子育て支援金も）がかかるかどうか
 * ・資格取得日は入社日、資格喪失日は退職日の翌日
 * ・保険料は、資格取得日がある月の分から、資格喪失日がある月の前月分までかかる（日割りはしない）
 *   → 月の途中で退職した人は、退職した月の分はかからない。月末に退職した人は、退職した月の分までかかる
 * ・入社した月に退職した（同月得喪）ときは、その月の分がかかる
 *   （厚生年金は、その月にほかの厚生年金・国民年金に入ると、あとで年金事務所から会社へ還付される）
 * 出典：日本年金機構 https://www.nenkin.go.jp/section/faq/kounen/hihokensha/20140902-01.html
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/nofu/20120330-01.html
 *       健康保険法156条3項（前月から引き続き被保険者である者が資格を喪失した月の分は算定しない）
 */
export const checkInsuredMonth = (
  joinDate: string | null | undefined,
  retirementDate: string | null | undefined,
  year: number,
  month: number,
): boolean => {
  const target = dayjs(new Date(year, month - 1, 1));
  const joinMonth = joinDate ? dayjs(joinDate).startOf('month') : null;
  if (joinMonth && target.isBefore(joinMonth)) return false;
  const loss = lossDateOf(retirementDate);
  if (!loss) return true;
  const lossMonth = loss.startOf('month');
  if (target.isBefore(lossMonth)) return true;
  // 資格喪失日がある月は、同月得喪のときだけかかる
  return target.isSame(lossMonth) && !!joinMonth && joinMonth.isSame(lossMonth);
};

/**
 * 入社日・退職日で決まる、その日に支払う賞与に健康保険・厚生年金（介護保険・子ども・子育て支援金も）がかかるかどうか
 * ・資格取得日（入社日）以後に支払った賞与にかかる
 * ・資格喪失日（退職日の翌日）がある月に支払った賞与にはかからない（月末に退職した人は、退職した月の賞与にもかかる）
 * ・入社した月に退職した（同月得喪）ときは、入社日から退職日までに支払った賞与にかかる
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20141203.html （留意事項(6)）
 */
export const checkInsuredOnBonusDate = (
  joinDate: string | null | undefined,
  retirementDate: string | null | undefined,
  payDate: string,
): boolean => {
  const pay = dayjs(payDate);
  if (joinDate && pay.isBefore(dayjs(joinDate), 'day')) return false;
  if (!checkInsuredMonth(joinDate, retirementDate, pay.year(), pay.month() + 1)) return false;
  // 同月得喪の月でも、資格喪失日より後に支払った賞与にはかからない
  const loss = lossDateOf(retirementDate);
  return !loss || pay.isBefore(loss, 'day');
};

/**
 * その月の土日を除いた日数（会社カレンダーを読み込めていないときの代わり。祝日・会社カレンダーは見ない）
 * 1年間の所定労働日数がわからないときの残業代の時給、計算期間の所定労働日数がわからないときの欠勤控除と、
 * 計算期間の所定労働日数を残していない確定した給与の支払基礎日数（utils/santei.ts）に使う
 * 従業員に月の所定労働日数（monthly_work_days）があればそれを使う
 */
export const prescribedWorkDays = (staff: any, year: number, month: number): number => {
  const daysInMonth = new Date(year, month, 0).getDate();
  let weekends = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 0 || dow === 6) weekends++;
  }
  return Number(staff.monthly_work_days) || (daysInMonth - weekends);
};

/* --- 外部から呼び出すメインロジック --- */

/**
 * 総労働時間と深夜時間を同時に計算する
 */
export const calcDetailedDiff = (inT: string, outT: string, bStart: string, bEnd: string, outV?: string, returnV?: string) => {
  const isValidTime = (t?: string) => t && t !== "" && t !== "--:--" && t.length >= 5;

  if (!isValidTime(inT) || !isValidTime(outT)) {
    return { total: NaN, night: NaN };
  }

  const start = parseToDayjs(inT);
  let end = parseToDayjs(outT);
  
  // 深夜02:00 〜 06:00 のような場合、end は start より後なのでそのまま。
  // 22:00 〜 02:00 のような場合のみ、end を翌日にする。
  if (end.isBefore(start)) {
    end = end.add(1, 'day');
  }

  let totalMin = end.diff(start, 'minute');
  // この nightMin の計算に修正した getNightMinutesInPeriod を使う
  let nightMin = getNightMinutesInPeriod(start, end);

  // 休憩時間の控除
  const deduct = (sStr?: string, eStr?: string) => {
    // 1. バリデーション
    if (!isValidTime(sStr) || !isValidTime(eStr)) return;

    // 2. Dayjsオブジェクトに変換（変数名を引数と明確に分ける）
    const ds = parseToDayjs(sStr!);
    let de = parseToDayjs(eStr!);

    // 3. 日またぎ補正（休憩終了が開始より前なら翌日扱い）
    if (de.isBefore(ds)) {
      de = de.add(1, 'day');
    }

    // 4. 計算と減算
    const diffMin = de.diff(ds, 'minute');
    totalMin -= diffMin;
    nightMin -= getNightMinutesInPeriod(ds, de);
  };

  deduct(bStart, bEnd);
  deduct(outV, returnV);

  return {
    total: Math.round((totalMin / 60) * 1000) / 1000,
    night: Math.round((nightMin / 60) * 1000) / 1000
  };
};

/**
 * 従業員の給与項目（自動計算の項目を除き、金額が入っているもの）を読む
 * 支給項目には、残業代の時給に入れるか（inOvertimeBase）も付ける
 */
export const loadCustomItems = async (db: any, staffId: string | number): Promise<SalaryExtras['customItems']> => {
  const rows = await db.select(
    `SELECT m.name, m.type, m.category, COALESCE(v.amount, 0) as amount, COALESCE(m.in_overtime_base, 1) as in_overtime_base
    FROM salary_item_master m
    LEFT JOIN staff_salary_values v ON m.id = v.item_id AND v.staff_id = ?
    WHERE m.category != 'formula'
    ORDER BY m.type DESC, m.id ASC`,
    [staffId]
  ) as { name: string; type: 'earning' | 'deduction'; category: string; amount: number; in_overtime_base: number }[];
  return rows
    .filter(r => Number(r.amount) > 0)
    .map(r => ({ name: r.name, amount: Number(r.amount), type: r.type, inOvertimeBase: Number(r.in_overtime_base) !== 0, fixed: r.category === 'fixed' }));
};

/**
 * 週40時間の累計に足す、前の計算期間の日：計算期間の初めの日がある週のうち、初めの日より前の日（YYYY-MM-DD）
 * 初めの日が週の最初の日なら null
 * @param weekStartDay 週の起算曜日（0=日曜, 1=月曜, ..., 6=土曜。会社設定の week_start_day）
 */
export const weekCarryOverRange = (periodStart: string, weekStartDay: number): { from: string; to: string } | null => {
  if (!periodStart) return null;
  const from = getWeekKey(periodStart, weekStartDay);
  if (from >= periodStart) return null;
  return { from, to: dayjs(periodStart).subtract(1, 'day').format('YYYY-MM-DD') };
};

/** 週40時間の累計に足す、前の計算期間の日の確定した勤怠を読む（その日がなければ空） */
export const loadWeekCarryOver = async (
  db: any,
  staffId: string | number,
  periodStart: string,
  weekStartDay: number,
): Promise<WeekCarryOverRow[]> => {
  const range = weekCarryOverRange(periodStart, weekStartDay);
  if (!range) return [];
  const rows = await db.select(
    "SELECT work_date, work_hours, work_type FROM attendance WHERE staff_id = ? AND work_date BETWEEN ? AND ? AND is_finalized = 1",
    [staffId, range.from, range.to]
  ) as WeekCarryOverRow[];
  return rows ?? [];
};

/**
 * 給与計算結果をDBに保存する（確定処理）
 */
export const saveSalaryResult = async (
  db: any, 
  staffId: string, 
  year: number, 
  month: number, 
  result: SalaryResult,
  staffMaster: any // その月の分の基本給（utils/staffHistory.ts の staffAsOf を通した従業員）。確定した結果に残す
) => {
  const sql = `
    INSERT INTO salary_results (
      staff_id, target_year, target_month,
      applied_base_wage, applied_dependents,
      total_work_hours, total_overtime_hours, total_night_hours,
      standard_overtime_hours, high_overtime_hours,
      standard_overtime_pay, high_overtime_pay, statutory_overtime_pay,
      fixed_overtime_allowance, fixed_overtime_excess, non_fixed_earnings,
      absence_deduction, prescribed_work_days,
      total_earnings, taxable_amount,
      health_insurance, nursing_insurance, child_support, welfare_pension, emp_insurance,
      social_ins_total, income_tax, flat_tax_reduction, resident_tax, year_end_adjustment, net_pay
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(staff_id, target_year, target_month) DO UPDATE SET
      applied_base_wage = excluded.applied_base_wage,
      applied_dependents = excluded.applied_dependents,
      total_work_hours = excluded.total_work_hours,
      total_overtime_hours = excluded.total_overtime_hours,
      total_night_hours = excluded.total_night_hours,
      standard_overtime_hours = excluded.standard_overtime_hours,
      high_overtime_hours = excluded.high_overtime_hours,
      standard_overtime_pay = excluded.standard_overtime_pay,
      high_overtime_pay = excluded.high_overtime_pay,
      statutory_overtime_pay = excluded.statutory_overtime_pay,
      fixed_overtime_allowance = excluded.fixed_overtime_allowance,
      fixed_overtime_excess = excluded.fixed_overtime_excess,
      non_fixed_earnings = excluded.non_fixed_earnings,
      absence_deduction = excluded.absence_deduction,
      prescribed_work_days = excluded.prescribed_work_days,
      total_earnings = excluded.total_earnings,
      taxable_amount = excluded.taxable_amount,
      health_insurance = excluded.health_insurance,
      nursing_insurance = excluded.nursing_insurance,
      child_support = excluded.child_support,
      welfare_pension = excluded.welfare_pension,
      emp_insurance = excluded.emp_insurance,
      social_ins_total = excluded.social_ins_total,
      income_tax = excluded.income_tax,
      flat_tax_reduction = excluded.flat_tax_reduction,
      resident_tax = excluded.resident_tax,
      year_end_adjustment = excluded.year_end_adjustment,
      net_pay = excluded.net_pay,
      processed_at = DATETIME('now', 'localtime');
  `;

  const params = [
    staffId, year, month,
    staffMaster.base_wage, result.appliedDependents,
    result.totalWorkHours, result.totalOvertimeHours, result.totalNightHours,
    result.standardPremiumHours, result.highPremiumHours,
    result.standardOvertimePay, result.highOvertimePay, result.statutoryOvertimePay,
    result.fixedOvertimeAllowance, result.fixedOvertimeExcess, result.nonFixedEarnings,
    // 欠勤控除の額と計算期間の所定労働日数（算定・月変の支払基礎日数に使う。utils/santei.ts）
    result.absenceDeduction, result.periodWorkDays,
    result.totalEarnings, result.taxableAmount, // 課税対象額（非課税の通勤手当を除く）
    result.healthInsurance, result.nursingInsurance, result.childSupport, result.welfarePension, result.empInsurance,
    (result.healthInsurance + result.nursingInsurance + result.childSupport + result.welfarePension + result.empInsurance),
    result.incomeTax, result.flatTaxReduction, result.residentTax, result.yearEndSettlement, result.netPay
  ];

  try {
    // db.run ではなく db.execute を使います
    await db.execute(sql, params); 
    return { success: true };
  } catch (error) {
    console.error("Failed to save salary result:", error);
    return { success: false, error };
  }
};

/** 社会保険料の徴収：current: 当月徴収（その月の分を、その月に支払う給与から引く） / next: 翌月徴収（前月の分を引く） */
export type SocialInsCollection = 'current' | 'next';

export const SOCIAL_INS_COLLECTION_LABELS: Record<SocialInsCollection, string> = {
  current: '当月徴収',
  next: '翌月徴収',
};

export const toSocialInsCollection = (value: unknown): SocialInsCollection => (value === 'next' ? 'next' : 'current');

const ymOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * 翌月徴収で、退職する月に支払う給与から、その月の分の保険料も引けるか
 * 退職日がその月にあり、その月の分の保険料がかかる（月末に退職した）とき
 */
export const isRetirementMonthCollectable = (staff: any, year: number, month: number, collection: SocialInsCollection): boolean =>
  collection === 'next'
  && !!staff.retirement_date && String(staff.retirement_date).slice(0, 7) === ymOf(year, month)
  && checkInsuredMonth(staff.join_date, staff.retirement_date, year, month);

/**
 * その月に支払う給与から引く社会保険料が、何年何月分か
 * ・当月徴収：支払う月の分
 * ・翌月徴収：前月の分。退職する月の給与で、この後に給与を払わないとき（collectRetirementMonth）は、その月の分も引く
 * 出典：健康保険法167条1項・厚生年金保険法84条1項（e-Gov法令検索）
 *       「被保険者の負担すべき前月の標準報酬月額に係る保険料（使用されなくなった場合は、前月及びその月の標準報酬月額に係る保険料）を
 *        報酬から控除することができる」。賞与の保険料は、その賞与の標準賞与額の分をその賞与から引く（同2項。徴収月に関係ない）
 */
export const socialInsMonthsOf = (
  staff: any,
  year: number,
  month: number,
  collection: SocialInsCollection,
  collectRetirementMonth = false,
): { year: number; month: number }[] => {
  if (collection === 'current') return [{ year, month }];
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return collectRetirementMonth && isRetirementMonthCollectable(staff, year, month, collection) ? [prev, { year, month }] : [prev];
};

/** ある月の分の社会保険料（健康保険・介護保険・子ども・子育て支援金・厚生年金）と、その月の加入・年齢・免除の状態 */
const socialPremiumsOf = (staff: any, year: number, month: number, prefecture: string, companySettings: any) => {
  // 保険料の対象月に合った料率（健康保険は3月分から新年度）
  const ins = Master.getInsuranceMaster(year, month);

  // 1. 加入しているかと標準報酬月額
  // 従業員画面で「標準報酬月額 0：未加入・対象外」または社保規定「未加入 / 適用除外」を選んだ人からは控除しない
  // （標準報酬月額は資格取得時・算定基礎・月変で決まり、毎月の給与からは計算しない）
  // 標準報酬月額は、その月の分に使う値（履歴から。詳しくは utils/standardRemuneration.ts）
  const isSocialInsEnrolled = checkSocialInsEnrolled(staff, year, month);
  const hyojunHoshu = isSocialInsEnrolled ? getStandardRemuneration(staff, year, month) : 0;

  // 2. 料率の取得と計算（本人負担分 = 標準報酬月額 × 料率 ÷ 2）
  // 年齢で、健康保険（75歳の誕生月から）・介護保険（40〜64歳）・厚生年金（70歳に達した月から）の対象が変わる
  const byAge = getInsuranceByAge(staff.birthday || '', year, month);
  // 入社前の月・資格喪失日（退職日の翌日）がある月からの分は、どの社会保険料もかからない
  const isInsuredMonth = checkInsuredMonth(staff.join_date, staff.retirement_date, year, month);
  // 産休・育休で免除される月の分も、どの社会保険料もかからない（詳しくは utils/leaveExemption.ts。役員の育休は免除されない）
  const isLeaveExemptMonth = checkLeaveExemptMonth(exemptLeavePeriodsOf(staff), year, month);
  const isSocialInsMonth = isSocialInsEnrolled && isInsuredMonth && !isLeaveExemptMonth;
  // 健康保険の料率は都道府県（協会けんぽの支部）ごと。都道府県がわからなければ（拠点の都道府県が未登録など）、
  // 健康保険料・介護保険料は計算しない（ほかの都道府県で仮に計算しない）。画面で知らせ、確定できないようにする
  const kenpoRate = ins.KENPO_RATES[prefecture];
  const healthRate = kenpoRate ? kenpoRate[1] : null; // 合計の料率(%)
  // 社会保険料（本人負担分）の端数：会社の設定（なければ、給与から引くときの原則の50銭以下切り捨て・50銭超切り上げ）
  const sInsType = companySettings?.round_social_ins || 'currency_law';
  const kenpoHyojun = Math.min(hyojunHoshu, ins.KENPO_MAX_HYOJUN);

  let healthInsurance = 0, nursingInsurance = 0, childSupport = 0, welfarePension = 0;
  /** 健康保険料がかかる月なのに、都道府県がわからないので計算していない */
  const healthRateMissing = isSocialInsMonth && byAge.health && healthRate === null;
  if (isSocialInsMonth && byAge.health) {
    if (healthRate !== null) {
      // 健康保険料
      healthInsurance = calcPremium(kenpoHyojun, healthRate, sInsType);

      // 介護保険料（40〜64歳）
      // 協会けんぽの保険料額表と同じく「健康保険＋介護保険」の料率でまとめて計算し、健康保険料を引いた残りを介護保険料とする
      if (byAge.nursing) {
        const combined = calcPremium(kenpoHyojun, healthRate + ins.KENPO_CARE_RATE[1], sInsType);
        nursingInsurance = combined - healthInsurance;
      }
    }

    // 子ども・子育て支援金（令和8年4月分から。健康保険と同じ標準報酬月額に支援金率を掛ける）
    if (Master.isChildSupportMonth(ins, year, month) && ins.CHILD_SUPPORT_RATE) {
      childSupport = calcPremium(kenpoHyojun, ins.CHILD_SUPPORT_RATE[1], sInsType);
    }
  }
  if (isSocialInsMonth && byAge.pension) {
    // 厚生年金（標準報酬月額は 88,000円〜650,000円 の範囲）
    const pensionHyojun = Math.max(ins.PENSION_MIN_HYOJUN, Math.min(hyojunHoshu, ins.PENSION_MAX_HYOJUN));
    welfarePension = calcPremium(pensionHyojun, ins.PENSION_RATE[1], sInsType);
  }
  return { isSocialInsEnrolled, hyojunHoshu, byAge, isInsuredMonth, isLeaveExemptMonth, healthInsurance, nursingInsurance, childSupport, welfarePension, healthRateMissing };
};

/** 計算期間の途中で入社・退職した人の日割り：none: しない / workdays: 所定労働日数で / calendar: 暦日数で */
export type ProrationMethod = 'none' | 'workdays' | 'calendar';

export const PRORATION_METHOD_LABELS: Record<ProrationMethod, string> = {
  none: '日割りしない',
  workdays: '所定労働日数で日割り',
  calendar: '暦日数で日割り',
};

export const toProrationMethod = (value: unknown): ProrationMethod =>
  (value === 'workdays' || value === 'calendar' ? value : 'none');

/**
 * 月給制の人の欠勤控除のしかた（給与規定グループの設定。決め方は法律にはなく、会社の賃金規程で決める）
 * ・workdays：月給 × 欠勤日数 ÷ 計算期間の所定労働日数（会社カレンダーで数える。1日分の額は月ごとに変わる）
 * ・annual：月給 × 欠勤日数 ÷ 1年間の月平均の所定労働日数（1年間の所定労働日数 ÷ 12。残業代の時給と同じ日数で、1日分の額は1年を通して同じ）
 *   （厚生労働省「モデル就業規則（令和7年12月版）」第45条第2項：月給の場合、控除する賃金の1時間あたりの金額は
 *    基本給 ÷ 1か月平均所定労働時間数。1日の所定労働時間が同じなら、この日数で割るのと同じになる）
 * ・none：欠勤控除をしない（完全月給制）
 */
export type AbsenceDeductionMethod = 'workdays' | 'annual' | 'none';

export const ABSENCE_DEDUCTION_METHOD_LABELS: Record<AbsenceDeductionMethod, string> = {
  workdays: '計算期間の所定労働日数で割る',
  annual: '1年間の月平均の所定労働日数で割る',
  none: '欠勤控除をしない（完全月給制）',
};

/** 設定がない・知らない値は「計算期間の所定労働日数で割る」 */
export const toAbsenceDeductionMethod = (value: unknown): AbsenceDeductionMethod =>
  (value === 'annual' || value === 'none' ? value : 'workdays');

/** 欠勤控除の額と、明細に出す計算式・注意 */
export interface AbsenceDeduction {
  amount: number;
  /** 計算式（欠勤がなければ null。欠勤控除をしない設定なら、その説明） */
  detail: string | null;
  /** 注意（会社カレンダーを読み込めていない・完全月給制で欠勤がある など。なければ null） */
  note: string | null;
}

/**
 * 月給制の人の欠勤控除（1円未満切り捨て）。引く額は、その月に払う基本給（日割りしたときは日割りした額）まで
 * @param monthlyWage    月給（日割りする前の額）
 * @param absentDays     欠勤した日数（勤怠で「欠勤」の日）
 * @param basePay        その月に払う基本給（引く額の上限）
 * @param periodWorkDays 計算期間の所定労働日数（呼び出し側が会社カレンダーから数える。読み込めていなければ null）
 * @param annualWorkDays 1年間の所定労働日数（読み込めていなければ null）
 * @param fallbackDays   会社カレンダーを読み込めていないときに割る日数（その月の土日を除いた日数）
 */
export const absenceDeductionOf = (
  method: AbsenceDeductionMethod,
  monthlyWage: number,
  absentDays: number,
  basePay: number,
  periodWorkDays: number | null | undefined,
  annualWorkDays: number | null | undefined,
  fallbackDays: number,
): AbsenceDeduction => {
  if (absentDays <= 0 || monthlyWage <= 0) return { amount: 0, detail: null, note: null };
  if (method === 'none') {
    return { amount: 0, detail: `欠勤 ${absentDays}日：欠勤控除をしない設定（完全月給制）なので、月給をそのまま支給します`, note: null };
  }
  const wage = `月給 ¥${monthlyWage.toLocaleString()} × 欠勤 ${absentDays}日`;
  // 割り算を最後にして、端数の誤差が出ないようにする
  const byFallback = (reason: string) => ({
    raw: Math.floor((monthlyWage * absentDays) / fallbackDays),
    detail: `${wage} ÷ この月の土日を除いた日数 ${fallbackDays}日`,
    note: `${reason}、この月の土日を除いた日数で割っています（従業員画面の出勤曜日・会社カレンダーを確かめてください）。` as string | null,
  });
  let r: { raw: number; detail: string; note: string | null };
  if (method === 'annual') {
    r = annualWorkDays && annualWorkDays > 0
      ? {
        // 月給 ÷ (1年間の所定労働日数 ÷ 12) × 欠勤日数
        raw: Math.floor((monthlyWage * absentDays * 12) / annualWorkDays),
        detail: `${wage} ÷ 1年間の月平均の所定労働日数（${annualWorkDays}日 ÷ 12）`,
        note: null,
      }
      : byFallback('1年間の所定労働日数がわからないため');
  } else if (periodWorkDays === null || periodWorkDays === undefined) {
    r = byFallback('会社カレンダーを読み込めていないため');
  } else if (periodWorkDays <= 0) {
    return { amount: 0, detail: null, note: '計算期間に所定労働日がないため、欠勤控除をしていません（従業員画面の出勤曜日・会社カレンダーを確かめてください）。' };
  } else {
    r = {
      raw: Math.floor((monthlyWage * absentDays) / periodWorkDays),
      detail: `${wage} ÷ 計算期間の所定労働日数 ${periodWorkDays}日`,
      note: null,
    };
  }
  const cap = Math.max(0, Math.floor(basePay));
  return r.raw > cap
    ? { amount: cap, detail: `${r.detail} ＝ ¥${r.raw.toLocaleString()} → 基本給の ¥${cap.toLocaleString()} まで`, note: r.note }
    : { amount: r.raw, detail: r.detail, note: r.note };
};

/** 日割りの割合（在籍した日数 ÷ 計算期間の日数） */
export interface Proration {
  method: ProrationMethod;
  numerator: number;
  denominator: number;
}

/** 月額を日割りする（1円未満は切り上げる。払う額が少なくならないように） */
export const prorate = (amount: number, p: Proration | null): number =>
  p ? Math.ceil((Math.floor(Number(amount) || 0) * p.numerator) / p.denominator) : Math.floor(Number(amount) || 0);

/**
 * 計算期間の途中で入社・退職した人の月額の賃金の日割り（日割りしない・期間の途中でないときは proration が null）
 * 日割りのしかたは法律では決まっておらず、会社の賃金規程で決める。
 * ・workdays：月額 × 在籍した日の所定労働日数 ÷ 計算期間の所定労働日数
 *   （厚生労働省「モデル就業規則（令和7年12月版）」第46条第2項：計算期間の中途で採用された労働者又は退職した労働者については、
 *    月額の賃金は当該計算期間の所定労働日数を基準に日割計算して支払う）
 * ・calendar：月額 × 在籍した暦日数 ÷ 計算期間の暦日数
 * @param periodWorkDays   計算期間の所定労働日数（workdays のとき。呼び出し側が会社カレンダーから数える）
 * @param employedWorkDays 計算期間のうち在籍した日の所定労働日数
 */
export const prorationOf = (
  staff: any,
  method: ProrationMethod,
  period: { start: string; end: string } | null | undefined,
  periodWorkDays: number | null | undefined,
  employedWorkDays: number | null | undefined,
): { proration: Proration | null; note: string | null } => {
  if (method === 'none' || !period) return { proration: null, note: null };
  const join = staff.join_date || '';
  const retire = staff.retirement_date || '';
  const joinedMidway = !!join && join > period.start && join <= period.end;
  const retiredMidway = !!retire && retire >= period.start && retire < period.end;
  if (!joinedMidway && !retiredMidway) return { proration: null, note: null };

  const from = joinedMidway ? join : period.start;
  const to = retiredMidway ? retire : period.end;
  if (method === 'calendar') {
    const days = (a: string, b: string) => dayjs(b).diff(dayjs(a), 'day') + 1;
    return { proration: { method, numerator: Math.max(0, days(from, to)), denominator: days(period.start, period.end) }, note: null };
  }
  if (periodWorkDays === null || periodWorkDays === undefined || employedWorkDays === null || employedWorkDays === undefined) {
    return { proration: null, note: '会社カレンダーを読み込めていないため、日割りしていません' };
  }
  if (periodWorkDays <= 0) {
    return { proration: null, note: '計算期間に所定労働日がないため、日割りしていません（従業員画面の出勤曜日・会社カレンダーを確かめてください）' };
  }
  return { proration: { method, numerator: Math.min(employedWorkDays, periodWorkDays), denominator: periodWorkDays }, note: null };
};

/**
 * 端数を処理した合計（total。円）を、もとの額（1円未満の端数がある）に近くなるように、円単位の行に分ける
 * それぞれの行を切り捨て、合計に足りない分を、切り捨てた端数の大きい行から1円ずつ足す（行の合計は total になる）
 * 例：127,840.90円 と 6,818.18円（合計 134,659.09円 → 四捨五入で 134,659円）→ 127,841円 と 6,818円
 */
export const splitRoundedTotal = (total: number, parts: number[]): number[] => {
  if (parts.length === 0) return [];
  const result = parts.map((p) => Math.floor(p));
  let rest = total - result.reduce((s, v) => s + v, 0);
  const order = parts
    .map((p, i) => ({ i, frac: p - Math.floor(p) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) result[order[k].i] += 1;
  // 合計が切り捨てた額の合計より小さいとき（端数処理では起きない）は、うしろの行から引く
  for (let i = result.length - 1; rest < 0 && i >= 0; i--) {
    const take = Math.min(result[i], -rest);
    result[i] -= take;
    rest += take;
  }
  return result;
};

/**
 * 金額を、重みの割合で分ける（1円未満は切り捨て。累計で分けるので、合計はもとの金額と同じになる）
 */
export const splitByWeights = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0 || sum <= 0) return weights.map(() => 0);
  let cumWeight = 0, given = 0;
  return weights.map((w, i) => {
    cumWeight += w;
    const upto = i === weights.length - 1 ? total : Math.floor((total * cumWeight) / sum);
    const amount = upto - given;
    given = upto;
    return amount;
  });
};

/**
 * 入社日から継続して2か月を超える最初の日（YYYY-MM-DD）。この日からの給与は丙欄を使えない（所得税法施行令309条かっこ書）
 * 期間は入社日から数え、2か月後の応当日の前日に満了する。応当日がない月（1月31日入社の2月など）は、その月の末日に満了する（民法143条2項）
 */
export const heiLimitDate = (joinDate: string): string => {
  const join = dayjs(joinDate);
  const corresponding = join.add(2, 'month');
  return (corresponding.date() === join.date() ? corresponding : corresponding.endOf('month').add(1, 'day')).format('YYYY-MM-DD');
};

/**
 * 丙欄（日雇賃金）：その月の社会保険料等控除後の給与を、働いた日ごとに分けて、日額表の丙欄を当てはめる（所得税基本通達185-8）
 * ・日ごとの給与は、勤怠から出したその日の支給額（日給・時給・有給休暇の賃金・残業代・深夜手当など）
 * ・月額の手当・通勤手当の課税分・社会保険料のように日がわからない額は、日ごとの支給額の割合で分ける
 * ・日ごとの支給額がない（月給制など）ときは働いた日数で等分し、働いた日もなければ1日分として計算する
 */
const heiDaysOf = (
  staff: any,
  sortedRows: any[],
  dayPays: Record<string, { pay: number; overtime: number }>,
  isOvertimeEligible: boolean,
  taxBase: number,
  payYear: number,
): { days: SalaryResult['heiDays']; warnings: string[] } => {
  const warnings: string[] = [];
  const table = Master.getTaxMaster(payYear).DAILY_HEI_TABLE;
  const workedDates = sortedRows.filter(r => (Number(r.work_hours) || 0) > 0).map(r => r.work_date as string);
  let entries = staff.wage_type === 'monthly'
    ? []
    : Object.entries(dayPays)
      .map(([date, d]) => ({ date, weight: d.pay + (isOvertimeEligible ? d.overtime : 0) }))
      .filter(e => e.weight > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  if (staff.wage_type === 'monthly') {
    warnings.push('月給制の人には丙欄を使えません（丙欄は、働いた日・時間で計算する給与に使います）。働いた日数で等分して計算しています。');
  }
  if (entries.length === 0) entries = workedDates.map(date => ({ date, weight: 1 }));

  let days: SalaryResult['heiDays'];
  if (entries.length === 0) {
    days = taxBase > 0 ? [{ date: null, amount: taxBase, tax: calcDailyHeiTaxByTable(taxBase, table) }] : [];
    if (taxBase > 0) warnings.push('働いた日がないため、1日分の給与として丙欄で計算しています。');
  } else {
    const amounts = splitByWeights(taxBase, entries.map(e => e.weight));
    days = entries.map((e, i) => ({ date: e.date, amount: amounts[i], tax: calcDailyHeiTaxByTable(amounts[i], table) }));
  }

  // 同じ会社から継続して2か月を超えて払う分は丙欄を使えない
  if (!staff.join_date) {
    warnings.push('入社日が入っていないため、入社から2か月を超えたかどうかを確かめられません。');
  } else {
    const limit = heiLimitDate(staff.join_date);
    const over = workedDates.filter(d => d >= limit).length;
    if (over > 0) {
      warnings.push(`入社日（${staff.join_date}）から2か月を超えた日（${limit}以後）に働いた日が${over}日あります。2か月を超えた日の給与には丙欄を使えません。従業員の設定で甲欄か乙欄に変えてください。`);
    }
  }
  return { days, warnings };
};

export const calculateSalary = (
  staff: any,
  attendanceData: any[],
  extras: SalaryExtras,
  targetYear: number,
  targetMonth: number,
  companySettings: any,
): SalaryResult => {

  const weekStartDay: number = companySettings?.week_start_day ?? 0; // デフォルト日曜
  const scheduledHours = Number(staff.scheduled_work_hours) || 8;

  // ── 勤怠集計 ──────────────────────────────────────────────
  // ── 1. まず、確定データの中から「欠勤」と「全休」の日数を正確に把握する ──
  // これにより、workDays(出勤日) と absentDays(欠勤日) を明確に分けます
  const actualAbsentDays = attendanceData.filter(row => row.work_type === 'absent').length;

  // 出勤日数は、実際に働いた時間がある日だけを数える（公休・全休・欠勤などは含めない）
  const workDays = attendanceData.filter(row => (Number(row.work_hours) || 0) > 0).length;
  let totalWorkHours = 0, totalNightHours = 0;
  let basePay = 0, standardOvertimePay = 0, highOvertimePay = 0, nightPay = 0;
  let statutoryOvertimePay = 0; // 法定内残業代（割増なし）
  let holidayWorkPay = 0;       // 法定休日労働の手当
  let paidLeavePay = 0;         // 有給休暇の賃金（時給制）
  let absenceDeduction = 0;
  let absenceDeductionDetail: string | null = null;
  let absenceDeductionNote: string | null = null;
  const absenceDeductionMethod = toAbsenceDeductionMethod(extras.absenceDeductionMethod);
  let totalOvertimeHours = 0;       // 法定外残業（割増対象）の累計
  let totalStatutoryOvertimeHours = 0; // 法定内残業の累計
  let standardPremiumHours = 0; // ★追加
  let highPremiumHours = 0;     // ★追加
  let deferredHighPremiumHours = 0;
  let overtimeWithinScheduleHours = 0; // 法定外残業のうち、所定労働時間の中の時間（割増分だけを払う）
  let holidayWorkHours = 0;
  let paidLeaveHours = 0;
  let dailyWageDays = 0;        // 日給制で日給を払った日数
  // 日ごとの支給額（丙欄で、働いた日ごとの給与を出すのに使う）。overtime は残業代の対象外の人には払わない分
  const dayPays: Record<string, { pay: number; overtime: number }> = {};
  const payTotal = () => basePay + paidLeavePay + nightPay;
  const overtimeTotal = () => statutoryOvertimePay + standardOvertimePay + highOvertimePay + holidayWorkPay;
  const addDayPay = (date: string, pay: number, overtime: number) => {
    const d = (dayPays[date] ??= { pay: 0, overtime: 0 });
    d.pay += pay;
    d.overtime += overtime;
  };
  // 中小企業（2023年3月までの月60時間超の割増が猶予される）
  const isSmallBusiness = Number(companySettings?.is_small_business) === 1;

  // 日付順にソートして処理（週40h超判定の正確性のため）
  const sorted = [...attendanceData].sort((a, b) => a.work_date.localeCompare(b.work_date));

  // ── 週40時間超の割り当て ─────────────────────────────────
  // 週の労働時間を日付順に足していき、40時間に達した「後」の時間を、その日の法定外残業とする
  // ・1日8時間を超えた分は日の残業として別に数えるので、週の累計には各日8時間までを足す
  // ・法定休日の労働は休日労働（35%増）として別に払うため、週40時間の計算には含めない
  // ・計算期間の初めの日がある週は、計算期間より前の日（前の計算期間の確定した勤怠）の時間から足し始める（その日は払わない）
  // 日付 → その日の「週40時間超」の時間
  const weeklyOvertimeByDate: Record<string, number> = {};
  const weeklyLegalHours: Record<string, number> = {};
  const firstDate: string = extras.period?.start || sorted[0]?.work_date || '';
  const firstWeek = firstDate ? getWeekKey(firstDate, weekStartDay) : '';
  const carryOverRows = firstDate
    ? (extras.weekCarryOver ?? []).filter(r =>
        !!r?.work_date && r.work_date < firstDate && getWeekKey(r.work_date, weekStartDay) === firstWeek
        && r.work_type !== 'statutory_holiday')
    : [];
  let carryOverHours = 0;
  for (const r of carryOverRows) carryOverHours += Math.min(Number(r.work_hours) || 0, Master.LEGAL_WORK_HOURS_DAILY);
  if (carryOverHours > 0) weeklyLegalHours[firstWeek] = carryOverHours;
  const weekCarryOver = carryOverHours > 0
    ? { from: firstWeek, to: dayjs(firstDate).subtract(1, 'day').format('YYYY-MM-DD'), hours: carryOverHours }
    : null;
  for (const row of sorted) {
    if (row.work_type === 'statutory_holiday') continue;
    const wk = getWeekKey(row.work_date, weekStartDay);
    const before = weeklyLegalHours[wk] ?? 0;
    const after = before + Math.min(Number(row.work_hours) || 0, Master.LEGAL_WORK_HOURS_DAILY);
    weeklyLegalHours[wk] = after;
    weeklyOvertimeByDate[row.work_date] =
      Math.max(0, after - Master.LEGAL_WORK_HOURS_WEEKLY) - Math.max(0, before - Master.LEGAL_WORK_HOURS_WEEKLY);
  }

  // ── 計算期間の途中で入社・退職した人の日割り ─────────────────────
  const { proration, note: prorationNote } = prorationOf(
    staff, toProrationMethod(extras.prorationMethod), extras.period, extras.periodWorkDays, extras.employedWorkDays,
  );

  // ── 残業代の時給（割増賃金の基礎）─────────────────────────────
  // 月給と月額の手当は「1年間における1か月平均所定労働時間」で割って時間あたりにする（上の「残業代の時給」）
  const customItems = extras.customItems ?? [];
  const overtimeBaseAllowances = (Number(extras.allowanceAmount) || 0)
    + customItems
      .filter(i => i.type === 'earning' && i.inOvertimeBase !== false)
      .reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const annualWorkDays = Number(extras.annualWorkDays) || 0;
  const overtimeBaseHoursIsAnnual = annualWorkDays > 0;
  const overtimeBaseHours = overtimeBaseHoursIsAnnual
    ? annualWorkDays * scheduledHours / 12
    : prescribedWorkDays(staff, targetYear, targetMonth) * scheduledHours;
  // 時給制・日給制の人の、月額の手当を時間あたりにした額
  const allowancePerHour = overtimeBaseHours > 0 ? overtimeBaseAllowances / overtimeBaseHours : 0;
  let overtimeHourlyRate = 0;

  const isDaily = staff.wage_type === 'daily';
  if (staff.wage_type === 'monthly' || isDaily) {
    // 月給制・日給制：月給・日給は所定労働時間の分の賃金なので、所定を超えた時間・休日の労働を、残業代の時給で別に払う
    let hourlyRate = 0;
    if (isDaily) {
      // 日給制：残業代の時給は 日給 ÷ 1日の所定労働時間 ＋ 手当を時間あたりにした額（上の「日給制」）。日ごとの日給で出すので、ここでは明細に出す値だけ
      overtimeHourlyRate = (Number(staff.base_wage) || 0) / scheduledHours + allowancePerHour;
    } else {
      // DBの「base_wage」と JSの「baseWage」の両方に対応させる
      const rawWage = staff.base_wage ?? staff.baseWage ?? 0;
      const monthlyWage = Number(rawWage);
      // 計算期間の途中で入社・退職した月は、日割りする（残業代の時給・欠勤控除は、日割りする前の月給で計算する）
      basePay = prorate(monthlyWage, proration);

      // 残業代の時給：(月給 ＋ 残業代の時給に入れる手当) ÷ 1年間における1か月平均所定労働時間
      hourlyRate = overtimeBaseHours > 0 ? (monthlyWage + overtimeBaseAllowances) / overtimeBaseHours : 0;
      overtimeHourlyRate = hourlyRate;

      // 欠勤控除：給与規定グループの設定で、計算期間の所定労働日数か、1年間の月平均の所定労働日数で割る（absenceDeductionOf）
      // 会社カレンダーを読み込めていないときだけ、その月の土日を除いた日数で割る
      const absence = absenceDeductionOf(
        absenceDeductionMethod, monthlyWage, actualAbsentDays, basePay,
        extras.periodWorkDays, extras.annualWorkDays, prescribedWorkDays(staff, targetYear, targetMonth),
      );
      absenceDeduction = absence.amount;
      absenceDeductionDetail = absence.detail;
      absenceDeductionNote = absence.note;
    }

    for (const row of sorted) {
      const h = Number(row.work_hours) || 0;
      const n = Number(row.night_hours) || 0;
      const type = row.work_type || 'normal';
      const pay0 = payTotal(), overtime0 = overtimeTotal();
      totalWorkHours += h;
      totalNightHours += n;

      // その日の残業代の時給（日給制は、その日の日給から出す）
      let rate = hourlyRate;
      if (isDaily) {
        const dayWage = Number(row.actual_base_wage) || Number(staff.base_wage) || 0;
        rate = dayWage / scheduledHours + allowancePerHour;

        // 日給：所定労働日（出勤・半休）に働いた分と、有給休暇の分（労基則25条1項2号・2項）
        // 半休・時間単位の有給の日は、1日の所定労働時間のうち有給の時間の割合を有給休暇の賃金にし、残りを日給として払う
        const leaveHours = Math.min(scheduledHours, paidLeaveHoursOf(type, scheduledHours, Number(row.paid_leave_hours) || 0));
        paidLeaveHours += leaveHours;
        paidLeavePay += dayWage * leaveHours / scheduledHours;
        if (h > 0 && (type === 'normal' || type === 'paid_half')) {
          const workShare = (scheduledHours - leaveHours) / scheduledHours;
          basePay += dayWage * workShare;
          dailyWageDays += workShare;
        }
      }

      if (type === 'statutory_holiday') {
        // ── 【法定休日】（日曜日など） ──────────────────────
        // 1. 休日出勤手当 (1.35倍) ※60h超のカウントには含めない
        holidayWorkPay += rate * Master.HOLIDAY_WORK_RATE * h;
        holidayWorkHours += h;

        // 2. 休日深夜割増 (+0.25倍加算 = 計1.60倍)
        // すでに下の nightPay で 0.25 分が計算されるため、差分は不要
        // (もし1.6倍として別に管理したい場合はここで調整)

      } else {
        // ── 【平日 または 所定休日】（土曜日など） ──────────
        
        // 1. 法定外残業の判定（日8h超 または 週40h超）
        const legalOvertimeFromDay = Math.max(0, h - Master.LEGAL_WORK_HOURS_DAILY);
        const weekOnlyOvertime = weeklyOvertimeByDate[row.work_date] ?? 0;
        const legalOvertimeToday = legalOvertimeFromDay + weekOnlyOvertime;

        // 2. 法定内残業（1.0倍）の計算
        // 所定労働時間の外の時間（月給・日給に入っていない時間）のうち、法定外残業でない時間
        const currentScheduled = scheduledHoursOf(type, scheduledHours, Number(row.paid_leave_hours) || 0);
        const { beyond, statutory: effectiveStatutoryOvertime } = splitBySchedule(h, currentScheduled, legalOvertimeToday);

        totalStatutoryOvertimeHours += effectiveStatutoryOvertime;
        statutoryOvertimePay += rate * effectiveStatutoryOvertime;

        // 3. 法定外残業代（1.25倍 / 1.5倍）の累積
        if (legalOvertimeToday > 0) {
          // 月60時間（Master.OVERTIME_PREMIUM_LIMIT_HOURS）を超えているか判定
          const split = splitOvertimeHours(legalOvertimeToday, totalOvertimeHours, row.work_date, isSmallBusiness);
          // 所定労働時間の中の法定外残業は、通常の賃金（1.0倍）を月給・日給で払っているので、割増分だけを足す
          const within = withinScheduleSplit(legalOvertimeToday, beyond, split.high);

          // 1.25倍（所定の中の時間は25%増の分だけ）の計算
          standardOvertimePay += rate * (Master.OVERTIME_RATE * split.standard - within.standard);
          // 1.50倍（所定の中の時間は50%増の分だけ）の計算
          highOvertimePay += rate * (Master.OVERTIME_PREMIUM_RATE * split.high - within.high);

          standardPremiumHours += split.standard;
          highPremiumHours += split.high;
          deferredHighPremiumHours += split.deferred;
          overtimeWithinScheduleHours += within.standard + within.high;
          totalOvertimeHours += legalOvertimeToday; // ここで60hカウントを蓄積
        }
      }

      // ── 【共通：深夜手当】 ────────────────────────────
      // 平日、所定休日、法定休日、いずれの場合も「深夜時間」があれば25%増(0.25)を加算
      // 法定休日の場合：1.35 + 0.25 = 1.60
      // 平日残業(60h内)の場合：1.25 + 0.25 = 1.50
      // 平日残業(60h超)の場合：1.50 + 0.25 = 1.75
      nightPay += rate * Master.NIGHT_SHIFT_RATE * n;
      addDayPay(row.work_date, payTotal() - pay0, overtimeTotal() - overtime0);
    }

  } else {
    // ── 時給制 ────────────────────────────────────────────
    // 割増には、時給に月額の手当を時間あたりにした額（allowancePerHour）を足す。
    // 時給の1.0倍分は basePay で払っているので割増分だけを、手当の分は払っていないので割増率をそのまま掛ける
    // （所定労働時間の中の法定外残業は、手当の1.0倍分も月額の手当で払っているので、手当の分も割増分だけ）
    overtimeHourlyRate = (Number(staff.base_wage) || 0) + allowancePerHour;
    for (const row of sorted) {
      const h = Number(row.work_hours) || 0;
      const n = Number(row.night_hours) || 0;
      const wage = Number(row.actual_base_wage) || Number(staff.base_wage) || 0;
      const type = row.work_type || 'normal';
      const pay0 = payTotal(), overtime0 = overtimeTotal();
      totalWorkHours += h;
      totalNightHours += n;

      basePay += wage * h;

      // 有給休暇の賃金（所定労働時間を働いた場合の通常の賃金）
      const leaveHours = paidLeaveHoursOf(type, scheduledHours, Number(row.paid_leave_hours) || 0);
      paidLeaveHours += leaveHours;
      paidLeavePay += wage * leaveHours;

      nightPay += (wage + allowancePerHour) * Master.NIGHT_SHIFT_RATE * n;

      if (type === 'statutory_holiday') {
        // 法定休日の労働：基本の時給分は basePay に入っているので、35%の割増分だけを足す（60h超のカウントには含めない）
        holidayWorkPay += (wage * (Master.HOLIDAY_WORK_RATE - 1) + allowancePerHour * Master.HOLIDAY_WORK_RATE) * h;
        holidayWorkHours += h;
        addDayPay(row.work_date, payTotal() - pay0, overtimeTotal() - overtime0);
        continue;
      }

      // 1日8h超
      const legalOvertimeFromDay = Math.max(0, h - Master.LEGAL_WORK_HOURS_DAILY);

      // 週40h超
      const weekOnlyOvertime = weeklyOvertimeByDate[row.work_date] ?? 0;
      const legalOvertimeToday = legalOvertimeFromDay + weekOnlyOvertime;

      if (legalOvertimeToday > 0) {
        // ★ 1. 「今日（その行）の時間」を25%と50%（月60時間超）に分ける
        const split = splitOvertimeHours(legalOvertimeToday, totalOvertimeHours, row.work_date, isSmallBusiness);
        // 所定労働時間の中の時間は、手当の通常の分（1.0倍）を月額の手当で払っているので、手当の分も割増分だけを足す（月給制・日給制と同じ）
        const currentScheduled = scheduledHoursOf(type, scheduledHours, Number(row.paid_leave_hours) || 0);
        const { beyond } = splitBySchedule(h, currentScheduled, legalOvertimeToday);
        const within = withinScheduleSplit(legalOvertimeToday, beyond, split.high);

        // ★ 2. 金額を累積
        standardOvertimePay += (wage * (Master.OVERTIME_RATE - 1) + allowancePerHour * Master.OVERTIME_RATE) * split.standard
          - allowancePerHour * within.standard;
        highOvertimePay += (wage * (Master.OVERTIME_PREMIUM_RATE - 1) + allowancePerHour * Master.OVERTIME_PREMIUM_RATE) * split.high
          - allowancePerHour * within.high;

        // ★ 3. 外側の変数（合計時間）に足し込む
        standardPremiumHours += split.standard;
        highPremiumHours += split.high;
        deferredHighPremiumHours += split.deferred;
        overtimeWithinScheduleHours += within.standard + within.high;
        totalOvertimeHours += legalOvertimeToday;
      }
      addDayPay(row.work_date, payTotal() - pay0, overtimeTotal() - overtime0);
    }
  }

  // ── 残業代の対象外（管理監督者など。労働基準法41条）────────────────────
  // 時間外（法定内残業を含む）・休日労働の手当は払わない。時間は記録のため残し、深夜の割増賃金は払う
  const isOvertimeEligible = Number(staff.is_overtime_eligible ?? 1) !== 0;
  if (!isOvertimeEligible) {
    statutoryOvertimePay = 0;
    standardOvertimePay = 0;
    highOvertimePay = 0;
    holidayWorkPay = 0;
  }

  // ── 通勤手当・任意手当 ──────────────────────────────────────
  const commutePay = staff.commute_type === 'daily'   ? (Number(staff.commute_amount) || 0) * workDays
                  : staff.commute_type === 'monthly' ? (Number(staff.commute_amount) || 0) : 0;
  const allowanceAmount = Number(extras.allowanceAmount) || 0;

  // 固定（毎月同額）の支給項目は、基本給と同じく日割りする（変動の項目は、その月に入れた額のまま）
  const customEarningLines = customItems.filter(i => i.type === 'earning')
    .map(i => ({ name: i.name, amount: i.fixed ? prorate(i.amount, proration) : Number(i.amount) || 0 }));
  const customDeductionLines = customItems.filter(i => i.type === 'deduction').map(i => ({ name: i.name, amount: Number(i.amount) || 0 }));
  const customEarnings   = customEarningLines.reduce((s, i) => s + i.amount, 0);
  const customDeductions = customDeductionLines.reduce((s, i) => s + i.amount, 0);

  // ── 支給合計 ──────────────────────────────────────────────
  // 1円未満の端数は、会社の設定（残業代の端数処理）で、法定内残業・時間外労働・休日労働・深夜労働の手当ごとに、1か月の合計で処理する
  // （1か月の時間外労働・休日労働・深夜業の「おのおのの割増賃金の総額」の端数は、50銭未満切り捨て・50銭以上切り上げにしてよい。基発第150号）
  // 明細の行にはこの処理した額を出し、支給合計は明細の行の合計にする（行を足すと、ちょうど支給合計になる）
  // 出典：鹿児島労働局「時間外労働・休日労働・深夜労働 Q10」https://jsite.mhlw.go.jp/kagoshima-roudoukyoku/yokuaru_goshitsumon/kyushokuchu/0310.html
  //       厚生労働省「確かめよう労働条件」Q&A https://www.check-roudou.mhlw.go.jp/qa/roudousya/chingin/q3.html （5 端数処理の方法について）
  const roundOvertime = companySettings?.round_overtime || 'round';
  const statutoryLine = applyRounding(statutoryOvertimePay || 0, roundOvertime);
  // 時間外労働の手当（25%・50%）は、合わせて1つの総額として端数を処理し、明細の2行に分ける（2行の合計が総額になる）
  const overtimeLegalTotal = applyRounding((standardOvertimePay || 0) + (highOvertimePay || 0), roundOvertime);
  const [standardLine, highLine] = splitRoundedTotal(overtimeLegalTotal, [standardOvertimePay || 0, highOvertimePay || 0]);
  const holidayLine = applyRounding(holidayWorkPay || 0, roundOvertime);
  const nightLine = applyRounding(nightPay || 0, roundOvertime);

  // 固定残業代（月給制の人だけ）：時間外労働の割増賃金の代わりに定額を払い、法定の計算額が上回る分だけ足す
  const fixedOvertimeAllowance = staff.wage_type === 'monthly'
    ? Math.max(0, Math.floor(Number(staff.fixed_overtime_allowance) || 0))
    : 0;
  const fixedOvertimeHours = fixedOvertimeAllowance > 0 ? Math.max(0, Number(staff.fixed_overtime_hours) || 0) : 0;
  const fixedOvertimeExcess = fixedOvertimeAllowance > 0 ? Math.max(0, overtimeLegalTotal - fixedOvertimeAllowance) : 0;
  // 時間外労働の手当として払う額（固定残業代がある人は、固定残業代 ＋ 超過分）と、休日・深夜の手当
  const roundedPremiums = (fixedOvertimeAllowance > 0 ? fixedOvertimeAllowance + fixedOvertimeExcess : overtimeLegalTotal)
    + holidayLine + nightLine;

  const totalEarnings = Math.floor(basePay || 0)
                    - (absenceDeduction || 0)
                    + statutoryLine
                    + roundedPremiums
                    + Math.floor(paidLeavePay || 0)
                    + (commutePay || 0)
                    + (allowanceAmount || 0)
                    + (customEarnings || 0);

  // 非固定的賃金：勤務の実績で額が変わる報酬（残業代・休日や深夜の手当・「変動（毎月入力）」の支給項目）
  // 固定的賃金：支給額や支給率が決まっている報酬（基本給（時給制は時給×時間）・有給休暇の賃金・通勤手当・固定の支給項目・固定残業代）
  // 出典：日本年金機構 年金用語集「固定的賃金」https://www.nenkin.go.jp/service/yougo/kagyo/koteitekichingin.html
  //       「非固定的賃金」https://www.nenkin.go.jp/service/yougo/hagyo/hikoteitekichingin.html
  // ※ 名称でなく実態で判断するものなので、月変の年間平均の画面で直せるようにしている
  const nonFixedEarnings = statutoryLine + roundedPremiums - fixedOvertimeAllowance
    + customItems.filter(i => i.type === 'earning' && !i.fixed).reduce((s, i) => s + (Number(i.amount) || 0), 0);

  // ── 社会保険料 ──────────────────────────────────────────────
  // この給与から引く保険料の月：当月徴収はその月の分、翌月徴収は前月の分（上の socialInsMonthsOf）
  // 加入しているか・標準報酬月額・料率・年齢・入社月や退職月・産休育休の免除は、すべて保険料の月で決める
  const socialInsCollection = toSocialInsCollection(extras.socialInsCollection);
  const retirementMonthCollectable = isRetirementMonthCollectable(staff, targetYear, targetMonth, socialInsCollection);
  const socialInsMonths = socialInsMonthsOf(staff, targetYear, targetMonth, socialInsCollection, !!extras.collectRetirementMonth);
  const perMonth = socialInsMonths.map(({ year, month }) => socialPremiumsOf(staff, year, month, extras.prefecture, companySettings));
  const main = perMonth[0];
  const { isSocialInsEnrolled, hyojunHoshu, byAge, isInsuredMonth, isLeaveExemptMonth } = main;
  const healthInsurance = perMonth.reduce((sum, p) => sum + p.healthInsurance, 0);
  const nursingInsurance = perMonth.reduce((sum, p) => sum + p.nursingInsurance, 0);
  const childSupport = perMonth.reduce((sum, p) => sum + p.childSupport, 0);
  const welfarePension = perMonth.reduce((sum, p) => sum + p.welfarePension, 0);

  // 雇用保険の料率は、賃金を支払った月のもの（社会保険料の徴収月とは関係ない）
  const ins = Master.getInsuranceMaster(targetYear, targetMonth);

  // 雇用保険（賃金総額 × 本人負担率）
  // 従業員画面の「雇用保険加入」を外した人（役員など）からは控除しない
  // 区分は 従業員の設定 → 会社の設定 → 「一般の事業」 の順に決める
  const isEmploymentInsEnrolled = checkEmploymentInsEnrolled(staff);
  const empInsKey = (staff.employment_insurance_type || companySettings?.default_emp_ins_type || 'general') as Master.EmpInsType;
  const empRates = ins.LABOR_INSURANCE_RATES[empInsKey] || ins.LABOR_INSURANCE_RATES.general;
  const empInsurance = isEmploymentInsEnrolled
    // 端数：会社の設定（なければ、賃金から引くときの原則の50銭以下切り捨て・50銭1厘以上切り上げ。厚生労働省「雇用保険被保険者からの雇用保険料の控除方法」）
    ? calcPremium(totalEarnings, empRates[0] * 100, companySettings?.round_emp_ins || 'currency_law', 1)
    : 0;

  // ── 税金・最終計算 ──────────────────────────────────────────────
  const socialTotal = healthInsurance + nursingInsurance + childSupport + welfarePension + empInsurance;
  // 通勤手当は、その人の非課税限度額まで所得税がかからない（utils/commuteAllowance.ts）
  // 電車・バスなどだけの人は月15万円まで、マイカー・自転車などの人は片道の距離の区分の額（＋駐車場等・有料道路、両方の人は＋運賃等）まで
  // 限度額の表は、給与を支払う年月で選ぶ（令和7年4月・令和8年4月に改正）
  const commuteSetting = parseCommuteSetting(staff.commute_setting);
  const commuteLimit = commuteLimitOf(commuteSetting, targetYear, targetMonth);
  const nonTaxableCommute = Math.min(commutePay, commuteLimit.limit);
  const taxableAmount = totalEarnings - nonTaxableCommute;
  // targetYear は支給年（源泉所得税は支払った年の税額表を使う）
  // 扶養控除等申告書を出していない人は乙欄（扶養人数は「従たる給与についての扶養控除等申告書」の人数）
  // 日雇賃金は丙欄で、働いた日ごとに計算する（下の heiDaysOf）
  const taxColumn = toTaxColumn(staff.tax_column);
  const taxBase = Math.max(0, taxableAmount - socialTotal);
  const isHei = taxColumn === 'hei';
  const { days: heiDays, warnings: heiWarnings } = isHei
    ? heiDaysOf(staff, sorted, dayPays, isOvertimeEligible, taxBase, targetYear)
    : { days: [], warnings: [] };
  const incomeTaxBeforeReduction = isHei
    ? heiDays.reduce((sum, d) => sum + d.tax, 0)
    : getGensenTax(taxBase, Number(extras.dependents) || 0, targetYear, extras.taxMethod, taxColumn);
  // 定額減税（令和6年6月〜）：残っている減税額を、源泉所得税を上限に差し引く
  const reductionBefore = Math.max(0, Math.floor(Number(extras.flatTaxReductionRemaining) || 0));
  const flatTaxReduction = Math.min(incomeTaxBeforeReduction, reductionBefore);
  const incomeTax = incomeTaxBeforeReduction - flatTaxReduction;
  const residentTax = Number(extras.residentTax) || 0;
  const totalDeductions = socialTotal + incomeTax + residentTax + customDeductions;
  const yearEndSettlement = Math.trunc(Number(extras.yearEndSettlement) || 0);


  return {
    // --- 勤怠データ ---
    workDays, 
    totalWorkHours, 
    totalOvertimeHours, 
    totalNightHours,
    totalStatutoryOvertimeHours,
    standardPremiumHours,
    highPremiumHours,
    deferredHighPremiumHours,
    overtimeWithinScheduleHours,
    weekCarryOver,
    holidayWorkHours,
    paidLeaveHours,

    // --- 支給額 (Earnings) ---
    basePay: Math.floor(basePay),
    absenceDeduction,
    absenceDays: actualAbsentDays,
    absenceDeductionMethod,
    absenceDeductionDetail,
    absenceDeductionNote,
    periodWorkDays: extras.periodWorkDays ?? null,
    // 明細の行（端数を処理した額。行を足すと支給合計になる）
    statutoryOvertimePay: statutoryLine,
    standardOvertimePay: standardLine,
    highOvertimePay: highLine,
    holidayWorkPay: holidayLine,
    fixedOvertimeAllowance,
    fixedOvertimeHours,
    fixedOvertimeExcess,
    isOvertimeEligible,
    overtimeHourlyRate,
    overtimeBaseAllowances,
    overtimeBaseHours,
    overtimeBaseHoursIsAnnual,
    dailyWageDays,
    appliedDependents: isHei ? 0 : Number(extras.dependents) || 0,
    nightPay: nightLine,
    paidLeavePay: Math.floor(paidLeavePay),
    commutePay,
    allowanceAmount,
    customEarnings,
    customEarningLines,
    customDeductionLines,
    proration,
    prorationNote,
    totalEarnings,
    nonFixedEarnings,
    nonTaxableCommute,
    commuteTaxFreeLimit: commuteLimit.limit,
    commuteMethod: commuteSetting.method,
    taxableAmount,

    // --- 控除額 (Deductions) ---
    healthInsurance, 
    nursingInsurance, 
    childSupport,
    welfarePension,
    empInsurance,
    incomeTax,
    incomeTaxBeforeReduction,
    taxColumn,
    heiDays,
    heiWarnings,
    flatTaxReduction,
    flatTaxReductionRemaining: reductionBefore - flatTaxReduction,
    residentTax,
    customDeductions,
    totalDeductions,

    // --- 最終結果・その他情報 ---
    // 年末調整の過不足額は、還付なら足し、徴収なら引く（所得税・社会保険料の計算には関係しない）
    yearEndSettlement,
    netPay: totalEarnings - totalDeductions + yearEndSettlement,
    isNursingCareTarget: byAge.nursing,
    isHealthInsAgeTarget: byAge.health,
    isPensionAgeTarget: byAge.pension,
    isInsuredMonth,
    isLeaveExemptMonth,
    socialInsCollection,
    socialInsMonths: socialInsMonths.map(({ year, month }) => ymOf(year, month)),
    retirementMonthCollectable,
    hyojunHoshu,
    isSocialInsEnrolled,
    isEmploymentInsEnrolled,
    prefectureUnknown: perMonth.some((p) => p.healthRateMissing),
  };
};
