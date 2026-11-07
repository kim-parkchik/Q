#!/usr/bin/env python3
"""
厚生労働省の地域別最低賃金の資料から、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_minimum_wage.py \
        minimum-wage-tables/地域別最低賃金改定状況_平成14-令和8年度.xlsx \
        minimum-wage-tables/地域別最低賃金_令和3-7年度.html \
        minimum-wage-tables/地域別最低賃金_令和8年度.html \
        src/constants/minimumWage.ts

・AI や手作業で数字を書き写さないための道具。数字はすべて資料の表から機械的に読み取る。
・1つ目は「平成14年度から令和８年度までの地域別最低賃金改定状況」（Excel）。
  「地域別最低賃金の全国一覧」（MHLW_LIST_URL）のページに載っている。
  ここから、Q で給与を計算できるいちばん古い月（2020年1月）に効力がある令和元年度から、新しい年度までを作る。
・2つ目は「地域別最低賃金の全国一覧（過去5年分）」（PAST_URL）、3つ目は「地域別最低賃金全国一覧」（CURRENT_URL）。
  この2つのページに出ている年度は、Excel と金額・発効日が一つ残らず同じか確かめ、違えば止まる。
  2つ目のページの HTML のコメントの中（画面に出ていない古い年度。令和元年度・令和2年度を含む）は、照らし合わせだけに使う。
・47都道府県がそろわないとき、金額を据え置いた年度ではないのに発効日・金額が前の年度より上がっていないときも止まる。
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import html
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from html.parser import HTMLParser

MHLW_LIST_URL = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/minimumichiran/index.html"
EXCEL_URL = "https://www.mhlw.go.jp/content/11200000/001756130.xlsx"
PAST_URL = "https://saiteichingin.mhlw.go.jp/table/page_list_past.html"
CURRENT_URL = "https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php"

# 令和元年度（2019年10月ごろ発効）から作る。Q の源泉徴収税額表・社会保険料率は2020年分からなので、
# 2020年1月から9月の給与に効力がある令和元年度があれば、Q で計算できるすべての月を比べられる
FIRST_FISCAL_YEAR = 2019

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ZENKAKU = str.maketrans("０１２３４５６７８９", "0123456789")


def squeeze(text):
    """空白（全角の空白も）を取る"""
    return re.sub(r"[\s　]", "", text)


def pref_key(name):
    """都道府県名を、Q の保険料率と同じ書き方にする（東京都→東京、大阪府→大阪、青森県→青森、北海道はそのまま）"""
    name = squeeze(name)
    if name == "東京都":
        return "東京"
    if name.endswith("府") or name.endswith("県"):
        return name[:-1]
    return name


def fiscal_year(label):
    """「平成14年度」「令和元年度」「令和２年度」「令 和 3 年 度」→ 2002・2019・2020・2021"""
    m = re.fullmatch(r"(平成|令和)(元|\d+)年度", squeeze(label).translate(ZENKAKU))
    assert m, f"年度を読み取れません: {label!r}"
    n = 1 if m.group(2) == "元" else int(m.group(2))
    return (1988 if m.group(1) == "平成" else 2018) + n


def era_date(text):
    """「平成27 年10 月8 日」「令和3年10月 1 日」「令和8.10.01」→ 2015-10-08・2021-10-01・2026-10-01"""
    t = squeeze(text).translate(ZENKAKU)
    m = re.fullmatch(r"(平成|令和)(元|\d+)年(\d+)月(\d+)日", t) or re.fullmatch(r"(平成|令和)(元|\d+)\.(\d+)\.(\d+)", t)
    assert m, f"日付を読み取れません: {text!r}"
    n = 1 if m.group(2) == "元" else int(m.group(2))
    y = (1988 if m.group(1) == "平成" else 2018) + n
    return date(y, int(m.group(3)), int(m.group(4))).isoformat()


def era_label(fy):
    """2002 → 平成14年度、2019 → 令和元年度、2026 → 令和8年度"""
    if fy >= 2019:
        return f"令和{'元' if fy == 2019 else fy - 2018}年度"
    return f"平成{fy - 1988}年度"


def yen(text):
    t = text.replace(",", "")
    assert re.fullmatch(r"\d+", t), f"金額を読み取れません: {text!r}"
    return int(t)


# ── Excel（平成14年度から新しい年度までの改定状況） ──────────────────────

def col_index(name):
    """列の名前を番号にする（A→1、Z→26、AA→27）"""
    n = 0
    for ch in name:
        n = n * 26 + (ord(ch) - 64)
    return n


def col_name(n):
    """列の番号を名前にする（1→A、27→AA）"""
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def excel_date(text):
    """Excel の日付（1900年からの通し番号）→ 2019-10-03"""
    serial = float(text)
    assert serial == int(serial) and serial > 60, f"発効年月日を読み取れません: {text!r}"
    return (date(1899, 12, 30) + timedelta(days=int(serial))).isoformat()


def xlsx_rows(path):
    """1枚だけのシートを {行番号: {列の名前: 文字}} にする（ふりがなは入れない）"""
    with zipfile.ZipFile(path) as z:
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = workbook.findall(f"{NS}sheets/{NS}sheet")
        assert len(sheets) == 1, f"シートが1枚ではありません: {[s.get('name') for s in sheets]}"
        pr = workbook.find(f"{NS}workbookPr")
        assert pr is None or pr.get("date1904") not in ("1", "true"), "1904年からの日付の形式には対応していません"
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si"):
                # 文字は si/t か si/r/t にある。ふりがな（si/rPh/t）は入れない
                parts = [t.text or "" for t in si.findall(f"{NS}t")] + [t.text or "" for t in si.findall(f"{NS}r/{NS}t")]
                shared.append("".join(parts))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = {}
    for row in sheet.iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            kind, v = c.get("t"), c.find(f"{NS}v")
            if kind == "s" and v is not None:
                cells[col] = shared[int(v.text)]
            elif kind == "inlineStr":
                cells[col] = "".join(t.text or "" for t in c.findall(f"{NS}is/{NS}t"))
            elif v is not None and v.text is not None:
                cells[col] = v.text
        rows[int(row.get("r"))] = cells
    return rows


def parse_excel(path):
    """Excel：都道府県ごとに {年度: (発効日, 金額)}。1行目が年度、2行目が「改定額(円)」「発効年月日」"""
    rows = xlsx_rows(path)
    header, labels = rows[1], rows[2]
    assert squeeze(header.get("A", "")) == "年度" and squeeze(labels.get("A", "")) == "都道府県名", "見出しの形が違います"
    years = {}  # 改定額の列の番号 → 年度
    for col, text in header.items():
        if col == "A":
            continue
        i = col_index(col)
        assert squeeze(labels.get(col, "")).startswith("改定額") and squeeze(labels.get(col_name(i + 1), "")) == "発効年月日", \
            f"{text} の列の見出しが「改定額」「発効年月日」ではありません"
        years[i] = fiscal_year(text)
    order = [years[i] for i in sorted(years)]
    assert order == list(range(order[0], order[0] + len(order))), f"年度が1年ずつ並んでいません: {order}"

    result = {}
    for r in sorted(rows):
        if r <= 2:
            continue
        cells = rows[r]
        name = squeeze(cells.get("A", ""))
        if name in ("", "全国加重平均額"):
            continue
        key = pref_key(name)
        assert key not in result, f"{key} が2回出てきました"
        entry = {}
        for i, fy in years.items():
            amount, effective = cells.get(col_name(i)), cells.get(col_name(i + 1))
            assert amount and effective, f"{key} の {fy}年度 の金額か発効年月日がありません"
            entry[fy] = (excel_date(effective), yen(amount))
        result[key] = entry
    return result


# ── 厚生労働省のページ（HTML） ──────────────────────────────────────

class TableRows(HTMLParser):
    """表の行ごとに、セル（th・td）を (タグ, 文字, コメントの中か) で集める。
    HTML のコメントの中のセル（画面に出ていない年度）は、コメントの中か＝True で入れる"""

    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.tag = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell, self.tag = [], tag

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append((self.tag, "".join(self.cell).strip(), False))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_comment(self, data):
        m = re.fullmatch(r"\s*<(td|th)\b[^>]*>(.*)</\1>\s*", data, re.S)
        if m and self.row is not None and self.cell is None:
            text = html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))
            self.row.append((m.group(1), text.strip(), True))


def read_rows(path):
    parser = TableRows()
    with open(path, encoding="utf-8") as f:
        parser.feed(f.read())
    return parser.rows


def parse_past(path):
    """過去5年分のページ：都道府県ごとに {年度: (発効日, 金額)} と、画面に出ている年度・出ていない年度"""
    rows = read_rows(path)
    header = next(r for r in rows if any(tag == "th" and "年度" in squeeze(t) for tag, t, _ in r))
    columns = [(fiscal_year(t), hidden) for tag, t, hidden in header if tag == "th" and "年度" in squeeze(t)]
    shown = [fy for fy, hidden in columns if not hidden]
    hidden_years = [fy for fy, hidden in columns if hidden]
    result = {}
    for row in rows:
        cells = [(t, hidden) for tag, t, hidden in row if tag == "td"]
        # 都道府県の行だけ（全国加重平均額の行は、発効日がない）
        if len(cells) != len(columns) + 1 or squeeze(cells[0][0]).startswith("全国加重平均") or not re.search(r"\d", cells[1][0]):
            continue
        key = pref_key(cells[0][0])
        assert key not in result, f"{key} が2回出てきました"
        entry = {}
        for (fy, hidden), (text, cell_hidden) in zip(columns, cells[1:]):
            assert hidden == cell_hidden, f"{key} の {fy}年度 の列が見出しと合いません"
            m = re.fullmatch(r"([\d,]+)\s*((平成|令和).+)", text, re.S)
            assert m, f"金額と発効日を読み取れません: {text!r}"
            entry[fy] = (era_date(m.group(2)), yen(m.group(1)))
        result[key] = entry
    return result, shown, hidden_years


def parse_current(path):
    """今年度のページ：都道府県ごとに、表示されている金額・発効日と、注記（までは／からは）"""
    result = {}
    for row in read_rows(path):
        cells = [t for tag, t, hidden in row if tag == "td" and not hidden]
        if len(cells) != 3:
            continue
        name, money, effective = cells
        m = re.match(r"\s*([\d,]+)円", money)
        if not m:
            continue
        note = re.search(r"令和(\d+\.\d+\.\d+)(まで|から)は([\d,]+)円", squeeze(money))
        assert note, f"{name} の注記を読み取れません: {money!r}"
        key = pref_key(name)
        assert key not in result, f"{key} が2回出てきました"
        result[key] = {
            "shown": (era_date(effective), yen(m.group(1))),
            "note_date": era_date("令和" + note.group(1)),
            "note_kind": note.group(2),
            "note_amount": yen(note.group(3)),
        }
    return result


def main():
    excel_path, past_path, current_path, out = sys.argv[1:5]
    excel = parse_excel(excel_path)
    past, shown_years, hidden_years = parse_past(past_path)
    current = parse_current(current_path)
    assert len(excel) == 47, f"Excel の都道府県が47ではありません: {len(excel)}"
    for label, d in (("過去5年分のページ", past), ("今年度のページ", current)):
        assert set(d) == set(excel), f"Excel と{label}の都道府県が違います: {set(d) ^ set(excel)}"

    years = sorted(next(iter(excel.values())))
    latest = years[-1]
    assert FIRST_FISCAL_YEAR in years, f"Excel に {FIRST_FISCAL_YEAR}年度がありません"
    assert shown_years and shown_years[-1] + 1 == latest, \
        f"Excel の新しい年度（{latest}年度）が、過去5年分のページ（〜{shown_years[-1]}年度）の次の年度ではありません"

    # 照らし合わせ：2つのページに出ている年度（画面に出ていない古い年度も）は、Excel と一つ残らず同じ
    checked = sorted(fy for fy in shown_years + hidden_years if fy >= FIRST_FISCAL_YEAR) + [latest]
    for key, entry in excel.items():
        for fy in shown_years + hidden_years:
            if fy >= FIRST_FISCAL_YEAR:
                assert entry[fy] == past[key][fy], f"{key} の {fy}年度：Excel {entry[fy]} と過去5年分のページ {past[key][fy]} が違います"
        c = current[key]
        new, before = entry[latest], entry[latest - 1]
        if c["note_kind"] == "まで":
            # 新しい金額がもう発効している：表示＝今年度、注記＝前年度の金額（発効日の前日まで）
            assert c["shown"] == new and c["note_amount"] == before[1], f"{key} の今年度：Excel {new} と今年度のページ {c} が違います"
            assert date.fromisoformat(c["note_date"]) + timedelta(days=1) == date.fromisoformat(new[0]), f"{key} の注記の日付が発効日の前日ではありません"
        else:
            # まだ発効していない：表示＝前年度の金額と発効日、注記＝今年度の金額と発効日
            assert c["shown"] == before and (c["note_date"], c["note_amount"]) == new, f"{key} の今年度：Excel {new} と今年度のページ {c} が違います"

    # 令和元年度から作る。金額を据え置いた年度（前の年度と金額も発効日も同じ）は、前の年度の金額が続くので入れない
    data, kept = {}, 0
    for key in past:  # 並びは過去5年分のページの順
        entries = []
        for fy in years:
            if fy < FIRST_FISCAL_YEAR:
                continue
            item = excel[key][fy]
            if entries and item == entries[-1]:
                kept += 1
                continue
            if entries:
                (d1, a1), (d2, a2) = entries[-1], item
                assert d1 < d2 and a1 < a2, f"{key} の {fy}年度：発効日も金額も前の年度より後・上ではありません（{entries[-1]} → {item}）"
            entries.append(item)
        data[key] = entries

    lines = [
        "/**",
        " * 地域別最低賃金（時間額）と発効年月日",
        " *",
        " * ⚠️ このファイルは自動生成です。手で書き換えないでください。",
        " * 元データ: 厚生労働省 最低賃金制度の資料（minimum-wage-tables/ フォルダ）",
        f" * 出典    : 厚生労働省「{era_label(years[0])}から{era_label(latest)}までの地域別最低賃金改定状況」（{EXCEL_URL}。",
        f" *           「地域別最低賃金の全国一覧」{MHLW_LIST_URL} に掲載）",
        f" *           厚生労働省ホームページ「地域別最低賃金の全国一覧（過去5年分）」（{PAST_URL}）",
        f" *           「地域別最低賃金全国一覧」（{CURRENT_URL}）を加工して作成",
        " *           （表を Q で使える形に変換したもので、厚生労働省が作成したものではありません）",
        f" * 範囲    : {era_label(FIRST_FISCAL_YEAR)}から。金額を据え置いた年度は、前の年度の金額が続くので入れていない",
        " * 作り方  : python3 -I scripts/import_minimum_wage.py <改定状況のExcel> <過去5年分のHTML> <今年度のHTML> <このファイル>",
        " */",
        "export interface MinimumWageEntry {",
        "  /** 発効年月日（この日から） */",
        "  from: string;",
        "  /** 最低賃金（時間額・円） */",
        "  amount: number;",
        "}",
        "",
        "/** 都道府県ごとの最低賃金（発効日の古い順）。都道府県名は保険料率と同じ書き方（東京・大阪・青森など） */",
        "export const MINIMUM_WAGES: Record<string, MinimumWageEntry[]> = {",
    ]
    for key, entries in data.items():
        items = ", ".join(f'{{ from: "{d}", amount: {a} }}' for d, a in entries)
        lines.append(f'  "{key}": [{items}],')
    lines.append("};")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{out} を作りました（{len(data)}都道府県、{era_label(FIRST_FISCAL_YEAR)}〜{era_label(latest)}。据え置きで入れなかった年度 {kept}件）")
    print(f"照らし合わせた年度：{'・'.join(era_label(fy) for fy in checked)}"
          f"（過去5年分のページの画面に出ていない {'・'.join(era_label(fy) for fy in hidden_years if fy >= FIRST_FISCAL_YEAR)} を含む）")


if __name__ == "__main__":
    main()
