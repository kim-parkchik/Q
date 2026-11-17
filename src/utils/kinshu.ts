/**
 * 金種表：現金で払う人の差引支給額を、お札と硬貨の枚数に分ける（一般的な給与ソフトの金種表と同じ。
 * 2千円札はふつう用意しないので使わない）。大きいお金から順に、できるだけ多く使う
 */

/** 使うお札・硬貨（円。大きい順） */
export const KINSHU = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1] as const;

export const kinshuLabel = (yen: number) => (yen >= 1000 ? `${yen.toLocaleString()}円札` : `${yen}円玉`);

/** 1人分の枚数（金額は0以上の整数にする） */
export const kinshuOf = (amount: number): number[] => {
  let rest = Math.max(0, Math.floor(Number(amount) || 0));
  return KINSHU.map((yen) => {
    const n = Math.floor(rest / yen);
    rest -= n * yen;
    return n;
  });
};

/** 全員分の枚数の合計（銀行で両替するときの数） */
export const kinshuTotal = (amounts: number[]): number[] =>
  amounts.map(kinshuOf).reduce((sum, row) => sum.map((v, i) => v + row[i]), KINSHU.map(() => 0));
