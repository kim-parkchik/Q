/**
 * QR コードを作る（qrCode.ts）のテスト
 * 実行方法: bun test
 *
 * 読み取れるかどうかは、Mac の CoreImage・Vision で確かめる（bun scripts/verify_qr_macos.ts）。
 * ここでは、形の決まり（大きさ・位置検出パターン・形式情報）と、作るたびに同じものになることを確かめる。
 */
import { describe, expect, test } from "bun:test";
import { encodeQr, penaltyScore, qrDataCapacityBits, qrSvgPath } from "./qrCode";

const CARD = "TQ1K7M3QP2XABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 形式情報（15ビット）を、左上の場所から読む */
const readFormatBits = (m: boolean[][]) => {
  let bits = 0;
  const at = (x: number, y: number) => (m[y][x] ? 1 : 0);
  const order: [number, number][] = [];
  for (let i = 0; i <= 5; i++) order.push([8, i]);
  order.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) order.push([14 - i, 8]);
  order.forEach(([x, y], i) => {
    bits |= at(x, y) << i;
  });
  return bits ^ 0x5412;
};

describe("QR コード", () => {
  test("打刻カードの中身（37文字）は、誤り訂正 Q の型番3（29マス）に入る", () => {
    const qr = encodeQr(CARD);
    expect(qr.version).toBe(3);
    expect(qr.ecc).toBe("Q");
    expect(qr.size).toBe(29);
    expect(qr.modules.length).toBe(29);
    expect(qr.modules.every((row) => row.length === 29)).toBe(true);
  });

  test("3つの角に位置検出パターン（7×7 の黒い枠と、中の 3×3）がある", () => {
    const { modules: m, size } = encodeQr(CARD);
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          expect(m[cy + dy][cx + dx]).toBe(d !== 2);
        }
      }
    }
  });

  test("形式情報（誤り訂正のレベルとマスクの番号）が、BCH 符号として正しい", () => {
    for (const ecc of ["L", "M", "Q", "H"] as const) {
      for (let mask = 0; mask < 8; mask++) {
        const qr = encodeQr(CARD, { ecc, mask });
        const bits = readFormatBits(qr.modules);
        const data = bits >>> 10;
        expect(data).toBe(({ L: 1, M: 0, Q: 3, H: 2 }[ecc] << 3) | mask);
        // BCH(15,5)：生成多項式 0x537 で割った余りが 0
        let rem = bits;
        for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
        expect(rem).toBe(0);
      }
    }
  });

  test("決まった中身なら、いつも同じ QR コードになる（マスクは点数のいちばん小さいもの）", () => {
    const a = encodeQr(CARD);
    const b = encodeQr(CARD);
    expect(a.modules).toEqual(b.modules);
    const scores = Array.from({ length: 8 }, (_, mask) => penaltyScore(encodeQr(CARD, { mask }).modules));
    expect(penaltyScore(a.modules)).toBe(Math.min(...scores));
  });

  test("入るデータの量（型番1の M は 16 コード語、型番3の Q は 34 コード語）", () => {
    expect(qrDataCapacityBits(1, "M")).toBe(16 * 8);
    expect(qrDataCapacityBits(3, "Q")).toBe(34 * 8);
    expect(qrDataCapacityBits(10, "H")).toBe(122 * 8);
  });

  test("入りきらない長さはエラーにする・日本語も入る", () => {
    expect(() => encodeQr("A".repeat(400), { ecc: "H" })).toThrow("入りきりません");
    expect(encodeQr("山田 太郎", { ecc: "M" }).version).toBe(1);
  });

  test("SVG の path は、黒いマスを横につなげて、余白の分ずらす", () => {
    const qr = encodeQr("HELLO", { ecc: "L" });
    const d = qrSvgPath(qr, 4);
    expect(d.startsWith("M4 4h7v1h-7z")).toBe(true); // 左上の位置検出パターンの1行目（黒が7つ）
  });
});
