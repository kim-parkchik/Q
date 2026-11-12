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

/** どうやって押したか（カードをかざした・ID を入れた・ブラウザで押した（各自のパソコン。ID とパスワードでログインして）） */
export type PunchMethod = "card" | "id" | "web";

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

/**
 * 申し出の種類：打刻の種類（時刻を申し出る）と、「休憩を取れなかった」（no_break。時刻はない）。
 * Q は、「休憩を取れなかった」を担当者が選ぶと、その日の勤怠の「休憩なし」（決まった休憩を引かない）にする。
 */
export const REQUEST_KINDS = [...PUNCH_KINDS, "no_break"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const NO_BREAK_LABEL = "休憩を取れなかった";
/** 申し出の理由の文・CSV の列で使う短い名前 */
export const NO_BREAK_SHORT = "休憩なし";

export const isRequestKind = (s: unknown): s is RequestKind =>
  typeof s === "string" && (REQUEST_KINDS as readonly string[]).includes(s);

/** 申し出の種類の名前（「出勤」「休憩を取れなかった」） */
export const requestKindLabel = (kind: RequestKind) => (kind === "no_break" ? NO_BREAK_LABEL : PUNCH_LABELS[kind]);
