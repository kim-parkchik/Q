/**
 * 勤怠の休憩の一覧（1日に何回でも。私用の外出・中抜けも休憩として入れる）
 *
 * ・勤怠には、手入力した一覧（attendance.breaks）と、打刻（TimeQard・CSV）の一覧（attendance.csv_breaks）を JSON で残す。
 *   手入力した一覧があれば（空の一覧も含めて）それを使い、なければ打刻を使う（出勤・退勤と同じく、手入力が先）。
 * ・leave：その休憩（中抜け）を、時間単位の有給にした印。働いた時間には入れず、労働基準法34条の休憩にも数えない。
 *   有給の時間そのもの（給与・有給の残り）は、その日の「時間有給」（attendance.paid_leave_hours）で数える。
 * ・leaveTypeId：その中抜けを、時間単位の特別休暇（子の看護等休暇・介護休暇など。utils/specialLeave.ts）にした印。
 *   時間有給と同じく、働いた時間にも休憩にも入れない。休暇の時間は、その日の「時間休」（attendance.special_leave_hours）で数える。
 *   1日に入れられる時間単位の特別休暇は1種類（勤怠の休暇の種類 attendance.leave_type_id が1つのため）。
 * ・一般的な勤怠ソフト（クラウド型の勤怠ソフトなど）も、休憩を1日に何回でも記録し、中抜けは休憩として扱う。
 */
import { formatSpanList, type TimeSpan } from "../../shared/timeqard";

export interface BreakSpan extends TimeSpan {
  /** この休憩（中抜け）を、時間単位の有給にした */
  leave?: boolean;
  /** この休憩（中抜け）を、時間単位の特別休暇（休暇の種類の id）にした */
  leaveTypeId?: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const clean = (b: any): BreakSpan => {
  const start = typeof b?.start === "string" && HHMM.test(b.start) ? b.start : "";
  const end = typeof b?.end === "string" && HHMM.test(b.end) ? b.end : "";
  const typeId = Number(b?.leaveTypeId);
  if (Number.isInteger(typeId) && typeId > 0) return { start, end, leaveTypeId: typeId };
  return b?.leave === true ? { start, end, leave: true } : { start, end };
};

/** 休暇にした中抜けか（時間有給か、時間単位の特別休暇）。働いた時間にも、労働基準法34条の休憩にも入れない */
export const isLeaveSpan = (b: BreakSpan): boolean => b.leave === true || !!b.leaveTypeId;

/** 保存した一覧（JSON）を読む。値がない・読めないときは null（手入力していない） */
export const parseBreaksJson = (value: unknown): BreakSpan[] | null => {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const arr = JSON.parse(value);
    if (!Array.isArray(arr)) return null;
    return arr.map(clean).filter((b) => b.start || b.end);
  } catch {
    return null;
  }
};

/** 保存する値（JSON）。null は「手入力していない」 */
export const stringifyBreaks = (spans: BreakSpan[] | null): string | null =>
  spans === null ? null : JSON.stringify(spans.map(clean).filter((b) => b.start || b.end));

/** その日に使う一覧（手入力があれば手入力、なければ打刻） */
export const effectiveBreaks = (manual: BreakSpan[] | null, punched: BreakSpan[]): BreakSpan[] => manual ?? punched;

/** 「12:00〜13:00」（一方しかないときは「12:00〜？」） */
export const spanLabel = (b: TimeSpan) => `${b.start || "？"}〜${b.end || "？"}`;

/** 始めと終わりがそろっているか */
export const isCompleteSpan = (b: TimeSpan) => HHMM.test(b.start) && HHMM.test(b.end);

/** CSV に書く休憩の一覧（休暇にした中抜けは除く） */
export const formatBreakList = (spans: BreakSpan[]) => formatSpanList(spans.filter((b) => !isLeaveSpan(b)));

/** CSV に書く、時間有給にした中抜けの一覧 */
export const formatLeaveList = (spans: BreakSpan[]) => formatSpanList(spans.filter((b) => b.leave === true && !b.leaveTypeId));

/** CSV に書く、時間単位の特別休暇にした中抜けの一覧 */
export const formatSpecialLeaveList = (spans: BreakSpan[]) => formatSpanList(spans.filter((b) => !!b.leaveTypeId));

/** 同じ休憩か（始めと終わりが同じ） */
export const sameSpan = (a: TimeSpan, b: TimeSpan) => a.start === b.start && a.end === b.end;

/** 始めの時刻の順に並べる（始めがない休憩は終わりの時刻で） */
export const sortSpans = <T extends TimeSpan>(spans: T[]): T[] =>
  [...spans].sort((a, b) => (a.start || a.end).localeCompare(b.start || b.end));

const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** 休憩の区間（分。終わりが始めより前なら、次の日の時刻） */
const rangeOf = (b: TimeSpan): [number, number] => {
  const s = minutesOf(b.start);
  const e = minutesOf(b.end);
  return [s, e < s ? e + 1440 : e];
};

/** 2つの休憩が重なるか（日をまたぐ休憩も見る） */
const overlapsSpan = (a: TimeSpan, b: TimeSpan) => {
  const [as, ae] = rangeOf(a);
  const [bs, be] = rangeOf(b);
  return [0, 1440, -1440].some((off) => Math.min(ae, be + off) > Math.max(as, bs + off));
};

/** 時刻が休憩の中にあるか（日をまたぐ休憩も見る） */
const withinSpan = (time: string, b: TimeSpan) => {
  const [bs, be] = rangeOf(b);
  const t = minutesOf(time);
  return [t, t + 1440].some((x) => x >= bs && x <= be);
};

/**
 * 休憩の申し出を、その日の休憩の一覧に足す（Q の CSV 取り込みで、担当者が選んだとき）。
 * 同じ始め・同じ終わりの休憩、重なる休憩、申し出た休憩の中に一方の時刻がある休憩（押し忘れで一方しかない休憩）は、
 * 申し出たものに置き換える。
 */
export const applyBreakRequests = (base: BreakSpan[], requested: TimeSpan[]): BreakSpan[] => {
  let list = [...base];
  for (const r of requested) {
    if (!isCompleteSpan(r)) continue;
    list = list.filter((b) => {
      if ((b.start && b.start === r.start) || (b.end && b.end === r.end)) return false;
      if (isCompleteSpan(b)) return !overlapsSpan(b, r);
      const one = b.start || b.end;
      return !(one && HHMM.test(one) && withinSpan(one, r));
    });
    list.push({ start: r.start, end: r.end });
  }
  return sortSpans(list);
};
