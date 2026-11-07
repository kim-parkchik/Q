/**
 * TimeQard の日時（日本時間）
 *
 * 打刻用のパソコンのタイムゾーンの設定が日本になっていなくても同じ日時になるように、
 * パソコンの時計（1970年1月1日からのミリ秒）に9時間を足して、日本時間の日付と時刻を作る（日本に夏時間はない）。
 * 記録には「2026-11-07T08:58:30+09:00」の形で残す。
 */

export const JST_OFFSET_MINUTES = 9 * 60;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 日本時間の年・月・日・時・分・秒・曜日（0 が日曜） */
export const jstParts = (ms: number) => {
  const d = new Date(ms + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
};

/** 日本時間の日付（「2026-11-07」） */
export const jstDate = (ms: number) => {
  const p = jstParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};

/** 日本時間の時刻（「08:58」。秒は切り捨てる） */
export const jstTime = (ms: number) => {
  const p = jstParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
};

/** 日本時間の時刻（秒まで。「08:58:30」） */
export const jstTimeWithSeconds = (ms: number) => {
  const p = jstParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
};

/** 記録に残す形（「2026-11-07T08:58:30+09:00」） */
export const jstIso = (ms: number) => `${jstDate(ms)}T${jstTimeWithSeconds(ms)}+09:00`;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** 「2026-11-07T08:58:30+09:00」の形を読む（読めなければ null） */
export const parseIso = (s: unknown): number | null => {
  if (typeof s !== "string" || !ISO_RE.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 「2026-11-07」の形で、本当にある日か（2026-02-30 などは false） */
export const isDateString = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  const m = s.match(DATE_RE);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

/** 「08:58」の形で、00:00〜23:59 か */
export const isTimeString = (s: unknown): s is string =>
  typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 日付に日数を足す（「2026-11-30」に1日足すと「2026-12-01」） */
export const addDays = (date: string, days: number) => {
  const m = date.match(DATE_RE);
  if (!m) throw new Error(`日付の形ではありません: ${date}`);
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};

/** 日本時間のその日・その時刻のミリ秒（「2026-11-07」「08:58」） */
export const jstMs = (date: string, time = "00:00") => {
  const m = date.match(DATE_RE);
  const t = time.match(/^(\d{2}):(\d{2})$/);
  if (!m || !t) throw new Error(`日付・時刻の形ではありません: ${date} ${time}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])) - JST_OFFSET_MS;
};

/** その月の1日と末日（「2026-11」→ 2026-11-01・2026-11-30） */
export const monthRange = (year: number, month: number) => {
  const first = `${year}-${pad2(month)}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return { from: first, to: addDays(next, -1) };
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 「11月7日（土）」 */
export const jstDateLabel = (ms: number) => {
  const p = jstParts(ms);
  return `${p.month}月${p.day}日（${WEEKDAYS[p.weekday]}）`;
};

/** 「2026-11-07」→「11月7日」 */
export const shortDateLabel = (date: string) => {
  const m = date.match(DATE_RE);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : date;
};

/** 「08:58」→「8:58」（画面に出すとき） */
export const timeLabel = (time: string) => time.replace(/^0(\d):/, "$1:");
