/**
 * 2020年分（令和2年分） 源泉徴収税額マスター
 *
 * 月額表・日額表の丙欄・賞与の算出率の表は、令和7年分（tax2025.ts）と同じものを使う
 * （国税庁のページによると、令和2年1月以後、令和7年分まで「税額」は改正されていない）。
 * 電算機計算の特例だけは、令和2年分の資料（densanki2020.ts）を使う。令和3年～令和7年分の資料には
 * 「令和2年分以前の給与等には使用できません」とあるため（表の数字は同じ）。
 *   URL: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2019/data/01.pdf
 *   （国税庁「過去分のパンフレット・手引（源泉所得税関係）」https://www.nta.go.jp/publication/pamph/kakobun/gensen/01.htm）
 *
 * 適用期間: 2020年1月1日 〜 2020年12月31日
 */

import { TAX_2025 } from './tax2025';
import { DENSANKI_2020 } from './densanki2020';

export const TAX_2020 = {
  ...TAX_2025,
  MASTER_YEAR: 2020,
  /** 月額表の甲欄の「電算機計算の特例」（令和2年分。国税庁の PDF から自動生成） */
  DENSANKI: DENSANKI_2020,
};
