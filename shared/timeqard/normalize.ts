/**
 * 入れた文字・CSV の値を、決まった形に直す
 *
 * CSV を Excel で開いて保存し直すと、日付が「2026/11/7」、時刻が「8:58」になることがある。
 * Q の勤怠は「2026-11-07」「08:58」の形だけを読むので、取り込む前にこの形に直す。
 */
import { isDateString } from "./time";

/** 全角の英数字・記号を半角にする（NFKC。「１００１」→「1001」、「：」→「:」） */
export const toHalfWidth = (s: string) => s.normalize("NFKC");

/** 入れた ID・読み取った ID を、比べる形にする（全角を半角にして、前後の空白を取る） */
export const normalizeIdInput = (s: string) => toHalfWidth(s).trim();

/**
 * 日付を「2026-11-07」の形にする。読めなければ null。
 * 「2026-11-07」「2026/11/7」「2026.11.7」「2026年11月7日」（全角も）を読む。
 */
export const normalizeDate = (raw: string | null | undefined): string | null => {
  const s = toHalfWidth(raw ?? "").trim();
  const m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isDateString(date) ? date : null;
};

/** 空の時刻として扱う書き方（ほかのタイムカードの CSV で使われることがある） */
const EMPTY_TIME_MARKS = new Set(["", "-", "--", "--:--", ":", "―", "ー"]);

/**
 * 時刻を「08:58」の形にする。空なら ""、読めなければ null。
 * 「08:58」「8:58」「8:58:30」（秒は切り捨てる）「8時58分」（全角も）を読む。
 * 24時以後の書き方（「25:30」）は、次の日の時刻（「01:30」）にする（Q は、退勤が出勤より前なら次の日として数える）。
 */
export const normalizeTime = (raw: string | null | undefined): string | null => {
  const s = toHalfWidth(raw ?? "").trim();
  if (EMPTY_TIME_MARKS.has(s)) return "";
  const m =
    s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/) ??
    s.match(/^(\d{1,2})時(\d{1,2})分(?:(\d{1,2})秒)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  if (minute > 59 || second > 59 || hour > 47) return null;
  if (hour >= 24) hour -= 24;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
