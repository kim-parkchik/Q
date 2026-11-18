/**
 * 現物で払う食事・社宅の所得税の決まり（給与として課税しない条件と、社宅の賃貸料相当額）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_genbutsu_tax.py genbutsu-tables/source koyo-format/source/001738607.pdf src/constants/genbutsuTax.ts
 *           （入手元は genbutsu-tables/README.md・koyo-format/README.md）
 * 元データ:
 *   source/ta2594.htm（SHA-256 67905d1c726f7d2c2255c0d91443f9205a43d6dd9c3ae2724e368a8373efe193）
 *     https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2594.htm
 *   source/ta2597.htm（SHA-256 581fa9a4dd87c941513762af298ffd6151b861f8eb502801ef94149c88271f1e）
 *     https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2597.htm
 *   source/ta2600.htm（SHA-256 44422764a9787148797596bb2d114f0a9d13a40d03eb57f9a0a813387631ecb4）
 *     https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm
 *   koyo-format/source/001738607.pdf（SHA-256 ab6ca0ee4f7ccdb354ba71980198db56b701e0080132031ae9da23acc8980b7c）
 */

/** タックスアンサーの「令和○年○月○日現在法令等」の日（Q は、この日の月の分から、この決まりで計算する） */
export const GENBUTSU_TAX_SINCE = "2026-04-01";

/** 食事（No.2594）：本人が食事の価額の selfShare 以上を払い、（食事の価額 − 本人が払う額）が1か月当たり monthlyLimit 円
 *  （消費税を除く。roundTo 円未満の端数は切り捨て）以下なら課税しない。満たさなければ、食事の価額 − 本人が払う額が課税される */
export const MEAL_TAX = {
  selfShare: [1, 2] as [number, number],
  monthlyLimit: 7500,
  roundTo: 10,
  /** 消費税の率（％。軽減税率・標準税率） */
  rates: { reduced: 8, standard: 10 },
} as const;

/** 社宅（No.2597・No.2600）：賃貸料相当額（1か月）＝ 建物の課税標準額 × building ＋ perArea 円 ×（総床面積 ÷ areaUnit ㎡）＋ 敷地の課税標準額 × land */
export const HOUSING_TAX = {
  building: [2, 1000] as [number, number],
  perArea: 12,
  areaUnit: [33, 10] as [number, number],
  land: [22, 10000] as [number, number],
  /** 使用人：本人が賃貸料相当額の employeeShare 以上を払えば課税しない（No.2597） */
  employeeShare: [50, 100] as [number, number],
  /** 役員（No.2600）：小規模な住宅（法定耐用年数 lifeYears 年以下は smallArea.short ㎡以下、超えるものは smallArea.long ㎡以下）は上の式。
   *  それ以外は（建物 × building ＋ 敷地 × land）÷ months。借り上げは、家主に払う家賃 × leasedShare と比べて多い方。
   *  床面積が luxuryArea ㎡を超えるものは、豪華社宅（時価）かどうかを確かめる */
  officer: {
    lifeYears: 30,
    smallArea: { short: 132, long: 99 },
    building: { short: [12, 100] as [number, number], long: [10, 100] as [number, number] },
    land: [6, 100] as [number, number],
    months: 12,
    leasedShare: [50, 100] as [number, number],
    luxuryArea: 240,
  },
} as const;

/** 雇用保険（手引き 第2編「賃金の範囲に算入される現物給与とは」）：代金を徴収する現物給与は原則として賃金にならないが、
 *  徴収金額が実際費用の share を下回るときは、実際費用 × share と徴収金額との差額を賃金にする */
export const EMP_IN_KIND = {
  share: [1, 3] as [number, number],
} as const;
