# 年末調整の元データ

## 出典・利用条件

国税庁「令和8年分 年末調整のしかた」（https://www.nta.go.jp/publication/pamph/gensen/nencho2026/01.htm）と、
「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」（https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/index.htm）の PDF です。
国税庁ホームページのコンテンツは、[国税庁の利用規約](https://www.nta.go.jp/chuijiko/copy.htm)（公共データ利用規約に準拠）により、
出典を記載すれば複製・加工・再配布（商用を含む）ができます。

- `src/constants/nencho/nencho2026.ts` は、これらの PDF の表と計算式を加工して作成したものです。
- `src/constants/nencho/gensen2026.ts` は、手引の第2章（源泉徴収票の記載要領）の区分などを加工して作成したものです。
- これらのファイルは Q 本体のライセンス（AGPL-3.0）ではなく、国税庁の利用規約に従います。
- Q は国税庁が作成・保証するものではありません。

**PDF は大きい（合わせて約17MB）ので、GitHub には上げていません（.gitignore）。** データを作り直すときは、下の表の入手元から取ってきて、ハッシュが同じか確かめてください（2026年11月1日に取得）。

| ファイル | 内容 | 使い方 | SHA-256 |
|---|---|---|---|
| [114.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/114.pdf) | 給与所得控除後の給与等の金額の表 | 計算式で作った全行と、表の数字が一致するか確かめる | `3d06c41b675161d51cc59c89d6d129ce8ea204b5ccc986f5b30b1072a12a032c` |
| [115.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/115.pdf) | 速算表・配偶者控除額の一覧表・基礎控除額の表・特定親族特別控除額の表・扶養控除額等の表 | 読み取る | `d37a6a15b38929bc8e331c611ccc2ac0295ab12bfc39266e6634393882c36c2b` |
| [204.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/204.pdf) | 電子計算機等による年末調整（年調給与額・給与所得控除後の金額の計算式・年調年税額） | 読み取る | `421bb95afd3e12193e8011e11af389f656f5d47b6a178c429e659f6da01b62f7` |
| [107.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/107.pdf) | 保険料控除申告書の受理と内容の確認（生命保険料・地震保険料の計算式） | 読み取る | `38907ac31a3a50e00b724feaec9d3d185434d3c79357edeb5fa3bbaf1b4ff4a3` |
| [110rei.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/110rei.pdf) | 設例（年末調整の計算例） | 所得金額調整控除の計算式を読み取る。設例はテストの期待値にする | `4e11985a39aae71bfe4a3f733d4359c14c9407aa59968c2a90430cedf34c8c63` |
| tebiki-02.pdf（[02.pdf](https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/02.pdf)。令和8年9月18日の訂正版） | 手引 第2章 給与所得の源泉徴収票（記載要領・記載例1〜4） | 区分（特定親族・住宅借入金等特別控除）・未成年者などの生年月日・摘要の文を読み取る。記載例はテストの期待値にする | `15960b2fe6c35fe1ff1fa5a965277bbeaf2d9a724b0831c8d6677bd72aaa2612` |
| tebiki-seigo.pdf（[seigo.pdf](https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/seigo.pdf)） | 手引の正誤表 | 読むだけ（第2章の訂正は、記載要領の前書きの（注）の追加と、摘要欄の「災害者」の書き方の字句。どちらも PDF は訂正版） | `233da6d7852cc4ed6ff3daf2101c8166378ee05874f5b32a63157714dbb0b1e0` |

## データの作り方

PDF の文字は、macOS の PDFKit で取り出します（`scripts/pdf_to_text.swift`。追加のインストールは要りません）。

```
python3 -I scripts/import_nencho_tables.py nencho-tables 2026 src/constants/nencho/nencho2026.ts
```

- 数字はすべて PDF の文字から機械的に読み取ります（全角は半角にします）。
- 204.pdf の計算式で「給与所得控除後の給与等の金額の表」の全行を作り、114.pdf の表の数字と一つ残らず一致しなければ止まります。
- 国税庁の様式が変わって読み取れないときも止まります（中途半端なデータは作りません）。
- 作ったあとは `bun test` で、設例（110rei.pdf）の年税額・過不足額と一致するか確かめます。

源泉徴収票の区分は、次で作ります（tebiki-02.pdf は名前を変えて保存したもの）。

```
python3 -I scripts/import_gensen_codes.py nencho-tables/tebiki-02.pdf 2026 src/constants/nencho/gensen2026.ts
```

- 住宅借入金等特別控除区分（14種類）・特定親族特別控除の額の区分（9行）・居住者の区分・未成年者と16歳未満の生年月日の境目・生命保険料控除の特例の摘要の文を、PDF の文字から読み取ります。数が合わない・様式が変わったときは止まります。
- `bun test` で、特定親族の区分の金額・所得の範囲が「年末調整のしかた」の表（別の PDF）と同じか、手引の記載例1〜3の源泉徴収票の金額と一致するかを確かめます。

## 令和9年分（2027年）の表を作るとき

国税庁の「令和9年分 年末調整のしかた」と「令和9年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」が出たら（例年は秋）、
令和8年分と同じ PDF（114・115・204・107・110rei と、手引の第2章）を取ってきてハッシュを上の表に残し、上の2つのスクリプトを年 2027 で動かします。
そのあと、`src/constants/nencho/index.ts` の表と、`src/features/nencho/useNenchoManager.ts` の `NENCHO_YEARS` に 2027 を足します。

令和9年分について、国税庁「[源泉所得税の改正のあらまし](https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf)」（令和8年4月）から、次のことがわかっています。
`bun test`（`src/utils/nencho.test.ts`）は、令和9年分の表ができると、これと合うかを確かめます（表ができるまでは飛ばします）。

- ひとり親控除は38万円（改正前：35万円。令和9年分以後。5ページ 6⑴）
- 年末調整は、所得税・防衛特別所得税・復興特別所得税の合計額（年調所得税額 × 102.1%）で行う（8ページ 3）。
  204.pdf の「復興特別所得税を含む年調年税額」の文が変わると `import_nencho_tables.py` は止まるので、新しい文に合わせて読み取りを直し、率が102.1%のままか確かめる
- 基礎控除と給与所得控除（最低74万円の特例）は、令和8年分と同じ「令和8・9年分」の額（1ページ）。扶養親族等の所得要件と、配偶者特別控除・特定親族特別控除の表も、令和8年分（改正後）と同じ（2ページ）
- 年齢23歳未満の扶養親族がいるときの生命保険料控除の特例は、令和9年分まで延長（6ページ 9⑵）

国税庁の「[変更を予定している年末調整関係書類](https://www.nta.go.jp/users/gensen/nencho_shorui/index.htm)」によると、令和9年分の扶養控除等（異動）申告書などは大きな変更をせず、
源泉徴収簿は、ひとり親の控除額の改正に伴う修正だけを予定しています。

ただし、令和9年度の税制改正（例年、12月に大綱、3月に法律）で、令和9年分の額がさらに変わることがあります（令和8年度の改正が、令和8年分の年末調整から使われたように）。
テストが合わなければ、そのときの改正と、国税庁の令和9年分の資料を確かめてください。

※ 数字を手やAIで書き写さないこと。
