/**
 * フレックスタイム制の清算（清算期間は1〜3か月。給与の計算期間を清算期間にし、2・3か月のときは計算期間をつなげる）
 *
 * 決まり（労働基準法32条の3・32条の3の2）：
 * ・始業・終業の時刻を本人が決める働き方。1日8時間・週40時間では残業を数えず、清算期間の合計で数える。
 * ・総労働時間：清算期間に働く時間として会社が決めた時間（所定）。法定の総枠を超えてはいけない。
 * ・法定の総枠：40時間 × 清算期間の暦日数 ÷ 7。0.1時間に満たない端数は切り捨てる（厚生労働省の手引きの表と同じ。
 *   31日 177.1時間・30日 171.4時間。総枠を少なめにして、働く人に不利にならないようにする）。
 *   完全週休2日の会社は、労使協定で「清算期間の所定労働日数 × 8時間」を総枠にできる（同条3項）。
 * ・実際に働いた時間（法定休日の労働を除く）が法定の総枠を超えた時間が、時間外労働（割増賃金。月60時間を超えた分は50%）。
 *   総労働時間を超えて法定の総枠までの時間は、法定内の時間（割増はいらない。通常の賃金を払う）。
 * ・年次有給休暇・有給の休暇の日は、総労働時間に足りているかを見るときは、1日の標準の時間（所定労働時間）働いたものとして数える。
 *   割増を払うのは、実際に働いた時間が法定の総枠を超えた分だけ。
 * ・足りない時間（不足時間）は、清算期間の終わりに清算する（賃金から引く）か、次の清算期間に繰り越す（次の清算期間の総労働時間に足す）。
 *   繰り越せるのは、法定の総枠と総労働時間の差まで（次の清算期間に、法定の総枠を超えて割増のない時間を働かせないため）。
 *   Q は、その差までを繰り越し、残りは引く。退職する月は繰り越さずに引く。
 * ・法定休日の労働（35%増）・深夜（25%増）は、フレックスタイム制でも別に数える（utils/calcSalary.ts）。
 *
 * 清算期間が1か月を超えるとき（2・3か月。同条2項。労使協定を労働基準監督署に届け出る）：
 * ・清算期間を1か月ごとに区分した各期間（Q では給与の計算期間）ごとに、週平均50時間（50時間 × 暦日数 ÷ 7。0.1時間未満切り捨て）を
 *   超えた時間は、その月の時間外労働として、その月の賃金支払日に割増賃金を払う（清算期間の途中でも払う。基発1228第15号 問1）。
 *   Q は、月給制・日給制は通常の賃金と割増（125%）を、時給制は割増分を払う。
 * ・清算期間の最後の月は、①最後の月の週平均50時間を超えた時間 ＋ ②清算期間の実労働時間から、各月の週平均50時間を超えた時間と
 *   法定の総枠を引いた時間 が、その月の時間外労働になる（基発0907第1号 第1の7(2)・手引き「時間外労働の計算手順」）。
 *   月60時間は、各月の時間外労働（最後の月は①＋②）で数える（基発1228第15号 問3）。
 * ・総労働時間との過不足は、最後の月に、清算期間の実労働時間（＋有給）と総労働時間を比べて清算する。総労働時間を超えた時間のうち、
 *   前の月までに週平均50時間を超えて時間外労働として払った時間は、通常の賃金も払っているので除く（同じ時間に2回払わない）。
 *   足りない時間は、実際に働いた時間すべてで見る（前の月に払った時間外労働の賃金は、引き戻さない）。
 * ・清算期間の途中で入社・退職した人は、働いた期間で清算する。働いた期間を平均して週40時間（40時間 × 働いた期間の暦日数 ÷ 7）を
 *   超えた時間（各月の週平均50時間を超えた時間を除く）に割増賃金を払う（労働基準法32条の3の2）。退職する人は、退職する月に清算する。
 *   入社した月の週平均50時間も、在籍した日で数える（働いていない日で平均を薄めない）。
 * ・前の月の数字は、確定した給与に残したもの（salary_results.flex_month）を使う。前の月の給与を確定していないと、最後の月は清算できない。
 *
 * 総労働時間（1か月ごと。清算期間が2・3か月なら、各月の分を足す）：
 * ・所定労働日数 × 1日の所定労働時間か、1か月あたりの決めた時間。休業の日・入社前・退職後の日がある月は、決めた時間を、計算期間の
 *   所定労働日数のうち在籍していて休業していない日の割合で減らす（所定労働日数で数えるときは、その日を数えない）。
 * ・日給制の人は、日給を払った日（所定労働日に働いた日。半休の日は働いた割合）× 1日の所定労働時間 ＋ 有給の時間を総労働時間にする
 *   （日給は1日の所定労働時間の分の賃金なので。欠勤した日は日給を払わないので、その日の時間を足りない時間にしない）。
 *   超えた時間は 日給 ÷ 1日の所定労働時間 で払い、足りない時間は同じ額で引く（または繰り越す）。遅刻・早退は別に引かない。
 *
 * 一般的な勤怠ソフトと同じ形（クラウド型の勤怠ソフトの「フレックスタイム制」：清算期間は1・2・3か月と起算の月、総労働時間は
 * 「1日の標準労働時間 × 所定労働日数」か指定した時間、法定の総枠は原則か「所定労働日数 × 8時間」、不足時間は清算期間の終わりに清算か
 * 次の清算期間に繰り越し、清算期間が複数の月なら、1か月の労働時間が「週平均50時間」を超えた時間をその月の法定外にする）。
 * 出典：厚生労働省「フレックスタイム制のわかりやすい解説＆導入の手引き」https://www.mhlw.go.jp/content/001140964.pdf
 *       通達 基発0907第1号（平成30年9月7日）第1・基発1228第15号（平成30年12月28日）第1
 */
import dayjs from "dayjs";
import { specialLeaveOfRow } from "./specialLeave";
import { getPayrollPeriod, getPeriodForPayMonth, type PayrollGroupForPeriod } from "./payrollPeriod";

/** 法定の1週間の労働時間 */
const WEEKLY_LEGAL_HOURS = 40;
/** 清算期間が1か月を超えるときの、1か月ごとの週平均の上限 */
const WEEKLY_MONTH_CAP_HOURS = 50;
/** 完全週休2日制の特例の1日の時間 */
const FIVE_DAY_DAILY_HOURS = 8;
/** 1か月の決めた時間の上限（31日 × 24時間） */
const MAX_FIXED_HOURS_PER_MONTH = 744;

/** 清算期間の長さ（か月） */
export type FlexMonths = 1 | 2 | 3;

export interface FlexRule {
  /** 総労働時間：workdays＝所定労働日数 × 1日の所定労働時間 / fixed＝1か月あたりの決めた時間（清算期間が2・3か月なら、その月数分） */
  total: { mode: "workdays" } | { mode: "fixed"; hours: number };
  /** 法定の総枠：standard＝40時間 × 暦日数 ÷ 7 / fiveDay＝所定労働日数 × 8時間（完全週休2日制の特例。労使協定がいる） */
  limit: "standard" | "fiveDay";
  /** 不足時間：deduct＝清算期間の終わりに清算する（給与から引く） / carry＝次の清算期間に繰り越す（法定の総枠と総労働時間の差まで） */
  shortage: "deduct" | "carry";
  /** 清算期間の長さ（給与の計算期間をいくつつなげるか） */
  months: FlexMonths;
  /** 清算期間の起算の月（計算期間の月。1〜months にそろえる。3か月なら 1＝1月・4月・7月・10月から） */
  startMonth: number;
}

export const DEFAULT_FLEX_RULE: FlexRule = { total: { mode: "workdays" }, limit: "standard", shortage: "deduct", months: 1, startMonth: 1 };

/** 起算の月を 1〜months にそろえる（3か月なら、1月・4月・7月・10月はどれも 1） */
const normalizeStartMonth = (startMonth: number, months: number): number =>
  ((((Math.trunc(startMonth) - 1) % months) + months) % months) + 1;

/** 給与規定グループの flex_rule（JSON）を読む。ない・読めないときは初めの決まり */
export const parseFlexRule = (value: unknown): FlexRule => {
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_FLEX_RULE;
  try {
    const v = JSON.parse(value);
    const months: FlexMonths = v?.months === 2 || v?.months === 3 ? v.months : 1;
    const hours = Number(v?.total?.hours);
    const total: FlexRule["total"] = v?.total?.mode === "fixed" && Number.isFinite(hours) && hours > 0 && hours <= MAX_FIXED_HOURS_PER_MONTH
      ? { mode: "fixed", hours }
      : { mode: "workdays" };
    const start = Number(v?.startMonth);
    return {
      total,
      limit: v?.limit === "fiveDay" ? "fiveDay" : "standard",
      shortage: v?.shortage === "carry" ? "carry" : "deduct",
      months,
      startMonth: Number.isInteger(start) && start >= 1 && start <= 12 ? normalizeStartMonth(start, months) : 1,
    };
  } catch {
    return DEFAULT_FLEX_RULE;
  }
};

export const stringifyFlexRule = (rule: FlexRule): string =>
  JSON.stringify({ ...rule, startMonth: normalizeStartMonth(rule.startMonth, rule.months) });

export const FLEX_MONTHS_LABELS: Record<FlexMonths, string> = {
  1: "1か月（給与の計算期間ごとに清算）",
  2: "2か月（計算期間2つで清算。労使協定を労働基準監督署に届け出る）",
  3: "3か月（計算期間3つで清算。労使協定を労働基準監督署に届け出る）",
};

export const FLEX_LIMIT_LABELS: Record<FlexRule["limit"], string> = {
  standard: "40時間 × 暦日数 ÷ 7（原則）",
  fiveDay: "所定労働日数 × 8時間（完全週休2日制の特例。労使協定がいる）",
};

export const FLEX_SHORTAGE_LABELS: Record<FlexRule["shortage"], string> = {
  deduct: "清算期間の終わりに清算する（給与から引く）",
  carry: "次の清算期間に繰り越す（法定の総枠と総労働時間の差まで。残りは引く）",
};

/** 起算の月の選び方（2か月：「1月・3月・5月・7月・9月・11月から」、3か月：「1月・4月・7月・10月から」など） */
export const flexStartMonthOptions = (months: number): { value: number; label: string }[] =>
  months <= 1
    ? []
    : Array.from({ length: months }, (_, i) => ({
        value: i + 1,
        label: `${Array.from({ length: 12 / months }, (_, k) => `${i + 1 + k * months}月`).join("・")}から`,
      }));

/** 「清算期間：3か月（1月・4月・7月・10月から）／総労働時間：…／法定の総枠：…／不足時間：…」 */
export const describeFlexRule = (rule: FlexRule): string => {
  const start = flexStartMonthOptions(rule.months).find((o) => o.value === normalizeStartMonth(rule.startMonth, rule.months));
  return `清算期間：${rule.months}か月${start ? `（${start.label}）` : ""}`
    + `／総労働時間：${rule.total.mode === "fixed" ? `1か月あたり${rule.total.hours}時間` : "所定労働日数 × 1日の所定労働時間"}`
    + `／法定の総枠：${FLEX_LIMIT_LABELS[rule.limit]}／不足時間：${FLEX_SHORTAGE_LABELS[rule.shortage]}`;
};

/** 清算に使う勤怠の行（確定した日） */
export interface FlexAttendanceRow {
  work_date: string;
  work_type?: string | null;
  work_hours?: number | string | null;
  paid_leave_hours?: number | string | null;
  special_leave_hours?: number | string | null;
  leave_paid?: number | string | null;
}

/**
 * 1か月（給与の計算期間）の記録。確定した給与（salary_results.flex_month）に残し、清算期間の最後の月の清算に使う
 * 時間は時間の単位（分まで正しい値）
 */
export interface FlexMonthRecord {
  /** どの清算期間の何か月目か（清算期間の初めの日・長さ・0から数えた番号） */
  periodStart: string;
  months: number;
  index: number;
  /** この計算期間（まるごと）の初めの日と終わりの日 */
  periodFrom: string;
  periodTo: string;
  /** 清算に使った日（在籍した日）の初めの日と終わりの日、その暦日数 */
  from: string;
  to: string;
  days: number;
  /** 在籍していて休業していない日の所定労働日数（完全週休2日制の特例の総枠に使う） */
  workDays: number;
  /** 1日の所定労働時間 */
  dayHours: number;
  /** この月の総労働時間（所定。会社都合で休ませた日を除く前。日給制は、日給を払った時間 ＋ 有給の時間） */
  totalHours: number;
  /** 会社都合で休ませた日の所定労働時間（働かなければならない時間から除く） */
  excusedHours: number;
  /** 実際に働いた時間（法定休日の労働を除く） */
  actualHours: number;
  /** 年休・有給の休暇で、働いたものとして数える時間 */
  leaveHours: number;
  /** 週平均50時間を超えた時間（この月の時間外労働として払った時間。清算期間が1か月なら 0） */
  over50Hours: number;
}

/** 確定した給与に残した記録（JSON）を読む。読めなければ null */
export const parseFlexMonthRecord = (value: unknown): FlexMonthRecord | null => {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const v = JSON.parse(value);
    const num = (k: string) => Number(v?.[k]);
    const str = (k: string) => (typeof v?.[k] === "string" ? v[k] : "");
    const r: FlexMonthRecord = {
      periodStart: str("periodStart"), months: num("months"), index: num("index"),
      periodFrom: str("periodFrom"), periodTo: str("periodTo"), from: str("from"), to: str("to"), days: num("days"),
      workDays: num("workDays"), dayHours: num("dayHours"), totalHours: num("totalHours"), excusedHours: num("excusedHours"),
      actualHours: num("actualHours"), leaveHours: num("leaveHours"), over50Hours: num("over50Hours"),
    };
    const numbers = [r.months, r.index, r.days, r.workDays, r.dayHours, r.totalHours, r.excusedHours, r.actualHours, r.leaveHours, r.over50Hours];
    if (!r.periodStart || !r.from || !r.to || numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return r;
  } catch {
    return null;
  }
};

/** 清算期間が1か月を超えるときの、この月の位置と前の月の記録 */
export interface FlexMultiInput {
  months: number;
  /** この月が何か月目か（0から） */
  index: number;
  /** この月で清算するか（清算期間の最後の月か、清算期間の途中で退職する月） */
  final: boolean;
  /** 清算期間の初めの日と終わりの日（計算期間をつなげた期間） */
  periodStart: string;
  periodEnd: string;
  /** 同じ清算期間の前の月の記録（確定した給与に残したもの） */
  previous: FlexMonthRecord[];
  /** 清算期間の途中で入社・退職した（省略時は、記録の日数が清算期間より短いかで決める） */
  partial?: boolean;
  /** 前の月の記録がない月がある（記録がある月だけで数えた仮の清算。確定できない） */
  incomplete?: boolean;
}

export interface FlexInput {
  rule: FlexRule;
  /** 給与形態（日給制は、日給を払った時間で清算する。省略時は月給制） */
  wageType?: string;
  /** この計算期間（まるごと）の初めの日と終わりの日（省略時は from・to） */
  periodFrom?: string;
  periodTo?: string;
  /** 清算に使う日（在籍した日）の初めの日と終わりの日（YYYY-MM-DD） */
  from: string;
  to: string;
  /** 在籍していて休業していない日の所定労働日数（会社カレンダーから数えたもの。わからなければ null） */
  workDays: number | null;
  /** 計算期間の所定労働日数（決めた時間を減らす割合に使う。省略・わからなければ workDays） */
  periodWorkDays?: number | null;
  /** 1日の所定労働時間（標準の時間。年休の日は、この時間働いたものとして数える） */
  dayHours: number;
  /** 前の清算期間から繰り越した不足時間（清算する月だけ使う） */
  carryInHours: number;
  rows: FlexAttendanceRow[];
  /**
   * 働かなければならない時間から除く時間（会社都合で休ませた日の所定労働時間。休業手当を払うので、不足時間にしない。utils/averageWage.ts）
   */
  excusedHours?: number;
  /** 日給制：日給を払った日数 × 1日の所定労働時間 */
  coveredHours?: number;
  /** この月に退職する（不足時間を繰り越さない） */
  retiring?: boolean;
  /** 清算期間が1か月を超えるとき */
  multi?: FlexMultiInput;
  /** 画面に出す清算期間（「2026年4月1日〜6月30日」）と、最後の月の支給年月（「2026年7月支給」） */
  periodLabel?: string | null;
  finalPayLabel?: string | null;
}

export interface FlexSettlement {
  /** 清算期間の長さ（か月）・この月が何か月目か（0から）・この月で清算したか */
  months: number;
  index: number;
  final: boolean;
  /** 清算期間の途中で入社・退職したので、働いた期間で清算した（清算期間が1か月を超えるとき。労働基準法32条の3の2） */
  partial: boolean;
  periodLabel: string | null;
  finalPayLabel: string | null;
  // ── ここから、清算する月は清算期間の合計（途中の月は、総労働時間・法定の総枠・過不足は 0） ──
  /** 総労働時間（繰り越しを含まない。会社都合で休ませた日を除く前） */
  totalHours: number;
  /** 前の清算期間から繰り越した不足時間 */
  carryInHours: number;
  /** 働かなければならない時間（総労働時間 − 会社都合で休ませた日 ＋ 繰り越し） */
  requiredHours: number;
  /** 法定の総枠 */
  limitHours: number;
  /** 実際に働いた時間（法定休日の労働を除く。途中の月は、この月の時間） */
  actualHours: number;
  /** 年休・有給の休暇で、働いたものとして数える時間 */
  leaveHours: number;
  /** 総労働時間を超えた時間（実労働 ＋ 有給 − 働かなければならない時間。0以上） */
  excessHours: number;
  /** この月の時間外労働（途中の月は週平均50時間を超えた時間、清算する月は ①＋②）。割増を払う */
  overtimeHours: number;
  /** この月の時間外労働のうち、通常の賃金も払う時間（月給制・日給制は 125%） */
  fullOvertimeHours: number;
  /** この月の時間外労働のうち、総労働時間の中の時間（通常の賃金は月給・日給で払っているので、割増だけ） */
  premiumOnlyHours: number;
  /** 総労働時間を超えて、時間外労働でない時間（法定内。通常の賃金） */
  innerHours: number;
  /** 足りない時間 */
  shortageHours: number;
  /** 次の清算期間に繰り越す時間 */
  carryOutHours: number;
  /** 給与から引く時間 */
  deductHours: number;
  // ── この月の値 ──
  monthActualHours: number;
  monthLeaveHours: number;
  /** この月の週平均50時間の上限（清算期間が1か月を超えるときだけ。ほかは null） */
  monthLimit50Hours: number | null;
  /** この月の、週平均50時間を超えた時間 */
  over50Hours: number;
  /** 前の月までに、週平均50時間を超えて時間外労働として払った時間 */
  previousOver50Hours: number;
  /** 清算期間を通じて法定の総枠を超えた時間（各月の週平均50時間を超えた時間を除く。清算する月だけ） */
  periodOverHours: number;
  /** 確定した給与に残す、この月の記録 */
  record: FlexMonthRecord;
  notes: string[];
}

/** 分（整数）を時間にする（丸めない。給与の額を、分の単位のまま正しく出すため。画面には flexHoursLabel で分まで出す） */
const hoursOf = (minutes: number) => minutes / 60;
const minutesOf = (hours: unknown) => Math.round((Number(hours) || 0) * 60);

/** 「171時間24分」 */
export const flexHoursLabel = (hours: number): string => {
  const m = Math.round(hours * 60);
  const h = Math.floor(m / 60);
  const rest = m - h * 60;
  return rest === 0 ? `${h}時間` : `${h}時間${rest}分`;
};

/** 期間の暦日数（両端を含む） */
const calendarDaysOf = (from: string, to: string): number => {
  const a = dayjs(from);
  const b = dayjs(to);
  if (!a.isValid() || !b.isValid() || b.isBefore(a)) return 0;
  return b.diff(a, "day") + 1;
};

/** 期間の平日（月〜金）の日数（所定労働日数がわからないときに使う） */
const weekdaysOf = (from: string, to: string): number => {
  let n = 0;
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) {
    if (d.day() !== 0 && d.day() !== 6) n++;
  }
  return n;
};

/**
 * 週平均の上限（時間 × 暦日数 ÷ 7）を、0.1時間に満たない端数を切り捨てて分にする
 * （厚生労働省の手引きの表と同じ：40時間で31日 177.1時間・30日 171.4時間・91日 520.0時間、50時間で31日 221.4時間・30日 214.2時間）
 */
export const weeklyAverageLimitMinutes = (weeklyHours: number, days: number): number =>
  Math.floor((weeklyHours * 10 * Math.max(0, days)) / 7) * 6;

/** その日の、有給（年休・有給の特別休暇）で働いたものとして数える時間 */
const leaveHoursOfRow = (row: FlexAttendanceRow, dayHours: number): number => {
  const type = row.work_type || "normal";
  const annual = (type === "paid_full" ? dayHours : type === "paid_half" ? dayHours / 2 : 0) + (Number(row.paid_leave_hours) || 0);
  const special = specialLeaveOfRow(row);
  const specialHours = special.paid ? special.days * dayHours + special.hours : 0;
  return annual + specialHours;
};

/**
 * フレックスタイム制の清算
 * 清算期間が1か月なら、この月で清算する。2・3か月なら、途中の月は週平均50時間を超えた時間だけをその月の時間外労働にし、
 * 最後の月（途中で退職する人は退職する月）に、前の月の記録と合わせて清算期間の合計で清算する
 */
export const settleFlex = (input: FlexInput): FlexSettlement => {
  const { rule, from, to, dayHours } = input;
  const daily = input.wageType === "daily";
  const notes: string[] = [];
  const multi = input.multi && input.multi.months > 1 ? input.multi : null;
  const final = multi ? multi.final : true;

  // ── この月 ──
  const days = calendarDaysOf(from, to);
  let workDays = input.workDays;
  if (workDays === null || !Number.isFinite(workDays)) {
    workDays = weekdaysOf(from, to);
    notes.push(`所定労働日数がわからないため、平日（月〜金）の日数 ${workDays}日で数えています（会社カレンダー・出勤曜日を確かめてください）。`);
  }
  const periodWorkDays = input.periodWorkDays !== null && input.periodWorkDays !== undefined && Number.isFinite(input.periodWorkDays)
    ? input.periodWorkDays
    : workDays;
  let actual = 0;
  let leave = 0;
  for (const row of input.rows) {
    if (row.work_date < from || row.work_date > to) continue;
    leave += minutesOf(leaveHoursOfRow(row, dayHours));
    if ((row.work_type || "normal") === "statutory_holiday") continue; // 法定休日の労働は休日労働として別に払う
    actual += minutesOf(row.work_hours);
  }
  // この月の総労働時間（所定）：日給制は、日給を払った時間 ＋ 有給の時間
  const monthTotal = daily
    ? Math.max(0, minutesOf(input.coveredHours)) + leave
    : rule.total.mode === "fixed"
      ? (periodWorkDays > 0 ? Math.round(minutesOf(rule.total.hours) * Math.min(1, workDays / periodWorkDays)) : minutesOf(rule.total.hours))
      : Math.round(workDays * dayHours * 60);
  const excused = daily ? 0 : Math.min(monthTotal, Math.max(0, minutesOf(input.excusedHours)));
  // この月の週平均50時間の上限（清算期間が1か月を超えるときだけ。在籍した日で数える）
  const limit50 = multi ? weeklyAverageLimitMinutes(WEEKLY_MONTH_CAP_HOURS, days) : null;
  const over50 = limit50 === null ? 0 : Math.max(0, actual - limit50);
  const record: FlexMonthRecord = {
    periodStart: multi?.periodStart ?? input.periodFrom ?? from,
    months: multi?.months ?? 1,
    index: multi?.index ?? 0,
    periodFrom: input.periodFrom ?? from,
    periodTo: input.periodTo ?? to,
    from, to, days, workDays, dayHours,
    totalHours: hoursOf(monthTotal),
    excusedHours: hoursOf(excused),
    actualHours: hoursOf(actual),
    leaveHours: hoursOf(leave),
    over50Hours: hoursOf(over50),
  };
  const common = {
    months: multi?.months ?? 1,
    index: multi?.index ?? 0,
    final,
    periodLabel: input.periodLabel ?? null,
    finalPayLabel: input.finalPayLabel ?? null,
    monthActualHours: hoursOf(actual),
    monthLeaveHours: hoursOf(leave),
    monthLimit50Hours: limit50 === null ? null : hoursOf(limit50),
    over50Hours: hoursOf(over50),
    record,
    notes,
  };

  if (!final) {
    // 清算期間の途中の月：週平均50時間を超えた時間だけを、この月の時間外労働として払う（過不足は最後の月に清算する）
    return {
      ...common,
      partial: false,
      totalHours: 0, carryInHours: 0, requiredHours: 0, limitHours: 0,
      actualHours: hoursOf(actual), leaveHours: hoursOf(leave),
      excessHours: 0,
      overtimeHours: hoursOf(over50), fullOvertimeHours: hoursOf(over50), premiumOnlyHours: 0, innerHours: 0,
      shortageHours: 0, carryOutHours: 0, deductHours: 0,
      previousOver50Hours: 0, periodOverHours: 0,
    };
  }

  // ── 清算する月：清算期間の合計（前の月の記録 ＋ この月）──
  const records = [...(multi?.previous ?? []), record];
  const sum = (f: (r: FlexMonthRecord) => number) => records.reduce((s, r) => s + f(r), 0);
  const actualTotal = sum((r) => minutesOf(r.actualHours));
  const leaveTotal = sum((r) => minutesOf(r.leaveHours));
  const previousOver50 = (multi?.previous ?? []).reduce((s, r) => s + minutesOf(r.over50Hours), 0);
  const daysTotal = sum((r) => r.days);
  const total = sum((r) => minutesOf(r.totalHours));
  const excusedTotal = Math.min(total, sum((r) => minutesOf(r.excusedHours)));
  // 清算期間の途中で入社・退職した（働いた期間が清算期間より短い）
  const partial = !!multi && (multi.partial ?? daysTotal < calendarDaysOf(multi.periodStart, multi.periodEnd));
  if (multi?.incomplete) {
    notes.push("清算期間の前の月に記録がない（給与を確定していない）月があるので、記録がある月だけで数えた仮の清算です（この月の給与は確定できません）。");
  }

  // 法定の総枠：途中で入社・退職した人は、働いた期間を平均して週40時間（32条の3の2。完全週休2日制の特例は使わない）。
  // 清算期間をまるごと働いた人は、清算期間の暦日数で数える
  const limitDays = multi && !partial ? calendarDaysOf(multi.periodStart, multi.periodEnd) : daysTotal;
  const limit = !partial && rule.limit === "fiveDay"
    ? sum((r) => r.workDays) * FIVE_DAY_DAILY_HOURS * 60
    : weeklyAverageLimitMinutes(WEEKLY_LEGAL_HOURS, limitDays);
  if (partial) {
    notes.push(
      `清算期間の途中で${input.retiring ? "退職する" : "入社した"}ので、働いた期間（${daysTotal}日）で清算します。`
      + `法定の総枠は 40時間 × ${daysTotal}日 ÷ 7 ＝ ${flexHoursLabel(hoursOf(limit))} です（労働基準法32条の3の2）。`,
    );
  }
  if (!daily && total > limit) {
    notes.push(
      `総労働時間（${flexHoursLabel(hoursOf(total))}）が法定の総枠（${flexHoursLabel(hoursOf(limit))}）を超えています。`
      + "総枠を超えて働いた時間には割増を払います（総労働時間は、法定の総枠の中で決めます。完全週休2日の会社は、労使協定で「所定労働日数 × 8時間」を総枠にできます）。",
    );
  }

  const carryIn = Math.max(0, minutesOf(input.carryInHours));
  if (excusedTotal > 0) {
    notes.push(`会社都合で休ませた日の ${flexHoursLabel(hoursOf(excusedTotal))} は、働かなければならない時間から除きました（休業手当を払います）。`);
  }
  const required = total - excusedTotal + carryIn;
  // 時間外労働：この月の週平均50時間を超えた時間 ＋ 清算期間を通じて法定の総枠を超えた時間（各月の週平均50時間を超えた時間を除く）
  const periodOver = Math.max(0, actualTotal - previousOver50 - over50 - limit);
  const overtime = over50 + periodOver;
  const credited = actualTotal + leaveTotal;
  const excess = Math.max(0, credited - required);
  const shortage = Math.max(0, required - credited);
  // 総労働時間を超えた時間のうち、前の月までに時間外労働として通常の賃金も払った時間は除く
  const excessUnpaid = Math.max(0, excess - previousOver50);
  const fullOvertime = Math.min(excessUnpaid, overtime);
  const premiumOnly = overtime - fullOvertime;
  const inner = excessUnpaid - fullOvertime;
  if (previousOver50 > 0) {
    notes.push(
      `前の月までに週平均50時間を超えて時間外労働として払った ${flexHoursLabel(hoursOf(previousOver50))} は、`
      + "清算期間を通じて法定の総枠を超えた時間と、総労働時間を超えた時間から除きました（同じ時間に2回払わないため）。",
    );
  }
  let carryOut = 0;
  if (rule.shortage === "carry" && shortage > 0) {
    if (input.retiring) {
      notes.push("退職するので、足りない時間は次の清算期間に繰り越さず、この月で引きます。");
    } else {
      const room = Math.max(0, limit - total);
      carryOut = Math.min(shortage, room);
      if (carryOut < shortage) {
        notes.push(
          `繰り越せるのは、法定の総枠と総労働時間の差（${flexHoursLabel(hoursOf(room))}）までなので、`
          + `残りの ${flexHoursLabel(hoursOf(shortage - carryOut))} はこの月で引きます。`,
        );
      }
    }
  }
  return {
    ...common,
    partial,
    totalHours: hoursOf(total),
    carryInHours: hoursOf(carryIn),
    requiredHours: hoursOf(required),
    limitHours: hoursOf(limit),
    actualHours: hoursOf(actualTotal),
    leaveHours: hoursOf(leaveTotal),
    excessHours: hoursOf(excess),
    overtimeHours: hoursOf(overtime),
    fullOvertimeHours: hoursOf(fullOvertime),
    premiumOnlyHours: hoursOf(premiumOnly),
    innerHours: hoursOf(inner),
    shortageHours: hoursOf(shortage),
    carryOutHours: hoursOf(carryOut),
    deductHours: hoursOf(shortage - carryOut),
    previousOver50Hours: hoursOf(previousOver50),
    periodOverHours: hoursOf(periodOver),
  };
};

/**
 * 清算の内訳を、画面と給与明細に出す文にする（title：見出し、lines：内訳。知らせ（notes）は別に出す）
 * @param wageType 給与形態（時給制は、足りない時間を引かない）
 */
export const describeFlexSettlement = (fs: FlexSettlement, wageType?: string): { title: string; lines: string[] } => {
  const h = flexHoursLabel;
  const period = fs.periodLabel ? `清算期間 ${fs.periodLabel}・${fs.months}か月` : `清算期間${fs.months}か月`;
  const lines: string[] = [];
  if (!fs.final) {
    lines.push(
      `この月の実労働 ${h(fs.monthActualHours)}${fs.monthLeaveHours > 0 ? `（ほかに有給 ${h(fs.monthLeaveHours)}）` : ""}`
      + `・週平均50時間の上限 ${h(fs.monthLimit50Hours ?? 0)}（50時間 × ${fs.record.days}日 ÷ 7）`
      + (fs.over50Hours > 0 ? ` → 超えた ${h(fs.over50Hours)} は、この月の時間外労働として払います` : " → 超えていません"),
    );
    lines.push(
      `総労働時間との過不足と、法定の総枠を超えた時間は、清算期間の最後の月${fs.finalPayLabel ? `（${fs.finalPayLabel}）` : ""}の給与でまとめて清算します`,
    );
    return { title: `フレックスタイム制（${period}の${fs.index + 1}か月目）`, lines };
  }
  lines.push(
    `総労働時間 ${h(fs.requiredHours)}${fs.carryInHours > 0 ? `（前の清算期間から繰り越した ${h(fs.carryInHours)} を含む）` : ""}`
    + `・法定の総枠 ${h(fs.limitHours)}・実労働 ${h(fs.actualHours)}${fs.leaveHours > 0 ? ` ＋ 有給 ${h(fs.leaveHours)}` : ""}`
    + (fs.months > 1 ? `（この月の実労働 ${h(fs.monthActualHours)}）` : ""),
  );
  if (fs.months > 1) {
    lines.push(
      `この月の週平均50時間の上限 ${h(fs.monthLimit50Hours ?? 0)}`
      + (fs.over50Hours > 0 ? ` → 超えた ${h(fs.over50Hours)} は時間外労働` : " → 超えていません")
      + `。清算期間を通じて法定の総枠を超えた時間 ${h(fs.periodOverHours)}`
      + (fs.previousOver50Hours > 0 ? `（前の月までに時間外労働として払った ${h(fs.previousOver50Hours)} を除く）` : "")
      + ` → この月の時間外労働 ${h(fs.overtimeHours)}`,
    );
  }
  if (fs.excessHours > 0) {
    const paidBefore = Math.min(fs.excessHours, fs.previousOver50Hours);
    lines.push(
      `総労働時間を超えた時間 ${h(fs.excessHours)}（法定内 ${h(fs.innerHours)}・時間外 ${h(fs.fullOvertimeHours)}`
      + (paidBefore > 0 ? `・前の月までに払った時間外 ${h(paidBefore)}` : "") + "）",
    );
  } else if (fs.shortageHours > 0) {
    const parts = [
      fs.deductHours > 0 ? `給与から引く ${h(fs.deductHours)}` : "",
      fs.carryOutHours > 0 ? `次の清算期間に繰り越す ${h(fs.carryOutHours)}` : "",
    ].filter(Boolean);
    lines.push(`足りない時間 ${h(fs.shortageHours)}（${parts.join("・") || (wageType === "hourly" ? "時給制なので引きません" : "引きません")}）`);
  } else {
    lines.push("総労働時間どおり");
  }
  if (fs.premiumOnlyHours > 0) {
    lines.push(`総労働時間の中で時間外労働になった ${h(fs.premiumOnlyHours)} には、割増分だけを払います`);
  }
  const title = fs.months > 1
    ? `フレックスタイム制（${period}の${fs.partial && fs.index < fs.months - 1 ? "途中で退職する月。働いた期間" : "最後の月。清算期間の合計"}で清算します）`
    : "フレックスタイム制（清算期間はこの計算期間）";
  return { title, lines };
};

/** フレックスタイム制で計算する人か（月給制・日給制・時給制） */
export const isFlexStaff = (staff: { is_flex?: unknown; wage_type?: unknown }): boolean =>
  Number(staff?.is_flex) === 1 && (staff?.wage_type === "monthly" || staff?.wage_type === "daily" || staff?.wage_type === "hourly");

// ── 清算期間の位置と、前の月の記録 ─────────────────────────────

/** 支給年月の給与が、清算期間のどこにあたるか */
export interface FlexPosition {
  months: number;
  /** この月が何か月目か（0から） */
  index: number;
  /** 清算期間の初めの日と終わりの日（計算期間をつなげた期間） */
  from: string;
  to: string;
  /** 「2026年4月1日〜6月30日」 */
  label: string;
  /** 清算期間の最後の計算期間の給与の支給年月 */
  finalPay: { year: number; month: number };
  /** 同じ清算期間の、この月より前の月の支給年月（古い順） */
  previousPays: { year: number; month: number }[];
  /** 繰り越した不足時間を読む月（前の清算期間の最後の月）の支給年月 */
  carryFrom: { year: number; month: number };
}

/** 清算期間（計算期間をつなげた期間）を「2026年4月1日〜6月30日」にする */
const periodLabelOf = (from: string, to: string): string => {
  const a = dayjs(from);
  const b = dayjs(to);
  return `${a.year()}年${a.month() + 1}月${a.date()}日〜${b.year() !== a.year() ? `${b.year()}年` : ""}${b.month() + 1}月${b.date()}日`;
};

/**
 * 支給年月の給与が、清算期間のどこにあたるか（計算期間の月で数える。翌月払いなら、支給月の前の月の計算期間）
 * 起算の月から清算期間の長さごとに区切る（3か月で起算が1なら、1〜3月・4〜6月・7〜9月・10〜12月の計算期間）
 */
export const flexPositionOf = (rule: FlexRule, group: PayrollGroupForPeriod, payYear: number, payMonth: number): FlexPosition => {
  const months = rule.months > 1 ? rule.months : 1;
  const shift = Number(group.is_next_month) === 1 ? 1 : 0;
  const work = dayjs(new Date(payYear, payMonth - 1 - shift, 1));
  const workMonth = work.month() + 1;
  const index = months <= 1 ? 0 : ((((workMonth - normalizeStartMonth(rule.startMonth, months)) % 12) + 12) % 12) % months;
  const firstWork = work.subtract(index, "month");
  const lastWork = firstWork.add(months - 1, "month");
  const closing = Number(group.closing_day);
  const from = getPayrollPeriod(firstWork.year(), firstWork.month() + 1, closing).startStr;
  const to = getPayrollPeriod(lastWork.year(), lastWork.month() + 1, closing).endStr;
  const pay = dayjs(new Date(payYear, payMonth - 1, 1));
  const ym = (d: dayjs.Dayjs) => ({ year: d.year(), month: d.month() + 1 });
  return {
    months,
    index,
    from,
    to,
    label: periodLabelOf(from, to),
    finalPay: ym(pay.add(months - 1 - index, "month")),
    previousPays: Array.from({ length: index }, (_, i) => ym(pay.subtract(index - i, "month"))),
    carryFrom: ym(pay.subtract(index + 1, "month")),
  };
};

/** 清算に使う、清算期間の位置と前の月の記録・繰り越し（給与明細・勤怠の画面で読み込む） */
export interface FlexPeriodContext extends FlexPosition {
  /** 同じ清算期間の前の月の記録（確定した給与に残したもの。古い順） */
  previous: FlexMonthRecord[];
  /** 前の月のうち、記録がない月（給与を確定していない、この清算期間の記録がない）。あれば、この月で清算できない */
  missing: string[];
  /** 前の清算期間から繰り越した不足時間（前の清算期間の最後の月の確定した給与。なければ 0） */
  carryIn: number;
}

interface SelectDb {
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/**
 * 清算期間の位置と、同じ清算期間の前の月の記録・前の清算期間からの繰り越しを、確定した給与から読む
 * 入社する前の計算期間は、記録がなくてよい（働いた期間で清算する）
 * @param group 給与規定グループの締日・支払月（省略時は、従業員の給与規定グループを読む）
 */
export const loadFlexPeriod = async (
  db: SelectDb,
  staff: { id: string | number; join_date?: string | null; payroll_group_id?: number | string | null },
  rule: FlexRule,
  payYear: number,
  payMonth: number,
  group?: PayrollGroupForPeriod | null,
): Promise<FlexPeriodContext> => {
  let g = group ?? null;
  if (!g) {
    const rows = (await db.select(
      "SELECT closing_day, is_next_month FROM payroll_groups WHERE id = ?",
      [staff.payroll_group_id || 1],
    )) as PayrollGroupForPeriod[];
    g = rows?.[0] ?? { closing_day: 99, is_next_month: 0 };
  }
  const pos = flexPositionOf(rule, g, payYear, payMonth);
  const previous: FlexMonthRecord[] = [];
  const missing: string[] = [];
  for (const p of pos.previousPays) {
    const rows = (await db.select(
      "SELECT flex_month FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month = ?",
      [staff.id, p.year, p.month],
    )) as { flex_month?: string | null }[];
    const rec = parseFlexMonthRecord(rows?.[0]?.flex_month);
    if (rec && rec.periodStart === pos.from && rec.months === pos.months) {
      previous.push(rec);
      continue;
    }
    // 入社する前の計算期間は、清算に入れない
    const end = getPeriodForPayMonth(g, p.year, p.month).endStr;
    if (staff.join_date && end < staff.join_date) continue;
    missing.push(rows?.[0]
      ? `${p.year}年${p.month}月支給の給与に、この清算期間のフレックスタイム制の記録がありません（その月を確定し直してください）`
      : `${p.year}年${p.month}月支給の給与を確定していません`);
  }
  const carryRows = (await db.select(
    "SELECT flex_carry_hours FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month = ?",
    [staff.id, pos.carryFrom.year, pos.carryFrom.month],
  )) as { flex_carry_hours?: number | null }[];
  return { ...pos, previous, missing, carryIn: Math.max(0, Number(carryRows?.[0]?.flex_carry_hours) || 0) };
};
