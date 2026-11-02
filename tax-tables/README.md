# 税額表の元データ

## 出典・利用条件

このフォルダの Excel ファイルは、国税庁が公開しているものです。
国税庁ホームページのコンテンツは、[国税庁の利用規約](https://www.nta.go.jp/chuijiko/copy.htm)（公共データ利用規約に準拠）により、
出典を記載すれば複製・加工・再配布（商用を含む）ができます。

- 出典：国税庁ホームページ（下の表の各URL）
- `src/constants/tax/monthlyTable20XX.ts`・`src/constants/tax/dailyHeiTable20XX.ts`・`src/constants/tax/bonusTaxTable20XX.ts` は、これらの Excel を加工して作成したものです。
- これらのファイルは Q 本体のライセンス（AGPL-3.0）ではなく、国税庁の利用規約に従います。
- Q は国税庁が作成・保証するものではありません。

国税庁が配布している「給与所得の源泉徴収税額表（月額表・日額表）」と「賞与に対する源泉徴収税額の算出率の表」の Excel ファイルです。
Q の月額表データ（`src/constants/tax/monthlyTable20XX.ts`）、日額表の丙欄データ（`src/constants/tax/dailyHeiTable20XX.ts`）と賞与の算出率データ（`src/constants/tax/bonusTaxTable20XX.ts`）は、ここから自動で作っています。
Q の給与は月ごとに払うので、日額表は丙欄（日雇賃金）だけを使います。

| ファイル | 内容 | 入手元 |
|---|---|---|
| 月額表_令和8年分.xls | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm |
| 月額表_令和7年分.xls | 2025年分（令和6年分と同じ税額） | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm |
| 日額表_令和8年分.xls | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm （data/08-14.xls） |
| 日額表_令和7年分.xls | 2025年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm （data/08-14.xls） |
| 賞与算出率表_令和8年分.xls | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm （data/15-16.xls） |
| 賞与算出率表_令和7年分.xls | 2025年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm （data/15-16.xls） |

※ 国税庁のページによると、令和2年1月以後、令和7年分までの「税額」は改正されていません。そのため 2025年以前の給与・賞与には令和7年分の表を使います。

## 新しい年の表を追加するとき

1. 国税庁のページから月額表・日額表・賞与の算出率の表の Excel をダウンロードして、このフォルダに置く
2. データファイルを作る

   ```
   pip install xlrd
   python3 scripts/import_monthly_tax_table.py tax-tables/月額表_令和9年分.xls 2027 src/constants/tax/monthlyTable2027.ts <国税庁のページのURL>
   python3 scripts/import_daily_tax_table.py tax-tables/日額表_令和9年分.xls 2027 src/constants/tax/dailyHeiTable2027.ts <国税庁のページのURL>
   python3 scripts/import_bonus_tax_table.py tax-tables/賞与算出率表_令和9年分.xls 2027 src/constants/tax/bonusTaxTable2027.ts <国税庁のページのURL>
   ```

3. `src/constants/tax/tax2027.ts` を作り、`src/constants/tax/index.ts` の `getTaxMaster` に追加する
4. `bun test` で確認する

※ 数字を手やAIで書き写さないこと（以前、AIが作った架空の税額表が混ざっていたことがあります）。
