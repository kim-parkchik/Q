#!/usr/bin/env python3
"""
国税庁「月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について」の PDF から、
Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_densanki.py tax-tables/電算機計算の特例_令和8年分.pdf 2026 src/constants/tax/densanki2026.ts \
        https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf

・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。全角は半角にする（NFKC）。
・AI や手作業で数字を書き写さないための道具。第1表〜第4表の金額・率・控除額、使える年、計算例は、
  すべて PDF の文字から機械的に読み取る。
・PDF の表は、列ごと（「以上」の列 → 「以下」の列 → 額・算式の列）に文字が並んでいるので、その順で読む。
・次のときはエラーで止まる（中途半端なデータは作らない）。
  - 表の行が、下限なしの行から切れ目なく並んでいない（ある行の「以下」の1円上が、次の行の「以上」でない）、
    最後の行に上限がある
  - 給与所得控除の額・税額が、行の境目で1〜2円より大きくとぶ（読み違えた数字があると、ふつうはとぶ）
  - 基礎控除の額が、給与が増えるほど減っていない・最後が0円でない
  - 第1表〜第3表の額が、1年の額（1万円単位）を12で割って1円未満を切り上げた額になっていない
  - 配偶者控除の額と扶養控除の額が違う（Q は1人あたりの同じ額で計算する）
  - 端数の決まり（給与所得控除の額は1円未満切り上げ、税額は10円未満四捨五入）が書いていない
  - PDF の計算例（3つ）の「特例計算による税額」が、読み取った表で計算した税額と合わない
  - 指定した年が、PDF の「令和○年分」（「令和○年~令和○年分」「令和○年分以降」）に入っていない
・計算例は、データファイルにも入れる。bun test で、Q の計算（utils/incomeTax.ts）が、計算例の
  「特例計算による税額」と「月額表甲欄の税額」の両方と同じになるかを確かめる。
"""
import re
import subprocess
import sys
import unicodedata
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
HEADING = "月額表の甲欄を適用する給与等に対する税額の電算機計算の特例について"

AMOUNT = r"[\d,]+"
FORMULA_A = re.compile(r"\(A\)×([\d.]+)%(?:([+-])([\d,]+)円)?")
FORMULA_B = re.compile(r"\(B\)×([\d.]+)%(?:([+-])([\d,]+)円)?")


def pdf_lines(path):
    """PDF の文字を行に分け、全角を半角にし（NFKC）、行の中の空白を除く（空の行は捨てる）"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(path)], check=True, capture_output=True, text=True).stdout
    lines = [re.sub(r"\s+", "", unicodedata.normalize("NFKC", line)) for line in out.splitlines()]
    return [line for line in lines if line]


def yen(s):
    """「158,334」「708,331円」→ 158334・708331"""
    m = re.fullmatch(rf"({AMOUNT})円?", s)
    assert m, f"金額を読めません: {s}"
    return int(m.group(1).replace(",", ""))


def reiwa(n):
    """「8」「元」→ 2026・2019"""
    return 2018 + (1 if n == "元" else int(n))


def reiwa_number(year):
    """2026・2019 → 「8」「元」"""
    return "元" if year == 2019 else str(year - 2018)


def is_table_heading(line, n):
    """「第N表」の見出しの行（令和2年分は「第1表 － 令和2年分 －」のように、後ろに「－…－」が付く）"""
    return re.fullmatch(rf"第{n}表(?:-.+-)?", line) is not None


def section(lines, n, end_pred, what):
    """「第N表」の見出しの行から、end_pred に当たる行の前までを返す"""
    found = [i for i, line in enumerate(lines) if is_table_heading(line, n)]
    assert len(found) == 1, f"「第{n}表」の見出しの行が1つではありません（{len(found)}行）"
    i = found[0]
    for j in range(i + 1, len(lines)):
        if end_pred(lines[j]):
            return lines[i + 1:j], lines[j]
    raise AssertionError(f"{what} の終わりが見つかりません")


def table_rows(lines, what):
    """
    表の部分の行から、[以上, 以下, 額・算式] の行を作る。
    以上は最初の行だけ None（下限なし）、以下は最後の行だけ None（上限なし。PDF では「-」か「以上」）。
    """
    cells = []
    for line in lines:
        if line in ("-", "以上") or re.fullmatch(rf"{AMOUNT}円?", line) or FORMULA_A.fullmatch(line) or FORMULA_B.fullmatch(line):
            cells.append(line)
        elif re.search(r"\d", line):
            raise AssertionError(f"{what} に、読めない数字の行があります: {line}")
        # ほかは見出し（「以上以下」「給与所得控除の額」など）と単位（「円」）
    assert cells and len(cells) % 3 == 0, f"{what} のセルの数が3列にそろいません（{len(cells)}個）: {cells}"
    n = len(cells) // 3
    froms, tos, values = cells[:n], cells[n:2 * n], cells[2 * n:]
    assert froms[0] == "-", f"{what} の最初の行に下限があります: {froms[0]}"
    assert tos[-1] in ("-", "以上"), f"{what} の最後の行に上限があります: {tos[-1]}"
    froms = [None] + [yen(x) for x in froms[1:]]
    tos = [yen(x) for x in tos[:-1]] + [None]
    for k in range(1, n):
        assert froms[k] == tos[k - 1] + 1, f"{what} の行が切れ目なく並んでいません: {tos[k - 1]}円以下 → {froms[k]}円以上"
    for f, t in zip(froms, tos):
        assert f is None or t is None or f <= t, f"{what} の行の以上・以下が逆です: {f}〜{t}"
    return list(zip(froms, tos, values))


def pct(s):
    return Decimal(s) / 100


def parse_employment(rows):
    """第1表：[上限, 率（小数）, 加算額]。定額の行は率0"""
    out = []
    for _, to, v in rows:
        m = FORMULA_A.fullmatch(v)
        if m:
            add = yen(m.group(3)) if m.group(3) else 0
            out.append((to, pct(m.group(1)), add if m.group(2) != "-" else -add))
        else:
            assert v.endswith("円"), f"第1表の額を読めません: {v}"
            out.append((to, Decimal(0), yen(v)))
    return out


def parse_basic(rows):
    """第3表：[上限, 控除額]"""
    out = []
    for _, to, v in rows:
        assert v.endswith("円"), f"第3表の額を読めません: {v}"
        out.append((to, yen(v)))
    return out


def parse_tax(rows):
    """第4表：[上限, 税率（%）, 控除額]（算式は B × 税率 − 控除額）"""
    out = []
    for _, to, v in rows:
        m = FORMULA_B.fullmatch(v)
        assert m, f"第4表の算式を読めません: {v}"
        minus = yen(m.group(3)) if m.group(3) else 0
        out.append((to, Decimal(m.group(1)), minus if m.group(2) != "+" else -minus))
    return out


def lookup(table, amount):
    for row in table:
        if row[0] is None or amount <= row[0]:
            return row
    raise AssertionError(f"表に {amount} 円の行がありません")


def employment_deduction(table, a):
    _, rate, add = lookup(table, a)
    if rate == 0:
        return add
    return int((a * rate + add).to_integral_value(rounding=ROUND_CEILING))  # 1円未満切り上げ


def basic_deduction(table, a):
    return lookup(table, a)[1]


def raw_tax(table, b):
    _, rate, minus = lookup(table, b)
    return b * rate / 100 - minus


def densanki_tax(t, a, dependents):
    """utils/incomeTax.ts の calcMonthlyWithholdingTax と同じ計算（小数の誤差がないよう Decimal で）"""
    b = a - employment_deduction(t["employment"], a) - t["dependent"] * dependents - basic_deduction(t["basic"], a)
    if b <= 0:
        return 0
    tax = (raw_tax(t["tax"], b) / 10).to_integral_value(rounding=ROUND_HALF_UP) * 10  # 10円未満四捨五入
    return max(0, int(tax))


def check_continuity(t):
    """行の境目で、給与所得控除の額は0〜1円、税額は±2円までしか変わらない（読み違えた数字を見つけるため）"""
    for (to, _, _), nxt in zip(t["employment"], t["employment"][1:]):
        jump = employment_deduction([nxt], to + 1) - employment_deduction(t["employment"], to)
        assert 0 <= jump <= 1, f"第1表：{to}円と{to + 1}円で給与所得控除の額が{jump}円とびます"
    for (to, _, _), nxt in zip(t["tax"], t["tax"][1:]):
        jump = raw_tax([nxt], to + 1) - raw_tax(t["tax"], to)
        assert abs(jump) <= 2, f"第4表：{to}円と{to + 1}円で税額が{jump}円とびます"
    amounts = [d for _, d in t["basic"]]
    assert amounts == sorted(amounts, reverse=True) and amounts[-1] == 0, f"第3表：基礎控除の額が減っていく形になっていません: {amounts}"


def check_monthly_of_annual(t):
    """
    第1表の額・加算額、第2表、第3表の額は、1年の額（1万円単位）を12で割って1円未満を切り上げた額になっている
    （例：54,167円 ＝ 65万円 ÷ 12、−8,333円 ＝ −10万円 ÷ 12）。そうでない額は、読み違えとして止める
    """
    values = [("第1表", add) for _, _, add in t["employment"]] + [("第2表", t["dependent"])] + [("第3表", d) for _, d in t["basic"]]
    for what, v in values:
        annual = round(v * 12 / 10000) * 10000
        monthly = int((Decimal(annual) / 12).to_integral_value(rounding=ROUND_CEILING))
        assert monthly == v, f"{what}：{v}円が、1年の額（1万円単位）を12で割った額になっていません（{annual}円 ÷ 12 ＝ {monthly}円）"


def parse(path):
    lines = pdf_lines(path)
    text = "".join(lines)

    # 使える年（「令和8年分」「令和3年~令和7年分」「令和9年分以降」と、「【注意】令和7年分以前の給与等には使用できません。」）
    # 「以降」は終わりの年がない（year_to が None）
    labels = set(re.findall(r"^令和(\d+|元)年(?:~令和(\d+|元)年)?分(以降)?$", "\n".join(lines), re.M))
    assert len(labels) == 1, f"何年分の資料かが1つに決まりません: {labels}"
    first, last, onward = next(iter(labels))
    assert not (last and onward), f"「令和○年~令和○年分以降」は読めません: {labels}"
    year_from = reiwa(first)
    year_to = None if onward else reiwa(last or first)
    label = f"令和{first}年分以降" if onward else f"令和{first}年分" if not last else f"令和{first}年〜令和{last}年分"
    # 【注意】の年は、資料の最初の年の前の年
    notes = set(re.findall(r"【注意】令和(\d+|元)年分以前の給与等には使用できません。", text))
    assert notes == {reiwa_number(year_from - 1)}, f"【注意】の年が、資料の年と合いません: {notes} / {label}"
    assert HEADING in lines, f"「{HEADING}」の見出しがありません"

    # 第1表〜第4表
    t1, t1_note = section(lines, 1, lambda line: line.startswith("(注)"), "第1表")
    t2, _ = section(lines, 2, lambda line: is_table_heading(line, 3), "第2表")
    t3, _ = section(lines, 3, lambda line: is_table_heading(line, 4), "第3表")
    t4, t4_note = section(lines, 4, lambda line: line.startswith("(注)"), "第4表")
    assert t1_note.startswith("(注)給与所得控除の額に1円未満の端数があるときは、これを切り上げた額"), f"第1表の端数の決まりが変わっています: {t1_note}"
    assert t4_note.startswith("(注)税額に10円未満の端数があるときは、これを四捨五入した額"), f"第4表の端数の決まりが変わっています: {t4_note}"

    t2_text = "".join(t2)
    spouse = re.fullmatch(rf"配偶者控除の額又は配偶者特別控除の額({AMOUNT})円扶養控除の額(?:又は特定親族特別控除の額)?({AMOUNT})円×(?:源泉控除対象親族|控除対象扶養親族)の数", t2_text)
    assert spouse, f"第2表を読めません: {t2_text}"
    assert yen(spouse.group(1)) == yen(spouse.group(2)), f"第2表：配偶者控除の額と扶養控除の額が違います（Q は同じ額で計算します）: {spouse.groups()}"

    t = {
        "employment": parse_employment(table_rows(t1, "第1表")),
        "dependent": yen(spouse.group(1)),
        "basic": parse_basic(table_rows(t3, "第3表")),
        "tax": parse_tax(table_rows(t4, "第4表")),
    }
    check_continuity(t)
    check_monthly_of_annual(t)

    # 計算例（①・②は NFKC で「1」「2」になる）
    examples = []
    for m in re.finditer(
        rf"その月の社会保険料等控除後の給与等の金額が({AMOUNT})円で、源泉控除対象配偶者と(?:源泉控除対象親族|控除対象扶養親族)(\d+)人の場合"
        rf"1月額表甲欄の税額({AMOUNT})円(?:-({AMOUNT})円=({AMOUNT})円)?.*?2特例計算による税額({AMOUNT})円",
        text,
    ):
        a, n, table_tax, _, table_tax_after, tax = m.groups()
        ex = {
            "amount": yen(a),
            "dependents": int(n) + 1,  # 源泉控除対象配偶者を1人と数える
            "tableTax": yen(table_tax_after or table_tax),
            "densankiTax": yen(tax),
        }
        got = densanki_tax(t, ex["amount"], ex["dependents"])
        assert got == ex["densankiTax"], f"計算例が合いません（{ex}）：読み取った表では {got} 円"
        examples.append(ex)
    assert len(examples) >= 3, f"計算例を3つ読めません: {examples}"

    return {"title": f"{label} {HEADING}", "label": label, "from": year_from, "to": year_to, **t, "examples": examples}


def num(d):
    """Decimal を TypeScript の数にする（0.30 → 0.3、10.210 → 10.21）"""
    s = format(d.normalize(), "f")
    return s


def limit(x):
    return "Infinity" if x is None else str(x)


def main():
    src, year, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
    source_url = sys.argv[4]
    d = parse(src)
    assert d["from"] <= year and (d["to"] is None or year <= d["to"]), f"{year}年は、この資料（{d['label']}）の年に入っていません"

    lines = [
        "/**",
        f" * {d['title']}",
        " *",
        " * ⚠️ このファイルは自動生成です。手で書き換えないでください。",
        " * 元データ: 国税庁の PDF（tax-tables/ フォルダ。入手元とハッシュは tax-tables/README.md）",
        f" * 出典    : 国税庁ホームページ（{source_url}）を加工して作成",
        " *           （PDF の表を Q で使える形に変換したもので、国税庁が作成したものではありません）",
        " * 作り方  : python3 -I scripts/import_densanki.py <PDF> <年> <このファイル> <出典URL>",
        " * 確認    : 表が切れ目なく並び、PDF の計算例の「特例計算による税額」と同じになることを、作るときに確かめてある",
        " *",
        " * 計算のしかたは utils/incomeTax.ts の calcMonthlyWithholdingTax（A = その月の社会保険料等控除後の給与等の金額）",
        " */",
        "import type { DensankiTable, DensankiExample } from './densankiTypes';",
        "",
        f"export const DENSANKI_{year}: DensankiTable = {{",
        f"  title: \"{d['title']}\",",
        "  /** この資料を使える年（PDF の「令和○年分」。to が null は「以降」で、終わりの年がない） */",
        f"  years: {{ from: {d['from']}, to: {'null' if d['to'] is None else d['to']} }},",
        "  /** 第1表：給与所得控除の額 [A の上限（以下）, 率, 加算額]（率が0なら定額。1円未満切り上げ） */",
        "  EMPLOYMENT_DEDUCTION: [",
        *[f"    [{limit(to)}, {num(rate)}, {add}]," for to, rate, add in d["employment"]],
        "  ],",
        "  /** 第2表：配偶者（特別）控除の額・扶養控除の額（1人あたり） */",
        f"  DEPENDENT_DEDUCTION: {d['dependent']},",
        "  /** 第3表：基礎控除の額 [A の上限（以下）, 控除額] */",
        "  BASIC_DEDUCTION: [",
        *[f"    [{limit(to)}, {amount}]," for to, amount in d["basic"]],
        "  ],",
        "  /** 第4表：税額の算式 [課税給与所得金額 B の上限（以下）, 税率（%）, 控除額]（B × 税率 − 控除額。10円未満四捨五入） */",
        "  TAX_RATES: [",
        *[f"    [{limit(to)}, {num(rate)}, {minus}]," for to, rate, minus in d["tax"]],
        "  ],",
        "};",
        "",
        "/**",
        " * PDF の「税額計算の特例により求めた税額と税額表による税額との差異」の計算例",
        " * dependents は扶養親族等の数（源泉控除対象配偶者を含む）、tableTax は月額表甲欄の税額、densankiTax は特例計算による税額",
        " */",
        f"export const DENSANKI_EXAMPLES_{year}: DensankiExample[] = [",
        *[f"  {{ amount: {e['amount']}, dependents: {e['dependents']}, tableTax: {e['tableTax']}, densankiTax: {e['densankiTax']} }}," for e in d["examples"]],
        "];",
    ]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{d['title']}: 第1表 {len(d['employment'])}行・第3表 {len(d['basic'])}行・第4表 {len(d['tax'])}行・計算例 {len(d['examples'])}つ → {out}")


if __name__ == "__main__":
    main()
