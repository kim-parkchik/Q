# 税額表の元データ

## 出典・利用条件

このフォルダの Excel ファイルと PDF ファイルは、国税庁が公開しているものです。
国税庁ホームページのコンテンツは、[国税庁の利用規約](https://www.nta.go.jp/chuijiko/copy.htm)（公共データ利用規約に準拠）により、
出典を記載すれば複製・加工・再配布（商用を含む）ができます。

- 出典：国税庁ホームページ（下の表の各URL）
- `src/constants/tax/monthlyTable20XX.ts`・`src/constants/tax/dailyHeiTable20XX.ts`・`src/constants/tax/bonusTaxTable20XX.ts` は、これらの Excel を、
  `src/constants/tax/densanki20XX.ts` は、これらの PDF を加工して作成したものです。
- これらのファイルは Q 本体のライセンス（AGPL-3.0）ではなく、国税庁の利用規約に従います。
- Q は国税庁が作成・保証するものではありません。

国税庁が配布している「給与所得の源泉徴収税額表（月額表・日額表）」と「賞与に対する源泉徴収税額の算出率の表」の Excel ファイルです。
Q の月額表データ（`src/constants/tax/monthlyTable20XX.ts`）、日額表の丙欄データ（`src/constants/tax/dailyHeiTable20XX.ts`）と賞与の算出率データ（`src/constants/tax/bonusTaxTable20XX.ts`）は、ここから自動で作っています。
Q の給与は月ごとに払うので、日額表は丙欄（日雇賃金）だけを使います。

| ファイル | 内容 | 入手元 | SHA-256 |
|---|---|---|---|
| 月額表_令和9年分.xlsx | 2027年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm （data/01-07.xlsx） | `f2f331de1207ae0da6a3f416c7ad233de9411b0210a65e928c39527f1791fea5` |
| 月額表_令和8年分.xls | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm | `50aafa072df1bb6b6aa253a021f7cc246265c3f2393f9988ee01ad121bc4f310` |
| 月額表_令和7年分.xls | 2025年分（令和6年分と同じ税額） | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm | `fc3ec9a187ce7754cc68e7c068e4207fb3995430b492a9967080d45c1b28f651` |
| 日額表_令和9年分.xls | 2027年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm （data/08-14.xls） | `2e9e3f66ec6c7a463ed419d7cec3383177e2cef00e8f6e28ec62b08155ec6db5` |
| 日額表_令和8年分.xls | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm （data/08-14.xls） | `7b3a9e9a3c9da51913d59bebb27b07691b4bbe6742eb2e38a948aaac5eaf0c90` |
| 日額表_令和7年分.xls | 2025年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm （data/08-14.xls） | `0a69331994ee089939bf2a082b1a1037c7fa43408e04b2fc4f2f60ecb65d1ccd` |
| 賞与算出率表_令和9年分.xls | 2027年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm （data/15-16.xls） | `8acbf38e76bf41584ab90ff1cd663ed688c9b468fb0b1f68498934ca2a78e6bf` |
| 賞与算出率表_令和8年分.xls | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm （data/15-16.xls） | `e74e6ba66623b67d8d478dfcc8187f702742e6e75554feebd948dd5b7beea9cf` |
| 賞与算出率表_令和7年分.xls | 2025年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2024/02.htm （data/15-16.xls） | `ede4e6b05e0909ae90d870e6cf6666206f7068ecbc152e8b4a488cafc8369471` |

※ 国税庁のページによると、令和2年1月以後、令和7年分までの「税額」は改正されていません。そのため 2025年以前の給与・賞与には令和7年分の表を使います。
※ 令和9年分は、令和8年度税制改正（所得税の基礎控除の引上げ等）で税額が変わっています（国税庁の令和9年分 源泉徴収税額表のページ）。
令和9年分の Excel は2026年11月7日に取得しました。令和9年分から、月額表の Excel は .xlsx になりました（Python の標準ライブラリだけで読みます）。

### 電算機計算の特例（PDF）

月額表の甲欄の代わりに使える計算式（「月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」）です。
Q の電算機計算の特例のデータ（`src/constants/tax/densanki20XX.ts`）は、ここから自動で作っています。
2026年11月7日に取得しました（ファイル名は、Q で分かりやすいように付け直したものです）。

| ファイル | 内容 | 入手元 | SHA-256 |
|---|---|---|---|
| 電算機計算の特例_令和9年分以降.pdf | 2027年分から（令和9年分以降） | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/denshi_01.pdf | `58c7c11f8ac4ed82db0029464f0540eba08f89f4a89df68d99e295e8b447154d` |
| 電算機計算の特例_令和8年分.pdf | 2026年分 | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf | `6206a15c97aa4fa1ed0945a2c24aeaf920efe1a7e453a28f8b4854d33bb9ac22` |
| 電算機計算の特例_令和3年から令和7年分.pdf | 2021〜2025年分（令和3年～令和7年分） | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2022/data/denshi_10.pdf | `e01bc3788a5b14c020d27b06da4299885b59b773187aeff721d1ed9cfa114082` |
| 電算機計算の特例_令和2年分.pdf | 2020年分（国税庁「[過去分のパンフレット・手引（源泉所得税関係）](https://www.nta.go.jp/publication/pamph/kakobun/gensen/01.htm)」に掲載） | https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2019/data/01.pdf | `01d3c468e2b9dffc34e3796801cb1df25832caf903e51c6810d9fdb613f8fd64` |

PDF の文字は、macOS の PDFKit で取り出します（`scripts/pdf_to_text.swift`。追加のインストールは要りません）。

```
python3 -I scripts/import_densanki.py tax-tables/電算機計算の特例_令和9年分以降.pdf 2027 src/constants/tax/densanki2027.ts https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/denshi_01.pdf
python3 -I scripts/import_densanki.py tax-tables/電算機計算の特例_令和8年分.pdf 2026 src/constants/tax/densanki2026.ts https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf
python3 -I scripts/import_densanki.py tax-tables/電算機計算の特例_令和3年から令和7年分.pdf 2025 src/constants/tax/densanki2025.ts https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2022/data/denshi_10.pdf
python3 -I scripts/import_densanki.py tax-tables/電算機計算の特例_令和2年分.pdf 2020 src/constants/tax/densanki2020.ts https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2019/data/01.pdf
```

- 第1表〜第4表の金額・率・控除額と、使える年（「令和○年分」「令和○年～令和○年分」「令和○年分以降」）は、すべて PDF の文字から機械的に読み取ります（全角は半角にします）。
- 表の行が切れ目なく並んでいない、行の境目で給与所得控除の額・税額が大きくとぶ、第1表〜第3表の額が「1年の額（1万円単位）÷ 12（1円未満切り上げ）」になっていない、
  端数の決まり（1円未満切り上げ・10円未満四捨五入）が書いていない、PDF の計算例（3つ）の税額と合わないときは、止まります（中途半端なデータは作りません）。
- 計算例はデータファイルにも入れ、`bun test` で、Q の計算が「特例計算による税額」と「月額表甲欄の税額」の両方と同じになるかを確かめます（`src/utils/incomeTax.test.ts`）。
- 月額表の税額は、行の金額の真ん中で計算してあります。そこで `bun test` では、月額表の行の真ん中の金額で、式と月額表の差がほとんど（95%以上）10円以内、どれも100円以内になることも確かめます（月額表の Excel と電算機計算の特例の PDF を照らし合わせるため）。
- 令和3年～令和7年分の PDF には「令和2年分以前の給与等には使用できません」とあるので、2020年分は令和2年分の PDF を使います（表の数字は令和3年～令和7年分と同じで、テストでも確かめています）。2020年分の月額表・日額表・賞与の表は、令和7年分と同じものを使います（`src/constants/tax/tax2020.ts`）。

## 新しい年の表を追加するとき

1. 国税庁のページから月額表・日額表・賞与の算出率の表の Excel と、電算機計算の特例の PDF をダウンロードして、このフォルダに置く
   （電算機計算の特例は、令和9年分の資料が「令和9年分以降」なので、新しい PDF が出ていなければ、前の資料をそのまま使う）
2. データファイルを作る（例は令和10年分）

   ```
   pip install xlrd
   python3 scripts/import_monthly_tax_table.py tax-tables/月額表_令和10年分.xlsx 2028 src/constants/tax/monthlyTable2028.ts <国税庁のページのURL>
   python3 scripts/import_daily_tax_table.py tax-tables/日額表_令和10年分.xls 2028 src/constants/tax/dailyHeiTable2028.ts <国税庁のページのURL>
   python3 scripts/import_bonus_tax_table.py tax-tables/賞与算出率表_令和10年分.xls 2028 src/constants/tax/bonusTaxTable2028.ts <国税庁のページのURL>
   python3 -I scripts/import_densanki.py tax-tables/電算機計算の特例_令和10年分.pdf 2028 src/constants/tax/densanki2028.ts <PDF のURL>
   ```

   xlrd は .xls を読むときだけ要ります（.xlsx は Python の標準ライブラリだけで読みます）。

3. `src/constants/tax/tax2028.ts` を作り、`src/constants/tax/index.ts` の `getTaxMaster` と `TAX_TABLE_LAST_YEAR` を直す
4. `bun test` で確認する（`src/utils/incomeTax.test.ts` の電算機計算の特例の計算例・年の切り替えのテストと、`src/utils/socialInsurance.test.ts` の「登録済み」のテストに、新しい年を足す）
5. この README の表（ファイル名・入手元・SHA-256）を直す

※ 数字を手やAIで書き写さないこと（以前、AIが作った架空の税額表が混ざっていたことがあります）。
