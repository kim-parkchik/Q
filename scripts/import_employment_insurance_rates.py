#!/usr/bin/env python3
"""
雇用保険料率（一般の事業・農林水産・清酒製造の事業・建設の事業の、本人負担と合計）を、厚生労働省「令和○年度の雇用保険料率について」の
PDF から読み取って、src/constants/insurance/laborInsuranceRates.ts を作る（手や AI で書き写さない）。

使い方:
    python3 -I scripts/import_employment_insurance_rates.py insurance-tables/source src/constants/insurance/laborInsuranceRates.ts

読むもの（insurance-tables/source に置く。入手元と SHA-256 は insurance-tables/README.md。下の SOURCES も同じ）:
・令和3〜8年度の「雇用保険料率について」の PDF（koyou-ryouritsu-r03.pdf 〜 koyou-ryouritsu-r08.pdf）
  字と、その位置（scripts/pdf_to_chars.swift）を読み、同じ高さにある5つの率を表の1行にする。
  列は左から「①労働者負担・②事業主負担・②のうち失業等給付・育児休業給付の保険料率・②のうち雇用保険二事業の保険料率・①＋②雇用保険料率」。
  行の左の名前が「一般の事業」「清酒製造の事業」（農林水産・清酒製造の事業）「建設の事業」なら、その年度の率（上の段）、
  「（３年度）」「（令和５年度）」などのかっこなら、前の年度の率（下の段）。
  表の期間は、表のすぐ上にある「令和○年４月１日から令和○年３月31日まで」「○令和４年１０月１日 ～ 令和５年３月３１日」から、
  下の段の期間は、表の下の「（枠内の下段は令和４年10月～令和５年３月の雇用保険料率）」などから読む。

確かめること（1つでも合わなければ、ファイルを作らずに止まる）:
・どの行も、①＋②が合計と同じ、②が失業等給付・育児休業給付の率と二事業の率の和と同じ、①が失業等給付・育児休業給付の率と同じ
・どの表も、3つの事業が「一般の事業・清酒製造の事業・建設の事業」の順にそろい、下の段があれば3つともある
・表の期間が月の初めの日から月の終わりの日まで、PDF の題名の年度が、ファイルの名前の年度と同じ
・下の段の率が、その期間の年度の PDF（上の段）の率と同じ。どの年度の PDF にもない期間（令和2年度）は、下の段の率を使う
・できた期間が、すき間も重なりもなく続く

令和5年度の PDF の下の段（令和4年10月〜）の一般の事業の②は「8,5/1,000」と書かれている。「,」のあとが1けたで、千の位の区切りではないので、
8.5/1,000 の書きまちがいとして読む（行の足し算と、令和4年度の PDF の率で確かめる）。読んだときは、そのことを出す。

標準ライブラリと macOS の PDFKit（scripts/pdf_to_chars.swift）だけで動く（追加のインストールは要らない）。
"""
import calendar
import hashlib
import re
import subprocess
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

PAGE_URL = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000108634.html"

# （ファイル, 入手元）。新しい年度の PDF を足すときは、ここと insurance-tables/README.md に足す
SOURCES = [
    ("koyou-ryouritsu-r03.pdf", "https://www.mhlw.go.jp/content/000739455.pdf"),
    ("koyou-ryouritsu-r04.pdf", "https://www.mhlw.go.jp/content/000921550.pdf"),
    ("koyou-ryouritsu-r05.pdf", "https://www.mhlw.go.jp/content/001050206.pdf"),
    ("koyou-ryouritsu-r06.pdf", "https://www.mhlw.go.jp/content/001211914.pdf"),
    ("koyou-ryouritsu-r07.pdf", "https://www.mhlw.go.jp/content/001401966.pdf"),
    ("koyou-ryouritsu-r08.pdf", "https://www.mhlw.go.jp/content/001692566.pdf"),
]

# 表の行の名前 → （Q の名前, コメントに書く名前）
BUSINESSES = {
    "一般の事業": ("general", "一般の事業"),
    "清酒製造の事業": ("agriculture", "農林水産・清酒製造"),
    "建設の事業": ("construction", "建設の事業"),
}
ORDER = ["general", "agriculture", "construction"]

RATE = re.compile(r"^(\d+)(?:([.,])(\d+))?/1,?000$")
DATE = r"令和(\d+)\s*(?:\((\d{4})\))?\s*年(\d+)月(\d+)日"
PERIOD = re.compile(DATE + r"\s*(?:から|~)\s*" + DATE)
NOTE = re.compile(r"\(枠内の下段は(.+?)の雇用保険料率\)")
TITLE = re.compile(r"^令和(\d+)\s*(?:\((\d{4})\))?\s*年度.*雇用保険料率(?:について|のご案内)$")

notes_out = []


def fail(message):
    sys.stderr.write(f"止まりました: {message}\n")
    sys.exit(1)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def nfkc(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def reiwa_year(reiwa, western, where):
    year = 2018 + int(reiwa)
    if western and int(western) != year:
        fail(f"{where}：令和{reiwa}年と、かっこの中の {western}年が合いません")
    return year


def month_index(year, month):
    return year * 12 + (month - 1)


def ym(index):
    return index // 12, index % 12 + 1


def ym_label(index):
    y, m = ym(index)
    return f"令和{y - 2018}年{m}月"


def read_items(pdf):
    """PDF の1ページめの字のまとまり（x, y, 字）。率が2ページめ以後にあれば止まる"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_chars.swift"), str(pdf)], check=True, capture_output=True, text=True).stdout
    items, page = [], 0
    for line in out.splitlines():
        if line.startswith("=== page "):
            page = int(line.split()[2])
            continue
        parts = line.split("\t")
        if len(parts) != 5:
            continue
        x, y, text = float(parts[0]), float(parts[1]), nfkc(parts[4])
        if page != 1:
            if RATE.match(text):
                fail(f"{pdf.name}：2ページめ以後にも率があります（{text}）")
            continue
        items.append((x, y, text))
    if not items:
        fail(f"{pdf.name}：字を取り出せません")
    return items


def rate_of(text, where):
    """「5/1,000」「13.5/1,000」を 1,000分のいくつ（Decimal）にする"""
    m = RATE.match(text)
    if not m:
        return None
    whole, sep, frac = m.groups()
    if sep == ",":
        if len(frac) != 1:
            fail(f"{where}：「{text}」を読めません")
        notes_out.append(f"{where}の「{text}」は、{whole}.{frac}/1,000 の書きまちがいとして読みました")
    return Decimal(f"{whole}.{frac}") if frac else Decimal(whole)


def parse_period(text):
    m = PERIOD.search(text)
    if not m:
        return None
    r1, w1, m1, d1, r2, w2, m2, d2 = m.groups()
    y1, y2 = reiwa_year(r1, w1, text), reiwa_year(r2, w2, text)
    if int(d1) != 1:
        fail(f"期間「{text}」が月の初めの日から始まっていません")
    if int(d2) != calendar.monthrange(y2, int(m2))[1]:
        fail(f"期間「{text}」が月の終わりの日で終わっていません")
    return month_index(y1, int(m1)), month_index(y2, int(m2))


def parse_note_range(text):
    """「令和２年度」「令和４年10月~令和５年３月」を（初めの月, 終わりの月）にする"""
    m = re.fullmatch(r"令和(\d+)年度", text)
    if m:
        y = 2018 + int(m.group(1))
        return month_index(y, 4), month_index(y + 1, 3)
    m = re.fullmatch(r"令和(\d+)年(\d+)月~令和(\d+)年(\d+)月", text)
    if m:
        r1, m1, r2, m2 = (int(g) for g in m.groups())
        return month_index(2018 + r1, m1), month_index(2018 + r2, m2)
    fail(f"下の段の期間「{text}」を読めません")


def read_pdf(path, url):
    """1つの PDF の表：[{from, until, rows: {general: (本人, 合計), …}, lower: {…} or None, lowerRange}]"""
    name = path.name
    items = read_items(path)

    titles = [t for _, _, t in items if TITLE.match(t)]
    if not titles:
        fail(f"{name}：「令和○年度…雇用保険料率…」の題名が見つかりません")
    tm = TITLE.match(titles[0])
    title_year = reiwa_year(tm.group(1), tm.group(2), name)
    file_year = 2018 + int(re.search(r"r(\d+)\.pdf$", name).group(1))
    if title_year != file_year:
        fail(f"{name}：題名の年度（{titles[0]}）が、ファイルの名前の年度と違います")

    periods = [(y, parse_period(t), t) for _, y, t in items if PERIOD.search(t)]
    notes = [(y, NOTE.search(t).group(1)) for _, y, t in items if NOTE.search(t)]

    # 同じ高さの率を1行にまとめる
    rows_by_y = {}
    for x, y, t in items:
        r = rate_of(t, f"{name}（y={y}）")
        if r is not None:
            rows_by_y.setdefault(y, []).append((x, r, t))
    rows = []
    for y, values in sorted(rows_by_y.items(), key=lambda kv: -kv[0]):
        values.sort()
        if len(values) != 5:
            fail(f"{name}：y={y} の行の率が5つではありません（{[t for _, _, t in values]}）")
        left = min(x for x, _, _ in values)
        labels = [t for x, ly, t in items if abs(ly - y) <= 1.0 and x < left and not RATE.match(t)]
        if len(labels) != 1:
            fail(f"{name}：y={y} の行の名前が1つに決まりません（{labels}）")
        label = labels[0]
        w, e, u, t2, total = (r for _, r, _ in values)
        where = f"{name} の「{label}」の行"
        if w + e != total:
            fail(f"{where}：①{w}＋②{e} が合計 {total} と違います")
        if u + t2 != e:
            fail(f"{where}：②{e} が、失業等給付・育児休業給付の率 {u} と二事業の率 {t2} の和と違います")
        if w != u:
            fail(f"{where}：①{w} が、失業等給付・育児休業給付の率 {u} と違います")
        rows.append({"y": y, "label": label, "worker": w, "total": total})

    # 表ごとに分ける（行のすぐ上にある期間の見出しが、その行の表の期間）
    tables = {}
    for row in rows:
        above = [p for p in periods if p[0] > row["y"]]
        if not above:
            fail(f"{name}：「{row['label']}」の行の上に、期間の見出しがありません")
        py, (start, until), ptext = min(above, key=lambda p: p[0])
        tables.setdefault(py, {"from": start, "until": until, "heading": ptext, "rows": []})["rows"].append(row)

    out = []
    for py in sorted(tables, reverse=True):
        table = tables[py]
        upper, lower, current = {}, {}, None
        for row in table["rows"]:
            label = row["label"]
            if label in BUSINESSES:
                key = BUSINESSES[label][0]
                if key in upper:
                    fail(f"{name}：「{label}」の行が2つあります")
                upper[key] = (row["worker"], row["total"])
                current = key
            elif label.startswith("(") and label.endswith(")"):
                if current is None or current in lower:
                    fail(f"{name}：下の段「{label}」が、どの事業の行かわかりません")
                lower[current] = (row["worker"], row["total"])
            else:
                fail(f"{name}：行の名前「{label}」を読めません")
        order = [BUSINESSES[r["label"]][0] for r in table["rows"] if r["label"] in BUSINESSES]
        if order != ORDER:
            fail(f"{name}（{table['heading']}）：事業の行が「一般の事業・清酒製造の事業・建設の事業」の順にそろっていません")
        if lower and sorted(lower) != sorted(ORDER):
            fail(f"{name}（{table['heading']}）：下の段が3つの事業にそろっていません")
        lower_range = None
        if lower:
            bottom = min(r["y"] for r in table["rows"])
            below = [n for n in notes if n[0] < bottom]
            if not below:
                fail(f"{name}（{table['heading']}）：下の段の期間（枠内の下段は…）が見つかりません")
            lower_range = parse_note_range(max(below, key=lambda n: n[0])[1])
        out.append({
            "from": table["from"], "until": table["until"], "rates": upper, "lower": lower or None, "lowerRange": lower_range,
            "file": name, "url": url, "title": titles[0], "heading": table["heading"],
        })
    if any(t["from"] < month_index(file_year, 4) or t["until"] > month_index(file_year + 1, 3) for t in out):
        fail(f"{name}：表の期間が、令和{file_year - 2018}年度（4月〜翌年3月）からはみ出しています")
    return out


def frac(r):
    return format(r.normalize(), "f")


def decimal_of(r):
    return format((r / 1000).normalize(), "f")


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_employment_insurance_rates.py insurance-tables/source src/constants/insurance/laborInsuranceRates.ts")
    folder, out_path = Path(sys.argv[1]), sys.argv[2]

    tables, hashes = [], []
    for file, url in SOURCES:
        path = folder / file
        if not path.exists():
            fail(f"{path} がありません（入手元 {url}）")
        hashes.append((file, url, sha256(path)))
        tables.extend(read_pdf(path, url))

    # 年度の PDF の上の段（その期間の率）
    periods = sorted(({**t, "fromLower": False} for t in tables), key=lambda t: t["from"])
    for a, b in zip(periods, periods[1:]):
        if b["from"] <= a["until"]:
            fail(f"{a['file']} と {b['file']} の期間が重なっています")

    # 下の段（前の年度の率）は、その期間の PDF の率と照らし合わせる。どの PDF にもない期間は、下の段の率を使う
    checked = []
    for t in tables:
        if not t["lower"]:
            continue
        start, until = t["lowerRange"]
        covering = [p for p in periods if not p["fromLower"] and p["from"] <= until and p["until"] >= start]
        if covering:
            months = sum(min(until, p["until"]) - max(start, p["from"]) + 1 for p in covering)
            if months != until - start + 1:
                fail(f"{t['file']} の下の段（{ym_label(start)}〜{ym_label(until)}）の一部の期間に、年度の PDF がありません")
            for p in covering:
                if p["rates"] != t["lower"]:
                    fail(f"{t['file']} の下の段（{ym_label(start)}〜{ym_label(until)}）の率が、{p['file']}（{p['heading']}）の率と違います")
                checked.append(f"{t['file']} の下の段 → {p['file']}（{ym_label(p['from'])}〜）")
        else:
            periods.append({
                "from": start, "until": until, "rates": t["lower"], "lower": None, "lowerRange": None, "file": t["file"], "url": t["url"],
                "title": t["title"], "heading": t["heading"], "fromLower": True,
            })
    periods.sort(key=lambda p: p["from"])
    for a, b in zip(periods, periods[1:]):
        if b["from"] != a["until"] + 1:
            fail(f"{ym_label(a['until'])} と {ym_label(b['from'])} のあいだで、期間がとぎれるか重なっています")

    blocks = []
    for p in periods:
        where = f"「{p['title']}」の表の下の段" if p["fromLower"] else (
            f"「{p['title']}」の「{p['heading']}」の表" if p["heading"].startswith("○") else f"「{p['title']}」の表")
        y, m = ym(p["from"])
        lines = [
            "  {",
            f"    // {ym_label(p['from'])}〜{ym_label(p['until'])}（{where}）",
            f"    from: {{ year: {y}, month: {m} }},",
            f"    source: \"{p['url']}\",",
            "    rates: {",
        ]
        for key in ORDER:
            worker, total = p["rates"][key]
            name = next(v[1] for v in BUSINESSES.values() if v[0] == key)
            pad = " " * (13 - len(key))
            lines.append(f"      {key}:{pad}[{decimal_of(worker)}, {decimal_of(total)}], // {name}: 本人 {frac(worker)}/1000、合計 {frac(total)}/1000")
        lines += ["    },", "  },"]
        blocks.append("\n".join(lines))

    sources = "\n".join(f" *   insurance-tables/source/{file}（{url}）SHA-256 {h}" for file, url, h in hashes)
    ts = f"""/**
 * 雇用保険料率の一覧（古い順）
 *
 * このファイルは scripts/import_employment_insurance_rates.py で、厚生労働省「令和○年度の雇用保険料率について」の PDF から作る
 * （手で書き換えない。作り方は insurance-tables/README.md）。PDF は「雇用保険料率について」のページ（{PAGE_URL}）にある:
{sources}
 *
 * 料率は「何年何月から」で切り替える。通常は4月1日から翌3月31日までの年度ごとに決まるが、
 * 令和4年度のように年度の途中（10月）で変わることもあるので、変わった月ごとに1行ずつ並べる。
 * 給与計算では、その月までに始まっている最後の行を使う（index.ts の getInsuranceMaster）。
 * 各年度の PDF の表（上の段）の率を使い、下の段（前の年度の率）は、前の年度の PDF の率と同じことを確かめた。
 * 令和2年度は、令和3年度の PDF の下の段の率。
 * ※ 令和2年3月までは、4月1日に64歳以上の人の保険料が免除されていた（Q はこの免除に対応していないので、ここより前は作らない）
 */
import type {{ YearMonth }} from './kenpoTableTypes';

/** 雇用保険料率 [本人負担, 合計]（小数。0.005 = 5/1000） */
export interface LaborInsuranceRates {{
  general: [number, number];
  agriculture: [number, number];
  construction: [number, number];
}}

export type EmpInsType = keyof LaborInsuranceRates;

export interface LaborInsurancePeriod {{
  /** この月の分から使う */
  from: YearMonth;
  rates: LaborInsuranceRates;
  /** 出典（厚生労働省の PDF） */
  source: string;
}}

export const LABOR_INSURANCE_PERIODS: LaborInsurancePeriod[] = [
{chr(10).join(blocks)}
];
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    for n in notes_out:
        print(f"注意: {n}")
    for c in checked:
        print(f"照らし合わせ: {c}")
    print(f"{out_path} を作りました：{len(periods)}の期間（{ym_label(periods[0]['from'])}〜{ym_label(periods[-1]['until'])}）")


if __name__ == "__main__":
    main()
