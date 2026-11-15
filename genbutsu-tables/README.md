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
