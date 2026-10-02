#!/usr/bin/env python3
"""
国税庁の「給与所得の源泉徴収税額表（月額表）」Excel から、Q で使うデータファイル（TypeScript）を作る。

使い方:
    pip install xlrd
    python3 scripts/import_monthly_tax_table.py tax-tables/月額表_令和8年分.xls 2026 src/constants/tax/monthlyTable2026.ts \
        https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm

・AI や手作業で数字を書き写さないための道具。数字はすべて Excel から機械的に読み取る。
・国税庁の様式が変わって読み取れない場合は、エラーで止まる（中途半端なデータは作らない）。
"""
import re
import sys
import xlrd


def to_int(v):
    if isinstance(v, float):
        assert v == int(v), v
        return int(v)
    raise ValueError(f"数値ではありません: {v!r}")


def parse(path):
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    title = str(sheet.cell_value(0, 1)).strip()
    cells = lambda r: [sheet.cell_value(r, c) for c in range(sheet.ncols)]

    # 1) 0円の範囲（「〇〇円未満」の行）
    zero_below = None
    for r in range(sheet.nrows):
        row = cells(r)
        if str(row[2]).strip() == "円未満" and isinstance(row[1], float):
            zero_below = to_int(row[1])
            assert all(to_int(x) == 0 for x in row[3:11]), "0円の行に0以外があります"
            break
    assert zero_below, "「円未満」の行が見つかりません"

    # 2) 通常の行：No. / 以上 / 未満 / 甲0〜7人 / 乙
    rows = []
    for r in range(sheet.nrows):
        row = cells(r)
        if isinstance(row[0], float) and isinstance(row[1], float) and isinstance(row[2], float):
            rows.append([to_int(x) for x in row[1:12]])
    assert rows, "表の行が見つかりません"
    assert rows[0][0] == zero_below, "表の最初の行が0円の範囲とつながっていません"
    for a, b in zip(rows, rows[1:]):
        assert a[1] == b[0], f"行がつながっていません: {a[:2]} → {b[:2]}"

    # 3) 高額部分の基準額（「740,000円」などの行）と、その上の加算率
    anchors = []
    for r in range(sheet.nrows):
        row = cells(r)
        m = re.fullmatch(r"\s*([\d,]+)円\s*", str(row[1]))
        if m and isinstance(row[3], float):
            amount = int(m.group(1).replace(",", ""))
            kou = [to_int(x) for x in row[3:11]]
            otsu = to_int(row[11]) if isinstance(row[11], float) else None
            anchors.append({"amount": amount, "kou": kou, "otsu": otsu})
    assert anchors and anchors[0]["amount"] == rows[-1][1], "表の最後と高額部分の基準額がつながっていません"

    text = "\n".join(str(sheet.cell_value(r, c)) for r in range(sheet.nrows) for c in range(sheet.ncols))
    text = text.replace("\n", "")
    # 甲欄：「N円を超える金額のR％に相当する金額を加算した金額」だけが書かれたセル
    #   （乙欄の説明は「259,200円に、…」で始まるので区別できる）
    kou_rates = {}
    for r in range(sheet.nrows):
        for c in range(sheet.ncols):
            m = re.fullmatch(r"\s*([\d,]+)円を超える金額の([\d.]+)％に相当する金額を加算した金額\s*", str(sheet.cell_value(r, c)))
            if m:
                amount = int(m.group(1).replace(",", ""))
                assert amount not in kou_rates, f"{amount}円の率が2回出てきました"
                kou_rates[amount] = float(m.group(2))
    # 乙欄：「X円に、…のうちN円を超える金額のR％」
    otsu_rules = {int(a.replace(",", "")): (int(base.replace(",", "")), float(rate))
                  for base, a, rate in re.findall(r"([\d,]+)円に、その月の社会保険料等控除後の給与等の金額のうち([\d,]+)円を超える金額の([\d.]+)％", text)}
    for an in anchors:
        assert an["amount"] in kou_rates, f"{an['amount']}円を超える部分の率が見つかりません"
        an["rate"] = kou_rates[an["amount"]]
    # 読み取りの確認：基準額の税額 ＋ 次の基準額までの差 × 率 ≒ 次の基準額の税額
    #   （基礎控除が段階的に減る金額では税額が少し上に跳ねるので、下にずれていないことと、跳ねが小さいことを確認）
    for a, b in zip(anchors, anchors[1:]):
        for k in range(8):
            expected = a["kou"][k] + (b["amount"] - a["amount"]) * a["rate"] / 100
            assert -10 <= b["kou"][k] - expected <= 15000, f"{a['amount']}→{b['amount']} の率が合いません"
    # 表の最後の行（737,000〜740,000円）と最初の基準額（740,000円）の差も確認
    assert all(0 <= anchors[0]["kou"][k] - rows[-1][2 + k] <= 1000 for k in range(8)), "表の最後と基準額の税額が離れすぎています"
    # 乙欄の「〇円未満は給与の3.063%」
    m = re.search(r"給与等の金額の([\d.]+)％に相当する金額", text)
    otsu_low_rate = float(m.group(1)) if m else None
    return title, zero_below, rows, anchors, otsu_rules, otsu_low_rate


def main():
    src, year, out = sys.argv[1], sys.argv[2], sys.argv[3]
    # 4つ目の引数：出典として記載する国税庁のページのURL
    source_url = sys.argv[4] if len(sys.argv) > 4 else "https://www.nta.go.jp/publication/pamph/gensen/"
    title, zero_below, rows, anchors, otsu_rules, otsu_low_rate = parse(src)
    lines = []
    lines.append("/**")
    lines.append(f" * {title}（月額表）")
    lines.append(" *")
    lines.append(" * ⚠️ このファイルは自動生成です。手で書き換えないでください。")
    lines.append(f" * 元データ: 国税庁の Excel（tax-tables/ フォルダ）")
    lines.append(f" * 出典    : 国税庁ホームページ（{source_url}）の「給与所得の源泉徴収税額表（月額表）」を加工して作成")
    lines.append(f" *           （Excel の表を Q で使える形に変換したもので、国税庁が作成したものではありません）")
    lines.append(" * 作り方  : python3 scripts/import_monthly_tax_table.py <Excel> <年> <このファイル> <出典URL>")
    lines.append(" */")
    lines.append("import type { MonthlyTaxTable } from './monthlyTableTypes';")
    lines.append("")
    lines.append(f"export const MONTHLY_TABLE_{year}: MonthlyTaxTable = {{")
    lines.append(f"  title: {title!r},".replace("'", '"'))
    lines.append(f"  /** この金額未満は甲欄0円 */")
    lines.append(f"  zeroBelow: {zero_below},")
    lines.append("  /** [以上, 未満, 甲0人, 1人, 2人, 3人, 4人, 5人, 6人, 7人, 乙] */")
    lines.append("  rows: [")
    for r in rows:
        lines.append("    [" + ", ".join(str(x) for x in r) + "],")
    lines.append("  ],")
    lines.append("  /** 高額部分：基準額の税額に、基準額を超える金額 × rate% を加算（甲欄） */")
    lines.append("  highAnchors: [")
    for a in anchors:
        lines.append(f"    {{ amount: {a['amount']}, kou: [{', '.join(map(str, a['kou']))}], rate: {a['rate']} }},")
    lines.append("  ],")
    lines.append("  /** 乙欄の高額部分：base円に、amount円を超える金額 × rate% を加算 */")
    lines.append("  otsuHigh: [")
    for amount, (base, rate) in sorted(otsu_rules.items()):
        lines.append(f"    {{ amount: {amount}, base: {base}, rate: {rate} }},")
    lines.append("  ],")
    lines.append(f"  /** 乙欄：表の最初の金額未満は、給与 × この率% */")
    lines.append(f"  otsuLowRate: {otsu_low_rate},")
    lines.append("  /** 扶養親族等が7人を超える場合、1人ごとに差し引く額 */")
    lines.append("  perExtraDependent: 1610,")
    lines.append("};")
    open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"{title}: {len(rows)}行, 高額部分の基準額 {len(anchors)}個 → {out}")


if __name__ == "__main__":
    main()
