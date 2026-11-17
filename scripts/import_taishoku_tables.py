#!/usr/bin/env python3
"""
退職手当等（退職金）に対する所得税・住民税の計算に使う数値を、法令の XML と国税庁の PDF から読み取って、
Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_taishoku_tables.py taishoku-tables src/constants/taishoku.ts

読むもの（入手元は taishoku-tables/README.md）:
・taishoku-tables/shotokuzei-30.xml       所得税法 第30条（退職所得）。e-Gov 法令API の条文
    退職所得の金額（2分の1・短期退職手当等の300万円と150万円・特定役員退職手当等）、退職所得控除額（40万円・20年・800万円・70万円・
    80万円・障害者の100万円）、短期退職手当等と特定役員退職手当等の「5年以下」
・taishoku-tables/shotokuzei-rei-69.xml   所得税法施行令 第69条（勤続年数の計算）。2項の「一年未満の端数を生じたときは、これを一年として」
・taishoku-tables/chihouzei-50-4.xml      地方税法 第50条の4（道府県民税の分離課税に係る所得割の税率。百分の四）
・taishoku-tables/chihouzei-328-3.xml     地方税法 第328条の3（市町村民税の分離課税に係る所得割の税率。百分の六）
・taishoku-tables/source/zeigakuhyo2026-18.pdf  国税庁「退職所得の源泉徴収税額の速算表（令和8年分）」
・taishoku-tables/source/zeigakuhyo2027-18.pdf  国税庁「退職所得の源泉徴収税額の速算表（令和9年分）」
・taishoku-tables/source/tebiki2026-03.pdf      国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第3章
    「退職所得の受給に関する申告書」の提出がないときの「100 分の 20.42」

次のときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
・条文の決まった言い回し（「四十万円に当該勤続年数を乗じて計算した金額」など）が見つからない
・800万円が 40万円 × 20年 と違う、150万円が 300万円の2分の1 と違う
・速算表の行が読めない、行の境目がつながらない、税率・控除額が税額の算式の欄と違う、控除額が速算表の作り（前の行の控除額 ＋
  境目の金額 × 税率の差）と合わない、「×102.1％」「1 円未満の端数があるときは、これを切り捨てます」がない
・20.42 が 102.1％ をかけた整数の税率でない
・標準ライブラリだけで動く（追加のインストールは要らない）。PDF の字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。
"""
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

LAW_SOURCES = {
    "shotokuzei-30.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=30",
    "shotokuzei-rei-69.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=69",
    "chihouzei-50-4.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=50_4",
    "chihouzei-328-3.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=328_3",
}
PDF_SOURCES = {
    "zeigakuhyo2026-18.pdf": "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf",
    "zeigakuhyo2027-18.pdf": "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/18.pdf",
    "tebiki2026-03.pdf": "https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/03.pdf",
}


def fail(message):
    print(f"止まりました: {message}", file=sys.stderr)
    sys.exit(1)


def nfkc(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------- 漢数字 ----------
DIGITS = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
SMALL = {"十": 10, "百": 100, "千": 1000}
LARGE = {"万": 10_000, "億": 100_000_000}


def kanji_number(s):
    """「八百万」「百五十万」「二十」などを数にする（読めない字があれば止まる）"""
    total, section, digit = 0, 0, None
    for ch in s:
        if ch in DIGITS:
            if digit is not None:
                fail(f"漢数字「{s}」を読めません")
            digit = DIGITS[ch]
        elif ch in SMALL:
            section += (1 if digit is None else digit) * SMALL[ch]
            digit = None
        elif ch in LARGE:
            section += digit or 0
            total += (section or 1) * LARGE[ch]
            section, digit = 0, None
        else:
            fail(f"漢数字「{s}」の「{ch}」を読めません")
    return total + section + (digit or 0)


KANJI = "〇一二三四五六七八九十百千万億"


def yen(text, pattern):
    """条文の言い回し（{n} が漢数字の金額・年数）を探して、その数を返す"""
    rx = re.escape(pattern).replace(re.escape("{n}"), f"([{KANJI}]+)")
    m = re.search(rx, text)
    if not m:
        fail(f"条文に「{pattern}」が見つかりません")
    return [kanji_number(g) for g in m.groups()]


# ---------- 法令の XML ----------
def law_article(path):
    """e-Gov 法令API（v1 の articles）の XML：{ 項の番号: { "text": 柱書き, "items": { 号の番号: 号の文 } } }"""
    root = ET.parse(path).getroot()
    if root.findtext("Result/Code") != "0":
        fail(f"{path.name} は条文の取得に失敗したときの XML です")
    art = root.find("ApplData/LawContents/Article")
    if art is None:
        fail(f"{path.name} に条文（Article）がありません")
    paras = {}
    for p in art.findall("Paragraph"):
        sentence = "".join(p.find("ParagraphSentence").itertext())
        items = {i.get("Num"): "".join(i.itertext()) for i in p.findall("Item")}
        paras[p.get("Num")] = {"text": re.sub(r"\s+", "", sentence), "items": {k: re.sub(r"\s+", "", v) for k, v in items.items()}}
    return {"caption": art.findtext("ArticleCaption") or "", "title": art.findtext("ArticleTitle") or "", "paras": paras}


def read_income_tax_law(folder):
    a = law_article(folder / "shotokuzei-30.xml")
    if a["title"] != "第三十条" or a["caption"] != "（退職所得）":
        fail(f"shotokuzei-30.xml が所得税法第30条（退職所得）ではありません（{a['title']}{a['caption']}）")
    p = a["paras"]
    for n in ("2", "3", "4", "5", "6"):
        if n not in p:
            fail(f"所得税法第30条の第{n}項がありません")
    p2 = p["2"]
    half_n, half_d = None, None
    m = re.search(r"控除した残額の([一二三四五六七八九十]+)分の([一二三四五六七八九十]+)に相当する金額", p2["text"])
    if not m:
        fail("所得税法第30条2項に「残額の二分の一に相当する金額」が見つかりません")
    half_d, half_n = kanji_number(m.group(1)), kanji_number(m.group(2))
    if "特定役員退職手当等である場合には当該退職手当等の収入金額から退職所得控除額を控除した残額に相当する金額" not in p2["text"]:
        fail("所得税法第30条2項に、特定役員退職手当等は2分の1にしない言い回しが見つかりません")
    [short_threshold] = yen(p2["items"].get("1", ""), "退職所得控除額を控除した残額が{n}円以下である場合")
    m = re.search(r"当該残額の([一二三四五六七八九十]+)分の([一二三四五六七八九十]+)に相当する金額", p2["items"]["1"])
    if not m or [kanji_number(m.group(2)), kanji_number(m.group(1))] != [half_n, half_d]:
        fail("所得税法第30条2項1号に、柱書きと同じ「当該残額の二分の一に相当する金額」が見つかりません")
    short_base, short_threshold2 = yen(p2["items"].get("2", ""), "{n}円と当該退職手当等の収入金額から{n}円に退職所得控除額を加算した金額を控除した残額との合計額")
    if short_threshold2 != short_threshold:
        fail(f"所得税法第30条2項1号と2号の金額が違います（{short_threshold}・{short_threshold2}）")
    if short_base * half_d != short_threshold * half_n:
        fail(f"所得税法第30条2項2号の {short_base}円が、{short_threshold}円の{half_n}/{half_d} と違います")

    p3 = p["3"]
    [years_threshold] = yen(p3["items"].get("1", ""), "勤続年数」という。）が{n}年以下である場合")
    [per_year] = yen(p3["items"]["1"], "{n}円に当該勤続年数を乗じて計算した金額")
    [years_threshold2] = yen(p3["items"].get("2", ""), "勤続年数が{n}年を超える場合")
    base, per_year_over, years_threshold3 = yen(p3["items"]["2"], "{n}円と{n}円に当該勤続年数から{n}年を控除した年数を乗じて計算した金額との合計額")
    if not (years_threshold == years_threshold2 == years_threshold3):
        fail(f"所得税法第30条3項の年数が違います（{years_threshold}・{years_threshold2}・{years_threshold3}）")
    if base != per_year * years_threshold:
        fail(f"所得税法第30条3項2号の {base}円が、{per_year}円 × {years_threshold}年 と違います")

    [short_years] = yen(p["4"]["text"], "役員等以外の者としての政令で定める勤続年数が{n}年以下であるもの")
    [officer_years] = yen(p["5"]["text"], "役員等勤続年数」という。）が{n}年以下である者")
    if "法人税法第二条第十五号" not in p["5"]["items"].get("1", ""):
        fail("所得税法第30条5項1号（法人税法の役員）が見つかりません")

    p6 = p["6"]
    minimum, minimum2 = yen(p6["items"].get("2", ""), "金額が{n}円に満たない場合（次号に該当する場合を除く。）{n}円")
    if minimum != minimum2:
        fail(f"所得税法第30条6項2号の金額が違います（{minimum}・{minimum2}）")
    min3, min4, disability = yen(p6["items"].get("3", ""), "（当該金額が{n}円に満たない場合には、{n}円）に{n}円を加算した金額")
    if not (min3 == min4 == minimum):
        fail(f"所得税法第30条6項3号の最低の額が2号と違います（{min3}・{min4}・{minimum}）")
    if "障害者になつたことに直接基因して退職した" not in p6["items"]["3"]:
        fail("所得税法第30条6項3号（障害者になったことが原因の退職）が見つかりません")
    if "その年の前年以前に他の退職手当等の支払を受けている場合" not in p6["items"].get("1", ""):
        fail("所得税法第30条6項1号（前年以前の退職手当等）が見つかりません")
    return {
        "half": [half_n, half_d],
        "deduction": {"perYear": per_year, "yearsThreshold": years_threshold, "base": base, "perYearOver": per_year_over,
                      "minimum": minimum, "disability": disability},
        "short": {"years": short_years, "threshold": short_threshold, "base": short_base},
        "officerYears": officer_years,
    }


def read_cabinet_order(folder):
    a = law_article(folder / "shotokuzei-rei-69.xml")
    if a["title"] != "第六十九条" or "勤続年数" not in a["caption"]:
        fail(f"shotokuzei-rei-69.xml が所得税法施行令第69条ではありません（{a['title']}{a['caption']}）")
    text = a["paras"].get("2", {}).get("text", "")
    m = re.search(r"([一二三四五六七八九十]+)年未満の端数を生じたときは、これを([一二三四五六七八九十]+)年として", text)
    if not m or kanji_number(m.group(1)) != 1 or kanji_number(m.group(2)) != 1:
        fail("所得税法施行令第69条2項に「一年未満の端数を生じたときは、これを一年として」が見つかりません")
    return True


def read_local_rate(folder, name, title):
    a = law_article(folder / name)
    if a["title"] != title or a["caption"] != "（分離課税に係る所得割の税率）":
        fail(f"{name} が地方税法{title}（分離課税に係る所得割の税率）ではありません（{a['title']}{a['caption']}）")
    m = re.search(r"分離課税に係る所得割の税率は、([一二三四五六七八九十百千]+)分の([一二三四五六七八九十]+)とする。", a["paras"].get("1", {}).get("text", ""))
    if not m:
        fail(f"地方税法{title}に「分離課税に係る所得割の税率は、百分の…とする。」が見つかりません")
    return [kanji_number(m.group(2)), kanji_number(m.group(1))]


# ---------- 国税庁の PDF ----------
def pdf_text(path):
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(path)], check=True, capture_output=True, text=True).stdout
    if len(out) < 200:
        fail(f"{path.name} の字を取り出せません")
    return out


def money(s):
    return int(s.replace(",", ""))


def read_quick_table(path):
    """退職所得の源泉徴収税額の速算表：年・行（境目・税率・控除額）・102.1％"""
    lines = [re.sub(r"(\d), (?=\d)", r"\1,", nfkc(l)) for l in pdf_text(path).splitlines()]
    title = next((l for l in lines if l.startswith("退職所得の源泉徴収税額の速算表")), None)
    m = re.fullmatch(r"退職所得の源泉徴収税額の速算表\(令和 ?(\d+) ?年分\)", title or "")
    if not m:
        fail(f"{path.name} に「退職所得の源泉徴収税額の速算表（令和○年分）」の見出しがありません")
    year = 2018 + int(m.group(1))
    head = next((l for l in lines if l.startswith("課税退職所得金額A")), "")
    hm = re.fullmatch(r"課税退職所得金額A 所得税率B 控除額C 税額=\(A×B−C\)×([\d.]+)%", head)
    if not hm:
        fail(f"{path.name} の速算表の見出しの行（税額=（A×B−C）×…％）を読めません：{head}")
    multiplier = hm.group(1)
    start = lines.index(head) + 1
    rows = []
    for l in lines[start:]:
        if l.startswith("(注)"):
            if "1 円未満の端数があるときは、これを切り捨てます" not in l:
                fail(f"{path.name} の速算表の注が「1 円未満の端数があるときは、これを切り捨てます」ではありません：{l}")
            break
        m1 = re.fullmatch(r"([\d,]+)円以下 (\d+)% ― \(A×(\d+)% ?\)×([\d.]+)%", l)
        m2 = re.fullmatch(r"([\d,]+)円(?:超|〃)? ([\d,]+)円 〃 (\d+)% ([\d,]+)円 \(A×(\d+)%− ?([\d,]+)円\)×([\d.]+)%", l)
        m3 = re.fullmatch(r"([\d,]+)円(?:超|〃)? (\d+)% ([\d,]+)円 \(A×(\d+)%− ?([\d,]+)円\)×([\d.]+)%", l)
        if m1:
            if rows:
                fail(f"{path.name} の速算表の「以下」の行が最初の行ではありません：{l}")
            if m1.group(2) != m1.group(3) or m1.group(4) != multiplier:
                fail(f"{path.name} の速算表の行の税率・算式が合いません：{l}")
            rows.append({"over": 0, "upTo": money(m1.group(1)), "rate": int(m1.group(2)), "deduction": 0})
        elif m2:
            over, up, rate, ded, rate2, ded2, mul = m2.groups()
            if rate != rate2 or ded != ded2 or mul != multiplier:
                fail(f"{path.name} の速算表の行の税率・控除額が算式の欄と違います：{l}")
            rows.append({"over": money(over), "upTo": money(up), "rate": int(rate), "deduction": money(ded)})
        elif m3:
            over, rate, ded, rate2, ded2, mul = m3.groups()
            if rate != rate2 or ded != ded2 or mul != multiplier:
                fail(f"{path.name} の速算表の行の税率・控除額が算式の欄と違います：{l}")
            rows.append({"over": money(over), "upTo": None, "rate": int(rate), "deduction": money(ded)})
            continue
        else:
            fail(f"{path.name} の速算表の行を読めません：{l}")
    else:
        fail(f"{path.name} の速算表の注（1 円未満の端数）が見つかりません")
    if len(rows) < 2 or rows[-1]["upTo"] is not None:
        fail(f"{path.name} の速算表の行が足りないか、最後の行に上限があります")
    for prev, cur in zip(rows, rows[1:]):
        if cur["over"] != prev["upTo"]:
            fail(f"{path.name} の速算表の境目がつながりません（{prev['upTo']}円以下の次が {cur['over']}円超）")
        expected = prev["deduction"] + cur["over"] * (cur["rate"] - prev["rate"]) // 100
        if cur["over"] * (cur["rate"] - prev["rate"]) % 100 != 0 or cur["deduction"] != expected:
            fail(f"{path.name} の速算表の控除額 {cur['deduction']}円が、前の行から計算した {expected}円と違います")
    m = re.fullmatch(r"(\d+)\.(\d+)", multiplier)
    if not m:
        fail(f"{path.name} の「×{multiplier}％」を読めません")
    num = int(m.group(1) + m.group(2))
    den = 100 * 10 ** len(m.group(2))
    return {"year": year, "title": re.sub(r"\s", "", title).replace("(", "（").replace(")", "）"), "multiplier": [num, den],
            "brackets": [{"upTo": r["upTo"], "rate": r["rate"], "deduction": r["deduction"]} for r in rows]}


def read_no_declaration_rate(path, multiplier):
    text = nfkc(pdf_text(path))
    if "退職所得の源泉徴収票・特別徴収票" not in text:
        fail(f"{path.name} が「退職所得の源泉徴収票・特別徴収票」の章ではありません")
    m = re.search(r"「退職所得の受給に関する申告書」の提出がないため、 ?100 ?分の ?(\d+)\.(\d+) ?の税率を適用して", text)
    if not m:
        fail(f"{path.name} に「申告書」の提出がないときの「100 分の …」が見つかりません")
    num = int(m.group(1) + m.group(2))
    den = 100 * 10 ** len(m.group(2))
    # 20.42％ ＝ 20％ × 102.1％ のはず（所得税の税率に、復興特別所得税（と防衛特別所得税）の分をかけた率）
    base_num = num * multiplier[1] * 100
    base_den = den * multiplier[0]
    if base_num % base_den != 0:
        fail(f"{path.name} の {m.group(1)}.{m.group(2)}％ が、{multiplier[0]}/{multiplier[1]} をかけた整数の税率になりません")
    return [num, den], base_num // base_den


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_taishoku_tables.py <taishoku-tables> <出力 src/constants/taishoku.ts>")
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    for name in [*LAW_SOURCES, *(f"source/{n}" for n in PDF_SOURCES)]:
        if not (folder / name).exists():
            fail(f"{folder / name} がありません（入手元は taishoku-tables/README.md）")
    law = read_income_tax_law(folder)
    read_cabinet_order(folder)
    pref = read_local_rate(folder, "chihouzei-50-4.xml", "第五十条の四")
    city = read_local_rate(folder, "chihouzei-328-3.xml", "第三百二十八条の三")
    tables = [read_quick_table(folder / "source" / n) for n in ("zeigakuhyo2026-18.pdf", "zeigakuhyo2027-18.pdf")]
    if [t["year"] for t in tables] != [2026, 2027]:
        fail(f"速算表の年が令和8年分・令和9年分ではありません（{[t['year'] for t in tables]}）")
    no_decl, base_rate = read_no_declaration_rate(folder / "source" / "tebiki2026-03.pdf", tables[0]["multiplier"])

    hashes = {n: sha256(folder / n) for n in LAW_SOURCES}
    hashes.update({f"source/{n}": sha256(folder / "source" / n) for n in PDF_SOURCES})
    sources = {**LAW_SOURCES, **{f"source/{n}": u for n, u in PDF_SOURCES.items()}}
    source_lines = "\n".join(f" *   {n}（SHA-256 {hashes[n]}）\n *     {sources[n]}" for n in sources)
    table_ts = ",\n".join(
        "  {\n"
        f"    year: {t['year']},\n"
        f"    title: {json.dumps(t['title'], ensure_ascii=False)},\n"
        f"    source: {json.dumps(PDF_SOURCES[f'zeigakuhyo{t['year']}-18.pdf'])},\n"
        f"    multiplier: {json.dumps(t['multiplier'])},\n"
        "    brackets: [\n" + "\n".join(
            f"      {{ upTo: {'null' if b['upTo'] is None else b['upTo']}, rate: {b['rate']}, deduction: {b['deduction']} }}," for b in t["brackets"]
        ) + "\n    ],\n  }"
        for t in tables
    )
    d = law["deduction"]
    ts = f"""/**
 * 退職手当等（退職金）に対する所得税（源泉徴収税額）と住民税（特別徴収税額）の計算に使う数値
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_taishoku_tables.py taishoku-tables src/constants/taishoku.ts（入手元は taishoku-tables/README.md）
 * 元データ:
{source_lines}
 */

/** 退職所得控除額（所得税法30条3項・6項） */
export const TAISHOKU_DEDUCTION = {{
  /** 勤続年数が yearsThreshold 年以下：perYear 円 × 勤続年数 */
  perYear: {d['perYear']},
  yearsThreshold: {d['yearsThreshold']},
  /** yearsThreshold 年を超える：base 円 ＋ perYearOver 円 ×（勤続年数 − yearsThreshold 年） */
  base: {d['base']},
  perYearOver: {d['perYearOver']},
  /** 計算した額がこれに満たないときは、この額（6項2号） */
  minimum: {d['minimum']},
  /** 障害者になったことに直接基因して退職したときに加える額（6項3号） */
  disability: {d['disability']},
}} as const;

/** 退職所得の金額（所得税法30条2項・4項・5項） */
export const TAISHOKU_INCOME = {{
  /** 収入金額から退職所得控除額を引いた残額にかける割合（[分子, 分母]。特定役員退職手当等にはかけない） */
  half: {json.dumps(law['half'])} as [number, number],
  /** 短期退職手当等：短期勤続年数（役員等以外の者としての勤続年数）が years 年以下。残額が threshold 円以下なら half、
   *  超えるなら base 円 ＋（収入金額 −（threshold 円 ＋ 退職所得控除額）） */
  short: {{ years: {law['short']['years']}, threshold: {law['short']['threshold']}, base: {law['short']['base']} }},
  /** 特定役員退職手当等：役員等勤続年数がこの年数以下 */
  officerYears: {law['officerYears']},
}} as const;

/** 勤続年数の1年未満の端数は1年にする（所得税法施行令69条2項） */
export const TAISHOKU_ROUND_UP_YEARS = true;

/** 住民税の分離課税に係る所得割の税率（[分子, 分母]。市町村民税：地方税法328条の3、道府県民税：50条の4） */
export const TAISHOKU_LOCAL_RATES = {{
  city: {json.dumps(city)} as [number, number],
  pref: {json.dumps(pref)} as [number, number],
}} as const;

/** 「退職所得の受給に関する申告書」の提出がないとき：支払金額にかける率（[分子, 分母]。100 分の {no_decl[0] / (no_decl[1] / 100):g}。
 *  所得税 {base_rate}％ に速算表の「×{tables[0]['multiplier'][0] / (tables[0]['multiplier'][1] / 100):g}％」をかけた率であることを確かめた） */
export const TAISHOKU_NO_DECLARATION_RATE = {json.dumps(no_decl)} as [number, number];

export interface TaishokuBracket {{
  /** 課税退職所得金額がこの額以下（最後の行は null） */
  upTo: number | null;
  /** 所得税率（％） */
  rate: number;
  /** 控除額（円） */
  deduction: number;
}}

export interface TaishokuQuickTable {{
  year: number;
  title: string;
  source: string;
  /** 税額 ＝（課税退職所得金額 × 税率 − 控除額）× multiplier（[分子, 分母]。102.1％）。1円未満の端数は切り捨て */
  multiplier: [number, number];
  brackets: TaishokuBracket[];
}}

/** 退職所得の源泉徴収税額の速算表（年分ごと） */
export const TAISHOKU_QUICK_TABLES: TaishokuQuickTable[] = [
{table_ts},
];
"""
    out.write_text(ts, encoding="utf-8")
    print(f"{out} を作りました（速算表 {', '.join(str(t['year']) for t in tables)}年分・{len(tables[0]['brackets'])}行、"
          f"控除 {d['perYear']}円/年・{d['base']}円＋{d['perYearOver']}円/年、短期 {law['short']['years']}年・役員 {law['officerYears']}年、"
          f"住民税 {city[0]}/{city[1]}・{pref[0]}/{pref[1]}、申告書なし {no_decl[0]}/{no_decl[1]}）")


if __name__ == "__main__":
    main()
