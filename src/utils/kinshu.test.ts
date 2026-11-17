import { describe, expect, test } from "bun:test";
import { KINSHU, kinshuOf, kinshuTotal } from "./kinshu";

describe("金種表", () => {
  test("大きいお金から順に使う（2千円札は使わない）", () => {
    expect(KINSHU).toEqual([10000, 5000, 1000, 500, 100, 50, 10, 5, 1]);
    // 257,839円 = 1万円札25枚・5千円札1枚・千円札2枚・500円玉1枚・100円玉3枚・10円玉3枚・5円玉1枚・1円玉4枚
    expect(kinshuOf(257839)).toEqual([25, 1, 2, 1, 3, 0, 3, 1, 4]);
    expect(kinshuOf(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(kinshuOf(-5)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  test("合計の枚数（足すと支給額の合計になる）", () => {
    const total = kinshuTotal([257839, 101851]);
    expect(total).toEqual([35, 1, 3, 2, 6, 1, 3, 1, 5]);
    expect(total.reduce((s, n, i) => s + n * KINSHU[i], 0)).toBe(257839 + 101851);
  });
});
