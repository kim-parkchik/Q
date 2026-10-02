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

雇用保険料率は Excel がないため、厚生労働省の発表資料の数字を `src/constants/insurance/insurance20XX.ts` に
出典URLつきで記載しています（`bun test` で値を確認しています）。

## 新しい年度の表を追加するとき

1. 協会けんぽのページから「エクセル版（全都道府県分）」をダウンロードして、このフォルダに置く
2. データファイルを作る（全47都道府県・全等級の保険料が Excel の印刷値と一致するか自動で確かめます）

   ```
   pip install openpyxl
   python3 scripts/import_kenpo_table.py insurance-tables/協会けんぽ_保険料額表_令和9年度.xlsx 2027 \
       src/constants/insurance/kenpoTable2027.ts <協会けんぽのページのURL>
   ```

3. `src/constants/insurance/insurance2027.ts` を作り（雇用保険料率は厚生労働省の発表を確認して記入）、
   `src/constants/insurance/index.ts` の一覧に追加する
4. `bun test` で確認する

※ 数字を手やAIで書き写さないこと（以前、AIが作った架空の料率が混ざっていたことがあります）。
