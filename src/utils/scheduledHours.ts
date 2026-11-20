/**
 * 所定労働時間（1日の所定労働時間・曜日ごとの時間・その日だけ直した時間）
 *
 * ・1日の所定労働時間（staff.scheduled_work_hours）：ふだんの1日の時間。役員でない人は入れる（入れていなければ、給与を確定しない）
 * ・曜日ごとの時間（staff.weekday_hours。JSON {"mon":4,"wed":6}）：曜日で時間が違う人（パートの月曜4時間・水曜6時間、土曜は半日など）。
 *   入れていない曜日は、1日の所定労働時間
 * ・その日だけ直した時間（attendance.scheduled_hours）：シフトで、毎週同じでない日（勤怠の画面で直す）
 * 市販の勤怠ソフトの「勤務パターン」（曜日ごとにも作れる）を日に当てる形を、曜日ごとの時間と、その日だけ直す時間にしたもの。
 * フレックスタイム制の人は、日ごとの所定労働時間がないので、1日の所定労働時間（標準となる1日の労働時間）だけを使う。
 *
 * 決まり（労働基準法施行規則）：
 * ・25条1項1号：時給の人の有給の日の賃金は「その金額にその日の所定労働時間数を乗じた金額」（2号：日給の人は日給）
 * ・19条1項2号：日給の人の残業代の時給は、日給 ÷ 1日の所定労働時間数（日によって違うときは「一週間における一日平均所定労働時間数」）
 * ・19条1項4号：月給の人の残業代の時給は、月給 ÷ 月における所定労働時間数（月によって違うときは「一年間における一月平均所定労働時間数」）
 * ・24条の4 1号：時間単位の有給の1日の時間数は、1日の所定労働時間数（日によって違うときは「一年間における一日平均所定労働時間数」）を下回らない
 * 1日平均は、1週間の所定労働日（契約曜日で決めている人は出勤する曜日、会社カレンダーの人は月〜金とチェックした曜日）の平均で出す
 * （週ごとの決まりが同じなら、1年間の1日平均も同じとみなす。Q で決めたこと）。
 * 1年間の所定労働時間の合計（月給の人の1か月平均所定労働時間）は、会社カレンダー・契約曜日の所定労働日ごとに、その曜日の時間を足す。
 */
import { isPrescribedWorkDay, parseWorkDays, type CalendarContext } from "./annualWorkDays";

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];
/** 曜日ごとの所定労働時間（時間。入れた曜日だけ） */
export type WeekdayHours = Partial<Record<WeekdayKey, number>>;
export const WEEKDAY_LABELS: Record<WeekdayKey, string> = { sun: "日", mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土" };

/** 所定労働時間を出すのに使う従業員の列 */
export interface StaffHours {
  scheduled_work_hours?: unknown;
  weekday_hours?: unknown;
  is_flex?: unknown;
  is_executive?: unknown;
  calendar_pattern_id?: unknown;
  /** 契約曜日（"mon,wed,fri"。画面のチェックの形 {mon: true, ...} も読む） */
  work_days?: string | Record<string, boolean> | null;
}

/** 1日の時間として使える値（0より大きく24時間以下。分の単位に丸める）。使えなければ null */
export const toHours = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 60) / 60;
};

/** 曜日ごとの時間（JSON）を読む。読めない・使えない値は入れない */
export const parseWeekdayHours = (value: unknown): WeekdayHours => {
  let obj: unknown = value;
  if (typeof value === "string") {
    if (value.trim() === "") return {};
    try { obj = JSON.parse(value); } catch { return {}; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: WeekdayHours = {};
  for (const k of WEEKDAY_KEYS) {
    const h = toHours((obj as Record<string, unknown>)[k]);
    if (h !== null) out[k] = h;
  }
  return out;
};

/** 曜日ごとの時間を保存する形（日曜から順。入れた曜日がなければ null） */
export const stringifyWeekdayHours = (hours: WeekdayHours | null | undefined): string | null => {
  const parsed = parseWeekdayHours(hours ?? {});
  return Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : null;
};

const isFlex = (staff: StaffHours | null | undefined) => Number(staff?.is_flex) === 1;

/** 1日の所定労働時間（入れていなければ null） */
export const baseHoursOf = (staff: StaffHours | null | undefined): number | null => toHours(staff?.scheduled_work_hours);

/** 使う曜日ごとの時間（フレックスタイム制の人は使わない） */
export const weekdayHoursOf = (staff: StaffHours | null | undefined): WeekdayHours =>
  isFlex(staff) ? {} : parseWeekdayHours(staff?.weekday_hours);

/** 曜日で時間が違うか（1日の所定労働時間と違う時間を入れた曜日がある） */
export const hasWeekdayHours = (staff: StaffHours | null | undefined): boolean => {
  const base = baseHoursOf(staff);
  return Object.values(weekdayHoursOf(staff)).some((h) => h !== base);
};

/** 1日の所定労働時間を入れていないか（役員は要らない） */
export const scheduledHoursMissing = (staff: StaffHours | null | undefined): boolean =>
  Number(staff?.is_executive) !== 1 && baseHoursOf(staff) === null;

/** その曜日の所定労働時間（曜日の時間 → 1日の所定労働時間。わからなければ null） */
export const weekdayScheduledHours = (staff: StaffHours | null | undefined, weekday: WeekdayKey): number | null =>
  weekdayHoursOf(staff)[weekday] ?? baseHoursOf(staff);

/** 日付（YYYY-MM-DD）の曜日 */
export const weekdayOf = (date: string): WeekdayKey | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : WEEKDAY_KEYS[d.getDay()];
};

/**
 * その日の所定労働時間（勤怠の画面でその日だけ直した時間 → 曜日の時間 → 1日の所定労働時間。わからなければ null）
 * フレックスタイム制の人は、いつも1日の所定労働時間（標準となる1日の労働時間）
 */
export const dayScheduledHours = (staff: StaffHours | null | undefined, date: string, override?: unknown): number | null => {
  if (isFlex(staff)) return baseHoursOf(staff);
  const o = toHours(override);
  if (o !== null) return o;
  const w = weekdayOf(date);
  return w ? weekdayScheduledHours(staff, w) : baseHoursOf(staff);
};

/**
 * 1週間の所定労働日（曜日）：契約曜日で決めている人は出勤する曜日、会社カレンダーの人は月〜金と、チェックした曜日（土曜の半日など）
 */
const standardWeekdays = (staff: StaffHours | null | undefined): WeekdayKey[] => {
  const days = parseWorkDays(staff?.work_days ?? null);
  if (Number(staff?.calendar_pattern_id ?? 1) === 0) return WEEKDAY_KEYS.filter((k) => days[k]);
  return WEEKDAY_KEYS.filter((k) => days[k] || ["mon", "tue", "wed", "thu", "fri"].includes(k));
};

/**
 * 1日平均所定労働時間（1週間の所定労働日の平均。曜日で時間が違わなければ、1日の所定労働時間。わからなければ null）
 * 日給の人の残業代の時給（労基則19条1項2号）・時間単位の有給の1日の時間数（24条の4）に使う
 */
export const averageDailyHoursOf = (staff: StaffHours | null | undefined): number | null => {
  const base = baseHoursOf(staff);
  if (!hasWeekdayHours(staff)) return base;
  const days = standardWeekdays(staff);
  const hours = days.map((k) => weekdayScheduledHours(staff, k));
  if (days.length === 0 || hours.some((h) => h === null)) return base;
  return Math.round((hours.reduce((s: number, h) => s + (h as number), 0) * 60) / days.length) / 60;
};

/**
 * 1週間の所定労働時間（1週間の所定労働日の時間の合計。契約曜日で決めている人は出勤する曜日、会社カレンダーの人は月〜金とチェックした曜日。
 * わからなければ null）
 */
export const weeklyScheduledHoursOf = (staff: StaffHours | null | undefined): number | null => {
  const days = standardWeekdays(staff);
  if (days.length === 0) return null;
  let minutes = 0;
  for (const k of days) {
    const h = weekdayScheduledHours(staff, k);
    if (h === null) return null;
    minutes += Math.round(h * 60);
  }
  return minutes / 60;
};

/**
 * from〜to（両端を含む。YYYY-MM-DD）の所定労働日の、所定労働時間の合計（会社カレンダー・契約曜日の所定労働日ごとに、その曜日の時間を足す。
 * 勤怠の画面でその日だけ直した時間は入れない）。所定労働時間がわからない日があれば null
 */
export const sumScheduledHours = (ctx: CalendarContext, staff: StaffHours | null | undefined, from: string, to: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const date = new Date(fy, fm - 1, fd);
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let minutes = 0;
  while (keyOf(date) <= to) {
    if (isPrescribedWorkDay(date, ctx)) {
      const h = weekdayScheduledHours(staff, WEEKDAY_KEYS[date.getDay()]);
      if (h === null) return null;
      minutes += Math.round(h * 60);
    }
    date.setDate(date.getDate() + 1);
  }
  return minutes / 60;
};

/** 「4時間」「4時間40分」 */
export const hoursLabel = (hours: number): string => {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : h === 0 ? `${m}分` : `${h}時間${m}分`;
};

/** 曜日ごとの時間の説明（「月4時間・水6時間」。入れていなければ空） */
export const describeWeekdayHours = (staff: StaffHours | null | undefined): string =>
  WEEKDAY_KEYS.filter((k) => weekdayHoursOf(staff)[k] !== undefined)
    .map((k) => `${WEEKDAY_LABELS[k]}${hoursLabel(weekdayHoursOf(staff)[k] as number)}`)
    .join("・");

/** 4.5 → "4:30"（入力欄に出す形。わからなければ空） */
export const hoursText = (hours: number | null | undefined): string => {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "";
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

/** 入力欄の字（"4:30"・"4"・"４：３０"）を時間にする（空なら null、読めない・0分・24時間を超えるなら undefined） */
export const parseHoursText = (text: string): number | null | undefined => {
  const t = String(text ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .trim();
  if (t === "") return null;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min >= 60) return undefined;
  const total = h * 60 + min;
  return total > 0 && total <= 24 * 60 ? total / 60 : undefined;
};
