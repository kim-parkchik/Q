/**
 * 源泉所得税（税額表の甲欄）の「扶養親族等の数」の数え方と、その線（年分ごと）
 *
 * このファイルは scripts/import_withholding_dependents.py で、国税庁「令和○年分 源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」
 * （19〜22ページ）の PDF から作る（手で書き換えない。作り方は tax-tables/README.md）:
 *   tax-tables/source/zeigakuhyo2026-19-22.pdf（https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/19-22.pdf。https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm）SHA-256 fbed5287d5e99b6d340655763f1809ae4cde6d6c5b762e5d995a05630620e42e
 *   tax-tables/source/zeigakuhyo2027-19-22.pdf（https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/19-22.pdf。https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm）SHA-256 ce2ac0cc772c728d41f9690fa0d62c96035738dda1d425ebe4655dfc61f167d6
 *
 * 令和8年分の PDF は、令和8年度の税制改正（令和8年12月1日以後に支払う給与から、扶養親族などの所得の線を引き上げた）より前のもの。
 * 12月1日以後の線は constants/nencho/gensen2026.ts（国税庁の法定調書の手引から作ったもの）にあり、Q の数え方（utils/withholdingDependents.ts）は
 * そちらの線を使う（このファイルの線とは、utils/withholdingDependents.test.ts で照らし合わせる）。
 */

export interface WithholdingDependentRule {
  year: number;
  /** 本人が障害者（特別障害者を含む）・寡婦・ひとり親・勤労学生に該当するごとに、扶養親族等の数に足す人数 */
  perSelfItem: number;
  /** 同一生計配偶者・扶養親族のうちに障害者（特別障害者を含む）・同居特別障害者に該当する人がいれば、これらの一に該当するごとに足す人数 */
  perFamilyItem: number;
  /** 障害者を数える扶養親族には、この年齢未満の人も含む */
  familyIncludesUnder: number;
  /** 源泉控除対象配偶者：給与等の支払を受ける人の所得の見積額の上限 */
  recipientIncomeLimit: number;
  /** 源泉控除対象配偶者：配偶者の所得の見積額の上限 */
  spouseIncomeLimit: number;
  /** 扶養親族・同一生計配偶者の所得の見積額の上限 */
  dependentIncomeLimit: number;
  /** 控除対象扶養親族（居住者）：この年齢以上（その年の12月31日の年齢） */
  deductibleAgeFrom: number;
  /** 控除対象扶養親族（居住者）：この日以前に生まれた人 */
  deductibleBornOnOrBefore: string;
  /**
   * 特定親族：年齢（ageFrom 歳以上 ageUntil 歳未満）・生年月日の範囲（bornFrom〜bornTo）・所得の見積額（over 超 upTo 以下）。
   * そのうち所得の見積額が sourceLimit 以下の人が、源泉控除対象親族
   */
  specificRelative: { ageFrom: number; ageUntil: number; bornFrom: string; bornTo: string; over: number; upTo: number; sourceLimit: number };
}

export const WITHHOLDING_DEPENDENT_RULES: Record<number, WithholdingDependentRule> = {
  2026: {
    year: 2026,
    perSelfItem: 1,
    perFamilyItem: 1,
    familyIncludesUnder: 16,
    recipientIncomeLimit: 9000000,
    spouseIncomeLimit: 950000,
    dependentIncomeLimit: 580000,
    deductibleAgeFrom: 16,
    deductibleBornOnOrBefore: "2011-01-01",
    specificRelative: {
      ageFrom: 19,
      ageUntil: 23,
      bornFrom: "2004-01-02",
      bornTo: "2008-01-01",
      over: 580000,
      upTo: 1230000,
      sourceLimit: 1000000
    }
  },
  2027: {
    year: 2027,
    perSelfItem: 1,
    perFamilyItem: 1,
    familyIncludesUnder: 16,
    recipientIncomeLimit: 9000000,
    spouseIncomeLimit: 950000,
    dependentIncomeLimit: 620000,
    deductibleAgeFrom: 16,
    deductibleBornOnOrBefore: "2012-01-01",
    specificRelative: {
      ageFrom: 19,
      ageUntil: 23,
      bornFrom: "2005-01-02",
      bornTo: "2009-01-01",
      over: 620000,
      upTo: 1230000,
      sourceLimit: 1000000
    }
  },
};
