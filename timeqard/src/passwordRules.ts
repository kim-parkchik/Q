/**
 * ブラウザ版の、従業員のパスワードの決まり（timeqard/DESIGN.md の 10）
 *
 * 入口のパソコン（src/webApi.ts）と、ブラウザの画面（src/web/。入れたときにすぐ知らせる）の両方で使う。
 * ・8文字以上・64文字まで。スタッフID と同じもの・同じ文字ばかり・「12345678」のような並びは使えない。
 * ・全角で入れても、半角で入れたときと同じにする（日本語入力がオンのまま入れても、ログインできるように）。
 * ・はじめのパスワードは、見まちがえやすい文字を除いた、ばらばらな8文字。
 */
import { normalizeIdInput } from "../../shared/timeqard";

export const INITIAL_PASSWORD_LENGTH = 8;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 64;

/** はじめのパスワードに使う文字（見まちがえやすい l・o・0・1 を除いた、小文字と数字の 32 文字） */
export const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** ばらばらな値（ブラウザ・TimeQard の画面の暗号の部品） */
export const cryptoRandomBytes = (length: number) => {
  const b = new Uint8Array(length);
  crypto.getRandomValues(b);
  return b;
};

/** パスワードの文字をそろえる（全角で入れても、半角で入れたときと同じにする） */
export const normalizePassword = (s: string) => s.normalize("NFKC");

const isRun = (chars: string[]) => {
  const codes = chars.map((c) => c.codePointAt(0) ?? 0);
  const d = codes[1] - codes[0];
  return (d === 1 || d === -1) && codes.every((c, i) => i === 0 || c - codes[i - 1] === d);
};

/** 従業員のパスワードとして使えないなら、わけを返す */
export const passwordProblem = (password: string, staffId: string): string | null => {
  const pw = normalizePassword(password);
  const chars = [...pw];
  if (chars.length < MIN_PASSWORD_LENGTH) return `${MIN_PASSWORD_LENGTH}文字以上にしてください。`;
  if (chars.length > MAX_PASSWORD_LENGTH) return `${MAX_PASSWORD_LENGTH}文字までにしてください。`;
  if (/[\u0000-\u001f\u007f]/.test(pw)) return "使えない文字が入っています。";
  if (pw.trim() !== pw) return "初めと終わりに空白は入れられません。";
  const id = normalizeIdInput(staffId).toLowerCase();
  if (id && normalizeIdInput(pw).toLowerCase() === id) return "スタッフID と同じパスワードは使えません。";
  if (new Set(chars).size < 3) return "同じ文字ばかりのパスワードは使えません。";
  if (isRun(chars)) return "「12345678」「abcdefgh」のような、順に並んだだけのパスワードは使えません。";
  return null;
};

/** はじめのパスワードを作る（ばらばらな8文字。数字と英字の両方を入れる） */
export const newInitialPassword = (randomBytes: (length: number) => Uint8Array = cryptoRandomBytes) => {
  for (let i = 0; i < 100; i++) {
    const pw = Array.from(randomBytes(INITIAL_PASSWORD_LENGTH), (x) => PASSWORD_ALPHABET[x % PASSWORD_ALPHABET.length]).join("");
    if (/[0-9]/.test(pw) && /[a-z]/.test(pw) && !passwordProblem(pw, "")) return pw;
  }
  throw new Error("はじめのパスワードを作れませんでした");
};
