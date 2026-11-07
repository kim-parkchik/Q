/**
 * 押したことを音で知らせる（音のファイルを使わず、その場で作る）
 */
let ctx: AudioContext | null = null;

const tone = (freq: number, start: number, length: number, volume = 0.18) => {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + start + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
};

const ready = () => {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch {
    return false; // 音が出せないパソコンでも、打刻は止めない
  }
};

/** 記録できたとき（ピポッ） */
export const playOk = () => {
  if (!ready()) return;
  tone(1046, 0, 0.12);
  tone(1568, 0.13, 0.18);
};

/** 押せなかったとき（ブー） */
export const playError = () => {
  if (!ready()) return;
  tone(220, 0, 0.35, 0.22);
};
