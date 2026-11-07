/**
 * カメラの1こま（白黒にする前の RGBA）から、QR コードを読み取る（画面が固まらないように、別の仕事（Web Worker）で動かす）
 * QR コードを読む部品は jsQR（Apache-2.0。npm の jsqr 1.4.0）
 */
import jsQR from "jsqr";

self.onmessage = (e: MessageEvent<{ width: number; height: number; data: ArrayBuffer }>) => {
  const { width, height, data } = e.data;
  // 打刻カードは白地に黒の QR コードなので、色を反転したものは探さない（速く読むため）
  const code = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: "dontInvert" });
  self.postMessage(code ? code.data : null);
};
