#!/usr/bin/env python3
"""
国税庁の「賞与に対する源泉徴収税額の算出率の表」Excel から、Q で使うデータファイル（TypeScript）を作る。

使い方:
    pip install xlrd
    python3 scripts/import_bonus_tax_table.py tax-tables/賞与算出率表_令和8年分.xls 2026 src/constants/tax/bonusTaxTable2026.ts \
        https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm

・AI や手作業で数字を書き写さないための道具。数字はすべて Excel から機械的に読み取る。
・国税庁の様式が変わって読み取れない場合は、エラーで止まる（中途半端なデータは作らない）。

表の形:
  行ごとに「賞与の金額に乗ずべき率」があり、甲欄（扶養親族等の数 0人〜7人以上）と乙欄の列ごとに、
  その率になる「前月の社会保険料等控除後の給与等の金額」の範囲（千円・以上〜未満）が書かれている。
  扶養人数の列ごとに範囲の区切りが違うので、列ごとに [以上, 未満, 率] の並びとして取り出す。
"""
import re
import sys
import xlrd

INF = float("inf")
# 甲 0人〜7人以上（8列×2セル）と乙（1列×2セル）の、「以上」セルの列番号
KOU_COLS = [3 + 2 * i for i in range(8)]
OTSU_COL = 19


def to_int(v):
    if isinstance(v, float):
        assert v == int(v), v
        return int(v)
    raise ValueError(f"数値ではありません: {v!r}")


def read_range(lo, hi):
    """「以上」「未満」の2セルを読んで (以上, 未満)（千円）を返す。範囲が書かれていなければ None"""
    lo_s, hi_s = str(lo).strip(), str(hi).strip()
    if isinstance(lo, float) and isinstance(hi, float):
        return to_int(lo), to_int(hi)
    if isinstance(lo, float) and hi_s == "千円未満":       # 「82 | 千円未満」
        return 0, to_int(lo)
    if lo_s == "" and isinstance(hi, float):                # 「   | 222」（＝222千円未満）
        return 0, to_int(hi)
    m = re.fullmatch(r"([\d,]+)千円未満", lo_s)            # 「68千円未満 |   」
    if m and hi_s == "":
        return 0, int(m.group(1).replace(",", ""))
    if isinstance(lo, float) and hi_s == "千円以上":       # 「3495 | 千円以上」
        return to_int(lo), INF
    if lo_s == "" and hi_s == "":
        return None
    raise ValueError(f"範囲を読み取れません: {lo!r} / {hi!r}")


def check_continuous(name, rows):
    """0円から始まり、すき間なくつながり、最後は上限なしで終わることを確かめる"""
    assert rows, f"{name}: 行がありません"
    assert rows[0][0] == 0, f"{name}: 0円から始まっていません: {rows[0]}"
    for a, b in zip(rows, rows[1:]):
        assert a[1] == b[0], f"{name}: 範囲がつながっていません: {a} → {b}"
        assert a[2] < b[2], f"{name}: 率が増えていません: {a} → {b}"
    assert rows[-1][1] == INF, f"{name}: 最後が「以上」で終わっていません: {rows[-1]}"


def parse(path):
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    title = str(sheet.cell_value(0, 1)).strip()
    assert "賞与に対する源泉徴収税額の算出率の表" in title, f"賞与の算出率の表ではありません: {title}"
    head = " ".join(str(sheet.cell_value(4, c)) for c in range(sheet.ncols))
    assert "7  人" in head and "以" in head, "扶養親族等の数の見出し（0人〜7人以上）が見つかりません"
    assert str(sheet.cell_value(2, OTSU_COL)).strip() == "乙", "乙欄の位置が違います"

    kou = [[] for _ in KOU_COLS]
    otsu = []
    for r in range(sheet.nrows):
        rate = sheet.cell_value(r, 1)
        if not isinstance(rate, float):
            continue
        for i, c in enumerate(KOU_COLS):
            rg = read_range(sheet.cell_value(r, c), sheet.cell_value(r, c + 1))
            assert rg, f"甲欄{i}人の率{rate}%の行に範囲がありません"
            kou[i].append((rg[0] * 1000, rg[1] * 1000 if rg[1] != INF else INF, rate))
        rg = read_range(sheet.cell_value(r, OTSU_COL), sheet.cell_value(r, OTSU_COL + 1))
        if rg:
            otsu.append((rg[0] * 1000, rg[1] * 1000 if rg[1] != INF else INF, rate))

    for i, rows in enumerate(kou):
        check_continuous(f"甲欄{i}人", rows)
    check_continuous("乙欄", otsu)
    # 扶養が多いほど、同じ率になる給与の範囲は上にずれる（列を取り違えていないことの確認）
    for i in range(7):
        for a, b in zip(kou[i], kou[i + 1]):
            assert a[2] == b[2] and a[0] <= b[0], f"甲欄{i}人と{i + 1}人の範囲の並びがおかしい: {a} / {b}"
    return title, kou, otsu


def fmt(v):
    return "Infinity" if v == INF else str(v)


def main():
    src, year, out = sys.argv[1], sys.argv[2], sys.argv[3]
    # 4つ目の引数：出典として記載する国税庁のページのURL
    source_url = sys.argv[4] if len(sys.argv) > 4 else "https://www.nta.go.jp/publication/pamph/gensen/"
    title, kou, otsu = parse(src)
    row = lambda r: f"[{fmt(r[0])}, {fmt(r[1])}, {r[2]}]"
    lines = []
    lines.append("/**")
    lines.append(f" * {title}")
    lines.append(" *")
    lines.append(" * ⚠️ このファイルは自動生成です。手で書き換えないでください。")
    lines.append(" * 元データ: 国税庁の Excel（tax-tables/ フォルダ）")
    lines.append(f" * 出典    : 国税庁ホームページ（{source_url}）の「賞与に対する源泉徴収税額の算出率の表」を加工して作成")
    lines.append(" *           （Excel の表を Q で使える形に変換したもので、国税庁が作成したものではありません）")
    lines.append(" * 作り方  : python3 scripts/import_bonus_tax_table.py <Excel> <年> <このファイル> <出典URL>")
    lines.append(" */")
    lines.append("import type { BonusTaxRateTable } from './bonusTaxTableTypes';")
    lines.append("")
    lines.append(f"export const BONUS_TAX_TABLE_{year}: BonusTaxRateTable = {{")
    lines.append(f"  title: {title!r},".replace("'", '"'))
    lines.append("  /** 甲欄：扶養親族等の数（0人, 1人, …, 7人以上）ごとに [前月の社会保険料等控除後の給与等の金額 以上(円), 未満(円), 率(%)] */")
    lines.append("  kou: [")
    for i, rows in enumerate(kou):
        label = f"{i}人" if i < 7 else "7人以上"
        lines.append(f"    // {label}")
        lines.append("    [" + ", ".join(row(r) for r in rows) + "],")
    lines.append("  ],")
    lines.append("  /** 乙欄：[前月の社会保険料等控除後の給与等の金額 以上(円), 未満(円), 率(%)] */")
    lines.append("  otsu: [" + ", ".join(row(r) for r in otsu) + "],")
    lines.append("};")
    open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"{title}: 甲欄 {len(kou[0])}行 × 8列, 乙欄 {len(otsu)}行 → {out}")


if __name__ == "__main__":
    main()
