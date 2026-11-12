/**
 * 1日の働いた時間と、決まった休憩（休憩を打刻しない会社などのために、勤怠を確定するときに引く休憩）
 *
 * ■ 休憩の一覧（utils/breaks.ts）：1日に何回でも。私用の外出・中抜けも休憩として入れる。
 *   出勤から退勤までの中の分だけを引き、重なる休憩は1つにまとめて引く（2回引かない）。深夜（22時〜5時）の分も、時刻どおりに引く。
 *   時間有給にした中抜け（leave）も働いた時間には入れないが、労働基準法34条の休憩には数えない。
 * ■ 決まった休憩（給与規定グループごと。payroll_groups.fixed_break。JSON）
 *   ・時刻で決める（例：12:00〜13:00）：出勤から退勤までが、決まった休憩の時刻をまるごと含む日だけ引く。
 *     途中で出勤・退勤した日（遅刻・早退など）や、時間有給にした中抜けと重なる日は、休憩を取ったかわからないので引かずに知らせる
 *     （働いた時間を少なく数えると、その分の賃金が払われなくなるため）
 *   ・長さで決める（例：出勤から退勤まで（時間有給にした中抜けを除く）が6時間を超えたら45分、8時間を超えたら1時間）：
 *     時刻がわからないので、深夜（22時〜5時）の時間はできるだけ減らさない（深夜の割増を少なく数えないため）
 *   ・打刻・手入力した休憩との合わせ方（combine。ジョブカンなどの勤怠ソフトと同じく、会社が選ぶ）
 *     - record（打刻を優先。初めの値）：その日に休憩を入れた日は、決まった休憩を引かない
 *     - merge（時刻で決めたとき）：入れた休憩と合わせて引く。重なるところは1つにまとめる
 *     - max（長さで決めたとき）：入れた休憩と決まった休憩の、長いほうを引く
 *     - sum（長さで決めたとき）：入れた休憩に、決まった休憩を足して引く
 * ■ 人ごと：従業員の「決まった休憩を使う」（staff.fixed_break_apply。初めは使う）
 * ■ 「休憩なし」にした日（attendance.break_none）は、決まった休憩を使わない
 * ■ 始めか終わりの一方しかない休憩がある日は、その休憩も決まった休憩も引かずに知らせる（休憩の長さがわからないため）
 * ■ 労働基準法34条1項：労働時間が6時間を超えるときは少なくとも45分、8時間を超えるときは少なくとも1時間の休憩を、労働時間の途中に与える。
 *   休憩がこれより短い日を、勤怠の画面で知らせる（breakShortage）
 */
import { NIGHT_END_HOUR, NIGHT_START_HOUR } from "../constants/labor";
import { spanLabel, type BreakSpan } from "./breaks";

/** 長さで決めるときの1行：出勤から退勤まで（時間有給にした中抜けを除く）が overMinutes 分を超えたら、breakMinutes 分の休憩 */
export interface LengthRule {
  overMinutes: number;
  breakMinutes: number;
}

/** 時刻で決めたときの、入れた休憩との合わせ方 */
export type TimeCombine = "record" | "merge";
/** 長さで決めたときの、入れた休憩との合わせ方 */
export type LengthCombine = "record" | "max" | "sum";

export type FixedBreakRule =
  | { mode: "time"; start: string; end: string; combine: TimeCombine }
  | { mode: "length"; rules: LengthRule[]; combine: LengthCombine };

export const TIME_COMBINE_LABELS: Record<TimeCombine, string> = {
  record: "休憩を入れた日は、決まった休憩を引かない（打刻を優先）",
  merge: "入れた休憩と合わせて引く（重なるところは1つにまとめる）",
};

export const LENGTH_COMBINE_LABELS: Record<LengthCombine, string> = {
  record: "休憩を入れた日は、決まった休憩を引かない（打刻を優先）",
  max: "入れた休憩と決まった休憩の、長いほうを引く",
  sum: "入れた休憩に、決まった休憩を足して引く（合算）",
};

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

/** 保存した値（JSON）を読む。読めない・使わないときは null */
export const parseFixedBreak = (value: unknown): FixedBreakRule | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const o = JSON.parse(value);
    if (o?.mode === "time" && HHMM.test(o.start) && HHMM.test(o.end) && o.start !== o.end) {
      return { mode: "time", start: o.start, end: o.end, combine: o.combine === "merge" ? "merge" : "record" };
    }
    if (o?.mode === "length" && Array.isArray(o.rules)) {
      const rules = o.rules
        .map((r: any) => ({ overMinutes: Math.floor(Number(r?.overMinutes)), breakMinutes: Math.floor(Number(r?.breakMinutes)) }))
        .filter((r: LengthRule) => Number.isFinite(r.overMinutes) && r.overMinutes >= 0 && Number.isFinite(r.breakMinutes) && r.breakMinutes > 0)
        .sort((a: LengthRule, b: LengthRule) => a.overMinutes - b.overMinutes);
      const combine: LengthCombine = o.combine === "max" || o.combine === "sum" ? o.combine : "record";
      return rules.length > 0 ? { mode: "length", rules, combine } : null;
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

/** 入れた休憩との合わせ方の書き方 */
export const describeCombine = (rule: FixedBreakRule | null): string =>
  !rule ? "" : rule.mode === "time" ? TIME_COMBINE_LABELS[rule.combine] : LENGTH_COMBINE_LABELS[rule.combine];

/** 画面に出す書き方（「12:00〜13:00」「6時間を超えたら45分・8時間を超えたら60分」） */
export const describeFixedBreak = (rule: FixedBreakRule | null): string =>
  !rule ? "使わない"
    : rule.mode === "time" ? `${rule.start}〜${rule.end}`
    : rule.rules.map((r) => `${durationLabel(r.overMinutes)}を超えたら${r.breakMinutes}分`).join("・");

/** その人に使う決まった休憩（給与規定グループの決まり。従業員の「決まった休憩を使う」を外した人は null） */
export const fixedBreakRuleFor = (groupFixedBreak: unknown, staffApply: unknown): FixedBreakRule | null =>
  staffApply !== undefined && staffApply !== null && staffApply !== "" && Number(staffApply) === 0 ? null : parseFixedBreak(groupFixedBreak);

/** 1日の出勤・退勤・休憩（手入力があれば手入力、なければ打刻） */
export interface DayTimes {
  entry: string;
  exit: string;
  /** 休憩の一覧（何回でも。時間有給にした中抜けも入る） */
  breaks: BreakSpan[];
  /** その日は休憩を取らなかった（決まった休憩を引かない） */
  breakNone?: boolean;
}

export interface DayHours {
  /** 実働（時間。出勤・退勤が入っていなければ NaN） */
  total: number;
  /** そのうち深夜（22時〜5時。時間） */
  night: number;
  /** 引いた休憩（分。決まった休憩を含む。時間有給にした中抜けは含まない） */
  breakMinutes: number;
  /** 労働基準法34条の確かめに使う休憩の長さ（分。breakMinutes と同じ） */
  restMinutes: number;
  /** 時間有給にした中抜けの長さ（分） */
  leaveMinutes: number;
  /** 決まった休憩を引いたときの書き方（「12:00〜13:00」「45分」。勤怠に残す）。引かなければ "" */
  autoBreak: string;
  /** 休憩を引かなかった理由など（画面に出す）。なければ "" */
  notice: string;
}

/** 出勤した日の0時からの分で表した、時間の区間（終わりは含まない） */
interface Iv {
  s: number;
  e: number;
}

/** 重なる区間を1つにまとめる */
const unionOf = (ivs: Iv[]): Iv[] => {
  const out: Iv[] = [];
  for (const i of [...ivs].filter((x) => x.e > x.s).sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out;
};

const lengthOf = (ivs: Iv[]) => unionOf(ivs).reduce((a, i) => a + i.e - i.s, 0);

/** 区間の中の深夜（22時〜5時）の分 */
const nightIn = (s: number, e: number) => {
  let n = 0;
  for (let d = Math.floor(s / 1440) - 1; d <= Math.floor(e / 1440); d++) {
    const ws = d * 1440 + NIGHT_START_HOUR * 60;
    const we = d * 1440 + 1440 + NIGHT_END_HOUR * 60;
    n += Math.max(0, Math.min(e, we) - Math.max(s, ws));
  }
  return n;
};

const overlaps = (a: number, b: number, c: number, d: number) => Math.min(b, d) > Math.max(a, c);

/**
 * 休憩の時刻を、出勤から退勤までの中に置く（夜勤の夜中の休憩は次の日の時刻）。出勤から退勤までの外の分は引かない。
 * まったく重ならない・長さが0なら null
 */
const placeSpan = (start: string, end: string, entry: number, exit: number): { iv: Iv; clipped: boolean } | null => {
  const s0 = toMinutes(start)!;
  let e0 = toMinutes(end)!;
  if (e0 === s0) return null;
  if (e0 < s0) e0 += 1440;
  let best: { iv: Iv; clipped: boolean } | null = null;
  for (const off of [0, 1440, -1440]) {
    const s = s0 + off;
    const e = e0 + off;
    const cs = Math.max(s, entry);
    const ce = Math.min(e, exit);
    if (ce - cs > (best ? best.iv.e - best.iv.s : 0)) best = { iv: { s: cs, e: ce }, clipped: cs !== s || ce !== e };
  }
  return best;
};

/** 出勤・退勤（退勤が出勤より前なら次の日）。入っていなければ null */
const shiftOf = (t: Pick<DayTimes, "entry" | "exit">) => {
  if (!hasTime(t.entry) || !hasTime(t.exit)) return null;
  const entry = toMinutes(t.entry)!;
  let exit = toMinutes(t.exit)!;
  if (exit < entry) exit += 1440;
  return { entry, exit };
};

/** 休憩の一覧を、出勤から退勤までの中に置く（休憩・時間有給にした中抜けに分け、知らせることを集める） */
const placeBreaks = (breaks: BreakSpan[], entry: number, exit: number) => {
  const rest: Iv[] = [];
  const leave: Iv[] = [];
  const notices: string[] = [];
  let incomplete = false;
  for (const b of breaks ?? []) {
    const hs = hasTime(b.start);
    const he = hasTime(b.end);
    if (!hs && !he) continue;
    if (hs !== he) {
      incomplete = true;
      notices.push(`休憩（${spanLabel(b)}）の始めか終わりの一方しか入っていないので、休憩を引いていません。`);
      continue;
    }
    if (toMinutes(b.start) === toMinutes(b.end)) continue;
    const placed = placeSpan(b.start, b.end, entry, exit);
    if (!placed) {
      notices.push(`休憩（${spanLabel(b)}）が出勤から退勤までの外にあるので、引いていません。`);
      continue;
    }
    if (placed.clipped) notices.push(`休憩（${spanLabel(b)}）の一部が出勤から退勤までの外にあるので、中の分だけ引いています。`);
    (b.leave ? leave : rest).push(placed.iv);
  }
  return { rest, leave, notices, incomplete };
};

/**
 * 1日の実働と深夜の時間（休憩の一覧と、決まった休憩を引く）
 * 勤怠を確定するときに計算して勤怠に残し、給与はその値を使う（utils/calcSalary.ts）
 */
export const calcDayHours = (t: DayTimes, rule: FixedBreakRule | null): DayHours => {
  const shift = shiftOf(t);
  if (!shift) return { total: NaN, night: NaN, breakMinutes: 0, restMinutes: 0, leaveMinutes: 0, autoBreak: "", notice: "" };
  const { entry, exit } = shift;
  const { rest, leave, notices, incomplete } = placeBreaks(t.breaks, entry, exit);

  // 決まった休憩：時刻で決めたときは区間（fixedIv）、長さで決めたときは時刻のない分（loose）
  let fixedIv: Iv | null = null;
  let loose = 0;
  let autoBreak = "";
  const recorded = rest.length > 0;
  const useFixed = !!rule && !t.breakNone && !incomplete && !(rule.combine === "record" && recorded);
  if (useFixed && rule.mode === "time") {
    const s = toMinutes(rule.start)!;
    const e = s + spanMinutes(rule.start, rule.end);
    // 決まった休憩は、出勤した日・次の日・前の日のどれかの時刻（夜勤：出勤22:00、休憩2:00〜3:00 は次の日の2時）
    const placements = [[s, e], [s + 1440, e + 1440], [s - 1440, e - 1440]];
    const inside = placements.find(([a, b]) => a >= entry && b <= exit);
    const label = `${rule.start}〜${rule.end}`;
    if (!inside) {
      if (placements.some(([a, b]) => overlaps(a, b, entry, exit))) {
        notices.push(`決まった休憩（${label}）の途中で出勤・退勤しているので、決まった休憩を引いていません。休憩を取ったなら、その日の休憩を入れてください。`);
      }
    } else if (leave.some((iv) => overlaps(iv.s, iv.e, inside[0], inside[1]))) {
      notices.push(`時間有給にした中抜けと決まった休憩（${label}）が重なっているので、決まった休憩を引いていません。休憩を取ったなら、その日の休憩を入れてください。`);
    } else {
      fixedIv = { s: inside[0], e: inside[1] };
      autoBreak = label;
    }
  } else if (useFixed && rule.mode === "length") {
    const span = exit - entry - lengthOf(leave); // 出勤から退勤まで（時間有給にした中抜けを除く）
    const fixedMinutes = Math.max(0, ...rule.rules.filter((r) => span > r.overMinutes).map((r) => r.breakMinutes));
    loose = rule.combine === "max" ? Math.max(0, fixedMinutes - lengthOf(rest)) : fixedMinutes;
    if (loose > 0) autoBreak = `${loose}分`;
  }

  const away = unionOf([...rest, ...leave, ...(fixedIv ? [fixedIv] : [])]);
  const awayMinutes = away.reduce((a, i) => a + i.e - i.s, 0);
  const work = Math.max(0, exit - entry - awayMinutes - loose);
  // 時刻のない決まった休憩（長さで決めたとき）は、深夜でない時間から先に休憩とみなす（深夜の割増を少なく数えない）
  const night = Math.max(0, Math.min(nightIn(entry, exit) - away.reduce((a, i) => a + nightIn(i.s, i.e), 0), work));
  const leaveMinutes = lengthOf(leave);
  const restMinutes = awayMinutes - leaveMinutes + loose;
  return {
    total: hoursOf(work),
    night: hoursOf(night),
    breakMinutes: restMinutes,
    restMinutes,
    leaveMinutes,
    autoBreak,
    notice: notices.join(" "),
  };
};

/** その日の時間有給にした中抜けの長さ（分。出勤から退勤までの中の分。出勤・退勤がなければ、入れた長さ） */
export const leaveMinutesOf = (t: DayTimes): number => {
  const shift = shiftOf(t);
  if (!shift) {
    return (t.breaks ?? []).filter((b) => b.leave && hasTime(b.start) && hasTime(b.end)).reduce((a, b) => a + spanMinutes(b.start, b.end), 0);
  }
  return lengthOf(placeBreaks(t.breaks, shift.entry, shift.exit).leave);
};

/** 確定した勤怠に残した決まった休憩（「12:00〜13:00」「45分」）の長さ（分） */
export const autoBreakMinutes = (autoBreak: unknown): number => {
  const text = typeof autoBreak === "string" ? autoBreak : "";
  const time = /^(\d{2}:\d{2})〜(\d{2}:\d{2})$/.exec(text);
  if (time) return spanMinutes(time[1], time[2]);
  const length = /^(\d+)分$/.exec(text);
  return length ? Number(length[1]) : 0;
};

/**
 * 確定した日の、労働基準法34条の確かめに使う休憩の長さ（分）：その日に入れた休憩（時間有給にした中抜けを除く）と、
 * 確定したときに引いた決まった休憩（「12:00〜13:00」なら重なるところは1つにまとめる。「45分」なら足す）
 */
export const recordedRestMinutes = (t: DayTimes, autoBreak: unknown = ""): number => {
  const shift = shiftOf(t);
  const text = typeof autoBreak === "string" ? autoBreak : "";
  if (!shift) {
    return (t.breaks ?? []).filter((b) => !b.leave && hasTime(b.start) && hasTime(b.end)).reduce((a, b) => a + spanMinutes(b.start, b.end), 0)
      + autoBreakMinutes(text);
  }
  const { rest } = placeBreaks(t.breaks, shift.entry, shift.exit);
  const time = /^(\d{2}:\d{2})〜(\d{2}:\d{2})$/.exec(text);
  if (time) {
    const placed = placeSpan(time[1], time[2], shift.entry, shift.exit);
    return lengthOf(placed ? [...rest, placed.iv] : rest);
  }
  return lengthOf(rest) + autoBreakMinutes(text);
};

/**
 * 労働基準法34条1項の休憩に足りない分（分）。労働時間が6時間を超えたら45分、8時間を超えたら1時間。足りていれば 0
 * @param workMinutes 労働時間（休憩を引いたあと）
 * @param restMinutes 休憩（外出も含める）
 */
export const breakShortage = (workMinutes: number, restMinutes: number): number => {
  const required = workMinutes > 480 ? 60 : workMinutes > 360 ? 45 : 0;
  return Math.max(0, required - Math.max(0, restMinutes));
};
