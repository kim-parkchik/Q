/**
 * 打刻の画面の決まり（人を見つける・押せるか・出すボタン）
 */
import {
  cardHash, NO_BREAK_LABEL, normalizeIdInput, parseCardPayload, PUNCH_KINDS, PUNCH_LABELS, SUGGESTED_KIND, timeLabel,
  type PunchKind, type RequestKind, type WorkState,
} from "../../shared/timeqard";
import type { KioskSettings, KioskStaff } from "./store";

export type FindResult = { ok: true; person: KioskStaff } | { ok: false; error: string };

/** 読み取ったカード（QR コードの中身）から人を見つける */
export const findByCard = async (staff: KioskStaff[], companyMark: string, text: string): Promise<FindResult> => {
  const card = parseCardPayload(text);
  if (!card) return { ok: false, error: "TimeQard の打刻カードではありません。" };
  if (card.companyMark !== companyMark) return { ok: false, error: "この会社のカードではありません。" };
  const hash = await cardHash(card.cardNumber);
  const person = staff.find((s) => s.inFile && s.cardHashes.includes(hash));
  if (!person) {
    return { ok: false, error: "このカードは使えません。担当者に伝えてください（作り直す前の古いカードか、新しい従業員ファイルをまだ読み込んでいないかもしれません）。" };
  }
  return { ok: true, person };
};

/** 入れた ID から人を見つける（全角・小文字・前後の空白があっても見つける。いま読み込んでいる従業員ファイルの人だけ） */
export const findById = (staff: KioskStaff[], input: string): KioskStaff | null => {
  const people = staff.filter((s) => s.inFile);
  const raw = input.trim();
  const exact = people.find((s) => s.id === raw);
  if (exact) return exact;
  const key = normalizeIdInput(input).toUpperCase();
  const same = people.filter((s) => normalizeIdInput(s.id).toUpperCase() === key);
  return same.length === 1 ? same[0] : null;
};

/** その日に押せない人なら、わけを返す（入社日より前・退職日より後は押せない） */
export const punchBlockReason = (person: KioskStaff, today: string): string | null => {
  if (!person.inFile) return "いまの従業員ファイルにいないので、押せません。担当者に伝えてください。";
  if (person.joinDate && today < person.joinDate) return `入社日（${person.joinDate}）より前なので、押せません。`;
  if (person.retirementDate && today > person.retirementDate) return `退職日（${person.retirementDate}）より後なので、押せません。`;
  return null;
};

/** 設定で出すことにしているボタン（休憩のボタンを出さない会社は、出勤・退勤だけ） */
export const availableKinds = (settings: Pick<KioskSettings, "showBreak">): PunchKind[] =>
  PUNCH_KINDS.filter((k) => (k === "break_start" || k === "break_end" ? settings.showBreak : true));

/** いまの状態で、大きく出すボタン（出していないボタンなら、退勤） */
export const suggestedKind = (state: WorkState, kinds: PunchKind[]): PunchKind =>
  kinds.includes(SUGGESTED_KIND[state]) ? SUGGESTED_KIND[state] : state === "before" || state === "done" ? "entry" : "exit";

/** 時刻（「HH:MM」）を、0時からの分にする */
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * 休憩の申し出の終わりの日時（ミリ秒を出すための日と時刻）。終わりが始めより前なら次の日の時刻（夜勤の休憩）
 */
export const breakEndDate = (date: string, start: string, end: string, addDays: (date: string, n: number) => string) =>
  minutesOf(end) < minutesOf(start) ? addDays(date, 1) : date;

/** 申し出を受け付けたときの知らせの中身（「出勤 9:00 」「休憩 12:00〜13:00 」「「休憩を取れなかった」」） */
export const requestWhatLabel = (r: { kind: RequestKind; time: string; endTime: string }) =>
  r.kind === "no_break" ? `「${NO_BREAK_LABEL}」`
    : r.kind === "break" ? `休憩 ${timeLabel(r.time)}〜${timeLabel(r.endTime)} `
    : `${PUNCH_LABELS[r.kind]} ${timeLabel(r.time)} `;
