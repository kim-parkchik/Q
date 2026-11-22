/**
 * 法人番号（13けた）のチェックと、国税庁の法人番号公表サイトのその番号のページ
 *
 * 法人番号から商号・所在地を Q が読みに行くことはしない（国税庁の Web-API は会社ごとにアプリケーションID の届出が要り、
 * ID を人に見せることは利用規約で禁止されているので、Q に入れて配れない。公表サイトのページを読むのは、ブラウザのふりになる）。
 * ブラウザで公表サイトのページを開き、見て写してもらう。
 */
import { HOUJIN_BANGOU_PAGE_URL } from "../constants/appConfig";

/**
 * 法人番号（13けた）が正しい形か（1けためのチェックディジット ＝ 9 −（2〜13けためを下のけたから 1・2・1・2… 倍して足したもの）を 9 で割った余り）
 */
export const isValidCorporateNumber = (code: string): boolean => {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const base = digits.slice(1).reverse();
  let total = 0;
  base.forEach((d, i) => {
    total += (i + 1) % 2 === 0 ? d * 2 : d;
  });
  return digits[0] === (9 - (total % 9)) % 10;
};

/** 国税庁の法人番号公表サイトの、その法人番号のページ（商号又は名称・本店又は主たる事務所の所在地が出る） */
export const houjinBangouPageUrl = (code: string): string => `${HOUJIN_BANGOU_PAGE_URL}${code}`;
