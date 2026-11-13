/**
 * フレックスタイム制の清算（清算期間は1か月。給与の計算期間を清算期間にする）
 *
 * 決まり（労働基準法32条の3）：
 * ・始業・終業の時刻を本人が決める働き方。1日8時間・週40時間では残業を数えず、清算期間の合計で数える。
 * ・総労働時間：清算期間に働く時間として会社が決めた時間（所定）。法定の総枠を超えてはいけない。
 * ・法定の総枠：40時間 × 清算期間の暦日数 ÷ 7（1分に満たない端数は切り捨て。働く人に不利にならないように、総枠を少なめにする）。
 *   完全週休2日の会社は、労使協定で「清算期間の所定労働日数 × 8時間」を総枠にできる（同条3項）。
 * ・実際に働いた時間（法定休日の労働を除く）が法定の総枠を超えた時間が、時間外労働（割増賃金。月60時間を超えた分は50%）。
 *   総労働時間を超えて法定の総枠までの時間は、法定内の時間（割増はいらない。通常の賃金を払う）。
 * ・年次有給休暇・有給の休暇の日は、総労働時間に足りているかを見るときは、1日の標準の時間（所定労働時間）働いたものとして数える。
 *   割増を払うのは、実際に働いた時間が法定の総枠を超えた分だけ。
 * ・足りない時間（不足時間）は、その清算期間で清算する（賃金から引く）か、次の清算期間に繰り越す（次の清算期間の総労働時間に足す）。
 *   繰り越せるのは、法定の総枠と総労働時間の差まで（次の清算期間に、法定の総枠を超えて割増のない時間を働かせないため）。
 *   Q は、その月の差までを繰り越し、残りはその月で引く。
 * ・法定休日の労働（35%増）・深夜（25%増）は、フレックスタイム制でも別に数える（utils/calcSalary.ts）。
 * ・清算期間が1か月を超えるとき（2・3か月）は、1か月ごとに週平均50時間を超えた時間もその月の時間外労働になる（同条2項）。
 *   Q は、まだ1か月だけに対応する。
 * 一般的な勤怠ソフトと同じ形（マネーフォワード クラウド勤怠の「フレックスタイム制」：総労働時間は「1日の標準労働時間 × 所定労働日数」か
 * 指定した時間、法定の総枠は原則か「所定労働日数 × 8時間」、不足時間は清算期間の終わりに清算か次の清算期間に繰り越し）。
 * 出典：厚生労働省「フレックスタイム制のわかりやすい解説＆導入の手引き」https://www.mhlw.go.jp/content/001140964.pdf
 */
import dayjs from "dayjs";
import { specialLeaveOfRow } from "./specialLeave";

/** 法定の1週間の労働時間 */
const WEEKLY_LEGAL_HOURS = 40;
/** 完全週休2日制の特例の1日の時間 */
const FIVE_DAY_DAILY_HOURS = 8;

export interface FlexRule {
  /** 総労働時間：workdays＝所定労働日数 × 1日の所定労働時間 / fixed＝決めた時間 */
  total: { mode: "workdays" } | { mode: "fixed"; hours: number };
  /** 法定の総枠：standard＝40時間 × 暦日数 ÷ 7 / fiveDay＝所定労働日数 × 8時間（完全週休2日制の特例。労使協定がいる） */
  limit: "standard" | "fiveDay";
  /** 不足時間：deduct＝その月で清算する（給与から引く） / carry＝次の月に繰り越す（法定の総枠と総労働時間の差まで） */
  shortage: "deduct" | "carry";
}

export const DEFAULT_FLEX_RULE: FlexRule = { total: { mode: "workdays" }, limit: "standard", shortage: "deduct" };

/** 給与規定グループの flex_rule（JSON）を読む。ない・読めないときは初めの決まり */
export const parseFlexRule = (value: unknown): FlexRule => {
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_FLEX_RULE;
  try {
    const v = JSON.parse(value);
    const hours = Number(v?.total?.hours);
    const total: FlexRule["total"] = v?.total?.mode === "fixed" && Number.isFinite(hours) && hours > 0 && hours <= 744
      ? { mode: "fixed", hours }
      : { mode: "workdays" };
    return {
      total,
      limit: v?.limit === "fiveDay" ? "fiveDay" : "standard",
      shortage: v?.shortage === "carry" ? "carry" : "deduct",
    };
  } catch {
    return DEFAULT_FLEX_RULE;
  }
};

export const stringifyFlexRule = (rule: FlexRule): string => JSON.stringify(rule);

export const FLEX_LIMIT_LABELS: Record<FlexRule["limit"], string> = {
  standard: "40時間 × 暦日数 ÷ 7（原則）",
  fiveDay: "所定労働日数 × 8時間（完全週休2日制の特例。労使協定がいる）",
};

export const FLEX_SHORTAGE_LABELS: Record<FlexRule["shortage"], string> = {
  deduct: "その月で清算する（給与から引く）",
  carry: "次の月に繰り越す（法定の総枠と総労働時間の差まで。残りはその月で引く）",
};

/** 「総労働時間：所定労働日数 × 1日の所定労働時間／法定の総枠：…／不足時間：…」 */
export const describeFlexRule = (rule: FlexRule): string =>
  `総労働時間：${rule.total.mode === "fixed" ? `${rule.total.hours}時間` : "所定労働日数 × 1日の所定労働時間"}`
  + `／法定の総枠：${FLEX_LIMIT_LABELS[rule.limit]}／不足時間：${FLEX_SHORTAGE_LABELS[rule.shortage]}`;

/** 清算に使う勤怠の行（確定した日） */
export interface FlexAttendanceRow {
  work_date: string;
  work_type?: string | null;
  work_hours?: number | string | null;
  paid_leave_hours?: number | string | null;
  special_leave_hours?: number | string | null;
  leave_paid?: number | string | null;
}

export interface FlexInput {
  rule: FlexRule;
  /** 清算期間（給与の計算期間。入社・退職した月は、在籍した日だけ）の初めの日と終わりの日（YYYY-MM-DD） */
  from: string;
  to: string;
  /** その期間の所定労働日数（会社カレンダーから数えたもの。わからなければ null） */
  workDays: number | null;
  /** 1日の所定労働時間（標準の時間。年休の日は、この時間働いたものとして数える） */
  dayHours: number;
  /** 前の月から繰り越した不足時間 */
  carryInHours: number;
  rows: FlexAttendanceRow[];
}

export interface FlexSettlement {
  /** 総労働時間（繰り越しを除く） */
  totalHours: number;
  /** 前の月から繰り越した不足時間 */
  carryInHours: number;
  /** 働かなければならない時間（総労働時間 ＋ 繰り越し） */
  requiredHours: number;
  /** 法定の総枠 */
  limitHours: number;
  /** 実際に働いた時間（法定休日の労働を除く） */
  actualHours: number;
  /** 年休・有給の休暇で、働いたものとして数える時間 */
  leaveHours: number;
  /** 総労働時間を超えた時間（実労働 ＋ 有給 − 働かなければならない時間。0以上） */
  excessHours: number;
  /** 時間外労働（実労働が法定の総枠を超えた時間）。割増を払う */
  overtimeHours: number;
  /** 時間外労働のうち、総労働時間を超えた時間（通常の賃金 ＋ 割増） */
  fullOvertimeHours: number;
  /** 時間外労働のうち、働かなければならない時間の中の時間（繰り越しで総枠を超えたとき。割増だけ） */
  premiumOnlyHours: number;
  /** 総労働時間を超えて、時間外労働でない時間（法定内。通常の賃金） */
  innerHours: number;
  /** 足りない時間 */
  shortageHours: number;
  /** 次の月に繰り越す時間 */
  carryOutHours: number;
  /** その月の給与から引く時間 */
  deductHours: number;
  notes: string[];
}

/** 分（整数）を時間にする（丸めない。給与の額を、分の単位のまま正しく出すため。画面には flexHoursLabel で分まで出す） */
const hoursOf = (minutes: number) => minutes / 60;
const minutesOf = (hours: unknown) => Math.round((Number(hours) || 0) * 60);

/** 「171時間25分」 */
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

/** その日の、有給（年休・有給の特別休暇）で働いたものとして数える時間 */
const leaveHoursOfRow = (row: FlexAttendanceRow, dayHours: number): number => {
  const type = row.work_type || "normal";
  const annual = (type === "paid_full" ? dayHours : type === "paid_half" ? dayHours / 2 : 0) + (Number(row.paid_leave_hours) || 0);
  const special = specialLeaveOfRow(row);
  const specialHours = special.paid ? special.days * dayHours + special.hours : 0;
  return annual + specialHours;
};

/** フレックスタイム制の清算（1か月） */
export const settleFlex = (input: FlexInput): FlexSettlement => {
  const { rule, from, to, dayHours } = input;
  const notes: string[] = [];
  const days = calendarDaysOf(from, to);
  let workDays = input.workDays;
  if (workDays === null || !Number.isFinite(workDays)) {
    workDays = weekdaysOf(from, to);
    notes.push(`所定労働日数がわからないため、平日（月〜金）の日数 ${workDays}日で数えています（会社カレンダー・出勤曜日を確かめてください）。`);
  }

  const totalMinutes = rule.total.mode === "fixed" ? minutesOf(rule.total.hours) : minutesOf(workDays * dayHours);
  // 法定の総枠は、1分に満たない端数を切り捨てる（総枠を少なめにして、働く人に不利にならないようにする）
  const limitMinutes = rule.limit === "fiveDay"
    ? workDays * FIVE_DAY_DAILY_HOURS * 60
    : Math.floor((WEEKLY_LEGAL_HOURS * 60 * days) / 7);
  if (totalMinutes > limitMinutes) {
    notes.push(
      `総労働時間（${flexHoursLabel(hoursOf(totalMinutes))}）が法定の総枠（${flexHoursLabel(hoursOf(limitMinutes))}）を超えています。`
      + "総枠を超えて働いた時間には割増を払います（総労働時間は、法定の総枠の中で決めます。完全週休2日の会社は、労使協定で「所定労働日数 × 8時間」を総枠にできます）。",
    );
  }

  const carryInMinutes = Math.max(0, minutesOf(input.carryInHours));
  const requiredMinutes = totalMinutes + carryInMinutes;
  let actualMinutes = 0;
  let leaveMinutes = 0;
  for (const row of input.rows) {
    if (row.work_date < from || row.work_date > to) continue;
    leaveMinutes += minutesOf(leaveHoursOfRow(row, dayHours));
    if ((row.work_type || "normal") === "statutory_holiday") continue; // 法定休日の労働は休日労働として別に払う
    actualMinutes += minutesOf(row.work_hours);
  }
  const creditedMinutes = actualMinutes + leaveMinutes;
  const excess = Math.max(0, creditedMinutes - requiredMinutes);
  const overtime = Math.max(0, actualMinutes - limitMinutes);
  const fullOvertime = Math.min(excess, overtime);
  const premiumOnly = overtime - fullOvertime;
  const inner = excess - fullOvertime;
  const shortage = Math.max(0, requiredMinutes - creditedMinutes);
  let carryOut = 0;
  if (rule.shortage === "carry" && shortage > 0) {
    const room = Math.max(0, limitMinutes - totalMinutes);
    carryOut = Math.min(shortage, room);
    if (carryOut < shortage) {
      notes.push(
        `繰り越せるのは、法定の総枠と総労働時間の差（${flexHoursLabel(hoursOf(room))}）までなので、`
        + `残りの ${flexHoursLabel(hoursOf(shortage - carryOut))} はこの月で引きます。`,
      );
    }
  }
  return {
    totalHours: hoursOf(totalMinutes),
    carryInHours: hoursOf(carryInMinutes),
    requiredHours: hoursOf(requiredMinutes),
    limitHours: hoursOf(limitMinutes),
    actualHours: hoursOf(actualMinutes),
    leaveHours: hoursOf(leaveMinutes),
    excessHours: hoursOf(excess),
    overtimeHours: hoursOf(overtime),
    fullOvertimeHours: hoursOf(fullOvertime),
    premiumOnlyHours: hoursOf(premiumOnly),
    innerHours: hoursOf(inner),
    shortageHours: hoursOf(shortage),
    carryOutHours: hoursOf(carryOut),
    deductHours: hoursOf(shortage - carryOut),
    notes,
  };
};

/** フレックスタイム制で計算する人か（月給制・時給制。日給制はまだ計算しない） */
export const isFlexStaff = (staff: { is_flex?: unknown; wage_type?: unknown }): boolean =>
  Number(staff?.is_flex) === 1 && (staff?.wage_type === "monthly" || staff?.wage_type === "hourly");

interface SelectDb {
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** 前の月（支給月）の確定した給与から、繰り越した不足時間を読む（なければ 0） */
export const loadFlexCarryIn = async (db: SelectDb, staffId: string | number, year: number, month: number): Promise<number> => {
  const prev = dayjs(new Date(year, month - 1, 1)).subtract(1, "month");
  const rows = (await db.select(
    "SELECT flex_carry_hours FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month = ?",
    [staffId, prev.year(), prev.month() + 1],
  )) as { flex_carry_hours?: number | null }[];
  return Math.max(0, Number(rows?.[0]?.flex_carry_hours) || 0);
};
