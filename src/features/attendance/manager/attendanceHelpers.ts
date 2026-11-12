/**
 * 勤怠画面で使う小さな判定関数
 */

export const isCompleteTime = (t: string) => {
  if (!t || t === ":" || t.trim() === "") return false;
  const parts = t.split(":");
  return parts.length === 2 && parts[0].length >= 1 && parts[1].length >= 1;
};

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// 入力があるかどうかの判定を共通化
export const checkHasInput = (row: any) => {
  const fields = [row.in, row.out];
  // ":" 以外の文字が含まれているか、休憩を手で入れたか、または有給・欠勤などのタイプが選択されているか
  return fields.some(f => f && f !== ":" && f.trim() !== "") || (Array.isArray(row.breaks) && row.breaks.length > 0)
    || row.workType !== "normal" || row.memo;
};
