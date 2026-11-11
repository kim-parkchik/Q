/**
 * 決まった休憩（休憩を打刻しない会社などのために、勤怠を確定するときに引く休憩）
 *
 * いままでの Q は、休憩の時刻が入っていない日を「休憩なし」として数えていたので、休憩を打刻しない会社では、
 * 働いた時間（残業・深夜を含む）が長く出ていた。そこで、給与規定グループに「決まった休憩」を決め、休憩の時刻が入っていない日に引く。
 *
 * ■ 決まり（給与規定グループごと。payroll_groups.fixed_break。JSON）
 *   ・時刻で決める（例：12:00〜13:00）：出勤から退勤までが、決まった休憩の時刻をまるごと含む日だけ引く。
 *     途中で出勤・退勤した日（遅刻・早退など）や、外出と重なる日は、休憩を取ったかわからないので引かずに知らせる
 *     （働いた時間を少なく数えると、その分の賃金が払われなくなるため）
 *   ・長さで決める（例：出勤から退勤まで（外出を除く）が6時間を超えたら45分、8時間を超えたら1時間）：
 *     時刻がわからないので、深夜（22時〜5時）の時間はできるだけ減らさない（深夜の割増を少なく数えないため）
 * ■ 人ごと：従業員の「決まった休憩を使う」（staff.fixed_break_apply。初めは使う）
 * ■ その日の記録が先：休憩の時刻が入っている日（手入力・打刻）と、「休憩なし」にした日（attendance.break_none）は、決まった休憩を使わない
 * ■ 労働基準法34条1項：労働時間が6時間を超えるときは少なくとも45分、8時間を超えるときは少なくとも1時間の休憩を、労働時間の途中に与える。
 *   休憩（外出も含める）がこれより短い日を、勤怠の画面で知らせる（breakShortage）
 */
import { calcDetailedDiff } from "./calcSalary";

/** 長さで決めるときの1行：出勤から退勤まで（外出を除く）が overMinutes 分を超えたら、breakMinutes 分の休憩 */
export interface LengthRule {
  overMinutes: number;
  breakMinutes: number;
}

export type FixedBreakRule =
  | { mode: "time"; start: string; end: string }
  | { mode: "length"; rules: LengthRule[] };

/**
 * 長さで決めるときの初めの値：6時間を超えたら45分、8時間を超えたら1時間（労働基準法34条1項の長さ）。
 * 出勤から退勤までの長さで決めるので、休憩を引いたあとの労働時間に対しても、34条の長さを下回らない
 */
export const DEFAULT_LENGTH_RULES: LengthRule[] = [
  { overMinutes: 360, breakMinutes: 45 },
  { overMinutes: 480, breakMinutes: 60 },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM"（"9:05" も読む）を、0時からの分にする。読めなければ null */
const toMinutes = (t: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(typeof t === "string" ? t.trim() : "");
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 47 && mi <= 59 ? h * 60 + mi : null;
};

/** 時刻が入っているか（calcSalary.ts の calcDetailedDiff と同じ見方。"--:--" や ":" は入っていない） */
const hasTime = (t: unknown): t is string =>
  typeof t === "string" && t !== "--:--" && t.length >= 5 && toMinutes(t) !== null;

/** 始めから終わりまでの分（終わりが始めより前なら、次の日の時刻） */
const spanMinutes = (start: string, end: string) => {
  const s = toMinutes(start)!;
  const e = toMinutes(end)!;
  return e < s ? e + 1440 - s : e - s;
};

const hoursOf = (minutes: number) => Math.round((minutes / 60) * 1000) / 1000;
const minutesOf = (hours: number) => Math.round(hours * 60);

/** 保存した値（JSON）を読む。読めない・使わないときは null */
export const parseFixedBreak = (value: unknown): FixedBreakRule | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const o = JSON.parse(value);
    if (o?.mode === "time" && HHMM.test(o.start) && HHMM.test(o.end) && o.start !== o.end) {
      return { mode: "time", start: o.start, end: o.end };
    }
    if (o?.mode === "length" && Array.isArray(o.rules)) {
      const rules = o.rules
        .map((r: any) => ({ overMinutes: Math.floor(Number(r?.overMinutes)), breakMinutes: Math.floor(Number(r?.breakMinutes)) }))
        .filter((r: LengthRule) => Number.isFinite(r.overMinutes) && r.overMinutes >= 0 && Number.isFinite(r.breakMinutes) && r.breakMinutes > 0)
        .sort((a: LengthRule, b: LengthRule) => a.overMinutes - b.overMinutes);
      return rules.length > 0 ? { mode: "length", rules } : null;
    }
  } catch {
    // 読めないときは使わない
  }
  return null;
};

/** 保存する値（使わないときは空） */
export const stringifyFixedBreak = (rule: FixedBreakRule | null): string => (rule ? JSON.stringify(rule) : "");

/** 「6時間」「7時間30分」 */
export const durationLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : h === 0 ? `${m}分` : `${h}時間${m}分`;
};

/** 画面に出す書き方（「12:00〜13:00」「6時間を超えたら45分・8時間を超えたら60分」） */
export const describeFixedBreak = (rule: FixedBreakRule | null): string =>
  !rule ? "使わない"
    : rule.mode === "time" ? `${rule.start}〜${rule.end}`
    : rule.rules.map((r) => `${durationLabel(r.overMinutes)}を超えたら${r.breakMinutes}分`).join("・");

/** その人に使う決まった休憩（給与規定グループの決まり。従業員の「決まった休憩を使う」を外した人は null） */
export const fixedBreakRuleFor = (groupFixedBreak: unknown, staffApply: unknown): FixedBreakRule | null =>
  staffApply !== undefined && staffApply !== null && staffApply !== "" && Number(staffApply) === 0 ? null : parseFixedBreak(groupFixedBreak);

/** 1日の出勤・退勤・休憩・外出（手入力があれば手入力、なければ打刻） */
export interface DayTimes {
  entry: string;
  exit: string;
  breakStart: string;
  breakEnd: string;
  outTime: string;
  returnTime: string;
  /** その日は休憩を取らなかった（決まった休憩を引かない） */
  breakNone?: boolean;
}

export interface DayHours {
  /** 実働（時間。出勤・退勤が入っていなければ NaN） */
  total: number;
  /** そのうち深夜（22時〜5時。時間） */
  night: number;
  /** 引いた休憩（分。決まった休憩を含む。外出は含まない） */
  breakMinutes: number;
  /** 休憩と外出を合わせた長さ（分。労働基準法34条の確かめに使う） */
  restMinutes: number;
  /** 決まった休憩を引いたときの書き方（「12:00〜13:00」「45分」。勤怠に残す）。引かなければ "" */
  autoBreak: string;
  /** 休憩を引かなかった理由など（画面に出す）。なければ "" */
  notice: string;
}

/**
 * 1日の実働と深夜の時間（決まった休憩を含む）
 * 勤怠を確定するときに計算して勤怠に残し、給与はその値を使う（utils/calcSalary.ts）
 */
export const calcDayHours = (t: DayTimes, rule: FixedBreakRule | null): DayHours => {
  const base = calcDetailedDiff(t.entry, t.exit, t.breakStart, t.breakEnd, t.outTime, t.returnTime);
  const out = hasTime(t.outTime) && hasTime(t.returnTime) ? spanMinutes(t.outTime, t.returnTime) : 0;
  const result = (total: number, night: number, breakMinutes: number, autoBreak = "", notice = ""): DayHours =>
    ({ total, night, breakMinutes, restMinutes: breakMinutes + out, autoBreak, notice });

  if (Number.isNaN(base.total)) return result(NaN, NaN, 0);
  const recorded = hasTime(t.breakStart) && hasTime(t.breakEnd);
  if (hasTime(t.breakStart) !== hasTime(t.breakEnd)) {
    return result(base.total, base.night, 0, "", "休憩の始めか終わりの一方しか入っていないので、休憩を引いていません。");
  }
  // その日の休憩の記録があれば、それを使う（「休憩なし」にした日・決まった休憩を使わない人は、決まった休憩を引かない）
  if (recorded || t.breakNone || !rule) return result(base.total, base.night, recorded ? spanMinutes(t.breakStart, t.breakEnd) : 0);

  if (rule.mode === "length") {
    const span = minutesOf(base.total); // 出勤から退勤まで（外出を除く）
    const breakMinutes = Math.max(0, ...rule.rules.filter((r) => span > r.overMinutes).map((r) => r.breakMinutes));
    if (breakMinutes === 0) return result(base.total, base.night, 0);
    const total = Math.max(0, span - breakMinutes);
    // 時刻がわからないので、深夜の時間はできるだけ減らさない（深夜でない時間から先に休憩とみなす）
    const night = Math.min(minutesOf(base.night), total);
    return result(hoursOf(total), hoursOf(night), breakMinutes, `${breakMinutes}分`);
  }

  // 時刻で決める：出勤から退勤までの中に、決まった休憩がまるごと入る日だけ引く
  const entry = toMinutes(t.entry)!;
  let exit = toMinutes(t.exit)!;
  if (exit < entry) exit += 1440;
  const s = toMinutes(rule.start)!;
  const e = s + spanMinutes(rule.start, rule.end);
  // 決まった休憩は、出勤した日・次の日・前の日のどれかの時刻（夜勤：出勤22:00、休憩2:00〜3:00 は次の日の2時）
  const placements = [[s, e], [s + 1440, e + 1440], [s - 1440, e - 1440]];
  const overlaps = (a: number, b: number, c: number, d: number) => Math.min(b, d) > Math.max(a, c);
  const inside = placements.find(([a, b]) => a >= entry && b <= exit);
  const label = `${rule.start}〜${rule.end}`;
  if (!inside) {
    return placements.some(([a, b]) => overlaps(a, b, entry, exit))
      ? result(base.total, base.night, 0, "", `決まった休憩（${label}）の途中で出勤・退勤しているので、休憩を引いていません。休憩を取ったなら、その日の休憩を入れてください。`)
      : result(base.total, base.night, 0); // 半日の勤務などで、休憩の時刻にかからない
  }
  if (out > 0) {
    let o = toMinutes(t.outTime)!;
    if (o < entry) o += 1440;
    if (overlaps(o, o + out, inside[0], inside[1])) {
      return result(base.total, base.night, 0, "", `外出と決まった休憩（${label}）が重なっているので、休憩を引いていません。休憩を取ったなら、その日の休憩を入れてください。`);
    }
  }
  const withBreak = calcDetailedDiff(t.entry, t.exit, rule.start, rule.end, t.outTime, t.returnTime);
  return result(withBreak.total, withBreak.night, inside[1] - inside[0], label);
};

/** 確定した勤怠に残した決まった休憩（「12:00〜13:00」「45分」）の長さ（分） */
export const autoBreakMinutes = (autoBreak: unknown): number => {
  const text = typeof autoBreak === "string" ? autoBreak : "";
  const time = /^(\d{2}:\d{2})〜(\d{2}:\d{2})$/.exec(text);
  if (time) return spanMinutes(time[1], time[2]);
  const length = /^(\d+)分$/.exec(text);
  return length ? Number(length[1]) : 0;
};

/** その日に記録した休憩と外出の長さ（分。始めと終わりがそろっているものだけ） */
export const recordedRestMinutes = (t: DayTimes): number =>
  (hasTime(t.breakStart) && hasTime(t.breakEnd) ? spanMinutes(t.breakStart, t.breakEnd) : 0)
  + (hasTime(t.outTime) && hasTime(t.returnTime) ? spanMinutes(t.outTime, t.returnTime) : 0);

/**
 * 労働基準法34条1項の休憩に足りない分（分）。労働時間が6時間を超えたら45分、8時間を超えたら1時間。足りていれば 0
 * @param workMinutes 労働時間（休憩を引いたあと）
 * @param restMinutes 休憩（外出も含める）
 */
export const breakShortage = (workMinutes: number, restMinutes: number): number => {
  const required = workMinutes > 480 ? 60 : workMinutes > 360 ? 45 : 0;
  return Math.max(0, required - Math.max(0, restMinutes));
};
