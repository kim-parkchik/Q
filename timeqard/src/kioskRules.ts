/**
 * 打刻の画面の決まり（人を見つける・押せるか・出すボタン）
 */
import { cardHash, normalizeIdInput, parseCardPayload, PUNCH_KINDS, SUGGESTED_KIND, type PunchKind, type WorkState } from "../../shared/timeqard";
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

/** 設定で出すことにしているボタン */
export const availableKinds = (settings: Pick<KioskSettings, "showBreak" | "showOut">): PunchKind[] =>
  PUNCH_KINDS.filter((k) => {
    if (k === "break_start" || k === "break_end") return settings.showBreak;
    if (k === "out" || k === "return") return settings.showOut;
    return true;
  });

/** いまの状態で、大きく出すボタン（出していないボタンなら、退勤） */
export const suggestedKind = (state: WorkState, kinds: PunchKind[]): PunchKind =>
  kinds.includes(SUGGESTED_KIND[state]) ? SUGGESTED_KIND[state] : state === "before" || state === "done" ? "entry" : "exit";
