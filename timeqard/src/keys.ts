/**
 * キーの位置（KeyboardEvent.code）から文字を決める。
 * 日本語入力がオンでも、USB の QR コード読み取り機とキーボードで、同じ文字になるようにする（英大文字・数字・いくつかの記号）。
 */
export const charOfKey = (code: string, shift = false): string | null => {
  let m = code.match(/^Key([A-Z])$/);
  if (m) return m[1];
  m = code.match(/^(?:Digit|Numpad)(\d)$/);
  if (m && !(shift && code.startsWith("Digit"))) return m[1];
  if (code === "Minus") return shift ? "_" : "-";
  if (code === "NumpadSubtract") return "-";
  if (code === "IntlRo" && shift) return "_"; // 日本語のキーボードの「ろ」のキー
  if (code === "Period" || code === "NumpadDecimal") return ".";
  return null;
};
