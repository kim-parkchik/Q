/**
 * カメラで読む部分のテスト：QR コードを読む部品（jsQR）が、Q で印刷する打刻カードの QR コードを読めるか。
 * カメラで読んだカードを、何度も続けて受け取らないか。
 * 実行方法: bun test timeqard
 */
import { describe, expect, test } from "bun:test";
import jsQR from "jsqr";
import { cardPayload, newCardNumber } from "../../shared/timeqard";
import { encodeQr } from "../../src/utils/qrCode";
import { makeScanGate } from "./scanGate";

/** QR コードを、カメラの1こまのような RGBA の画像にする（1マス scale 画素・まわりに白・少しずらして置く） */
const toFrame = (text: string, opts: { scale: number; margin: number; width: number; height: number; noise?: number }) => {
  const qr = encodeQr(text, { ecc: "Q" });
  const data = new Uint8ClampedArray(opts.width * opts.height * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
  for (let y = 0; y < opts.height; y++) {
    for (let x = 0; x < opts.width; x++) {
      const qx = (x - opts.margin) / opts.scale;
      const qy = Math.floor((y - opts.margin) / opts.scale);
      const mx = Math.floor(qx);
      const dark = mx >= 0 && qy >= 0 && mx < qr.size && qy < qr.size && qr.modules[qy][mx];
      // 白は少し灰色、黒は少し明るく（印刷とカメラのにじみのかわり）。少しのざらつきも足す
      let v = dark ? 40 : 215;
      if (opts.noise) v += Math.round((rand() - 0.5) * opts.noise);
      const i = (y * opts.width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
      data[i + 3] = 255;
    }
  }
  return data;
};

describe("jsQR で打刻カードの QR コードを読む", () => {
  const payload = cardPayload("K7M3QP2X", newCardNumber());

  test("カメラの1こま（横480画素）の中の QR コードを読める", () => {
    const frame = toFrame(payload, { scale: 4, margin: 150, width: 480, height: 360 });
    expect(jsQR(frame, 480, 360, { inversionAttempts: "dontInvert" })?.data).toBe(payload);
  });

  test("小さく写っていても（1マス3画素）、ざらついていても読める", () => {
    const frame = toFrame(payload, { scale: 3, margin: 60, width: 320, height: 240, noise: 80 });
    expect(jsQR(frame, 320, 240, { inversionAttempts: "dontInvert" })?.data).toBe(payload);
  });
});

describe("カメラで読んだカードを、何度も続けて受け取らない", () => {
  test("同じカードは、いったん離して3秒たつまで受け取らない（かざしたままなら、ずっと受け取らない）", () => {
    const pass = makeScanGate(3000);
    expect(pass("A", 0)).toBe(true);
    expect(pass("A", 200)).toBe(false);
    expect(pass("A", 2800)).toBe(false);
    expect(pass("A", 5600)).toBe(false); // 読むたびに時刻を新しくするので、かざしたままなら受け取らない
    expect(pass("A", 9000)).toBe(true); // 3秒より長くあいた
  });

  test("ちがうカードは、すぐ受け取る", () => {
    const pass = makeScanGate(3000);
    expect(pass("A", 0)).toBe(true);
    expect(pass("B", 100)).toBe(true);
    expect(pass("A", 200)).toBe(true);
  });
});
