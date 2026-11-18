# 労働保険の年度更新の元データ

Q の労働保険の年度更新（確定保険料・一般拠出金算定基礎賃金集計表と、労働保険概算・確定保険料申告書に書く金額。`src/utils/nendoKoshin.ts`）で使う
労災保険率（事業の種類ごと）と一般拠出金率は、厚生労働省の PDF から、スクリプトで読み取って `src/constants/insurance/rousaiRates.ts` に作っています
（手で書き写していません）。雇用保険率は、給与計算で使っている `src/constants/insurance/laborInsuranceRates.ts` の率です。

計算のしかた（千円未満の切り捨て・1円未満の切り捨て・算定基礎額が同じときの率の合計・延納・充当・常時使用労働者数）は、
下の「申告書の書き方」によります（記入例の額と同じになることを `src/utils/nendoKoshin.test.ts` で確かめています）。

## 出典

| 置く場所 | 内容 | 入手元 | SHA-256 |
|---|---|---|---|
| source/001221989.pdf | 厚生労働省「労災保険率表（令和６年度～）」（令和6年4月1日施行）（370,578バイト） | https://www.mhlw.go.jp/content/11200000/001221989.pdf （厚生労働省「労災保険・雇用保険の特徴」 https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/hoken/2024707.html の「労災保険率表 令和６年度～」） | `c75702fdddef9342b14690507e8730d806ffb6452c361b4243fd21a9b9fb6f76` |
| source/001184407.pdf | 厚生労働省「労災保険率の改定について」（労働政策審議会の答申（令和5年12月26日）の別添３）（1,372,094バイト） | https://www.mhlw.go.jp/content/11401000/001184407.pdf （厚生労働省「労災保険料算出に用いる労災保険率の改定等を行います」 https://www.mhlw.go.jp/stf/newpage_37107.html ） | `3d156b36cfaf13552c7f72cafc418c94f7c8708a7d10c8bc80147c9e98f648d4` |
| source/keizoku-06.pdf | 厚生労働省「令和８年度 労働保険年度更新申告書の書き方（継続事業用）」6 労働保険対象者の範囲（2,164,862バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-06.pdf （ https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/keizoku.html ） | `79a99dc318ee0da5d7f9b9a7c384b9b2bd7ac5905504c4d049153593d6e09447` |
| source/keizoku-07.pdf | 同 7 労働保険対象賃金の範囲（1,349,097バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-07.pdf | `9a88dafeb9481dfd56559bc666c75037eecf21b77c11b60d5a9a1be13bffec86` |
| source/keizoku-09.pdf | 同 9 確定保険料・一般拠出金算定基礎賃金集計表の書き方（2,692,363バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-09.pdf | `96159f6a00954bb660527907bf4ad0c1ac4dd969cf606fc9819ebb962aa269dd` |
| source/keizoku-10.pdf | 同 10 申告書の記入にあたって（6,168,735バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-10.pdf | `15c198ca99059d5a948a992c197b192f6307181a2fe0063a50a59dc41b5e51e3` |
| source/keizoku-11.pdf | 同 11 申告書の書き方（記入例1〜5）（29,102,088バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-11.pdf | `67082d08ae594ad4984a8e81478a8232c506f96053eee2cbe5fc2657f0f1bbc1` |
| source/keizoku-12.pdf | 同 12 常時使用労働者数・雇用保険被保険者数計算要領（と 13 一般拠出金）（998,888バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-12.pdf | `1488510fdc09013ad124adcb35978054839887770b84c484fbbac6701edee242` |
| source/keizoku-13.pdf | 同 13 一般拠出金の申告・納付について（998,888バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-13.pdf | `bd96a8d45068ea21a967384921157d7a3d02b22c8fef22c07547b76663984cf4` |
| source/keizoku-21.pdf | 同 20 雇用保険料の控除方法・21 年度更新よくある質問（1,121,395バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-21.pdf | `fa7a86b3d80449728f1441e3fa28b2a8eb6b62e390297bdd843f38f1ba0537e9` |
| source/keizoku-22.pdf | 同 22 申告書作成チェックポイント（590,733バイト） | https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/kakikata/dl/keizoku-22.pdf | `cd1a1e8fc4a39a2a0784d05377ef779400716fc371b95dbcd51de80e4c480dd4` |

| source/yamagata-tebiki-2026.pdf | 山形労働局「年度更新の手引き」（令和8年度。労働保険事務組合向け）の「特別加入保険料算定基礎額表」と記入例（5,613,345バイト） | https://jsite.mhlw.go.jp/yamagata-roudoukyoku/content/contents/002587832.pdf | `29f5e65c7e7c6173f39da7b42254a6ef5ca69c0b8ffd10378235ba76d9473fb9` |

2026年11月17日に取得しました（山形労働局の手引きは2026年11月18日。どれもユーザーの許しを得て取得）。

### 労災保険の特別加入（第1種）の保険料算定基礎額

```
python3 -I scripts/import_tokubetsu_kanyu.py nendo-koshin/source/yamagata-tebiki-2026.pdf src/constants/tokubetsuKanyu.ts
```

「特別加入保険料算定基礎額表」の給付基礎日額（3,500円〜25,000円の16段階）ごとの保険料算定基礎額と「特例による 1/12 の額」を読みます。
保険料算定基礎額がどの行も給付基礎日額の同じ倍数（365日）であること、1/12 の額が 保険料算定基礎額 ÷ 12 の1円未満を切り上げた額であること、
記入例の「算定基礎額の計」5,748千円 × 9.5/1000 ＝ 54,606円 と合うことを確かめ、合わなければ止まります。

**PDF は大きいので、リポジトリには入れていません**（`source/` は .gitignore）。
作り直すときは、上の入手元から取ってきて `source/` に置き、SHA-256 を確かめてください（違えば、資料が変わったので、読んでから作り直します）。

## データの作り方

追加のインストールは要りません（Python の標準ライブラリと、macOS の PDFKit・文字認識（Vision）だけで動きます）。

```
python3 -I scripts/import_rousai_rates.py nendo-koshin/source src/constants/insurance/rousaiRates.ts
```

・労災保険率表（001221989.pdf）は、字が「字の形の線」で描かれていて、PDFKit では字を取り出せないので、ページを画像にして macOS の文字認識
（`scripts/pdf_ocr.swift`）で、事業の種類の番号・事業の種類・労災保険率を読みます（率の列と同じ高さの行を、番号・名前と結び付けます）。
・文字認識は読み違えることがあるので、読んだ 54 の事業の種類を、字を取り出せる答申の資料（001184407.pdf）の業種と名前で1つずつ結び付け、
率が答申の資料の「改定」の率とすべて同じことを確かめます。名前は、答申の資料の字（文字認識でない字）を使います。
・一般拠出金率は、「書き方」の 12・13 の「賃金総額（千円未満は切り捨て） × 一般拠出金率（1,000分の0.02）」から読みます。

スクリプトは、次のときにファイルを作らずに止まります。

- 労災保険率表の見出し（令和6年4月1日施行）・「労災保険率」の列を読めない、事業の種類が 54 でない、番号が重なる
- 率表の事業の種類を、答申の資料の業種と結び付けられない（名前が似ていない・1つの業種に2つ）、率が答申の資料の「改定」の率と違う
- 答申の資料の業種が 54 でない、一般拠出金率を読めない

労災保険率は原則3年ごとに4月1日から変わります（令和7年度・令和8年度は令和6年度と同じ率。厚生労働省「令和８年度の労災保険率について（令和７年度から変更ありません）」）。
次に変わるときは、新しい率表を取ってきて、`ROUSAI_RATE_PERIODS` に期間を足すようにスクリプトを直します。
