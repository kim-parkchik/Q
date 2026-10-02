/**
 * 社会保険料の計算（本人負担分）
 *
 * 「標準報酬月額 × 料率 ÷ 2」を、小数の誤差が出ないように整数で計算してから端数処理する。
 * （例: 4,826.5 円のような「ちょうど50銭」の判定を、浮動小数点の誤差で間違えないため）
 */
import { applyRounding } from "./payrollUtils";

/**
 * 金額 × 料率(%) ÷ 分母 を、指定の端数処理で円にする
 * @param base       標準報酬月額・標準賞与額・賃金総額など
 * @param ratePercent 料率（%）。例: 9.85
 * @param rounding   端数処理（'currency_law' | 'floor' | 'ceil' | 'round'）
 * @param divisor    2 なら折半（本人負担分）、1 ならそのまま
 */
export const calcPremium = (base: number, ratePercent: number, rounding: string, divisor: 1 | 2 = 2): number => {
    const amount = Math.max(0, Math.floor(base));
    const rate = Math.round(ratePercent * 10000);       // 9.85% → 98500（1/10000 % 単位の整数）
    const num = amount * rate;                           // 整数のまま
    const den = 100 * 10000 * divisor;
    const q = Math.floor(num / den);
    const rem = num - q * den;                           // 余り（0 ≦ rem < den）
    switch (rounding) {
        case "currency_law": return rem * 2 > den ? q + 1 : q;   // 50銭以下切り捨て、50銭超切り上げ
        case "round":        return rem * 2 >= den ? q + 1 : q;  // 四捨五入
        case "ceil":         return rem > 0 ? q + 1 : q;
        case "floor":        return q;
        default:             return applyRounding(num / den, rounding);
    }
};
