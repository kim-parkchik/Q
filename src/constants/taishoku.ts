/**
 * 退職手当等（退職金）に対する所得税（源泉徴収税額）と住民税（特別徴収税額）の計算に使う数値
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_taishoku_tables.py taishoku-tables src/constants/taishoku.ts（入手元は taishoku-tables/README.md）
 * 元データ:
 *   shotokuzei-30.xml（SHA-256 c7f2b45fc7b469dbf7fc3cfe82f7d7572e5ed52171e4aef62ff6d842e12f1b5c）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=30
 *   shotokuzei-rei-69.xml（SHA-256 3969cba1c5c3c383b28fa9ccff329bbb74793a1f91e4e44304bb447984d3720d）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=69
 *   chihouzei-50-4.xml（SHA-256 f6a087566264aecd522fe3321c1d66811ca13a042d7ea1a45d400c88b2031700）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=50_4
 *   chihouzei-328-3.xml（SHA-256 3985d8771601778478d00d16b72e9a9a1cf7d60ad6d15a51ffec278ff7647471）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=328_3
 *   shotokuzei-rei-70.xml（SHA-256 8192e537259cf6d7cdc246a8e6618f62dc43009bde337be09a346759ea250d75）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=70
 *   shotokuzei-rei-71-2.xml（SHA-256 19eeaf09415baadccd9e82ea9c3b63c517555d78c85b17f2bce0de3c5f625940）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=71_2
 *   shotokuzei-203.xml（SHA-256 4a205b3e0c58601d445927f992658c25e2a2244b33162e441c7d1d88a4fb6c92）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=203
 *   shotokuzei-kisoku-77.xml（SHA-256 6c0ae3103323358fd25ac896da608e7422a3b22f88ff8c94ea3fb33487f54e86）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340M50000040011;article=77
 *   shotokuzei-212.xml（SHA-256 ab8f2aca981a5342cbda29462c7426111c8539841e28ab97978a4869395a80ec）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=212
 *   shotokuzei-213.xml（SHA-256 2f8bcab3eb8cc53e0cd147f5a78d2a434483d68b3d25ead7419a83ad619ea581）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=213
 *   chihouzei-328.xml（SHA-256 40a173346bf68c2107a29703178be7763c3aea9baf4a4fe6a0cf1a85f7581761）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=328
 *   souzokuzei-59.xml（SHA-256 53b8354417b0c8d09f1908039896414611448c70229446430a363522577e3d53）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000073;article=59
 *   souzokuzei-kisoku-30.xml（SHA-256 9136033beb8e324a8d2c19625f7618933ce1e050caf08387847170dee023f3c8）
 *     https://laws.e-gov.go.jp/api/1/articles;lawId=325M50000040017;article=30
 *   source/zeigakuhyo2026-18.pdf（SHA-256 897dcc15c50c63cd5d5a2477b05097b8af946e137a0f4430585a210b38d67651）
 *     https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf
 *   source/zeigakuhyo2027-18.pdf（SHA-256 2d5228a70e85d38212b56d096e4e6104fc84fb9adeeb669114115df0f9b38427）
 *     https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/18.pdf
 *   source/tebiki2026-03.pdf（SHA-256 b53451729d3e1c3bf333467f39d1061f12b596bfade549f4e66cb4ab16660a87）
 *     https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/03.pdf
 *   source/ta2741.htm（SHA-256 460a2d07be6bd9ba27de6ac55df8cb5649de5732cff4ec07394f85992261d669）
 *     https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2741.htm
 *   source/kisai_chousho46.pdf（SHA-256 5eac66521cd3d5302e9decdc4f24763457d6de1e045216f7f832d5400a4fe2e4）
 *     https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_chousho46.pdf
 *   source/kisai_goukei40.pdf（SHA-256 1ea940e11819f2f3a1370def5120980090e8d9f5e16150e1dc5c9ba1841dc465）
 *     https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_goukei40.pdf
 *   source/shinkokusho-2026.pdf（SHA-256 e3fc4518f1048e613575b7757b9130a9e8c401f7dd388940dc51f68feb50c62e）
 *     https://www.nta.go.jp/law/tsutatsu/kobetsu/hojin/010705/pdf/0025006-122_07.pdf
 *   source/kisai_chousho27.pdf（SHA-256 1a341398aba05bd5ae93f2899fe5c993c1f7d7c4accbd4314c5f09b2a1ab99cf）
 *     https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_chousho27.pdf
 *   source/kisai_goukei21.pdf（SHA-256 3bb05370bcc09e1155c573eab2aff52071f8b68dc1fa0a018cbc327c2c63ca1c）
 *     https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_goukei21.pdf
 *   source/etax-316.pdf（SHA-256 7cc7f5aebf9b26daef4e89fa2594bdcbca7d3b255d18f948366f99f38c7fb853）
 *     https://www.e-tax.nta.go.jp/e-taxsoftweb/hoteichosho/csv2/web_316.pdf
 *   source/etax-325.pdf（SHA-256 89b317daaf823e10642c4241f12b459f2e43a219ba627de2ab8316d6151e1779）
 *     https://www.e-tax.nta.go.jp/e-taxsoftweb/hoteichosho/csv2/soft_325.pdf
 *   source/etax-soft-all.pdf（SHA-256 ee658d0a6696a6b946771dc81d96a99772a71c55cef3d9c0be6eeb68afb44e43）
 *     https://www.e-tax.nta.go.jp/e-taxsoftweb/hoteichosho/csv2/soft_all.pdf
 */

/** 退職所得控除額（所得税法30条3項・6項） */
export const TAISHOKU_DEDUCTION = {
  /** 勤続年数が yearsThreshold 年以下：perYear 円 × 勤続年数 */
  perYear: 400000,
  yearsThreshold: 20,
  /** yearsThreshold 年を超える：base 円 ＋ perYearOver 円 ×（勤続年数 − yearsThreshold 年） */
  base: 8000000,
  perYearOver: 700000,
  /** 計算した額がこれに満たないときは、この額（6項2号） */
  minimum: 800000,
  /** 障害者になったことに直接基因して退職したときに加える額（6項3号） */
  disability: 1000000,
} as const;

/** 退職所得の金額（所得税法30条2項・4項・5項） */
export const TAISHOKU_INCOME = {
  /** 収入金額から退職所得控除額を引いた残額にかける割合（[分子, 分母]。特定役員退職手当等にはかけない） */
  half: [1, 2] as [number, number],
  /** 短期退職手当等：短期勤続年数（役員等以外の者としての勤続年数）が years 年以下。残額が threshold 円以下なら half、
   *  超えるなら base 円 ＋（収入金額 −（threshold 円 ＋ 退職所得控除額）） */
  short: { years: 5, threshold: 3000000, base: 1500000 },
  /** 特定役員退職手当等：役員等勤続年数がこの年数以下 */
  officerYears: 5,
} as const;

/** 勤続年数の1年未満の端数は1年にする（所得税法施行令69条2項） */
export const TAISHOKU_ROUND_UP_YEARS = true;

/** 住民税の分離課税に係る所得割の税率（[分子, 分母]。市町村民税：地方税法328条の3、道府県民税：50条の4） */
export const TAISHOKU_LOCAL_RATES = {
  city: [6, 100] as [number, number],
  pref: [4, 100] as [number, number],
} as const;

/**
 * 前年以前の退職手当等と勤続期間が重なるとき（所得税法施行令70条1項2号・2項・3項。所得税法30条6項1号）：
 * その年の前年以前 priorYears 年内に支払を受けた退職手当等（令和8年1月1日以後に確定拠出年金の一時金を受けたときは、令和8年以後の分は dcPriorYears 年内、
 * その年に確定拠出年金の一時金を受けるときは dcCurrentYears 年内）の勤続期間と重なる期間の年数（1年未満の端数は切り捨て）で計算した額を、
 * 退職所得控除額から引く。前の退職手当等の収入金額がその控除額に満たないときは、前の勤続期間を「収入金額 ÷ 40万円」（800万円を超えるときは
 * 「（収入金額 − 800万円）÷ 70万円 ＋ 20」。1未満の端数は切り捨て）の年数に短くする
 */
export const TAISHOKU_OVERLAP_RULE = {
  priorYears: 4,
  dcPriorYears: 9,
  dcCurrentYears: 19,
  /** 確定拠出年金の一時金を dcPriorYears 年内で数えるのは、この日以後に支払を受けたもの（ロ） */
  dcSince: "2026-01-01",
} as const;

/**
 * 同じ年に一般退職手当等・短期退職手当等・特定役員退職手当等のうち2つ以上があるとき（タックスアンサー No.2741・所得税法施行令71条の2）の控除額の係数：
 * 特定役員・短期の控除額は base 円 ×（その勤続年数 − 重複勤続年数。0未満は0）＋ overlap 円 × 重複勤続年数（3つともあるときは、全重複期間の年数に
 * officerFullOverlap 円・shortFullOverlap 円）。一般の控除額は、全体の勤続年数の退職所得控除額から、ほかの区分の控除額を引いた残り
 */
export const TAISHOKU_MIXED = {
  base: 400000,
  overlap: 200000,
  officerFullOverlap: 140000,
  shortFullOverlap: 130000,
  /** 3つの区分があり、1つの区分の収入金額がその控除額に満たないとき、満たない部分のこの割合（[分子, 分母]）ずつを、ほかの2つの区分の残額から引く
   *  （一方の残額が足りなければ、足りない分をもう一方から引く。施行令71条の2 9項）。2つの区分のときは、満たない部分の全部をもう一方の残額から引く（1項・3項・5項） */
  shortfallShare: [1, 2] as [number, number],
} as const;

/** 非居住者に払う退職手当等（国内源泉所得）の源泉徴収（所得税法212条・213条1項1号）：税率（[分子, 分母]）に、速算表の 102.1％ をかける。
 *  納付は、徴収した月の翌月 dueDay 日まで（国外で払うときは翌月末日まで） */
export const TAISHOKU_NONRESIDENT = {
  rate: [20, 100] as [number, number],
  dueDay: 10,
} as const;

/** 住民税（分離課税）は、所得税法199条で所得税を徴収する（居住者に払う）退職手当等にだけかかり、支払を受けるべき日の属する年の
 *  この月日現在の住所の市町村が課す（地方税法328条） */
export const TAISHOKU_LOCAL_SCOPE = { residentOnly: true, month: 1, day: 1 } as const;

/** 退職手当金等受給者別支払調書（相続税法59条1項）：支給した月の翌月 dueDay 日までに出す。受給者ごとの金額が omitUpTo 円以下なら出さなくてよい（相続税法施行規則30条3項） */
export const TAISHOKU_BENEFIT_REPORT = { dueDay: 15, omitUpTo: 1000000 } as const;

/** 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（記載要領）：退職手当等の「区分」の書き方と、「元号」欄に書く数字 */
export const TAISHOKU_NONRESIDENT_REPORT = {
  kubun: "退職手当等",
  eraCodes: {"令和": "5", "平成": "4", "昭和": "3"} as Record<string, string>,
} as const;

/** e-Tax で出す法定調書の CSV の項目（「レコードの内容及び記録要領」。項番の順。zenkaku：全角、length：文字数（fixed でなければ「以内」）） */
export interface EtaxItem {
  no: number;
  name: string;
  zenkaku: boolean;
  length: number;
  fixed: boolean;
}

/** 316：退職所得の源泉徴収票（e-Tax ソフト（WEB版））、325：退職手当金等受給者別支払調書・339：非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（e-Tax ソフト） */
export const ETAX_LAYOUTS: Record<"316" | "325" | "339", EtaxItem[]> = {
  /** 退職所得の源泉徴収票（41項目） */
  "316": [
    { no: 1, name: "法定資料の種類", zenkaku: false, length: 3, fixed: true },
    { no: 2, name: "整理番号 1", zenkaku: false, length: 10, fixed: true },
    { no: 3, name: "本支店等区分番号", zenkaku: false, length: 5, fixed: false },
    { no: 4, name: "提出義務者の住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 5, name: "提出義務者の氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 6, name: "提出義務者の電話番号", zenkaku: false, length: 15, fixed: false },
    { no: 7, name: "整理番号 2", zenkaku: false, length: 13, fixed: true },
    { no: 8, name: "提出者の住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 9, name: "提出者の氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 10, name: "訂正表示", zenkaku: false, length: 1, fixed: true },
    { no: 11, name: "年分", zenkaku: false, length: 2, fixed: true },
    { no: 12, name: "住所又は居所", zenkaku: true, length: 60, fixed: false },
    { no: 13, name: "支払を受ける者 国外住所表示", zenkaku: false, length: 1, fixed: true },
    { no: 14, name: "氏名", zenkaku: true, length: 30, fixed: false },
    { no: 15, name: "法 201 条 第 1 項第 1 号 適用分 支払金額", zenkaku: false, length: 10, fixed: false },
    { no: 16, name: "法 201 条 第 1 項第 1 号 適用分 源泉徴収税額", zenkaku: false, length: 10, fixed: false },
    { no: 17, name: "法 201 条 第 1 項第 1 号 適用分 市町村民税", zenkaku: false, length: 10, fixed: false },
    { no: 18, name: "法 201 条 第 1 項第 1 号 適用分 道府県民税", zenkaku: false, length: 10, fixed: false },
    { no: 19, name: "法 201 条第 1 項第 2 号適用分 支払金額", zenkaku: false, length: 10, fixed: false },
    { no: 20, name: "法 201 条第 1 項第 2 号適用分 源泉徴収税額", zenkaku: false, length: 10, fixed: false },
    { no: 21, name: "法 201 条第 1 項第 2 号適用分 市町村民税", zenkaku: false, length: 10, fixed: false },
    { no: 22, name: "法 201 条第 1 項第 2 号適用分 道府県民税", zenkaku: false, length: 10, fixed: false },
    { no: 23, name: "法 201 条第 3 項適用分 支払金額", zenkaku: false, length: 10, fixed: false },
    { no: 24, name: "法 201 条第 3 項適用分 源泉徴収税額", zenkaku: false, length: 10, fixed: false },
    { no: 25, name: "法 201 条第 3 項適用分 市町村民税", zenkaku: false, length: 10, fixed: false },
    { no: 26, name: "法 201 条第 3 項適用分 道府県民税", zenkaku: false, length: 10, fixed: false },
    { no: 27, name: "退職所得控除額", zenkaku: false, length: 10, fixed: false },
    { no: 28, name: "勤続年数", zenkaku: false, length: 2, fixed: false },
    { no: 29, name: "就職年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 30, name: "就職年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 31, name: "就職年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 32, name: "退職年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 33, name: "退職年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 34, name: "退職年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 35, name: "役職名", zenkaku: true, length: 15, fixed: false },
    { no: 36, name: "摘要", zenkaku: true, length: 300, fixed: false },
    { no: 37, name: "提出義務者の個人番号又は法人番号", zenkaku: false, length: 13, fixed: true },
    { no: 38, name: "支払を受ける者の個人番号", zenkaku: false, length: 13, fixed: true },
    { no: 39, name: "適用分 番号", zenkaku: false, length: 1, fixed: true },
    { no: 40, name: "番号", zenkaku: false, length: 1, fixed: true },
    { no: 41, name: "法 201 条第 3 項適用分 番号", zenkaku: false, length: 1, fixed: true },
  ],
  /** 退職手当金等受給者別支払調書（36項目） */
  "325": [
    { no: 1, name: "法定資料の種類", zenkaku: false, length: 3, fixed: true },
    { no: 2, name: "整理番号 1", zenkaku: false, length: 10, fixed: true },
    { no: 3, name: "本支店等区分番号", zenkaku: false, length: 5, fixed: false },
    { no: 4, name: "提出義務者の住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 5, name: "提出義務者の氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 6, name: "提出義務者の電話番号", zenkaku: false, length: 15, fixed: false },
    { no: 7, name: "整理番号 2", zenkaku: false, length: 13, fixed: true },
    { no: 8, name: "提出者の住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 9, name: "提出者の氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 10, name: "訂正表示", zenkaku: false, length: 1, fixed: true },
    { no: 11, name: "住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 12, name: "退職者 国外住所表示", zenkaku: false, length: 1, fixed: true },
    { no: 13, name: "氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 14, name: "住所(居所)又は所在地", zenkaku: true, length: 50, fixed: false },
    { no: 15, name: "受給者 国外住所表示", zenkaku: false, length: 1, fixed: true },
    { no: 16, name: "氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 17, name: "退職手当金等の種類", zenkaku: true, length: 15, fixed: false },
    { no: 18, name: "退職手当金等の給与金額", zenkaku: false, length: 10, fixed: false },
    { no: 19, name: "退職年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 20, name: "退職年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 21, name: "退職年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 22, name: "退職時の地位職務", zenkaku: true, length: 15, fixed: false },
    { no: 23, name: "受給者と退職者との続柄", zenkaku: true, length: 15, fixed: false },
    { no: 24, name: "支払年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 25, name: "支払年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 26, name: "支払年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 27, name: "退職者の死亡年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 28, name: "退職者の死亡年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 29, name: "退職者の死亡年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 30, name: "提出年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 31, name: "提出年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 32, name: "提出年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 33, name: "摘要", zenkaku: true, length: 100, fixed: false },
    { no: 34, name: "提出義務者の個人番号又は法人番号", zenkaku: false, length: 13, fixed: true },
    { no: 35, name: "受給者の個人番号又は法人番号", zenkaku: false, length: 13, fixed: true },
    { no: 36, name: "退職者の個人番号又は法人番号", zenkaku: false, length: 13, fixed: true },
  ],
  /** 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（48項目） */
  "339": [
    { no: 1, name: "法定資料の種類", zenkaku: false, length: 3, fixed: true },
    { no: 2, name: "整理番号 1", zenkaku: false, length: 10, fixed: true },
    { no: 3, name: "本支店等区分番号", zenkaku: false, length: 5, fixed: false },
    { no: 4, name: "提出義務者の住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 5, name: "提出義務者の氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 6, name: "提出義務者の電話番号", zenkaku: false, length: 15, fixed: false },
    { no: 7, name: "整理番号 2", zenkaku: false, length: 13, fixed: true },
    { no: 8, name: "提出者の住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 9, name: "提出者の氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 10, name: "訂正表示", zenkaku: false, length: 1, fixed: true },
    { no: 11, name: "年分", zenkaku: false, length: 2, fixed: true },
    { no: 12, name: "住所(居所)又は所在地", zenkaku: true, length: 60, fixed: false },
    { no: 13, name: "国外住所表示", zenkaku: false, length: 1, fixed: true },
    { no: 14, name: "国内納税地", zenkaku: true, length: 60, fixed: false },
    { no: 15, name: "氏名又は名称", zenkaku: true, length: 30, fixed: false },
    { no: 16, name: "支払内容 (1) 区分", zenkaku: true, length: 30, fixed: false },
    { no: 17, name: "支払内容 (1) 計算の基礎", zenkaku: true, length: 30, fixed: false },
    { no: 18, name: "支払内容 (1) 支払金額", zenkaku: false, length: 12, fixed: false },
    { no: 19, name: "支払内容 (1) 支払金額(内書)", zenkaku: false, length: 12, fixed: false },
    { no: 20, name: "支払内容 (1) 源泉徴収税額", zenkaku: false, length: 12, fixed: false },
    { no: 21, name: "支払内容 (2) 区分", zenkaku: true, length: 30, fixed: false },
    { no: 22, name: "支払内容 (2) 計算の基礎", zenkaku: true, length: 30, fixed: false },
    { no: 23, name: "支払内容 (2) 支払金額", zenkaku: false, length: 12, fixed: false },
    { no: 24, name: "支払内容 (2) 支払金額(内書)", zenkaku: false, length: 12, fixed: false },
    { no: 25, name: "支払内容 (2) 源泉徴収税額", zenkaku: false, length: 12, fixed: false },
    { no: 26, name: "支払内容 (3) 区分", zenkaku: true, length: 30, fixed: false },
    { no: 27, name: "支払内容 (3) 計算の基礎", zenkaku: true, length: 30, fixed: false },
    { no: 28, name: "支払内容 (3) 支払金額", zenkaku: false, length: 12, fixed: false },
    { no: 29, name: "支払内容 (3) 支払金額(内書)", zenkaku: false, length: 12, fixed: false },
    { no: 30, name: "支払内容 (3) 源泉徴収税額", zenkaku: false, length: 12, fixed: false },
    { no: 31, name: "支払内容 (4) 区分", zenkaku: true, length: 30, fixed: false },
    { no: 32, name: "支払内容 (4) 計算の基礎", zenkaku: true, length: 30, fixed: false },
    { no: 33, name: "支払内容 (4) 支払金額", zenkaku: false, length: 12, fixed: false },
    { no: 34, name: "支払内容 (4) 支払金額(内書)", zenkaku: false, length: 12, fixed: false },
    { no: 35, name: "支払内容 (4) 源泉徴収税額", zenkaku: false, length: 12, fixed: false },
    { no: 36, name: "住所又は居所", zenkaku: true, length: 60, fixed: false },
    { no: 37, name: "氏名", zenkaku: true, length: 30, fixed: false },
    { no: 38, name: "退職所得控除額", zenkaku: false, length: 9, fixed: false },
    { no: 39, name: "勤続年数", zenkaku: false, length: 2, fixed: false },
    { no: 40, name: "就職年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 41, name: "就職年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 42, name: "就職年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 43, name: "退職年月日 年", zenkaku: false, length: 2, fixed: true },
    { no: 44, name: "退職年月日 月", zenkaku: false, length: 2, fixed: true },
    { no: 45, name: "退職年月日 日", zenkaku: false, length: 2, fixed: true },
    { no: 46, name: "摘要", zenkaku: true, length: 100, fixed: false },
    { no: 47, name: "提出義務者の個人番号又は法人番号", zenkaku: false, length: 13, fixed: true },
    { no: 48, name: "支払を受ける者の個人番号又は法人番号", zenkaku: false, length: 13, fixed: true },
  ],
};

/** 「退職所得の受給に関する申告書」の提出がないとき：支払金額にかける率（[分子, 分母]。100 分の 20.42。
 *  所得税 20％ に速算表の「×102.1％」をかけた率であることを確かめた） */
export const TAISHOKU_NO_DECLARATION_RATE = [2042, 10000] as [number, number];

/** 退職所得の源泉徴収票の「④ 番号」（手引 第3章「●退職手当等の区分」。いずれにも該当しなければ空欄。benefit の番号は、摘要に経済的利益の価額を書く） */
export const TAISHOKU_SLIP_NUMBERS: { code: string; label: string; benefit: boolean }[] = [{"code": "1", "label": "所得税法第31条の規定により退職手当等とみなされる一時金（「2」の一時金を除く）の場合", "benefit": false}, {"code": "2", "label": "確定拠出型年金（DC）の老齢給付金として支払われる一時金の場合", "benefit": false}, {"code": "3", "label": "特定譲渡制限付株式又は承継譲渡制限付株式の譲渡についての制限が解除されたことにより受けた経済的利益（譲渡制限株式（RS）に係る経済的利益）に該当する場合", "benefit": false}, {"code": "4", "label": "発行法人から与えられた有利な条件等により発行された新株予約権等の行使により取得した株式の取得に係る経済的利益（ストックオプション（SO）権利行使益）に該当する場合", "benefit": false}, {"code": "5", "label": "一般的退職手当等と「3」の経済的利益の合計から成る場合", "benefit": true}, {"code": "6", "label": "一般的退職手当等と「4」の経済的利益の合計から成る場合", "benefit": true}, {"code": "7", "label": "一般的退職手当等と「3」の経済的利益と「4」の経済的利益の合計から成る場合", "benefit": true}];

/** 退職手当金等受給者別支払調書・同合計表の「元号」欄に書く数字（記載要領） */
export const TAISHOKU_REPORT_ERA_CODES: Record<string, string> = {"令和": "5", "平成": "4"};

export interface TaishokuBracket {
  /** 課税退職所得金額がこの額以下（最後の行は null） */
  upTo: number | null;
  /** 所得税率（％） */
  rate: number;
  /** 控除額（円） */
  deduction: number;
}

export interface TaishokuQuickTable {
  year: number;
  title: string;
  source: string;
  /** 税額 ＝（課税退職所得金額 × 税率 − 控除額）× multiplier（[分子, 分母]。102.1％）。1円未満の端数は切り捨て */
  multiplier: [number, number];
  brackets: TaishokuBracket[];
}

/** 退職所得の源泉徴収税額の速算表（年分ごと） */
export const TAISHOKU_QUICK_TABLES: TaishokuQuickTable[] = [
  {
    year: 2026,
    title: "退職所得の源泉徴収税額の速算表（令和8年分）",
    source: "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf",
    multiplier: [1021, 1000],
    brackets: [
      { upTo: 1950000, rate: 5, deduction: 0 },
      { upTo: 3300000, rate: 10, deduction: 97500 },
      { upTo: 6950000, rate: 20, deduction: 427500 },
      { upTo: 9000000, rate: 23, deduction: 636000 },
      { upTo: 18000000, rate: 33, deduction: 1536000 },
      { upTo: 40000000, rate: 40, deduction: 2796000 },
      { upTo: null, rate: 45, deduction: 4796000 },
    ],
  },
  {
    year: 2027,
    title: "退職所得の源泉徴収税額の速算表（令和9年分）",
    source: "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/18.pdf",
    multiplier: [1021, 1000],
    brackets: [
      { upTo: 1950000, rate: 5, deduction: 0 },
      { upTo: 3300000, rate: 10, deduction: 97500 },
      { upTo: 6950000, rate: 20, deduction: 427500 },
      { upTo: 9000000, rate: 23, deduction: 636000 },
      { upTo: 18000000, rate: 33, deduction: 1536000 },
      { upTo: 40000000, rate: 40, deduction: 2796000 },
      { upTo: null, rate: 45, deduction: 4796000 },
    ],
  },
];
