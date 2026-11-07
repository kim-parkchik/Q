/**
 * 打刻の種類と、申し出の理由
 *
 * 種類の名前（entry など）は、Q の勤怠の列の名前（entry_time・csv_entry_time など）に合わせる。
 * 画面と CSV の見出しには、Q の「CSV 取り込み」と同じ言葉（出勤・退勤・休憩始・休憩終・外出・戻り）を使う。
 */

export const PUNCH_KINDS = ["entry", "exit", "break_start", "break_end", "out", "return"] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];

export const PUNCH_LABELS: Record<PunchKind, string> = {
  entry: "出勤",
  exit: "退勤",
  break_start: "休憩始",
  break_end: "休憩終",
  out: "外出",
  return: "戻り",
};

export const isPunchKind = (s: unknown): s is PunchKind =>
  typeof s === "string" && (PUNCH_KINDS as readonly string[]).includes(s);

/** 「出勤」→ entry（知らない言葉は null） */
export const punchKindOfLabel = (label: string): PunchKind | null =>
  PUNCH_KINDS.find((k) => PUNCH_LABELS[k] === label.trim()) ?? null;

/** どうやって押したか（カードをかざした・ID を入れた） */
export type PunchMethod = "card" | "id";

/** 押し忘れの申し出の理由（このほかに、ひとこと書ける） */
export const REQUEST_REASONS = [
  "押し忘れた",
  "カードを忘れて押せなかった",
  "押し間違えた",
  "パソコンが動かなかった",
  "そのほか",
] as const;
export type RequestReason = (typeof REQUEST_REASONS)[number];

export const isRequestReason = (s: unknown): s is RequestReason =>
  typeof s === "string" && (REQUEST_REASONS as readonly string[]).includes(s);
