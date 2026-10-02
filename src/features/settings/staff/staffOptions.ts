/**
 * 従業員管理で使う選択肢
 */
import * as Master from '../../../constants';

// 選択肢用の定数を作成
export const HYOJUN_OPTIONS = Master.INSURANCE_2026.HYOJUN_TABLE.map(([lo, hi, std], index) => {
    let range = "";

    if (index === 0) {
        // 第1級の場合
        range = `${hi.toLocaleString()}円未満`;
    } else if (hi === Infinity) {
        // 最高等級の場合
        range = `${lo.toLocaleString()}円〜`;
    } else {
        // 通常の等級
        range = `${lo.toLocaleString()}円 〜 ${hi.toLocaleString()}円未満`;
    }

    return {
        // label: `${index + 1}級：${std.toLocaleString()}円 (${range})`,
        label: `${String(index + 1).padStart(2, '0')}級：${std.toLocaleString().padStart(9)}円 (${range})`,
        value: std
    };
});
