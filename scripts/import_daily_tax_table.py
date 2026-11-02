#!/usr/bin/env python3
"""
国税庁の「給与所得の源泉徴収税額表（日額表）」Excel から、丙欄（日雇賃金）のデータファイル（TypeScript）を作る。

使い方:
    pip install xlrd
    python3 scripts/import_daily_tax_table.py tax-tables/日額表_令和8年分.xls 2026 src/constants/tax/dailyHeiTable2026.ts \
        https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm

・AI や手作業で数字を書き写さないための道具。数字はすべて Excel から機械的に読み取る。
・国税庁の様式が変わって読み取れない場合は、エラーで止まる（中途半端なデータは作らない）。
・Q の給与は月ごとに払うので、日額表のうち使うのは丙欄だけ（甲欄・乙欄は月額表を使う）。
"""
import re
import sys
import xlrd

# 列：No. / 以上 / 未満 / 甲0〜7人 / 乙 / 丙
COL_FROM, COL_TO, COL_OTSU, COL_HEI = 1, 2, 11, 12


def to_int(v):
    if isinstance(v, float):
        assert v == int(v), v
        return int(v)
    raise ValueError(f"数値ではありません: {v!r}")


def flat(v):
    """セルの文字（改行・空白を取る）"""
    return re.sub(r"\s+", "", str(v))


def parse(path):
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    title = flat(sheet.cell_value(0, 1))
    assert "日額表" in flat(sheet.cell_value(1, 1)), "2行目が日額表の見出しではありません"
    assert flat(sheet.cell_value(3, COL_HEI)) == "丙", "丙欄の列が見つかりません"
    cell = lambda r, c: sheet.cell_value(r, c)

    # 1) 表の最初の金額未満の行（「3,500円未満」など）。丙欄は0円
    zero_below = None
    for r in range(sheet.nrows):
        a, b = cell(r, COL_FROM), flat(cell(r, COL_TO))
        if isinstance(a, float) and b == "円未満":
            zero_below = to_int(a)
        else:
            m = re.fullmatch(r"([\d,]+)円未満", flat(a))
            if m:
                zero_below = int(m.group(1).replace(",", ""))
        if zero_below is not None:
            assert to_int(cell(r, COL_HEI)) == 0, "最初の金額未満の行の丙欄が0円ではありません"
            break
    assert zero_below, "「円未満」の行が見つかりません"

    # 2) 通常の行：[以上, 未満, 丙]
    rows = []
    for r in range(sheet.nrows):
        no, a, b = cell(r, 0), cell(r, COL_FROM), cell(r, COL_TO)
        if isinstance(no, float) and isinstance(a, float) and isinstance(b, float):
            rows.append([to_int(a), to_int(b), to_int(cell(r, COL_HEI))])
    assert rows, "表の行が見つかりません"
    assert rows[0][0] == zero_below, "表の最初の行が「円未満」の行とつながっていません"
    for x, y in zip(rows, rows[1:]):
        assert x[1] == y[0], f"行がつながっていません: {x[:2]} → {y[:2]}"
        assert x[2] <= y[2], f"丙欄の税額が下がっています: {x} → {y}"

    # 3) 表の最後の金額以上：「N円」の行の丙欄の税額と、丙欄の列に書かれた計算式
    anchors = {}
    for r in range(sheet.nrows):
        m = re.fullmatch(r"([\d,]+)円", flat(cell(r, COL_FROM)))
        if m and isinstance(cell(r, COL_HEI), float):
            anchors[int(m.group(1).replace(",", ""))] = to_int(cell(r, COL_HEI))
    rules = {}
    for r in range(sheet.nrows):
        m = re.fullmatch(r"([\d,]+)円に、その日の社会保険料等控除後の給与等の金額のうち([\d,]+)円を超える金額の([\d.]+)％に相当する金額を加算した金額",
                         flat(cell(r, COL_HEI)))
        if m:
            amount = int(m.group(2).replace(",", ""))
            assert amount not in rules, f"{amount}円の丙欄の式が2回出てきました"
            rules[amount] = (int(m.group(1).replace(",", "")), float(m.group(3)))
    assert rules, "丙欄の計算式が見つかりません"
    assert sorted(rules) == sorted(anchors), f"丙欄の基準額と計算式が合いません: {sorted(anchors)} / {sorted(rules)}"
    high = []
    for amount in sorted(rules):
        base, rate = rules[amount]
        assert base == anchors[amount], f"{amount}円の丙欄の税額（{anchors[amount]}円）と式の金額（{base}円）が違います"
        high.append({"amount": amount, "base": base, "rate": rate})

    # 読み取りの確認
    #   ・表の最後の金額と、最初の基準額がつながっている
    #   ・表の最後の行の税額と、最初の基準額の税額が離れすぎていない
    #   ・基準額の税額 ＋ 次の基準額までの差 × 率 ≒ 次の基準額の税額
    assert high[0]["amount"] == rows[-1][1], "表の最後と丙欄の基準額がつながっていません"
    assert 0 <= high[0]["base"] - rows[-1][2] <= 50, "表の最後と丙欄の基準額の税額が離れすぎています"
    for x, y in zip(high, high[1:]):
        expected = x["base"] + (y["amount"] - x["amount"]) * x["rate"] / 100
        assert abs(y["base"] - expected) <= 2, f"{x['amount']}→{y['amount']} の丙欄の率が合いません"

    # 丙欄には「従たる給与についての扶養控除等申告書」の控除がない（「―」）
    for r in range(sheet.nrows):
        if "従たる給与についての扶養控除等申告書" in flat(cell(r, COL_OTSU)):
            assert flat(cell(r, COL_HEI)) == "―", "丙欄に扶養親族等の控除が書かれています"
            break
    else:
        raise AssertionError("「従たる給与についての扶養控除等申告書」の行が見つかりません")

    return title, rows, high


def main():
    src, year, out = sys.argv[1], sys.argv[2], sys.argv[3]
    # 4つ目の引数：出典として記載する国税庁のページのURL
    source_url = sys.argv[4] if len(sys.argv) > 4 else "https://www.nta.go.jp/publication/pamph/gensen/"
    title, rows, high = parse(src)
    lines = []
    lines.append("/**")
    lines.append(f" * {title}（日額表の丙欄）")
    lines.append(" *")
    lines.append(" * ⚠️ このファイルは自動生成です。手で書き換えないでください。")
    lines.append(f" * 元データ: 国税庁の Excel（tax-tables/ フォルダ）")
    lines.append(f" * 出典    : 国税庁ホームページ（{source_url}）の「給与所得の源泉徴収税額表（日額表）」を加工して作成")
    lines.append(f" *           （Excel の表の丙欄を Q で使える形に変換したもので、国税庁が作成したものではありません）")
    lines.append(" * 作り方  : python3 scripts/import_daily_tax_table.py <Excel> <年> <このファイル> <出典URL>")
    lines.append(" */")
    lines.append("import type { DailyHeiTaxTable } from './dailyTableTypes';")
    lines.append("")
    lines.append(f"export const DAILY_HEI_TABLE_{year}: DailyHeiTaxTable = {{")
    lines.append(f"  title: {title!r},".replace("'", '"'))
    lines.append("  /** [以上, 未満, 丙欄の税額]（最初の行の金額未満は0円） */")
    lines.append("  rows: [")
    for r in rows:
        lines.append("    [" + ", ".join(str(x) for x in r) + "],")
    lines.append("  ],")
    lines.append("  /** 表の最後の金額以上：base円に、amount円を超える金額 × rate% を加算 */")
    lines.append("  high: [")
    for h in high:
        lines.append(f"    {{ amount: {h['amount']}, base: {h['base']}, rate: {h['rate']} }},")
    lines.append("  ],")
    lines.append("};")
    open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"{title}: 丙欄 {len(rows)}行（{rows[0][0]}円〜{rows[-1][1]}円）, 基準額 {len(high)}個 → {out}")


if __name__ == "__main__":
    main()
