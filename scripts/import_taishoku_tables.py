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
・taishoku-tables/shotokuzei-rei-70.xml   所得税法施行令 第70条（退職所得控除額の計算の特例）
    前年以前の退職手当等と勤続期間等が重なるときに数える年数（4年・9年・19年）と確定拠出年金の一時金の日（令和8年1月1日）、
    前の勤続期間等を短くするときの数（800万円・40万円・70万円・20）、1年未満の端数の切り捨て
・taishoku-tables/source/tebiki2026-03.pdf      国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第3章
    「退職所得の受給に関する申告書」の提出がないときの「100 分の 20.42」、源泉徴収票の「④ 番号」の区分（1〜7）と、摘要に経済的利益の価額を書く番号
・taishoku-tables/source/ta2741.htm             国税庁 タックスアンサー No.2741（同じ年に区分の違う退職手当等があるとき）
    特定役員・短期の控除額の係数（40万円・20万円・全重複期間の14万円・13万円）。2つの具体例（120万円・80万円・1,650万円、90万円・85万円・225万円・3,155万円）が
    読んだ係数で計算した額と合うことを確かめる
・taishoku-tables/source/kisai_chousho46.pdf    国税庁「退職手当金等受給者別支払調書」の記載要領
・taishoku-tables/source/kisai_goukei40.pdf     国税庁「退職手当金等受給者別支払調書合計表」の記載要領
    「元号」欄に書く数字（令和・平成）。2つの記載要領で同じことを確かめる
・taishoku-tables/shotokuzei-rei-71-2.xml 所得税法施行令 第71条の2（区分の違う退職手当等があるときの退職所得の金額）
    係数（40万円・20万円・14万円・13万円）が No.2741 と同じこと、収入金額がその区分の控除額に満たないときの調整（2つの区分は全部をもう一方から、
    3つの区分は2分の1ずつ（9項））、前年以前の退職手当等と重なるときの短期・特定役員の控除額（11項・12項）
・taishoku-tables/shotokuzei-212.xml・shotokuzei-213.xml 所得税法 第212条・第213条（非居住者に払う国内源泉所得の源泉徴収。百分の二十・翌月十日）
・taishoku-tables/chihouzei-328.xml      地方税法 第328条（住民税の分離課税は、所得税法199条で徴収する退職手当等だけ。1月1日の住所の市町村）
・taishoku-tables/souzokuzei-59.xml・souzokuzei-kisoku-30.xml 相続税法 第59条・相続税法施行規則 第30条
    退職手当金等受給者別支払調書の提出期限（翌月十五日）と、出さなくてよい額（百万円以下）
・taishoku-tables/shotokuzei-203.xml・shotokuzei-kisoku-77.xml 所得税法 第203条・所得税法施行規則 第77条（退職所得の受給に関する申告書に書くこと）
・taishoku-tables/source/shinkokusho-2026.pdf  国税庁「退職所得の受給に関する申告書」の様式（令和8年1月1日以後）：裏の書き方の年数・日付・算式が施行令70条と同じこと
・taishoku-tables/source/kisai_chousho27.pdf・kisai_goukei21.pdf 国税庁「非居住者等に支払われる給与、報酬、年金及び賞金の支払調書」と同合計表の記載要領
    退職手当等の「区分」の書き方と「元号」欄の数字（令和・平成・昭和）
・taishoku-tables/source/etax-316.pdf・etax-325.pdf・etax-soft-all.pdf e-Tax の法定調書の CSV「レコードの内容及び記録要領」
    316（退職所得の源泉徴収票）・325（退職手当金等受給者別支払調書）・339（非居住者等に支払われる給与、報酬、年金及び賞金の支払調書）の
    項番の順の項目の名前・全角か半角か・文字数。字の位置（scripts/pdf_to_chars.swift）で列に分ける。325 は個別の PDF と全体版で同じことを確かめる

次のときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
・条文の決まった言い回し（「四十万円に当該勤続年数を乗じて計算した金額」など）が見つからない
・800万円が 40万円 × 20年 と違う、150万円が 300万円の2分の1 と違う
・速算表の行が読めない、行の境目がつながらない、税率・控除額が税額の算式の欄と違う、控除額が速算表の作り（前の行の控除額 ＋
  境目の金額 × 税率の差）と合わない、「×102.1％」「1 円未満の端数があるときは、これを切り捨てます」がない
・20.42 が 102.1％ をかけた整数の税率でない
・施行令70条の言い回し・数が見つからない、2項の数が退職所得控除額の数と合わない、No.2741 の具体例の額が合わない、④番号の表が 1 から順に並んでいない
・施行令71条の2 の係数が No.2741 と違う、調整の言い回しがそろっていない、所得税法213条の 20％ に 102.1％ をかけた率が手引の 20.42％ と違う
・申告書の様式の書き方の年数・算式が施行令70条と違う
・e-Tax の CSV の項番が 1 から続いていない、項番と入力文字基準の数が合わない、項番1 に「「316」を記録してください。」などがない
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
    "shotokuzei-rei-70.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=70",
    "shotokuzei-rei-71-2.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340CO0000000096;article=71_2",
    "shotokuzei-203.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=203",
    "shotokuzei-kisoku-77.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340M50000040011;article=77",
    "shotokuzei-212.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=212",
    "shotokuzei-213.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=340AC0000000033;article=213",
    "chihouzei-328.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000226;article=328",
    "souzokuzei-59.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=325AC0000000073;article=59",
    "souzokuzei-kisoku-30.xml": "https://laws.e-gov.go.jp/api/1/articles;lawId=325M50000040017;article=30",
}
PDF_SOURCES = {
    "zeigakuhyo2026-18.pdf": "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf",
    "zeigakuhyo2027-18.pdf": "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/18.pdf",
    "tebiki2026-03.pdf": "https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/03.pdf",
    "ta2741.htm": "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2741.htm",
    "kisai_chousho46.pdf": "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_chousho46.pdf",
    "kisai_goukei40.pdf": "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_goukei40.pdf",
    "shinkokusho-2026.pdf": "https://www.nta.go.jp/law/tsutatsu/kobetsu/hojin/010705/pdf/0025006-122_07.pdf",
    "kisai_chousho27.pdf": "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_chousho27.pdf",
    "kisai_goukei21.pdf": "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r08/kisai_goukei21.pdf",
    "etax-316.pdf": "https://www.e-tax.nta.go.jp/e-taxsoftweb/hoteichosho/csv2/web_316.pdf",
    "etax-325.pdf": "https://www.e-tax.nta.go.jp/e-taxsoftweb/hoteichosho/csv2/soft_325.pdf",
    "etax-soft-all.pdf": "https://www.e-tax.nta.go.jp/e-taxsoftweb/hoteichosho/csv2/soft_all.pdf",
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


def read_overlap_order(folder):
    """所得税法施行令70条：前年以前の退職手当等と勤続期間が重なるとき（1項2号イ〜ハの年数、2項の期間の短縮、3項の端数）"""
    a = law_article(folder / "shotokuzei-rei-70.xml")
    if a["title"] != "第七十条":
        fail(f"shotokuzei-rei-70.xml が所得税法施行令第70条ではありません（{a['title']}{a['caption']}）")
    p1 = a["paras"].get("1", {})
    item2 = p1.get("items", {}).get("2", "")
    if not item2:
        fail("施行令70条1項2号が見つかりません")
    prior = yen(item2, "その年の前年以前{n}年内に退職手当等（前号に規定する前に支払を受けた退職手当等を除く。）の支払を受け、かつ、その年に退職手当等の支払を受けた場合")[0]
    dc = yen(item2, "その年の前年以前{n}年内に第七十二条第三項第七号（退職手当等とみなす一時金）に掲げる一時金（令和八年一月一日以後に支払を受けたものに限り")[0]
    dc_current = yen(item2, "その年の前年以前{n}年内に退職手当等（前号に規定する前に支払を受けた退職手当等を除く。）の支払を受け、かつ、その年に第七十二条第三項第七号に掲げる一時金の支払を受けた場合")[0]
    # 確定拠出年金の一時金を数える初めの日（令和8年1月1日）。ロの (1)(2) の年数が、イ・ロの年数と同じことも確かめる
    since = yen(item2, "第七十二条第三項第七号（退職手当等とみなす一時金）に掲げる一時金（令和{n}年{n}月{n}日以後に支払を受けたものに限り")
    s1 = yen(item2, "令和{n}年{n}月{n}日以後に支払を受けた退職手当等であつてその年の前年以前{n}年内に支払を受けたもの")
    s2 = yen(item2, "令和{n}年{n}月{n}日前に支払を受けた退職手当等であつてその年の前年以前{n}年内に支払を受けたもの")
    if s1 != since + [dc] or s2 != since + [prior]:
        fail("施行令70条1項2号ロの (1)(2) の日付・年数が、ロの一時金の日付とイ・ロの年数と合いません")
    dc_since = f"{2018 + since[0]:04d}-{since[1]:02d}-{since[2]:02d}"
    p2 = a["paras"].get("2", {})
    whole2 = p2.get("text", "") + "".join(p2.get("items", {}).values())
    lo_limit, lo_div = yen(whole2, "前の退職手当等の収入金額が{n}円以下である場合当該収入金額を{n}円で除して計算した数")
    hi_base, hi_div, hi_add = yen(whole2, "前の退職手当等の収入金額が八百万円を超える場合当該収入金額から{n}円を控除した金額を{n}円で除して計算した数に{n}を加算した数")
    if not (lo_limit == hi_base == 8000000 and lo_div == 400000 and hi_div == 700000 and hi_add == 20):
        fail("施行令70条2項の数（800万円・40万円・70万円・20）が、退職所得控除額の数と合いません")
    if "（一に満たない端数を生じたときは、これを切り捨てた数）" not in p2.get("text", ""):
        fail("施行令70条2項の「一に満たない端数を生じたときは、これを切り捨てた数」が見つかりません")
    p3 = a["paras"].get("3", {}).get("text", "")
    if "一年未満の端数があるときは、その端数を切り捨てる" not in p3:
        fail("施行令70条3項の「一年未満の端数があるときは、その端数を切り捨てる」が見つかりません")
    return {"priorYears": prior, "dcPriorYears": dc, "dcCurrentYears": dc_current, "dcSince": dc_since}


def read_mixed_answer(path):
    """タックスアンサー No.2741：同じ年に区分の違う退職手当等があるときの控除額の係数（40万円・20万円・14万円・13万円）と、2つの具体例"""
    import html as _html
    raw = path.read_bytes().decode("utf-8", errors="replace")
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S)
    t = re.sub(r"\s+", "", _html.unescape(re.sub(r"<[^>]+>", " ", t)))
    if "No.2741" not in t or "令和8年4月1日現在法令等" not in t:
        fail("タックスアンサー No.2741（令和8年4月1日現在法令等）ではありません")
    def man(pattern):
        m = re.search(pattern, t)
        if not m:
            fail(f"No.2741 に「{pattern}」が見つかりません")
        return int(m.group(1)) * 10000
    base = man(r"①([0-9]+)万円×（短期勤続年数（※1）-重複勤続年数（※2））")
    overlap = man(r"①[0-9]+万円×（短期勤続年数（※1）-重複勤続年数（※2））②([0-9]+)万円×重複勤続年数")
    officer_full = man(r"③([0-9]+)万円×重複勤続年数（全重複期間により計算した年数）（※2）ロ短期退職所得控除額")
    short_full = man(r"③([0-9]+)万円×重複勤続年数（全重複期間により計算した年数）（※2）ハ一般退職所得控除額")
    # 具体例：短期と特定役員（勤続5年・特定役員5年・重複4年 → 120万円・80万円・1,650万円）、
    # 3つの区分（勤続10年・各5年・全重複5年・部分重複1年ずつ → 90万円・85万円・225万円・3,155万円）
    o = base * max(0, 5 - 4) + overlap * 4
    sh = base * 5 - o
    inc = (15000000 - o) + 1500000 + (5000000 - (3000000 + sh))
    o4 = base * max(0, 5 - (1 + 5)) + overlap * 1 + officer_full * 5
    s4 = base * max(0, 5 - (1 + 5)) + overlap * 1 + short_full * 5
    g4 = base * 10 - (o4 + s4)
    inc4 = (30000000 - o4) + (3000000 - s4) // 2 + (5000000 - g4) // 2
    want = [("120万円", o), ("80万円", sh), ("1,650万円", inc), ("90万円", o4), ("85万円", s4), ("225万円", g4), ("3,155万円", inc4)]
    for text, value in want:
        if f"＝{text}" not in t or int(text.replace(",", "").replace("万円", "")) * 10000 != value:
            fail(f"No.2741 の具体例の「{text}」が、読んだ係数で計算した額（{value:,}円）と合いません")
    return {"base": base, "overlap": overlap, "officerFullOverlap": officer_full, "shortFullOverlap": short_full}


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


def read_slip_numbers(path):
    """手引 第3章の「④ 番号」：退職手当等の区分と番号（1〜7）と、摘要に経済的利益の価額を書く番号"""
    flat = re.sub(r"\s+", "", nfkc(pdf_text(path)))
    i = flat.find("●退職手当等の区分")
    j = flat.find("※1「", i)  # 表の下の注（※1「特定譲渡制限付株式」とは…）
    if i < 0 or j < 0:
        fail("手引 第3章に「●退職手当等の区分」の表が見つかりません")
    body = flat[i + len("●退職手当等の区分"):j]
    if not body.startswith("区分番号"):
        fail("手引 第3章の「●退職手当等の区分」の表の見出し（区分・番号）が見つかりません")
    rows = re.findall(r"(.+?場合)([0-9])", body[len("区分番号"):])
    codes = [c for _, c in rows]
    if codes != [str(k) for k in range(1, len(codes) + 1)] or len(codes) < 4:
        fail(f"手引 第3章の「④ 番号」が 1 から順に並んでいません（{codes}）")
    m = re.search(r"退職手当等が「([0-9])」[~～〜]「([0-9])」のいずれかの区分に該当する場合は、「摘要」欄にその経済的利益の価額を記載", flat)
    if not m:
        fail("手引 第3章に「摘要」欄に経済的利益の価額を書く番号が見つかりません")
    lo, hi = int(m.group(1)), int(m.group(2))
    if hi != len(codes):
        fail("手引 第3章の経済的利益を書く番号の範囲が、番号の数と合いません")
    out = []
    for label, code in rows:
        label = re.sub(r"\(※[0-9]\)", "", label).replace("(", "（").replace(")", "）")
        out.append({"code": code, "label": label, "benefit": lo <= int(code) <= hi})
    return out


def read_report_era_codes(folder):
    """退職手当金等受給者別支払調書と同合計表の記載要領の「元号」欄の書き方（令和・平成の数字）。2つの記載要領で同じことを確かめる"""
    found = []
    for name, title in (("kisai_chousho46.pdf", "【退職手当金等受給者別支払調書】"), ("kisai_goukei40.pdf", "【退職手当金等受給者別支払調書合計表】")):
        flat = re.sub(r"\s+", "", nfkc(pdf_text(folder / "source" / name)))
        if title not in flat:
            fail(f"{name} が{title}の記載要領ではありません")
        i = flat.find("※「元号」欄は次のとおり記載してください。元号記載方法")
        j = flat.find("※", i + 2)
        if i < 0 or j < 0:
            fail(f"{name} に「元号」欄の書き方の表が見つかりません")
        pairs = re.findall(r"(令和|平成|昭和|大正|明治)([0-9])", flat[i:j])
        if not pairs or len({e for e, _ in pairs}) != len(pairs):
            fail(f"{name} の「元号」欄の書き方の表が読めません")
        found.append(dict(pairs))
    if found[0] != found[1]:
        fail("支払調書と合計表の記載要領で、元号の数字が違います")
    return found[0]


def read_mixed_order(folder, mixed):
    """所得税法施行令71条の2：区分の違う退職手当等の控除額の係数（No.2741 と同じこと）と、収入金額がその区分の控除額に満たないときの調整"""
    a = law_article(folder / "shotokuzei-rei-71-2.xml")
    if a["title"] != "第七十一条の二" or "二以上の退職手当等がある場合の退職所得の金額の計算" not in a["caption"]:
        fail(f"shotokuzei-rei-71-2.xml が所得税法施行令第71条の2ではありません（{a['title']}{a['caption']}）")

    def para(n):
        p = a["paras"].get(str(n))
        if not p:
            fail(f"施行令71条の2 {n}項が見つかりません")
        return p["text"] + "".join(p["items"].values())

    def bare(t):
        """括弧書き（「（前項に規定する…をいう。）」など）を除いた文"""
        while True:
            u = re.sub(r"（[^（）]*）", "", t)
            if u == t:
                return t
            t = u

    # 2つの区分（1項：短期と一般、3項：特定役員と一般、5項：特定役員と短期）の係数
    for n, years in ((1, "短期勤続年数"), (3, "特定役員等勤続年数"), (5, "特定役員等勤続年数")):
        t = bare(para(n))
        base = yen(t, "{n}円に" + years + "から重複勤続年数を控除した年数を乗じて計算した金額")[0]
        overlap = yen(t, "{n}円に重複勤続年数を乗じて計算した金額")[0]
        if base != mixed["base"] or overlap != mixed["overlap"]:
            fail(f"施行令71条の2 {n}項の係数（{base:,}円・{overlap:,}円）が、No.2741 の係数と違います")
    # 3つの区分（7項）：全重複期間の係数（特定役員 14万円・短期 13万円）
    t7 = para(7)
    full_o = yen(t7, "ハ{n}円に重複勤続年数（全重複期間により計算した年数に限る。）を乗じて計算した金額")[0]
    full_s = yen(t7, "（３）{n}円に重複勤続年数（全重複期間により計算した年数に限る。）を乗じて計算した金額")[0]
    base7 = yen(t7, "イ{n}円に特定役員等勤続年数からロに規定する重複勤続年数とハに規定する重複勤続年数を合計した年数を控除した年数を乗じて計算した金額")[0]
    over7 = yen(t7, "ロ{n}円に重複勤続年数（特定役員等勤続期間と短期勤続期間とが重複している期間（全重複期間を除く。）")[0]
    if (full_o, full_s, base7, over7) != (mixed["officerFullOverlap"], mixed["shortFullOverlap"], mixed["base"], mixed["overlap"]):
        fail("施行令71条の2 7項の係数が、No.2741 の係数と違います")

    # 2つの区分：一方の収入金額がその控除額に満たないときは、満たない部分を、もう一方の残額から引く（1項・3項・5項）。
    # 短期退職手当等の300万円の判定は、引いたあとの残額でする（1項1号イ・5項2号イ）
    adjust = "満たない場合には、当該残額からその満たない部分の金額を控除した残額"
    for n in (1, 3, 5):
        if para(n).count(adjust) < 2:
            fail(f"施行令71条の2 {n}項に、収入金額が控除額に満たないときの調整（「{adjust}」）が2つ見つかりません")
    if "一般退職所得控除額に満たない場合には、当該残額からその満たない部分の金額を控除した残額。イにおいて同じ。）が三百万円以下である場合" not in para(1):
        fail("施行令71条の2 1項1号イの、調整したあとの残額で300万円を判定する言い回しが見つかりません")
    if "特定役員退職所得控除額に満たない場合には、当該残額からその満たない部分の金額を控除した残額。イにおいて同じ。）が三百万円以下である場合" not in para(5):
        fail("施行令71条の2 5項2号イの、調整したあとの残額で300万円を判定する言い回しが見つかりません")
    # 3つの区分：7項では調整せず（300万円の判定は調整する前の残額）、9項で満たない部分の2分の1ずつを、ほかの2つの区分の残額から引く
    if "満たない" in t7:
        fail("施行令71条の2 7項に「満たない」があります（調整は9項だけのはず）")
    t9 = para(9)
    shares = re.findall(rf"当該満たない部分の金額の([{KANJI}]+)分の([{KANJI}]+)に相当する金額（[イロ]に掲げる残額が当該\1分の\2に相当する金額に満たない場合には、当該満たない部分の金額を加算した金額）", t9)
    if len(shares) != 6 or len(set(shares)) != 1:
        fail(f"施行令71条の2 9項の、満たない部分を2つの区分に分ける割合が6つそろっていません（{len(shares)}）")
    share = [kanji_number(shares[0][1]), kanji_number(shares[0][0])]
    # 前年以前の退職手当等と重なるとき（11項：短期退職所得控除額、12項：特定役員退職所得控除額から、施行令70条1項1号・2号の額を引く）
    for n, who in ((11, "短期"), (12, "特定役員")):
        t = para(n)
        kind = "短期退職手当等" if who == "短期" else "特定役員退職手当等"
        period = "短期勤続期間" if who == "短期" else "特定役員等勤続期間"
        if (f"前に支払を受けた退職手当等の全部又は一部が{kind}に該当する場合" not in t
                or f"{period}の全部又は一部が第七十条第一項第二号に規定する前の勤続期間等と重複している場合その重複している期間を基礎として同号の規定により計算した金額" not in t):
            fail(f"施行令71条の2 {n}項（{who}の控除額から、前年以前の退職手当等と重なる分を引く）の言い回しが見つかりません")
    if "第六十九条第二項及び第三項の規定は、第二項に規定する短期勤続年数、同項、第四項、第六項若しくは第八項に規定する重複勤続年数又は第四項に規定する特定役員等勤続年数を計算する場合について準用する" not in para(10):
        fail("施行令71条の2 10項（短期勤続年数・重複勤続年数・特定役員等勤続年数の1年未満の端数は1年）が見つかりません")
    return share


def read_nonresident(folder, no_decl, multiplier):
    """所得税法212条・213条：非居住者に払う退職手当等（国内源泉所得）の源泉徴収の税率と納付の期限"""
    a = law_article(folder / "shotokuzei-213.xml")
    if a["title"] != "第二百十三条" or a["caption"] != "（徴収税額）":
        fail(f"shotokuzei-213.xml が所得税法第213条（徴収税額）ではありません（{a['title']}{a['caption']}）")
    items = a["paras"].get("1", {}).get("items", {})
    m = re.match(rf"一前条第一項に規定する国内源泉所得（次号及び第三号に掲げるものを除く。）その金額（次に掲げる国内源泉所得については、それぞれ次に定める金額）に([{KANJI}]+)分の([{KANJI}]+)の税率を乗じて計算した金額", items.get("1", ""))
    if not m:
        fail("所得税法213条1項1号の税率（「…に百分の…の税率を乗じて計算した金額」）が見つかりません")
    rate = [kanji_number(m.group(2)), kanji_number(m.group(1))]
    # 退職手当等（161条1項12号ハ）は、1号のイ〜ハ（12号ロの年金・13号の賞金・14号の年金）にも、2号（5号）・3号（8号・15号）にも当たらない
    if "第十二号ハ" in "".join(items.values()) or "第百六十一条第一項第五号" not in items.get("2", "") or "第百六十一条第一項第八号及び第十五号" not in items.get("3", ""):
        fail("所得税法213条1項の号の分け方が、思っていたものと違います（退職手当等が1号の税率でないかもしれません）")
    # 20.42％（申告書がないとき）＝ 20％ × 102.1％ と同じことを確かめる
    if rate[0] * multiplier[0] * no_decl[1] != no_decl[0] * rate[1] * multiplier[1]:
        fail(f"所得税法213条の税率 {rate[0]}/{rate[1]} に {multiplier[0]}/{multiplier[1]} をかけた率が、手引の {no_decl[0]}/{no_decl[1]} と違います")
    b = law_article(folder / "shotokuzei-212.xml")
    if b["title"] != "第二百十二条" or b["caption"] != "（源泉徴収義務）":
        fail(f"shotokuzei-212.xml が所得税法第212条（源泉徴収義務）ではありません（{b['title']}{b['caption']}）")
    t1 = b["paras"].get("1", {}).get("text", "")
    if "非居住者に対し国内において第百六十一条第一項第四号から第十六号まで（国内源泉所得）に掲げる国内源泉所得" not in t1:
        fail("所得税法212条1項に、非居住者に払う国内源泉所得（161条1項4号〜16号）の源泉徴収が見つかりません")
    due = yen(t1, "その徴収の日の属する月の翌月{n}日までに、これを国に納付しなければならない")[0]
    if "「翌月十日まで」とあるのは、「翌月末日まで」とする" not in b["paras"].get("2", {}).get("text", ""):
        fail("所得税法212条2項（国外で払うときは翌月末日まで）が見つかりません")
    return {"rate": rate, "dueDay": due}


def read_local_scope(folder):
    """地方税法328条：住民税の分離課税は、所得税法199条で所得税を徴収する（居住者に払う）退職手当等にだけかかり、1月1日の住所の市町村が課す"""
    a = law_article(folder / "chihouzei-328.xml")
    if a["title"] != "第三百二十八条" or a["caption"] != "（退職所得の課税の特例）":
        fail(f"chihouzei-328.xml が地方税法第328条（退職所得の課税の特例）ではありません（{a['title']}{a['caption']}）")
    t = a["paras"].get("1", {}).get("text", "")
    if "退職手当等（所得税法第百九十九条の規定によりその所得税を徴収して納付すべきものに限る。" not in t:
        fail("地方税法328条に「所得税法第百九十九条の規定によりその所得税を徴収して納付すべきものに限る」が見つかりません")
    month, day = yen(t, "当該退職手当等の支払を受けるべき日の属する年の{n}月{n}日現在におけるその者の住所所在の市町村において課する")
    return {"month": month, "day": day}


def read_benefit_report_rule(folder):
    """相続税法59条1項・相続税法施行規則30条：退職手当金等受給者別支払調書の提出期限（翌月15日）と、出さなくてよい額（100万円以下）"""
    a = law_article(folder / "souzokuzei-59.xml")
    if a["title"] != "第五十九条" or a["caption"] != "（調書の提出）":
        fail(f"souzokuzei-59.xml が相続税法第59条（調書の提出）ではありません（{a['title']}{a['caption']}）")
    p1 = a["paras"].get("1", {})
    due = yen(p1.get("text", ""), "その月中に支払つた生命保険契約の保険金若しくは損害保険契約の保険金のうち政令で定めるもの又は支給した退職手当金等（第三条第一項第二号に掲げる給与をいう。以下この項において同じ。）について、翌月{n}日までに")[0]
    if "ただし、保険金額又は退職手当金等の金額が財務省令で定める額以下である場合は、この限りでない。" not in p1.get("text", ""):
        fail("相続税法59条1項ただし書（財務省令で定める額以下なら出さなくてよい）が見つかりません")
    if "二退職手当金等を支給した者支給した退職手当金等に関する受給者別の調書" not in p1.get("items", {}).get("2", ""):
        fail("相続税法59条1項2号（退職手当金等に関する受給者別の調書）が見つかりません")
    b = law_article(folder / "souzokuzei-kisoku-30.xml")
    if b["title"] != "第三十条" or b["caption"] != "（調書の記載事項等）":
        fail(f"souzokuzei-kisoku-30.xml が相続税法施行規則第30条（調書の記載事項等）ではありません（{b['title']}{b['caption']}）")
    limit = yen(b["paras"].get("3", {}).get("text", ""), "法第五十九条第一項ただし書に規定する財務省令で定める額は、{n}円とする。")[0]
    items2 = "".join(b["paras"].get("2", {}).get("items", {}).values())
    if "その支給を受ける者の氏名、住所又は居所及び個人番号" not in items2 or "その月中に支給をした退職手当金等の金額" not in items2:
        fail("相続税法施行規則30条2項（受給者別の調書に書くこと）が見つかりません")
    return {"dueDay": due, "omitUpTo": limit}


def read_declaration_rule(folder, overlap70):
    """所得税法203条・所得税法施行規則77条と「退職所得の受給に関する申告書」の様式（令和8年1月1日以後）の書き方：申告書に書くことを確かめる"""
    a = law_article(folder / "shotokuzei-203.xml")
    if a["title"] != "第二百三条" or "第一項の規定による申告書は、退職所得の受給に関する申告書という。" not in a["paras"].get("6", {}).get("text", ""):
        fail("shotokuzei-203.xml が所得税法第203条（退職所得の受給に関する申告書）ではありません")
    items = a["paras"].get("1", {}).get("items", {})
    if len(items) != 5 or "支払済みの他の退職手当等があるかどうか" not in items.get("2", ""):
        fail("所得税法203条1項の申告書に書くこと（1号〜5号）が見つかりません")
    b = law_article(folder / "shotokuzei-kisoku-77.xml")
    if b["title"] != "第七十七条" or "退職所得の受給に関する申告書の記載事項" not in b["caption"]:
        fail(f"shotokuzei-kisoku-77.xml が所得税法施行規則第77条ではありません（{b['title']}{b['caption']}）")
    k = b["paras"].get("1", {}).get("items", {})
    if len(k) != 7 or "徴収された所得税の額及びその支払を受けた年月日" not in k.get("4", ""):
        fail("所得税法施行規則77条1項の申告書に書くこと（1号〜7号）が見つかりません")
    # 様式の裏の書き方：前年以前の退職手当等の年数（4年内・9年内・19年内）と令和8年1月1日・期間を短くする算式が、施行令70条と同じこと
    flat = re.sub(r"\s+", "", nfkc(pdf_text(folder / "source" / "shinkokusho-2026.pdf")))
    if "申告書の書き方" not in flat or "退職手当等の支払を受ける際に支払者に提出してください" not in flat:
        fail("shinkokusho-2026.pdf が「退職所得の受給に関する申告書」の様式ではありません")
    want = [
        f"前年以前{overlap70['priorYears']}年内に退職手当等の支払を受けた場合",
        f"前年以前{overlap70['dcPriorYears']}年内に確定拠出年金法に基づく老齢給付金として支給される一時金(令和8年1月1日以後に支払を受けたものに限ります。)",
        f"前年以前{overlap70['dcCurrentYears']}年内に退職手当等の支払を受け、本年中に確定拠出年金法に基づく老齢給付金として支給される一時金の支払を受ける場合",
        "800万円以下の場合その収入金額÷40万円", "800万円を超える場合(その収入金額-800万円)÷70万円+20",
    ]
    if overlap70["dcSince"] != "2026-01-01":
        fail("施行令70条の確定拠出年金の一時金の日が、様式の「令和8年1月1日」と違います")
    for w in want:
        if w not in flat:
            fail(f"申告書の様式の書き方に「{w}」が見つかりません（施行令70条と違うかもしれません）")
    return True


def read_nonresident_report(folder):
    """非居住者等に支払われる給与、報酬、年金及び賞金の支払調書・同合計表の記載要領：退職手当等の「区分」の書き方と「元号」欄の数字"""
    found = []
    kubun = None
    for name, title in (("kisai_chousho27.pdf", "【非居住者等に支払われる給与、報酬、年金及び賞金の支払調書】"),
                        ("kisai_goukei21.pdf", "【非居住者等に支払われる給与、報酬、年金及び賞金の支払調書合計表】")):
        flat = re.sub(r"\s+", "", nfkc(pdf_text(folder / "source" / name)))
        if title not in flat:
            fail(f"{name} が{title}の記載要領ではありません")
        i = flat.find("※「元号」欄は次のとおり記載してください。元号記載方法")
        j = flat.find("※", i + 2)
        pairs = re.findall(r"(令和|平成|昭和|大正|明治)([0-9])", flat[i:j]) if i >= 0 and j >= 0 else []
        if not pairs or len({e for e, _ in pairs}) != len(pairs):
            fail(f"{name} の「元号」欄の書き方の表が読めません")
        found.append(dict(pairs))
        if name == "kisai_chousho27.pdf":
            m = re.search(r"「区分」の欄には、給与については俸給、給料、歳費、年金、賞与、(退職手当等)と", flat)
            if not m or "法第161条第1項第12号ハの規定に該当する退職手当等" not in flat:
                fail("非居住者等の支払調書の記載要領に、退職手当等の「区分」と「勤続年数」の書き方が見つかりません")
            kubun = m.group(1)
    if any(found[0].get(e) != c for e, c in found[1].items()):
        fail("非居住者等の支払調書と合計表の記載要領で、元号の数字が違います")
    return {"kubun": kubun, "eras": found[0]}


def chars_of(path):
    """pdf_to_chars.swift：ページごとの字のまとまり（左の位置・下の位置・幅・字）"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_chars.swift"), str(path)], check=True, capture_output=True, text=True).stdout
    pages, page = {}, 0
    for line in out.splitlines():
        m = re.fullmatch(r"=== page (\d+) ===", line)
        if m:
            page = int(m.group(1))
            pages[page] = []
            continue
        parts = line.split("\t")
        if len(parts) >= 5:
            pages[page].append((float(parts[0]), float(parts[1]), float(parts[2]), nfkc("\t".join(parts[4:]))))
    return pages


def read_etax_layout(path, code):
    """
    e-Tax の法定調書の CSV「レコードの内容及び記録要領」：項番の順の項目の名前・全角か半角か・文字数（「以内」がなければその文字数ちょうど）
    表の枠がつながっているので、字の位置で列（項番・項目名・入力文字基準・記録要領）に分ける。「19 ～ 22」のような項番は、
    その前の同じ数の項目のまとまり（記録要領の「…の各項目に準じて記録」）をくり返す
    """
    pages = chars_of(path)
    page = next((segs for segs in pages.values() if any(re.search(rf"【.+:{code}】", s[3]) for s in segs)), None)
    if page is None:
        fail(f"{path.name} に「【…：{code}】」のレコードが見つかりません")
    title = next(re.search(rf"【(.+):{code}】", s[3]).group(1) for s in page if re.search(rf"【.+:{code}】", s[3]))
    head = next((s for s in page if s[3] == "項番"), None)
    rule_x = next((s[0] for s in page if s[3] == "記録要領"), None)
    if head is None or rule_x is None:
        fail(f"{path.name} の {code} の表の見出し（項番・記録要領）が見つかりません")
    left = [s for s in page if s[1] < head[1] - 1 and s[0] < 395]
    rules = [s for s in page if s[1] < head[1] - 1 and s[0] >= 395]
    near = lambda a, b: abs(a - b) < 1.6
    numbers, tildes = [], []
    for x, y, w, t in left:
        if x >= 100:
            continue
        m = re.fullmatch(r"(\d+)(?: (.+))?", t)
        if m:
            numbers.append((int(m.group(1)), y, m.group(2) or ""))
        elif t in ("～", "~"):
            tildes.append(y)
    numbers.sort(key=lambda n: -n[1])
    # 「a ～ b」の範囲
    ranges = []
    for ty in tildes:
        above = min((n for n in numbers if n[1] > ty), key=lambda n: n[1] - ty)
        below = min((n for n in numbers if n[1] < ty), key=lambda n: ty - n[1])
        label = " ".join(s[3] for s in left if 100 <= s[0] < 170 and below[1] - 2 <= s[1] <= above[1] + 2)
        ranges.append((above[0], below[0], label))
    in_range = {k for a, b, _ in ranges for k in range(a, b + 1)}
    # 入力文字基準の行（「全角」「半角」と「60 文字以内」が同じ高さ）を、上から順に、範囲でない項番と組にする
    # （項目名が2行の項目は、項番と入力文字基準の高さが少しずれるので、高さではなく順で結ぶ）
    kind_segs = [s for s in left if 160 <= s[0] < 320 and re.fullmatch(r"(?:(.+) )?(全角|半角)", s[3])]
    len_segs = [s for s in left if 320 <= s[0] < 395 and re.fullmatch(r"\d+ 文字(?:以内)?", s[3])]
    rows = []
    for k in sorted(kind_segs, key=lambda s: -s[1]):
        same = [l for l in len_segs if near(l[1], k[1])]
        if len(same) != 1:
            fail(f"{path.name} の {code} の入力文字基準（{k[3]}）の文字数が読めません")
        rows.append((k, same[0]))
    plain = [n for n in numbers if n[0] not in in_range]
    if len(rows) != len(plain) or len(len_segs) != len(rows):
        fail(f"{path.name} の {code} の項番（{len(plain)}）と入力文字基準（{len(rows)}）の数が合いません")
    items = {}
    for (no, y, inline), (kseg, lseg) in zip(plain, rows):
        if abs(kseg[1] - y) > 10:
            fail(f"{path.name} の {code} の項番 {no} と入力文字基準の高さが離れすぎています")
        km = re.fullmatch(r"(?:(.+) )?(全角|半角)", kseg[3])
        lm = re.fullmatch(r"(\d+) 文字(以内)?", lseg[3])
        names = [s[3] for s in sorted(left, key=lambda s: (-s[1], s[0]))
                 if (near(s[1], y) or near(s[1], kseg[1])) and 100 <= s[0] < 290 and s is not kseg]
        name = " ".join([inline, *names, km.group(1) or ""]).strip()
        items[no] = {"no": no, "name": re.sub(r"\s+", " ", name), "zenkaku": km.group(2) == "全角", "length": int(lm.group(1)), "fixed": not lm.group(2)}
    # 年・日だけの項目には、真ん中の「月」の行にある日付の名前（「就職年月日 月」の「就職年月日」）を付ける
    for no in sorted(items):
        it = items[no]
        if it["name"] in ("年", "日"):
            mid = items.get(no + 1 if it["name"] == "年" else no - 1, {}).get("name", "")
            if not re.search(r"年月日 月$", mid):
                fail(f"{path.name} の {code} の項番 {no}（{it['name']}）の日付の名前が見つかりません")
            it["name"] = f"{mid[:-2]} {it['name']}"
    # 範囲の項目は、その前の同じ数の項目のまとまりをくり返す（くり返すもとのまとまりの名前（「支払内容 (1)」など）は、
    # もとの項目の名前の頭に付け、くり返した項目は範囲の名前（「支払内容 (2)」など）にする）
    first_start = None
    source_label = {}
    for a, b, label in sorted(ranges):
        n = b - a + 1
        if first_start is None or a != prev_end + 1:
            first_start = a
            src_ys = [y for no, y, _ in numbers if first_start - n <= no < first_start]
            parts = [s[3] for s in sorted(left, key=lambda s: -s[1]) if 100 <= s[0] < 170 and src_ys and min(src_ys) - 2 <= s[1] <= max(src_ys) + 2]
            for k in range(first_start - n, first_start):
                if k not in items:
                    fail(f"{path.name} の {code} の項番 {a}〜{b} がくり返す項目が見つかりません")
                bare_name = items[k]["name"]
                for p in parts:
                    bare_name = bare_name.replace(p, "").strip()
                source_label[k] = (" ".join(parts), re.sub(r"\s+", " ", bare_name))
        prev_end = b
        for k in range(n):
            src_label, src_name = source_label[first_start - n + k]
            items[a + k] = {**items[first_start - n + k], "no": a + k, "name": f"{label} {src_name}".strip()}
    for k, (src_label, src_name) in source_label.items():
        items[k]["name"] = f"{src_label} {src_name}".strip()
    total = max(items)
    if sorted(items) != list(range(1, total + 1)):
        fail(f"{path.name} の {code} の項番が 1 から {total} まで続いていません")
    if "法定資料の種類" not in items[1]["name"] or not any(near(s[1], next(n[1] for n in numbers if n[0] == 1)) and s[3] == f"「{code}」を記録してください。" for s in rules):
        fail(f"{path.name} の {code} の項番1（法定資料の種類）に「「{code}」を記録してください。」が見つかりません")
    return {"title": title, "items": [items[k] for k in range(1, total + 1)]}


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
    overlap70 = read_overlap_order(folder)
    mixed = read_mixed_answer(folder / "source" / "ta2741.htm")
    slip_numbers = read_slip_numbers(folder / "source" / "tebiki2026-03.pdf")
    report_eras = read_report_era_codes(folder)
    shortfall_share = read_mixed_order(folder, mixed)
    nonresident = read_nonresident(folder, no_decl, tables[0]["multiplier"])
    local_scope = read_local_scope(folder)
    benefit_rule = read_benefit_report_rule(folder)
    read_declaration_rule(folder, overlap70)
    nr_report = read_nonresident_report(folder)
    etax = {
        "316": read_etax_layout(folder / "source" / "etax-316.pdf", "316"),
        "325": read_etax_layout(folder / "source" / "etax-325.pdf", "325"),
        "339": read_etax_layout(folder / "source" / "etax-soft-all.pdf", "339"),
    }
    # 退職手当金等受給者別支払調書は、e-Tax ソフト用の個別の PDF と全体版で同じことを確かめる
    if read_etax_layout(folder / "source" / "etax-soft-all.pdf", "325")["items"] != etax["325"]["items"]:
        fail("退職手当金等受給者別支払調書（325）のレコードが、個別の PDF と全体版で違います")
    etax_ts = "\n".join(
        f"  /** {v['title']}（{len(v['items'])}項目） */\n  \"{k}\": [\n" + "\n".join(
            f"    {{ no: {i['no']}, name: {json.dumps(i['name'], ensure_ascii=False)}, zenkaku: {'true' if i['zenkaku'] else 'false'}, "
            f"length: {i['length']}, fixed: {'true' if i['fixed'] else 'false'} }}," for i in v["items"]
        ) + "\n  ],"
        for k, v in etax.items()
    )

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

/**
 * 前年以前の退職手当等と勤続期間が重なるとき（所得税法施行令70条1項2号・2項・3項。所得税法30条6項1号）：
 * その年の前年以前 priorYears 年内に支払を受けた退職手当等（令和8年1月1日以後に確定拠出年金の一時金を受けたときは、令和8年以後の分は dcPriorYears 年内、
 * その年に確定拠出年金の一時金を受けるときは dcCurrentYears 年内）の勤続期間と重なる期間の年数（1年未満の端数は切り捨て）で計算した額を、
 * 退職所得控除額から引く。前の退職手当等の収入金額がその控除額に満たないときは、前の勤続期間を「収入金額 ÷ 40万円」（800万円を超えるときは
 * 「（収入金額 − 800万円）÷ 70万円 ＋ 20」。1未満の端数は切り捨て）の年数に短くする
 */
export const TAISHOKU_OVERLAP_RULE = {{
  priorYears: {overlap70['priorYears']},
  dcPriorYears: {overlap70['dcPriorYears']},
  dcCurrentYears: {overlap70['dcCurrentYears']},
  /** 確定拠出年金の一時金を dcPriorYears 年内で数えるのは、この日以後に支払を受けたもの（ロ） */
  dcSince: "{overlap70['dcSince']}",
}} as const;

/**
 * 同じ年に一般退職手当等・短期退職手当等・特定役員退職手当等のうち2つ以上があるとき（タックスアンサー No.2741・所得税法施行令71条の2）の控除額の係数：
 * 特定役員・短期の控除額は base 円 ×（その勤続年数 − 重複勤続年数。0未満は0）＋ overlap 円 × 重複勤続年数（3つともあるときは、全重複期間の年数に
 * officerFullOverlap 円・shortFullOverlap 円）。一般の控除額は、全体の勤続年数の退職所得控除額から、ほかの区分の控除額を引いた残り
 */
export const TAISHOKU_MIXED = {{
  base: {mixed['base']},
  overlap: {mixed['overlap']},
  officerFullOverlap: {mixed['officerFullOverlap']},
  shortFullOverlap: {mixed['shortFullOverlap']},
  /** 3つの区分があり、1つの区分の収入金額がその控除額に満たないとき、満たない部分のこの割合（[分子, 分母]）ずつを、ほかの2つの区分の残額から引く
   *  （一方の残額が足りなければ、足りない分をもう一方から引く。施行令71条の2 9項）。2つの区分のときは、満たない部分の全部をもう一方の残額から引く（1項・3項・5項） */
  shortfallShare: {json.dumps(shortfall_share)} as [number, number],
}} as const;

/** 非居住者に払う退職手当等（国内源泉所得）の源泉徴収（所得税法212条・213条1項1号）：税率（[分子, 分母]）に、速算表の 102.1％ をかける。
 *  納付は、徴収した月の翌月 dueDay 日まで（国外で払うときは翌月末日まで） */
export const TAISHOKU_NONRESIDENT = {{
  rate: {json.dumps(nonresident['rate'])} as [number, number],
  dueDay: {nonresident['dueDay']},
}} as const;

/** 住民税（分離課税）は、所得税法199条で所得税を徴収する（居住者に払う）退職手当等にだけかかり、支払を受けるべき日の属する年の
 *  この月日現在の住所の市町村が課す（地方税法328条） */
export const TAISHOKU_LOCAL_SCOPE = {{ residentOnly: true, month: {local_scope['month']}, day: {local_scope['day']} }} as const;

/** 退職手当金等受給者別支払調書（相続税法59条1項）：支給した月の翌月 dueDay 日までに出す。受給者ごとの金額が omitUpTo 円以下なら出さなくてよい（相続税法施行規則30条3項） */
export const TAISHOKU_BENEFIT_REPORT = {{ dueDay: {benefit_rule['dueDay']}, omitUpTo: {benefit_rule['omitUpTo']} }} as const;

/** 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（記載要領）：退職手当等の「区分」の書き方と、「元号」欄に書く数字 */
export const TAISHOKU_NONRESIDENT_REPORT = {{
  kubun: {json.dumps(nr_report['kubun'], ensure_ascii=False)},
  eraCodes: {json.dumps(nr_report['eras'], ensure_ascii=False)} as Record<string, string>,
}} as const;

/** e-Tax で出す法定調書の CSV の項目（「レコードの内容及び記録要領」。項番の順。zenkaku：全角、length：文字数（fixed でなければ「以内」）） */
export interface EtaxItem {{
  no: number;
  name: string;
  zenkaku: boolean;
  length: number;
  fixed: boolean;
}}

/** 316：退職所得の源泉徴収票（e-Tax ソフト（WEB版））、325：退職手当金等受給者別支払調書・339：非居住者等に支払われる給与、報酬、年金及び賞金の支払調書（e-Tax ソフト） */
export const ETAX_LAYOUTS: Record<"316" | "325" | "339", EtaxItem[]> = {{
{etax_ts}
}};

/** 「退職所得の受給に関する申告書」の提出がないとき：支払金額にかける率（[分子, 分母]。100 分の {no_decl[0] / (no_decl[1] / 100):g}。
 *  所得税 {base_rate}％ に速算表の「×{tables[0]['multiplier'][0] / (tables[0]['multiplier'][1] / 100):g}％」をかけた率であることを確かめた） */
export const TAISHOKU_NO_DECLARATION_RATE = {json.dumps(no_decl)} as [number, number];

/** 退職所得の源泉徴収票の「④ 番号」（手引 第3章「●退職手当等の区分」。いずれにも該当しなければ空欄。benefit の番号は、摘要に経済的利益の価額を書く） */
export const TAISHOKU_SLIP_NUMBERS: {{ code: string; label: string; benefit: boolean }}[] = {json.dumps(slip_numbers, ensure_ascii=False)};

/** 退職手当金等受給者別支払調書・同合計表の「元号」欄に書く数字（記載要領） */
export const TAISHOKU_REPORT_ERA_CODES: Record<string, string> = {json.dumps(report_eras, ensure_ascii=False)};

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
