# 社会保険料の元データ

## 出典・利用条件

このフォルダの Excel ファイルは、全国健康保険協会（協会けんぽ）が公開している
「健康保険・厚生年金保険の保険料額表（全都道府県分）」です。

- 出典：全国健康保険協会ホームページ（下の表の各URL）
- `src/constants/insurance/kenpoTable20XX.ts` は、これらの Excel を加工して作成したものです。
- これらのファイルは Q 本体のライセンス（AGPL-3.0）の対象ではありません。
- Q は協会けんぽが作成・保証するものではありません。

| ファイル | 内容 | 入手元 |
|---|---|---|
| 協会けんぽ_保険料額表_令和8年度.xlsx | 令和8年3月分から（子ども・子育て支援金は4月分から） | https://www.kyoukaikenpo.or.jp/g7/cat330/sb3150/r08/r8ryougakuhyou3gatukara/ |
| 協会けんぽ_保険料額表_令和7年度.xlsx | 令和7年3月分から | https://www.kyoukaikenpo.or.jp/g7/cat330/sb3150/r07/r7ryougakuhyou3gatukara/ |
| 協会けんぽ_保険料額表_令和6年度.xlsx | 令和6年3月分から | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r06/ （「都道府県別 XLSファイル」の被保険者の方の分） |
| 協会けんぽ_保険料額表_令和5年度.xlsx | 令和5年3月分から | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r05/ （「都道府県別 XLSファイル」の被保険者の方の分） |
| 協会けんぽ_保険料額表_令和4年度.xlsx | 令和4年3月分から | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r04/ （「都道府県別 XLSファイル」の被保険者の方の分） |
| 協会けんぽ_保険料額表_令和3年度.xlsx | 令和3年3月分から | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r03/ （「都道府県別 XLSファイル」の被保険者の方の分） |
| 協会けんぽ_保険料額表_令和2年9月分から.xlsx | 令和2年9月分から（厚生年金の上限が62万円→65万円） | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r02/001/ |
| 協会けんぽ_保険料額表_令和2年4月分から8月分まで.xlsx | 令和2年4月分から8月分まで（子ども・子育て拠出金率が0.34%→0.36%） | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r02/002/ |
| 協会けんぽ_保険料額表_令和2年3月分.xlsx | 令和2年3月分 | https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r02/003/ |

※ 協会けんぽのホームページは移転しており、古いURL（/g7/cat330/…）は新しいURL（/about/business/insurance_rate/premium_prefectures/…）に転送されます。
　過去の年度の表は、新しいURLのページの一覧（平成21年度〜）から入手できます。

## 雇用保険料率の元データ

雇用保険料率（`src/constants/insurance/laborInsuranceRates.ts`）は、厚生労働省「雇用保険料率について」のページ
（https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000108634.html ）にある、年度ごとの「雇用保険料率について」の PDF から、
`scripts/import_employment_insurance_rates.py` で作っています（手で書き写していません）。
PDF は `insurance-tables/source/` に置き、GitHub には上げません（.gitignore）。2026年11月25日に取得しました（ユーザーの許しを得て取得）。

| 置く場所 | 内容 | 入手元 | 大きさ（バイト） | SHA-256 |
|---|---|---|---|---|
| source/koyou-ryouritsu-r03.pdf | 令和3年度の雇用保険料率について（表の下の段が令和2年度） | https://www.mhlw.go.jp/content/000739455.pdf | 107,670 | c7798b41124f41711ee1e06b5f118b8dbd9812be118d27ba8aa3c60933268bf0 |
| source/koyou-ryouritsu-r04.pdf | 令和4年度雇用保険料率のご案内（4月〜9月と、10月〜3月の2つの表） | https://www.mhlw.go.jp/content/000921550.pdf | 112,603 | e0a7859939540a272415a69ff6dc6e965d1182a133f8ddb3b3447a78c033d267 |
| source/koyou-ryouritsu-r05.pdf | 令和5年度雇用保険料率のご案内 | https://www.mhlw.go.jp/content/001050206.pdf | 323,216 | 194c4e6384e47e43bf1110bb1e849e5bc542e6ee1b4a783d27b7e142e01430ee |
| source/koyou-ryouritsu-r06.pdf | 令和6年度の雇用保険料率について | https://www.mhlw.go.jp/content/001211914.pdf | 99,716 | 51792c90abc698e377875868df3aa35873fbcecf6d952b31a62ffe52a5d18a27 |
| source/koyou-ryouritsu-r07.pdf | 令和7（2025）年度 雇用保険料率のご案内 | https://www.mhlw.go.jp/content/001401966.pdf | 349,386 | eda8a16a77c762247b7e7412c86f9f6accc33830620e2d8de047308cfca4022b |
| source/koyou-ryouritsu-r08.pdf | 令和8（2026）年度 雇用保険料率のご案内 | https://www.mhlw.go.jp/content/001692566.pdf | 360,445 | 69ca914736d051ffa067464756500c2a8cf597186e9cf091b54512a68d3b1be9 |

```
python3 -I scripts/import_employment_insurance_rates.py insurance-tables/source src/constants/insurance/laborInsuranceRates.ts
```

追加のインストールは要りません（Python の標準ライブラリと、macOS の PDFKit（`scripts/pdf_to_chars.swift`）だけで動きます）。

- 表の字と、その位置を読み、同じ高さにある5つの率（①労働者負担・②事業主負担・②のうち失業等給付・育児休業給付の保険料率・
  二事業の保険料率・①＋②雇用保険料率）を1行にします。どの行も、①＋②が合計と、②が2つの率の和と、①が失業等給付・育児休業給付の率と
  同じでなければ止まります。
- 表の上の段がその年度の率、下の段は前の年度の率です。下の段は、前の年度の PDF の率と同じことを確かめます
  （令和2年度は、令和3年度の PDF の下の段から作ります）。期間にすき間や重なりがあっても止まります。
- 令和5年度の PDF の下の段（令和4年10月〜）の一般の事業の②は「8,5/1,000」と書かれています。「,」のあとが1けたで千の位の区切りではないので、
  8.5/1,000 の書きまちがいとして読み、そのことを出します（行の足し算と、令和4年度の PDF の率で確かめます）。

## 登録している範囲

| 項目 | いつから | それより前を登録していない理由 |
|---|---|---|
| 健康保険・介護保険・厚生年金（協会けんぽ） | 2020年3月分 | 2020年以前の給与の計算し直しは、時効などでほぼ必要ないため |
| 雇用保険 | 2020年4月分 | 2020年3月までは、4月1日に64歳以上の人の保険料が免除されていた（Q はこの免除に対応していない） |
| 源泉所得税（`tax-tables/`） | 2020年1月分 | 2019年以前は税額表が違う（給与所得控除・基礎控除の改正前） |

登録より前の月は、いちばん古い料率で計算して、給与明細・賞与の画面に注意を出します。

## 料率は「何年何月分から」で切り替わる

料率は、その月までに始まっている最後の表・行を使います（`src/constants/insurance/index.ts` の `getInsuranceMaster`）。
ふつうは協会けんぽが3月分から、雇用保険が4月からですが、年度の途中で変わることもあります
（例：雇用保険は令和4年10月に本人負担が変わった、厚生年金は令和2年9月に上の等級が増えた、
子ども・子育て拠出金率は令和2年4月分から変わった）。
登録していない月は、いちばん近い料率で計算して、給与明細・賞与の画面に注意を出します。

## 新しい年度の表を追加するとき

1. 協会けんぽのページから「都道府県別 XLSファイル」（被保険者の方の分）をダウンロードして、このフォルダに置く
2. データファイルを作る（全47都道府県・全等級の保険料が Excel の印刷値と一致するか自動で確かめます）

   ```
   pip install openpyxl
   python3 scripts/import_kenpo_table.py insurance-tables/協会けんぽ_保険料額表_令和9年度.xlsx 2027 \
       src/constants/insurance/kenpoTable2027.ts <協会けんぽのページのURL>
   ```

3. `src/constants/insurance/insurance2027.ts` を作り（他の年と同じ形）、`src/constants/insurance/index.ts` の `KENPO_MASTERS` に追加する
4. 雇用保険料率は、厚生労働省「雇用保険料率について」のページから新しい年度の PDF を `insurance-tables/source/koyou-ryouritsu-r09.pdf` のような
   名前で置き、`scripts/import_employment_insurance_rates.py` の `SOURCES` と、上の「雇用保険料率の元データ」の表に足して、作り直す
5. `bun test` で確認する

## 年度の途中で料率が変わったとき

- **協会けんぽの表が年度の途中から変わった**：その月からの表を、年度に月を付けて取り込み（例：`2020-09`）、
  `KENPO_MASTERS` の正しい位置（古い順）に足す。表題の年・月と違うとエラーで止まります。

  ```
  python3 scripts/import_kenpo_table.py insurance-tables/協会けんぽ_保険料額表_令和2年9月分から.xlsx 2020-09 \
      src/constants/insurance/kenpoTable2020_09.ts <協会けんぽのページのURL>
  ```

  令和2年度の `2020-04`・`2020-09` の表がこの例です。

- **雇用保険料率が年度の途中から変わった**：PDF の表が、期間ごとに分かれます（令和4年度の PDF が例。表の上の
  「○令和４年１０月１日 ～ 令和５年３月３１日」から期間を読みます）。スクリプトをそのまま流せば、変わった月からの行ができます。

※ 数字を手やAIで書き写さないこと（以前、AIが作った架空の料率が混ざっていたことがあります）。
