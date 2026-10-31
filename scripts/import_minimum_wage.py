#!/usr/bin/env python3
"""
厚生労働省「地域別最低賃金の全国一覧」のページ（HTML）から、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_minimum_wage.py \
        minimum-wage-tables/地域別最低賃金_令和3-7年度.html \
        minimum-wage-tables/地域別最低賃金_令和8年度.html \
        src/constants/minimumWage.ts

・AI や手作業で数字を書き写さないための道具。数字はすべてページの表から機械的に読み取る。
・1つ目は「地域別最低賃金の全国一覧（過去5年分）」（https://saiteichingin.mhlw.go.jp/table/page_list_past.html）
・2つ目は「地域別最低賃金全国一覧」（https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php）
・HTML のコメントの中（画面に表示されていない古い年度）は読まない。
・2つのページの同じ年度の金額・発効日が食い違うときや、47都道府県がそろわないときは、エラーで止まる。
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import re
import sys
from html.parser import HTMLParser

PAST_URL = "https://saiteichingin.mhlw.go.jp/table/page_list_past.html"
CURRENT_URL = "https://saiteichingin.mhlw.go.jp/table/page_list_nationallist.php"


class TableRows(HTMLParser):
    """表の行ごとに、td の文字を集める（コメントは HTMLParser が別に扱うので入らない）"""

    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag == "td" and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag == "td" and self.cell is not None:
            self.row.append("".join(self.cell).strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def read_rows(path):
    parser = TableRows()
    with open(path, encoding="utf-8") as f:
        parser.feed(f.read())
    return parser.rows


def pref_key(name):
    """都道府県名を、Q の保険料率と同じ書き方にする（東京都→東京、大阪府→大阪、青森県→青森、北海道はそのまま）"""
    name = re.sub(r"[\s　]", "", name)
    if name == "東京都":
        return "東京"
    if name.endswith("府") or name.endswith("県"):
        return name[:-1]
    return name


def reiwa_date(text):
    """「令和3年10月 1 日」「令和8.10.01」→ 2021-10-01"""
    t = re.sub(r"[\s　]", "", text)
    m = re.fullmatch(r"令和(\d+)年(\d+)月(\d+)日", t) or re.fullmatch(r"令和(\d+)\.(\d+)\.(\d+)", t)
    assert m, f"日付を読み取れません: {text!r}"
    y, mo, d = (int(x) for x in m.groups())
    return f"{2018 + y:04d}-{mo:02d}-{d:02d}"


def yen(text):
    return int(text.replace(",", ""))


def parse_past(path):
    """過去5年分：都道府県ごとに [(発効日, 金額)]（年度の古い順）"""
    result = {}
    for row in read_rows(path):
        cells = [c for c in row]
        if len(cells) < 2 or not re.search(r"\d+.*令和", cells[1]):
            continue
        entries = []
        for c in cells[1:]:
            m = re.fullmatch(r"\s*([\d,]+)\s*(令和.+)", c, re.S)
            assert m, f"金額と発効日を読み取れません: {c!r}"
            entries.append((reiwa_date(m.group(2)), yen(m.group(1))))
        key = pref_key(cells[0])
        assert key not in result, f"{key} が2回出てきました"
        result[key] = entries
    return result


def parse_current(path):
    """今年度：都道府県ごとに、表示されている金額・発効日と、注記（までは／からは）"""
    result = {}
    for row in read_rows(path):
        if len(row) != 3:
            continue
        name, money, date = row
        m = re.match(r"\s*([\d,]+)円", money)
        if not m:
            continue
        note = re.search(r"令和(\d+\.\d+\.\d+)(まで|から)は([\d,]+)円", re.sub(r"[\s　]", "", money))
        assert note, f"{name} の注記を読み取れません: {money!r}"
        key = pref_key(name)
        assert key not in result, f"{key} が2回出てきました"
        result[key] = {
            "shown": (reiwa_date(date), yen(m.group(1))),
            "note_date": reiwa_date("令和" + note.group(1)),
            "note_kind": note.group(2),
            "note_amount": yen(note.group(3)),
        }
    return result


def main():
    past_path, current_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    past = parse_past(past_path)
    current = parse_current(current_path)
    assert len(past) == 47, f"過去5年分の都道府県が47ではありません: {len(past)}"
    assert set(past) == set(current), f"2つのページの都道府県が違います: {set(past) ^ set(current)}"

    data = {}
    for key, entries in past.items():
        # 年度の順に、発効日も金額も上がっていること
        for (d1, a1), (d2, a2) in zip(entries, entries[1:]):
            assert d1 < d2 and a1 < a2, f"{key} の年度の順がおかしい: {entries}"
        last_date, last_amount = entries[-1]
        c = current[key]
        if c["note_kind"] == "まで":
            # 新しい金額がもう発効している：表示＝今年度、注記＝前年度の金額（発効日の前日まで）
            new = c["shown"]
            assert c["note_amount"] == last_amount, f"{key} の前年度の金額が2つのページで違います"
        else:
            # まだ発効していない：表示＝前年度の金額と発効日、注記＝今年度の金額と発効日
            assert c["shown"] == (last_date, last_amount), f"{key} の前年度の金額・発効日が2つのページで違います"
            new = (c["note_date"], c["note_amount"])
        assert new[0] > last_date and new[1] > last_amount, f"{key} の今年度の値がおかしい: {new}"
        data[key] = entries + [new]

    lines = [
        "/**",
        " * 地域別最低賃金（時間額）と発効年月日",
        " *",
        " * ⚠️ このファイルは自動生成です。手で書き換えないでください。",
        " * 元データ: 厚生労働省 最低賃金制度のページ（minimum-wage-tables/ フォルダ）",
        f" * 出典    : 厚生労働省ホームページ「地域別最低賃金の全国一覧（過去5年分）」（{PAST_URL}）",
        f" *           「地域別最低賃金全国一覧」（{CURRENT_URL}）を加工して作成",
        " *           （表を Q で使える形に変換したもので、厚生労働省が作成したものではありません）",
        " * 作り方  : python3 -I scripts/import_minimum_wage.py <過去5年分のHTML> <今年度のHTML> <このファイル>",
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
    print(f"{out} を作りました（{len(data)}都道府県 × {len(next(iter(data.values())))}年度）")


if __name__ == "__main__":
    main()
