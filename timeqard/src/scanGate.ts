/**
 * カメラで読んだ QR コードを、何度も続けて受け取らないための門
 *
 * カードをカメラの前にかざしているあいだは、同じカードを何度も読む。同じ中身を最後に読んでから gapMs のあいだは受け取らない
 * （かざしたままなら、読むたびに最後の時刻を新しくするので、いったんカードを離すまで受け取らない）。
 */
export const makeScanGate = (gapMs = 3000) => {
  let lastText = "";
  let lastAt = -Infinity;
  return (text: string, now: number) => {
    const same = text === lastText && now - lastAt < gapMs;
    lastText = text;
    lastAt = now;
    return !same;
  };
};
