#!/usr/bin/env python3
"""
労務の書類（36協定届・障害者雇用状況報告など）で使う数を、法令の条文（e-Gov 法令API の XML）と厚生労働省の記入要領から読み取って、
src/constants/roumu.ts を作る（手で書き写さない）。

使い方:
  python3 -I scripts/import_roumu_tables.py roumu-forms src/constants/roumu.ts

読むもの（入手元と SHA-256 は roumu-forms/README.md）:
  roumu-forms/labor-standards-act-36.xml       労働基準法 第36条（時間外及び休日の労働）
    ・4項  限度時間「一箇月について四十五時間及び一年について三百六十時間（…三箇月を超える期間を定めて…一箇月について四十二時間及び一年について三百二十時間）」
    ・5項  特別条項「百時間未満の範囲内」「七百二十時間を超えない範囲内」「一年について六箇月以内」
    ・6項2号「一箇月について…百時間未満であること」・3号「一箇月、二箇月、三箇月、四箇月及び五箇月の期間を加えた…平均時間八十時間を超えないこと」
  roumu-forms/disability-employment-order-9.xml 障害者の雇用の促進等に関する法律施行令 第9条（障害者雇用率「百分の二・七」）
  roumu-forms/source/shougai-youshiki6.pdf 障害者雇用状況報告書（様式第6号）
    ・数え方の式（常用雇用労働者の数「イ+(ロ×0.5)」、身体障害者・知的障害者・精神障害者の数）と、裏面の注意の法定雇用率「100分の2.5」
  roumu-forms/source/koyoujoukyou-kinyuyouryou.pdf 高年齢者雇用状況等報告書及び障害者雇用状況報告書 記入要領（令和8年6月）
    ・「常用労働者」（1年以上継続して雇用される者のうち、1週間の所定労働時間が20時間以上の者）
    ・5ページの様式第2号の絵（文字認識。scripts/pdf_ocr.swift）の⑮常用労働者数の年齢の区分（~44歳・45~49歳…70歳~）
  roumu-forms/source/shougai-kinyuyouryou.pdf 障害者雇用状況報告記入要領（令和8年6月1日現在の報告）
    ・常用雇用労働者（20時間以上）・短時間労働者（20〜30時間）・特定短時間労働者（10〜20時間）と、障害者のカウントの表、報告義務のある事業主（40.0人以上）

次のときは作らずに止まる:
  ・条文の言い回しが見つからない・漢数字を読めない
  ・特別条項の年の上限（720時間）が、限度時間の年（360時間）以下になっている
  ・2〜6か月の平均の期間（直前の1〜5か月を加える）が、条文の並びと合わない
  ・様式第6号の数え方の式・端数の決まりが見つからない（様式が変わった）、様式の法定雇用率が施行令9条の率より大きい
"""
import hashlib
import os
import re
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET


def fail(message):
    sys.stderr.write(f"止まりました: {message}\n")
    sys.exit(1)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


DIGITS = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
SMALL = {"十": 10, "百": 100, "千": 1000}
LARGE = {"万": 10000, "億": 100000000}
KANJI = "〇一二三四五六七八九十百千万億"


def kanji_number(s):
    """「三百六十」「七百二十」などを数にする（読めない字があれば止まる）"""
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


def numbers(text, pattern):
    """条文の言い回し（{n} が漢数字）を探して、その数を返す"""
    rx = re.escape(pattern).replace(re.escape("{n}"), f"([{KANJI}]+)")
    m = re.search(rx, text)
    if not m:
        fail(f"条文に「{pattern}」が見つかりません")
    return [kanji_number(g) for g in m.groups()]


def paragraphs(path):
    """e-Gov 法令API（v1 articles）の XML から、項の番号 → 項の字（号の字も続ける。空白は除く）"""
    root = ET.parse(path).getroot()
    out = {}
    for p in root.iter("Paragraph"):
        num = p.get("Num")
        if not num:
            continue
        out[num] = re.sub(r"\s+", "", "".join(p.itertext()))
    if not out:
        fail(f"{path} に項がありません")
    return out


def read_article36(path):
    p = paragraphs(path)
    for n in ("4", "5", "6"):
        if n not in p:
            fail(f"労働基準法36条に第{n}項がありません")
    monthly, annual, monthly_v, annual_v = numbers(
        p["4"], "一箇月について{n}時間及び一年について{n}時間（第三十二条の四第一項第二号の対象期間として三箇月を超える期間を定めて同条の規定により労働させる場合にあつては、一箇月について{n}時間及び一年について{n}時間）")
    special_monthly = numbers(p["5"], "含め{n}時間未満の範囲内に限る。")[0]
    special_annual = numbers(p["5"], "含め{n}時間を超えない範囲内に限る。")[0]
    special_months = numbers(p["5"], "一年について{n}箇月以内に限る。")[0]
    actual_monthly = numbers(p["6"], "休日において労働させた時間{n}時間未満であること。")[0]
    avg_text = re.search(r"当該各期間の直前の(.+?)の期間を加えたそれぞれの期間", p["6"])
    if not avg_text:
        fail("労働基準法36条6項3号の「直前の…の期間を加えた」が見つかりません")
    before = [kanji_number(x) for x in re.findall(f"([{KANJI}]+)箇月", avg_text.group(1))]
    if before != [1, 2, 3, 4, 5]:
        fail(f"36条6項3号の直前の期間が {before} です（1〜5か月のはず）")
    average_max = numbers(p["6"], "一箇月当たりの平均時間{n}時間を超えないこと。")[0]
    if not (special_annual > annual and annual > annual_v and monthly > monthly_v and special_monthly > monthly):
        fail("限度時間と特別条項の上限の大きさが合いません")
    return {
        "monthly": monthly, "annual": annual, "monthlyVariable": monthly_v, "annualVariable": annual_v,
        "specialMonthlyBelow": special_monthly, "specialAnnual": special_annual, "specialMonthsMax": special_months,
        "actualMonthlyBelow": actual_monthly, "averageMax": average_max, "averageMonths": [b + 1 for b in before],
    }


def read_disability_rate(path):
    p = paragraphs(path)
    text = "".join(p.values())
    m = re.search(r"障害者雇用率は、百分の([〇一二三四五六七八九]+)・([〇一二三四五六七八九]+)とする。", text)
    if not m:
        fail("施行令9条の「障害者雇用率は、百分の○・○とする。」が見つかりません")
    whole, frac = kanji_number(m.group(1)), kanji_number(m.group(2))
    if len(m.group(2)) != 1:
        fail("障害者雇用率の小数が1けたではありません")
    return [whole * 10 + frac, 1000]


def pdf_text(path):
    here = os.path.dirname(os.path.abspath(__file__))
    out = subprocess.run(["swift", os.path.join(here, "pdf_to_text.swift"), path], capture_output=True, check=True)
    return unicodedata.normalize("NFKC", out.stdout.decode("utf-8"))


def read_form6(path, current):
    """障害者雇用状況報告書（様式第6号）の、数え方の式と、裏面の注意の法定雇用率"""
    t = re.sub(r"\s+", "", pdf_text(path))
    if "障害者雇用状況報告書" not in t or "様式第6号" not in t:
        fail("様式第6号ではありません")
    formulas = {
        "workers": "[イ+(ロ×0.5)]",
        "physical": "[(ホ×2)+ヘ+ト+((チ+リ)×0.5)]",
        "intellectual": "[(ル×2)+ヲ+ワ+((カ+ヨ)×0.5)]",
        "mental": "[レ+ソ+(ツ×0.5)]",
    }
    for key, f in formulas.items():
        if f not in t:
            fail(f"様式第6号に数え方の式「{f}」が見つかりません（様式が変わったので、数え方を確かめてください）")
    m = re.search(r"法定雇用率は一般の企業にあっては100分の([0-9])\.([0-9])", t)
    if not m:
        fail("様式第6号の裏面に「法定雇用率は一般の企業にあっては100分の○.○」が見つかりません")
    rate = [int(m.group(1)) * 10 + int(m.group(2)), 1000]
    if rate[0] > current[0]:
        fail(f"様式第6号の法定雇用率 {rate} が、施行令9条の率 {current} より大きくなっています")
    if "小数点以下第3位を四捨五入" not in t or "1人未満の端数があるときは、その端数を切り捨てた数" not in t:
        fail("様式第6号の端数の決まり（実雇用率は小数点以下第3位を四捨五入・人数は1人未満を切り捨て）が見つかりません")
    return rate


def read_elderly_guide(path):
    """高年齢者雇用状況等報告書 記入要領（令和8年6月）の「常用労働者」（1週間の所定労働時間が○時間以上）と、報告の基準日"""
    t = re.sub(r"\s+", "", pdf_text(path))
    if "令和８年６月" not in t and "令和8年6月" not in t:
        fail("記入要領が令和8年6月の版ではありません")
    m = re.search(r"1年以上継続して雇用される者\(見込みを含みます。\)のうち、1週間の所定労働時間が([0-9]+)時間以上の者", t)
    if not m:
        fail("記入要領に「常用労働者」の決まり（1週間の所定労働時間が○時間以上）が見つかりません")
    return int(m.group(1))


def read_disability_guide(path, form_rate):
    """障害者雇用状況報告記入要領（令和8年6月1日現在の報告）の、常用雇用労働者・短時間労働者・特定短時間労働者の週の所定労働時間と、
    障害者のカウントの表、報告する事業主の常用雇用労働者の数"""
    t = re.sub(r"\s+", "", pdf_text(path))
    if "令和8年6月1日現在" not in t:
        fail("障害者雇用状況報告記入要領が令和8年6月1日現在の報告の版ではありません")
    m = re.search(r"常用雇用労働者とは、雇用契約の形式如何を問わず、1週間の所定労働時間が([0-9]+)時間以上の労働者であって、次の1~4のように1年を超えて雇用される者", t)
    if not m:
        fail("記入要領に常用雇用労働者の決まり（1週間の所定労働時間が○時間以上・1年を超えて雇用される者）が見つかりません")
    regular_min = int(m.group(1))
    m = re.search(r"短時間労働者とは、常用雇用労働者のうち、1週間の所定労働時間が([0-9]+)時間以上([0-9]+)時間未満である者", t)
    if not m or int(m.group(1)) != regular_min:
        fail("記入要領に短時間労働者の決まり（○時間以上○時間未満）が見つからないか、常用雇用労働者の時間と合いません")
    short_below = int(m.group(2))
    m = re.search(r"特定短時間労働者とは、短時間労働者のうち、1週間の所定労働時間が([0-9]+)時間以上([0-9]+)時間未満である者", t)
    if not m or int(m.group(2)) != regular_min:
        fail("記入要領に特定短時間労働者の決まり（○時間以上○時間未満）が見つからないか、常用雇用労働者の時間と合いません")
    specified_min = int(m.group(1))
    table = (f"週所定労働時間{short_below}時間以上{regular_min}時間以上{short_below}時間未満特定短時間労働者(※2){specified_min}時間以上{regular_min}時間未満"
             "身体障害者10.5-重度210.5知的障害者10.5-重度210.5精神障害者11(※1)0.5")
    if table not in t:
        fail("記入要領の障害者のカウントの表が、様式第6号の数え方（重度×2・短時間×0.5・精神の短時間は1・特定短時間×0.5）と合いません")
    m = re.search(r"報告義務のある事業主は、企業全体の常用雇用労働者\(除外率により除外すべき労働者を控除した数\)が([0-9]+\.[0-9])人以上の事業主", t)
    if not m:
        fail("記入要領に報告義務のある事業主の規模（○○.○人以上）が見つかりません")
    min_workers = float(m.group(1))
    if abs(min_workers - form_rate[1] / form_rate[0]) > 1e-9:
        fail(f"報告する事業主の規模 {min_workers} 人が、法定雇用率 {form_rate} の逆数と合いません")
    return {"regularMin": regular_min, "shortBelow": short_below, "specifiedMin": specified_min, "minWorkers": m.group(1)}


def read_elderly_bands(path):
    """高年齢者雇用状況等報告書（様式第2号）の⑮常用労働者数の年齢の区分（記入要領の様式の絵のページを文字認識で読む）"""
    here = os.path.dirname(os.path.abspath(__file__))
    out = subprocess.run(["swift", os.path.join(here, "pdf_ocr.swift"), path, "5"], capture_output=True, check=True)
    words = [line.split("\t")[-1] for line in out.stdout.decode("utf-8").splitlines() if line.count("\t") >= 4]
    t = unicodedata.normalize("NFKC", "".join(words)).replace("〜", "~").replace("～", "~")
    t = re.sub(r"\s+", "", t)
    m = re.search(r"常用労総数(.+?)働者数", t)
    if not m:
        fail("様式第2号の⑮常用労働者数の欄が読めません")
    cells = m.group(1)
    bands = []
    first = re.match(r"~([0-9]+)歳", cells)
    if not first:
        fail(f"⑮の最初の区分（~○歳）が読めません：{cells}")
    bands.append([None, int(first.group(1))])
    for a, b in re.findall(r"([0-9]+)~([0-9]+)歳", cells[first.end():]):
        bands.append([int(a), int(b)])
    for i in range(1, len(bands)):
        if bands[i][0] != bands[i - 1][1] + 1:
            fail(f"⑮の年齢の区分がつながっていません：{bands}")
    last = bands[-1][1] + 1
    if f"{last}歳~" not in t:
        fail(f"⑮の最後の区分（{last}歳~）が見つかりません")
    bands.append([last, None])
    return bands


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_roumu_tables.py roumu-forms src/constants/roumu.ts")
    folder, out_path = sys.argv[1], sys.argv[2]
    law36 = os.path.join(folder, "labor-standards-act-36.xml")
    order9 = os.path.join(folder, "disability-employment-order-9.xml")
    form6 = os.path.join(folder, "source", "shougai-youshiki6.pdf")
    guide = os.path.join(folder, "source", "koyoujoukyou-kinyuyouryou.pdf")
    k = read_article36(law36)
    rate = read_disability_rate(order9)
    form_rate = read_form6(form6, rate)
    regular_hours = read_elderly_guide(guide)
    dguide = os.path.join(folder, "source", "shougai-kinyuyouryou.pdf")
    dh = read_disability_guide(dguide, form_rate)
    bands = read_elderly_bands(guide)

    lines = [
        "// このファイルは scripts/import_roumu_tables.py で作ったものです。手で直さないでください。",
        "// 入手元・SHA-256・作り直し方は roumu-forms/README.md",
        f"// 労働基準法36条（labor-standards-act-36.xml SHA-256 {sha256(law36)}）",
        f"// 障害者の雇用の促進等に関する法律施行令9条（disability-employment-order-9.xml SHA-256 {sha256(order9)}）",
        f"// 障害者雇用状況報告書 様式第6号（shougai-youshiki6.pdf SHA-256 {sha256(form6)}）",
        f"// 高年齢者雇用状況等報告書及び障害者雇用状況報告書 記入要領 令和8年6月（koyoujoukyou-kinyuyouryou.pdf SHA-256 {sha256(guide)}）",
        f"// 障害者雇用状況報告記入要領（shougai-kinyuyouryou.pdf SHA-256 {sha256(dguide)}）",
        "",
        "/** 36協定の時間外労働・休日労働の上限（時間。労働基準法36条4項〜6項） */",
        "export const KYOTEI36_LIMITS = {",
        f"  /** 限度時間（4項）：1か月 {k['monthly']}時間・1年 {k['annual']}時間 */",
        f"  monthly: {k['monthly']},",
        f"  annual: {k['annual']},",
        f"  /** 対象期間が3か月を超える1年単位の変形労働時間制の人の限度時間：1か月 {k['monthlyVariable']}時間・1年 {k['annualVariable']}時間 */",
        f"  monthlyVariable: {k['monthlyVariable']},",
        f"  annualVariable: {k['annualVariable']},",
        f"  /** 特別条項（5項）：1か月の時間外労働と休日労働の合計は {k['specialMonthlyBelow']}時間未満・1年の時間外労働は {k['specialAnnual']}時間以内・限度時間を超えられるのは1年に {k['specialMonthsMax']}か月まで */",
        f"  specialMonthlyBelow: {k['specialMonthlyBelow']},",
        f"  specialAnnual: {k['specialAnnual']},",
        f"  specialMonthsMax: {k['specialMonthsMax']},",
        f"  /** 実際の時間（6項2号・3号）：1か月の時間外労働と休日労働の合計は {k['actualMonthlyBelow']}時間未満、{k['averageMonths'][0]}〜{k['averageMonths'][-1]}か月の平均は {k['averageMax']}時間以内 */",
        f"  actualMonthlyBelow: {k['actualMonthlyBelow']},",
        f"  averageMax: {k['averageMax']},",
        f"  averageMonths: [{', '.join(str(x) for x in k['averageMonths'])}],",
        "} as const;",
        "",
        "/** 障害者雇用率（法定雇用率。[分子, 分母]。障害者の雇用の促進等に関する法律施行令9条） */",
        f"export const DISABILITY_EMPLOYMENT_RATE: [number, number] = [{rate[0]}, {rate[1]}];",
        "/** 様式第6号の裏面の注意にある法定雇用率（一般の企業。令和8年6月1日現在の報告まで。令和9年からは施行令9条の率） */",
        f"export const DISABILITY_EMPLOYMENT_RATE_FORM6: [number, number] = [{form_rate[0]}, {form_rate[1]}];",
        "/** 様式第6号の数え方：常用雇用労働者の数は イ＋ロ×0.5、身体障害者は 重度×2＋重度以外＋重度の短時間＋（重度以外の短時間＋重度の特定短時間）×0.5、精神障害者は 精神＋精神の短時間＋特定短時間×0.5 */",
        "export const FORM6_WEIGHTS = { regular: 1, shortTime: 0.5, severe: 2, severeShortTime: 1, specifiedShortTime: 0.5, mentalShortTime: 1 } as const;",
        f"/** 高年齢者雇用状況等報告の「常用労働者」：1年以上継続して雇用される（見込みを含む）人のうち、1週間の所定労働時間が {regular_hours}時間以上の人（記入要領） */",
        f"export const ELDERLY_REPORT_REGULAR_WEEKLY_HOURS = {regular_hours};",
        "/** 高年齢者雇用状況等報告書（様式第2号）の⑮常用労働者数の年齢の区分（[から, まで]。null は上限・下限なし） */",
        "export const ELDERLY_AGE_BANDS: [number | null, number | null][] = [" + ", ".join(f"[{'null' if a is None else a}, {'null' if b is None else b}]" for a, b in bands) + "];",
        "/** 障害者雇用状況報告の週の所定労働時間（記入要領）：常用雇用労働者は regularMin 時間以上、そのうち shortBelow 時間未満は短時間労働者、",
        " *  specifiedMin 時間以上 regularMin 時間未満は特定短時間労働者（重度身体・重度知的・精神の人だけ 0.5 人と数える） */",
        f"export const DISABILITY_WEEKLY_HOURS = {{ regularMin: {dh['regularMin']}, shortBelow: {dh['shortBelow']}, specifiedMin: {dh['specifiedMin']} }} as const;",
        f"/** 令和8年6月1日現在の報告で、報告する事業主（常用雇用労働者 {dh['minWorkers']}人以上。法定雇用率 {form_rate[0]}/{form_rate[1]} の逆数） */",
        f"export const DISABILITY_REPORT_MIN_WORKERS_FORM6 = {dh['minWorkers']};",
        "",
    ]
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"{out_path} を作りました")


if __name__ == "__main__":
    main()
