# 年末調整の元データ

## 出典・利用条件

国税庁「令和8年分 年末調整のしかた」（https://www.nta.go.jp/publication/pamph/gensen/nencho2026/01.htm）の PDF です。
国税庁ホームページのコンテンツは、[国税庁の利用規約](https://www.nta.go.jp/chuijiko/copy.htm)（公共データ利用規約に準拠）により、
出典を記載すれば複製・加工・再配布（商用を含む）ができます。

- `src/constants/nencho/nencho2026.ts` は、これらの PDF の表と計算式を加工して作成したものです。
- これらのファイルは Q 本体のライセンス（AGPL-3.0）ではなく、国税庁の利用規約に従います。
- Q は国税庁が作成・保証するものではありません。

**PDF は大きい（合わせて約10MB）ので、GitHub には上げていません（.gitignore）。** データを作り直すときは、下の表の入手元から取ってきて、ハッシュが同じか確かめてください（2026年11月1日に取得）。

| ファイル | 内容 | 使い方 | SHA-256 |
|---|---|---|---|
| [114.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/114.pdf) | 給与所得控除後の給与等の金額の表 | 計算式で作った全行と、表の数字が一致するか確かめる | `3d06c41b675161d51cc59c89d6d129ce8ea204b5ccc986f5b30b1072a12a032c` |
| [115.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/115.pdf) | 速算表・配偶者控除額の一覧表・基礎控除額の表・特定親族特別控除額の表・扶養控除額等の表 | 読み取る | `d37a6a15b38929bc8e331c611ccc2ac0295ab12bfc39266e6634393882c36c2b` |
| [204.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/204.pdf) | 電子計算機等による年末調整（年調給与額・給与所得控除後の金額の計算式・年調年税額） | 読み取る | `421bb95afd3e12193e8011e11af389f656f5d47b6a178c429e659f6da01b62f7` |
| [107.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/107.pdf) | 保険料控除申告書の受理と内容の確認（生命保険料・地震保険料の計算式） | 読み取る | `38907ac31a3a50e00b724feaec9d3d185434d3c79357edeb5fa3bbaf1b4ff4a3` |
| [110rei.pdf](https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/110rei.pdf) | 設例（年末調整の計算例） | 所得金額調整控除の計算式を読み取る。設例はテストの期待値にする | `4e11985a39aae71bfe4a3f733d4359c14c9407aa59968c2a90430cedf34c8c63` |

## データの作り方

PDF の文字は、macOS の PDFKit で取り出します（`scripts/pdf_to_text.swift`。追加のインストールは要りません）。

```
python3 -I scripts/import_nencho_tables.py nencho-tables 2026 src/constants/nencho/nencho2026.ts
```

- 数字はすべて PDF の文字から機械的に読み取ります（全角は半角にします）。
- 204.pdf の計算式で「給与所得控除後の給与等の金額の表」の全行を作り、114.pdf の表の数字と一つ残らず一致しなければ止まります。
- 国税庁の様式が変わって読み取れないときも止まります（中途半端なデータは作りません）。
- 作ったあとは `bun test` で、設例（110rei.pdf）の年税額・過不足額と一致するか確かめます。

※ 数字を手やAIで書き写さないこと。
