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
 * 固定残業代（月給制の人だけ）:
 *  - 時間外労働（1日8時間・週40時間超）の割増賃金に当てる定額の手当として、時間外労働の有無にかかわらず払う
 *  - 労働基準法37条で計算した時間外労働の割増賃金（25%・月60時間超は50%）が固定残業代を超えたら、差額を「超過分」として足して払う
 *  - 法定内残業・休日労働・深夜労働の手当は、固定残業代とは別に払う
 *  出典：厚生労働省「固定残業代を支払うこととすれば、残業や休日勤務をさせても別途に残業代を支払わなくてよいでしょうか？」
 *        https://www.startup-roudou.mhlw.go.jp/qa/zigyonushi/chingin/q11.html
 *        （医療法人康心会事件 最判平29.7.7、平29.7.31 基発0731第27号：固定残業代が37条で計算した額を下回るときは差額を払う）
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
import { calcWithholdingTax, toTaxColumn, type TaxCalcMethod, type TaxColumn } from './incomeTax';
import { checkLeaveExemptMonth, parseLeavePeriods } from './leaveExemption';
import { getStandardRemuneration } from './standardRemuneration';
import * as Master from '../constants';

// プラグインの有効化
dayjs.extend(isSameOrAfter);

export interface SalaryExtras {
  allowanceName: string;
  allowanceAmount: number;
  residentTax: number;
  prefecture: string;
  dependents: number;
  customItems: { name: string; amount: number; type: 'earning' | 'deduction' }[];
  /** 源泉所得税の計算方法（給与規定グループの設定。省略時は月額表） */
  taxMethod?: TaxCalcMethod;
  /** 定額減税（令和6年分）の、この給与より前に引ききれずに残っている額（対象外・未設定なら 0） */
  flatTaxReductionRemaining?: number;
  /** この給与で精算する年末調整の過不足額（＋なら還付、−なら徴収。なければ 0） */
  yearEndSettlement?: number;
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
  holidayWorkHours: number;     // 法定休日の労働時間
  paidLeaveHours: number;       // 有給休暇の時間（時給制で賃金を払う時間）
  basePay: number;
  absenceDeduction: number;
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
  nightPay: number;
  paidLeavePay: number;           // 有給休暇の賃金（時給制）
  commutePay: number;
  allowanceAmount: number;
  customEarnings: number;
  totalEarnings: number;
  /** 通勤手当のうち所得税がかからない額 */
  nonTaxableCommute: number;
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
  /** 源泉所得税の欄（甲欄・乙欄） */
  taxColumn: TaxColumn;
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
  hyojunHoshu: number;
  /** 健康保険・厚生年金に加入しているか（標準報酬月額が未設定・社保規定が「未加入」なら false） */
  isSocialInsEnrolled: boolean;
  /** 雇用保険に加入しているか */
  isEmploymentInsEnrolled: boolean;
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
 * 時給制で賃金を払う有給休暇の時間（所定労働時間を働いた場合の通常の賃金で払う）
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
const birthdayAt = (birthday: string, age: number) => {
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
 * 月給制の、その月の所定労働日数（欠勤控除・時間単価の計算に使う）
 * 従業員に月の所定労働日数があればそれを、なければその月の土日を除いた日数を使う
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
 * 給与計算結果をDBに保存する（確定処理）
 */
export const saveSalaryResult = async (
  db: any, 
  staffId: string, 
  year: number, 
  month: number, 
  result: SalaryResult,
  staffMaster: any // その時の基本給などのスナップショット用
) => {
  const sql = `
    INSERT INTO salary_results (
      staff_id, target_year, target_month,
      applied_base_wage, applied_dependents,
      total_work_hours, total_overtime_hours, total_night_hours,
      standard_overtime_hours, high_overtime_hours,
      standard_overtime_pay, high_overtime_pay, statutory_overtime_pay,
      fixed_overtime_allowance, fixed_overtime_excess,
      total_earnings, taxable_amount,
      health_insurance, nursing_insurance, child_support, welfare_pension, emp_insurance,
      social_ins_total, income_tax, flat_tax_reduction, resident_tax, year_end_adjustment, net_pay
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    staffMaster.base_wage, staffMaster.dependents,
    result.totalWorkHours, result.totalOvertimeHours, result.totalNightHours,
    result.standardPremiumHours, result.highPremiumHours,
    result.standardOvertimePay, result.highOvertimePay, result.statutoryOvertimePay,
    result.fixedOvertimeAllowance, result.fixedOvertimeExcess,
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
  let totalOvertimeHours = 0;       // 法定外残業（割増対象）の累計
  let totalStatutoryOvertimeHours = 0; // 法定内残業の累計
  let standardPremiumHours = 0; // ★追加
  let highPremiumHours = 0;     // ★追加
  let deferredHighPremiumHours = 0;
  let holidayWorkHours = 0;
  let paidLeaveHours = 0;
  // 中小企業（2023年3月までの月60時間超の割増が猶予される）
  const isSmallBusiness = Number(companySettings?.is_small_business) === 1;

  // 日付順にソートして処理（週40h超判定の正確性のため）
  const sorted = [...attendanceData].sort((a, b) => a.work_date.localeCompare(b.work_date));

  // ── 週40時間超の割り当て ─────────────────────────────────
  // 週の労働時間を日付順に足していき、40時間に達した「後」の時間を、その日の法定外残業とする
  // ・1日8時間を超えた分は日の残業として別に数えるので、週の累計には各日8時間までを足す
  // ・法定休日の労働は休日労働（35%増）として別に払うため、週40時間の計算には含めない
  // 日付 → その日の「週40時間超」の時間
  const weeklyOvertimeByDate: Record<string, number> = {};
  const weeklyLegalHours: Record<string, number> = {};
  for (const row of sorted) {
    if (row.work_type === 'statutory_holiday') continue;
    const wk = getWeekKey(row.work_date, weekStartDay);
    const before = weeklyLegalHours[wk] ?? 0;
    const after = before + Math.min(Number(row.work_hours) || 0, Master.LEGAL_WORK_HOURS_DAILY);
    weeklyLegalHours[wk] = after;
    weeklyOvertimeByDate[row.work_date] =
      Math.max(0, after - Master.LEGAL_WORK_HOURS_WEEKLY) - Math.max(0, before - Master.LEGAL_WORK_HOURS_WEEKLY);
  }

  if (staff.wage_type === 'monthly') {
    // DBの「base_wage」と JSの「baseWage」の両方に対応させる
    const rawWage = staff.base_wage ?? staff.baseWage ?? 0;
    const monthlyWage = Number(rawWage);
    basePay = monthlyWage;

    // 所定労働日数の確定
    const prescribedDays = prescribedWorkDays(staff, targetYear, targetMonth);
    
    // 時給単価の計算（残業代などのベース）
    const hourlyRate = (prescribedDays > 0 && scheduledHours > 0)
      ? monthlyWage / (prescribedDays * scheduledHours)
      : 0;

    // ── 【ここを修正】 欠勤控除 ──
    // 先ほど算出した actualAbsentDays を使ってダイレクトに計算
    absenceDeduction = actualAbsentDays > 0
      ? Math.floor((monthlyWage / prescribedDays) * actualAbsentDays)
      : 0;

    for (const row of sorted) {
      const h = Number(row.work_hours) || 0;
      const n = Number(row.night_hours) || 0;
      const type = row.work_type || 'normal';
      totalWorkHours += h;
      totalNightHours += n;

      if (type === 'statutory_holiday') {
        // ── 【法定休日】（日曜日など） ──────────────────────
        // 1. 休日出勤手当 (1.35倍) ※60h超のカウントには含めない
        holidayWorkPay += hourlyRate * Master.HOLIDAY_WORK_RATE * h;
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
        const currentScheduled = scheduledHoursOf(type, scheduledHours, Number(row.paid_leave_hours) || 0);
        const effectiveStatutoryOvertime = Math.max(0, h - currentScheduled - legalOvertimeToday);
        
        totalStatutoryOvertimeHours += effectiveStatutoryOvertime;
        statutoryOvertimePay += hourlyRate * effectiveStatutoryOvertime;

        // 3. 法定外残業代（1.25倍 / 1.5倍）の累積
        if (legalOvertimeToday > 0) {
          // 月60時間（Master.OVERTIME_PREMIUM_LIMIT_HOURS）を超えているか判定
          const split = splitOvertimeHours(legalOvertimeToday, totalOvertimeHours, row.work_date, isSmallBusiness);

          // 1.25倍（または25%増）の計算
          standardOvertimePay += hourlyRate * Master.OVERTIME_RATE * split.standard;
          // 1.50倍（または50%増）の計算
          highOvertimePay += hourlyRate * Master.OVERTIME_PREMIUM_RATE * split.high;

          standardPremiumHours += split.standard;
          highPremiumHours += split.high;
          deferredHighPremiumHours += split.deferred;
          totalOvertimeHours += legalOvertimeToday; // ここで60hカウントを蓄積
        }
      }

      // ── 【共通：深夜手当】 ────────────────────────────
      // 平日、所定休日、法定休日、いずれの場合も「深夜時間」があれば25%増(0.25)を加算
      // 法定休日の場合：1.35 + 0.25 = 1.60
      // 平日残業(60h内)の場合：1.25 + 0.25 = 1.50
      // 平日残業(60h超)の場合：1.50 + 0.25 = 1.75
      nightPay += hourlyRate * Master.NIGHT_SHIFT_RATE * n;
    }

  } else {
    // ── 時給制 ────────────────────────────────────────────
    for (const row of sorted) {
      const h = Number(row.work_hours) || 0;
      const n = Number(row.night_hours) || 0;
      const wage = Number(row.actual_base_wage) || Number(staff.base_wage) || 0;
      const type = row.work_type || 'normal';
      totalWorkHours += h;
      totalNightHours += n;

      basePay += wage * h;

      // 有給休暇の賃金（所定労働時間を働いた場合の通常の賃金）
      const leaveHours = paidLeaveHoursOf(type, scheduledHours, Number(row.paid_leave_hours) || 0);
      paidLeaveHours += leaveHours;
      paidLeavePay += wage * leaveHours;

      nightPay += wage * Master.NIGHT_SHIFT_RATE * n;

      if (type === 'statutory_holiday') {
        // 法定休日の労働：基本の時給分は basePay に入っているので、35%の割増分だけを足す（60h超のカウントには含めない）
        holidayWorkPay += wage * (Master.HOLIDAY_WORK_RATE - 1) * h;
        holidayWorkHours += h;
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

        // ★ 2. 金額を累積
        standardOvertimePay += wage * (Master.OVERTIME_RATE - 1) * split.standard;
        highOvertimePay += wage * (Master.OVERTIME_PREMIUM_RATE - 1) * split.high;

        // ★ 3. 外側の変数（合計時間）に足し込む
        standardPremiumHours += split.standard;
        highPremiumHours += split.high;
        deferredHighPremiumHours += split.deferred;
        totalOvertimeHours += legalOvertimeToday;
      }
    }
  }

  // ── 通勤手当・任意手当 ──────────────────────────────────────
  const commutePay = staff.commute_type === 'daily'   ? (Number(staff.commute_amount) || 0) * workDays
                  : staff.commute_type === 'monthly' ? (Number(staff.commute_amount) || 0) : 0;
  const allowanceAmount = Number(extras.allowanceAmount) || 0;

  const customItems = extras.customItems ?? [];
  const customEarnings   = customItems.filter(i => i.type === 'earning').reduce((s, i) => s + i.amount, 0);
  const customDeductions = customItems.filter(i => i.type === 'deduction').reduce((s, i) => s + i.amount, 0);

  // ── 支給合計 ──────────────────────────────────────────────
  // const premiums = standardOvertimePay + highOvertimePay + nightPay;
  // const roundedPremiums = applyRounding(premiums, companySettings?.round_overtime || 'round');
  // const roundedStatutory = applyRounding(statutoryOvertimePay, companySettings?.round_overtime || 'round');
  const roundOvertime = companySettings?.round_overtime || 'round';
  const roundedStatutory = applyRounding(statutoryOvertimePay || 0, roundOvertime);

  // 固定残業代（月給制の人だけ）：時間外労働の割増賃金の代わりに定額を払い、法定の計算額が上回る分だけ足す
  const fixedOvertimeAllowance = staff.wage_type === 'monthly'
    ? Math.max(0, Math.floor(Number(staff.fixed_overtime_allowance) || 0))
    : 0;
  const fixedOvertimeHours = fixedOvertimeAllowance > 0 ? Math.max(0, Number(staff.fixed_overtime_hours) || 0) : 0;
  let fixedOvertimeExcess = 0;
  let roundedPremiums: number;
  if (fixedOvertimeAllowance > 0) {
    const legalOvertimePay = applyRounding((standardOvertimePay || 0) + (highOvertimePay || 0), roundOvertime);
    fixedOvertimeExcess = Math.max(0, legalOvertimePay - fixedOvertimeAllowance);
    roundedPremiums = fixedOvertimeAllowance + fixedOvertimeExcess
      + applyRounding((holidayWorkPay || 0) + (nightPay || 0), roundOvertime);
  } else {
    roundedPremiums = applyRounding((standardOvertimePay || 0) + (highOvertimePay || 0) + (holidayWorkPay || 0) + (nightPay || 0), roundOvertime);
  }

  const totalEarnings = Math.floor(basePay || 0)
                    - (absenceDeduction || 0)
                    + (roundedStatutory || 0)
                    + (roundedPremiums || 0)
                    + Math.floor(paidLeavePay || 0)
                    + (commutePay || 0)
                    + (allowanceAmount || 0)
                    + (customEarnings || 0);

  // ── 社会保険料 ──────────────────────────────────────────────
  // 保険料の対象月に合った料率（健康保険は3月分から、雇用保険は4月から新年度）
  // ※ 支給年月を保険料の対象月として扱う（当月徴収）
  const ins = Master.getInsuranceMaster(targetYear, targetMonth);

  // 1. 加入しているかと標準報酬月額
  // 従業員画面で「標準報酬月額 0：未加入・対象外」または社保規定「未加入 / 適用除外」を選んだ人からは控除しない
  // （標準報酬月額は資格取得時・算定基礎・月変で決まり、毎月の給与からは計算しない）
  // 標準報酬月額は、その月の分に使う値（履歴から。詳しくは utils/standardRemuneration.ts）
  const isSocialInsEnrolled = checkSocialInsEnrolled(staff, targetYear, targetMonth);
  const hyojunHoshu = isSocialInsEnrolled ? getStandardRemuneration(staff, targetYear, targetMonth) : 0;

  // 2. 料率の取得と計算（本人負担分 = 標準報酬月額 × 料率 ÷ 2）
  // 年齢で、健康保険（75歳の誕生月から）・介護保険（40〜64歳）・厚生年金（70歳に達した月から）の対象が変わる
  const byAge = getInsuranceByAge(staff.birthday || '', targetYear, targetMonth);
  // 入社前の月・資格喪失日（退職日の翌日）がある月からの分は、どの社会保険料もかからない
  const isInsuredMonth = checkInsuredMonth(staff.join_date, staff.retirement_date, targetYear, targetMonth);
  // 産休・育休で免除される月の分も、どの社会保険料もかからない（詳しくは utils/leaveExemption.ts）
  const isLeaveExemptMonth = checkLeaveExemptMonth(parseLeavePeriods(staff.leave_periods), targetYear, targetMonth);
  const isSocialInsMonth = isSocialInsEnrolled && isInsuredMonth && !isLeaveExemptMonth;
  const healthRate = (ins.KENPO_RATES[extras.prefecture] ?? ins.KENPO_RATES["京都"])[1]; // 合計の料率(%)
  const sInsType = companySettings?.round_social_ins || 'floor';
  const kenpoHyojun = Math.min(hyojunHoshu, ins.KENPO_MAX_HYOJUN);

  let healthInsurance = 0, nursingInsurance = 0, childSupport = 0, welfarePension = 0;
  if (isSocialInsMonth && byAge.health) {
    // 健康保険料
    healthInsurance = calcPremium(kenpoHyojun, healthRate, sInsType);

    // 介護保険料（40〜64歳）
    // 協会けんぽの保険料額表と同じく「健康保険＋介護保険」の料率でまとめて計算し、健康保険料を引いた残りを介護保険料とする
    if (byAge.nursing) {
      const combined = calcPremium(kenpoHyojun, healthRate + ins.KENPO_CARE_RATE[1], sInsType);
      nursingInsurance = combined - healthInsurance;
    }

    // 子ども・子育て支援金（令和8年4月分から。健康保険と同じ標準報酬月額に支援金率を掛ける）
    if (Master.isChildSupportMonth(ins, targetYear, targetMonth) && ins.CHILD_SUPPORT_RATE) {
      childSupport = calcPremium(kenpoHyojun, ins.CHILD_SUPPORT_RATE[1], sInsType);
    }
  }
  if (isSocialInsMonth && byAge.pension) {
    // 厚生年金（標準報酬月額は 88,000円〜650,000円 の範囲）
    const pensionHyojun = Math.max(ins.PENSION_MIN_HYOJUN, Math.min(hyojunHoshu, ins.PENSION_MAX_HYOJUN));
    welfarePension = calcPremium(pensionHyojun, ins.PENSION_RATE[1], sInsType);
  }

  // 雇用保険（賃金総額 × 本人負担率）
  // 従業員画面の「雇用保険加入」を外した人（役員など）からは控除しない
  // 区分は 従業員の設定 → 会社の設定 → 「一般の事業」 の順に決める
  const isEmploymentInsEnrolled = checkEmploymentInsEnrolled(staff);
  const empInsKey = (staff.employment_insurance_type || companySettings?.default_emp_ins_type || 'general') as Master.EmpInsType;
  const empRates = ins.LABOR_INSURANCE_RATES[empInsKey] || ins.LABOR_INSURANCE_RATES.general;
  const empInsurance = isEmploymentInsEnrolled
    ? calcPremium(totalEarnings, empRates[0] * 100, companySettings?.round_emp_ins || 'round', 1)
    : 0;

  // ── 税金・最終計算 ──────────────────────────────────────────────
  const socialTotal = healthInsurance + nursingInsurance + childSupport + welfarePension + empInsurance;
  // 通勤手当は非課税限度額（月15万円）まで所得税がかからない
  // ※ マイカー・自転車通勤は距離に応じた限度額になるが、今は交通機関の限度額で計算する
  const nonTaxableCommute = Math.min(commutePay, Master.getTaxMaster(targetYear).DEFAULT_COMMUTING_TAX_FREE_LIMIT);
  const taxableAmount = totalEarnings - nonTaxableCommute;
  // targetYear は支給年（源泉所得税は支払った年の税額表を使う）
  // 扶養控除等申告書を出していない人は乙欄（扶養人数は「従たる給与についての扶養控除等申告書」の人数）
  const taxColumn = toTaxColumn(staff.tax_column);
  const incomeTaxBeforeReduction = getGensenTax(Math.max(0, taxableAmount - socialTotal), Number(extras.dependents) || 0, targetYear, extras.taxMethod, taxColumn);
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
    holidayWorkHours,
    paidLeaveHours,

    // --- 支給額 (Earnings) ---
    basePay: Math.floor(basePay),
    absenceDeduction,
    statutoryOvertimePay: Math.floor(statutoryOvertimePay),
    standardOvertimePay: Math.floor(standardOvertimePay),
    highOvertimePay: Math.floor(highOvertimePay),
    holidayWorkPay: Math.floor(holidayWorkPay),
    fixedOvertimeAllowance,
    fixedOvertimeHours,
    fixedOvertimeExcess,
    nightPay: Math.floor(nightPay),
    paidLeavePay: Math.floor(paidLeavePay),
    commutePay,
    allowanceAmount,
    customEarnings,
    totalEarnings,
    nonTaxableCommute,
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
    hyojunHoshu,
    isSocialInsEnrolled,
    isEmploymentInsEnrolled,
  };
};
