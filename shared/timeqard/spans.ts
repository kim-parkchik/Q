/**
 * 休憩の一覧の書き方（CSV の「休憩」の列。TimeQard の CSV と、Q の勤怠の CSV で同じ書き方にする）
 *
 * 「12:00-13:00 15:00-15:10」のように、始め・終わりを「-」でつなぎ、休憩ごとに空白で区切る。
 * 始めか終わりの一方しかない休憩（押し忘れ）は「12:00-」「-13:00」と書く（Q は、その休憩を引かずに知らせる）。
 * 読むときは、全角・「〜」「~」・「、」「／」区切りも読む。
 */
import { normalizeTime } from "./normalize";

/** 1回の休憩（始め・終わり。「HH:MM」。一方がないときは ""） */
export interface TimeSpan {
  start: string;
  end: string;
}

/** 休憩の一覧を書く（「12:00-13:00 15:00-15:10」） */
export const formatSpanList = (spans: TimeSpan[]): string =>
  spans
    .filter((s) => s.start || s.end)
    .map((s) => `${s.start}-${s.end}`)
    .join(" ");

/** 休憩の一覧を読む。読めないところは bad に入れる（ほかは読む） */
export const parseSpanList = (text: string | undefined): { spans: TimeSpan[]; bad: string[] } => {
  const spans: TimeSpan[] = [];
  const bad: string[] = [];
  const parts = (text ?? "").normalize("NFKC").split(/[\s、,／/]+/).filter((p) => p !== "");
  for (const part of parts) {
    const m = /^([^-~〜]*)[-~〜]([^-~〜]*)$/.exec(part);
    const start = m ? normalizeTime(m[1]) : null;
    const end = m ? normalizeTime(m[2]) : null;
    if (start === null || end === null || (start === "" && end === "")) {
      bad.push(part);
      continue;
    }
    spans.push({ start, end });
  }
  return { spans, bad };
};
