/**
 * 打刻の種類と、申し出の種類・理由
 *
 * 打刻は、出勤・退勤・休憩始・休憩終の4つ（よく使われている勤怠ソフトと同じ）。休憩は1日に何回でも押せる。
 * 外出・中抜け（私用で仕事を抜ける）も、休憩として押す（2026年11月12日に、外出をなくして休憩にまとめた）。
 * 仕事での外出（客先など）は働いた時間なので、押さない。
 * 種類の名前（entry など）は、Q の勤怠の列の名前（entry_time・csv_entry_time など）に合わせる。
 */

export const PUNCH_KINDS = ["entry", "exit", "break_start", "break_end"] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];

export const PUNCH_LABELS: Record<PunchKind, string> = {
  entry: "出勤",
  exit: "退勤",
  break_start: "休憩始",
  break_end: "休憩終",
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
 * 申し出の種類：
 * ・出勤・退勤（entry・exit）：時刻を1つ申し出る。Q は、担当者が選ぶと修正の欄に入れる。
 * ・休憩（break）：休憩の始めと終わりを申し出る（押し忘れた休憩・中抜け）。Q は、担当者が選ぶと、その日の休憩の一覧に足す。
 * ・休憩を取れなかった（no_break）：時刻はない。Q は、担当者が選ぶと、その日の勤怠の「休憩なし」（決まった休憩を引かない）にする。
 */
export const REQUEST_KINDS = ["entry", "exit", "break", "no_break"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** 時刻を1つ申し出る種類（出勤・退勤） */
export type TimeRequestKind = "entry" | "exit";
export const TIME_REQUEST_KINDS: readonly TimeRequestKind[] = ["entry", "exit"];

/** 申し出の「休憩」の名前 */
export const BREAK_LABEL = "休憩";

export const NO_BREAK_LABEL = "休憩を取れなかった";
/** 申し出の理由の文・CSV の列で使う短い名前 */
export const NO_BREAK_SHORT = "休憩なし";

export const isRequestKind = (s: unknown): s is RequestKind =>
  typeof s === "string" && (REQUEST_KINDS as readonly string[]).includes(s);

/** 申し出の種類の名前（「出勤」「休憩」「休憩を取れなかった」） */
export const requestKindLabel = (kind: RequestKind) => (kind === "no_break" ? NO_BREAK_LABEL : kind === "break" ? BREAK_LABEL : PUNCH_LABELS[kind]);
