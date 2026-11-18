# 現物給与の価額（食事・住宅）の元データ

Q の現物で払った報酬（食事・住宅）の価額（`src/utils/genbutsu.ts`）に使う「厚生労働大臣が定める現物給与の価額」は、
日本年金機構の「全国現物給与価額一覧表」の PDF から、スクリプトで読み取って `src/constants/genbutsu.ts` に作っています（手で書き写していません）。

## 出典

日本年金機構「全国現物給与価額一覧表（厚生労働大臣が定める現物給与の価額）」
https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150511.html と、
「過去の現物給与価額一覧表」 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.html の PDF。
令和8年度の表は、厚生労働省「現物給与の価額改定について（令和８年度）」の表とも比べています。

| 置く場所 | 内容 | 入手元 | 大きさ（バイト） | SHA-256 |
|---|---|---|---|---|
| source/2019.pdf | 平成31年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/2019.pdf | 204,289 | `6f690f9f1bab99afa60c1d49ea12f553e3863187d99a3fb2d69fa9a6f50cf2dd` |
| source/2020.pdf | 令和2年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/2020.pdf | 1,427,367 | `40ad346b2d5e75ffcc4e2a2e334db0380f930efc83dfd44952d8548f12938a64` |
| source/2021.pdf | 令和3年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/2021.pdf | 357,849 | `0745f7297d3a7469650dbdb72a78bd15991ea1c12cb689d1991ed53662a24893` |
| source/2022.pdf | 令和4年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/2022.pdf | 359,622 | `1fae05c3797c754e4b56497067046188fe70591a843ecbc03b203098d6ff80db` |
| source/2023.pdf | 令和5年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/2023.pdf | 359,286 | `19a7d994b7321d52af508939e35afb2cb3cd54b752917c9bd2e902ee4817dbc6` |
| source/2024.pdf | 令和6年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/2024.pdf | 371,710 | `27a1c288fc9ca623fa344c98b65c6be05bb22ae36b6fa3b54c54da2ed6bb18ce` |
| source/2025.pdf | 令和7年4月から | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150511.files/2025.pdf | 441,086 | `4699f014362d49b25b95271c55e8fff6951612e6aa2c511c0a9cd0f27c46736e` |
| source/2026.pdf | 令和8年4月から（食事は令和8年4月1日から、住宅は令和8年10月1日から） | https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150511.files/2026.pdf | 3,428,033 | `4522c6609f4ff77e9b90494af9b75431239d5ded56b73eb7248247008f5e678b` |
| source/001677803.pdf | 厚生労働省「現物給与の価額改定について（令和８年度）」 | https://www.mhlw.go.jp/content/001677803.pdf | 177,705 | `c340463a4ea2741e65b7c5649dba8980883e659712bbcc07880b32c73cfaa301` |

2026年11月15日に取得しました（ユーザーの許しを得て取得）。

**PDF は合わせて約7MB なので、リポジトリには入れていません**（`source/` は .gitignore）。
作り直すときは、上の入手元から取ってきて `source/` に置き、SHA-256 を確かめてください（違えば、PDF が差し替えられたので、中身を読んでから作り直します）。
平成31年4月からの表は、Q が扱う2020年3月分（令和2年4月の改正の前の月）のために使います。

## データの作り方

追加のインストールは要りません（Python の標準ライブラリと、macOS の PDFKit（`scripts/pdf_to_text.swift`）だけで動きます）。

```
python3 -I scripts/import_genbutsu_values.py genbutsu-tables/source src/constants/genbutsu.ts
```

都道府県の名前（`src/constants/prefectures.ts` の順）ごとに、その後ろの数字（1人1月当たりの食事の額・1人1日当たりの食事の額・
朝食のみ・昼食のみ・夕食のみの額・住宅の利益の額）を読みます。令和8年度は、住宅の額が【R8.9.30まで】（畳1畳につき）と
【R8.10.1から】（総面積1平方メートルにつき）の2つあるので、令和8年4月からと令和8年10月からの2つの期間にします。

令和2年4月からの表（2020.pdf）は、PDF に字の形の情報がなく日本語を取り出せないので、数字の並び
（47都道府県の「1月・1日」の組、朝食、昼食、注の「1.65」「1」、夕食、住宅）で読みます。
読み方が合っていることは、令和3年度の Q&A の「43都道府県において、食事の現物給与価額が…変更」と、
令和2年度と令和3年度の表を比べて食事の額が変わった都道府県の数（43）が同じことなどで確かめています。

スクリプトは、次のときにファイルを作らずに止まります。

- 見出しの「平成31年4月から」「令和○年4月から」が、ファイルの年と合わない
- 47都道府県のどれかが見つからない・数字が足りない・数字でない・数字のあいだにほかの字がある
- 1人1月当たりの食事の額が1日当たりの額の30倍でない、1日当たりの額が朝食・昼食・夕食の額の合計でない
- Q&A の「どこが変更になったのか」の都道府県の数（「43都道府県において、食事の…」「全ての都道府県において、住宅の…」など）と、
  前の年の表と比べて額が変わった都道府県の数が違う。Q&A に住宅が書いていない年なのに、住宅の額が前の年と違う
- 令和8年度の【R8.9.30まで】の住宅の額が令和7年度と違う。令和2年度の住宅の額が平成31年度と違う
- 令和8年度の表が、日本年金機構の PDF と厚生労働省のお知らせで違う
- Q&A の計算例（東京に所在する事業所の場合）の食事の1か月の額・住宅の1畳（令和8年度は1平方メートルも）の額が、読んだ表の東京の額と違う

## 気をつけること

- 京都の令和8年度の住宅（畳1畳につき）の額は、日本年金機構の PDF も厚生労働省のお知らせも「1.810」と点で書いてあるので、
  3けたの区切りとして 1,810 と読みます（令和7年度と同じ額。住宅の額は令和8年9月30日まで変わらないので、上の確かめで合っていることがわかります）。
- 健康保険組合は、規約で別の価額を決めていることがあります（Q は、この表の価額で計算します）。
- 食事・住宅以外の現物（自社製品・通勤定期券など）は時価なので、この表にはありません。

## 食事・社宅の所得税の決まり（`src/constants/genbutsuTax.ts`）

現物で払う食事・社宅に所得税がかかるかどうかと、かかる額の決まり（給与として課税しない条件・社宅の賃貸料相当額の計算）は、
国税庁のタックスアンサーの HTML から、スクリプトで読み取って `src/constants/genbutsuTax.ts` に作っています。
雇用保険の賃金に入れる現物（代金を取っていても、実際費用の3分の1を下回る分は賃金）も、厚生労働省「雇用保険事務手続きの手引き【第２編】」
（`koyo-format/source/001738607.pdf`。入手元は koyo-format/README.md）から読みます。

| 置く場所 | 内容 | 入手元 | 大きさ（バイト） | SHA-256 |
|---|---|---|---|---|
| source/ta2594.htm | タックスアンサー No.2594「食事を支給したとき」（令和8年4月1日現在法令等） | https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2594.htm | 15,845 | `67905d1c726f7d2c2255c0d91443f9205a43d6dd9c3ae2724e368a8373efe193` |
| source/ta2597.htm | タックスアンサー No.2597「使用人に社宅や寮などを貸したとき」 | https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2597.htm | 16,039 | `581fa9a4dd87c941513762af298ffd6151b861f8eb502801ef94149c88271f1e` |
| source/ta2600.htm | タックスアンサー No.2600「役員に社宅などを貸したとき」 | https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm | 17,759 | `44422764a9787148797596bb2d114f0a9d13a40d03eb57f9a0a813387631ecb4` |

2026年11月18日に取得しました（ユーザーの許しを得て取得）。HTML もリポジトリには入れていません（`source/` は .gitignore）。

```
python3 -I scripts/import_genbutsu_tax.py genbutsu-tables/source koyo-format/source/001738607.pdf src/constants/genbutsuTax.ts
```

読むもの：食事の「本人が半分以上を負担」「1か月当たり7,500円（消費税を除く）以下」「10円未満の端数は切り捨て」と軽減税率・標準税率の率、
社宅の賃貸料相当額（建物の課税標準額 × 0.2％ ＋ 12円 ×（総床面積 ÷ 3.3㎡）＋ 敷地の課税標準額 × 0.22％）と使用人の「50パーセント以上」、
役員の小規模な住宅（法定耐用年数30年以下は132㎡以下・30年超は99㎡以下）・それ以外の（建物 × 12％（30年超は10％）＋ 敷地 × 6％）÷ 12・
借り上げの家賃の50％・豪華社宅の240㎡、手引きの「実際費用の3分の1」。

スクリプトは、言い回しが見つからない、3つのタックスアンサーの「現在法令等」の日が違う、具体例（No.2594：13,000円と6,000円 → 7,000円、
No.2597：10,000円の社宅で3,000円 → 7,000円・6,000円 → 課税しない）が読んだ決まりで計算した結果と合わない、No.2600 の小規模な住宅の式が
No.2597 と違う、手引きの「3分の1」が3か所で違うときに止まります。Q は、タックスアンサーの「現在法令等」の日（令和8年4月1日）の月の分から
この決まりで計算し、それより前の月は入れた額を使います（食事の7,500円は令和8年4月からの額。それより前の額は、この資料にありません）。
