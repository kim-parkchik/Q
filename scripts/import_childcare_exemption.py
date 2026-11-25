#!/usr/bin/env python3
"""
育児休業等の期間中の社会保険料の免除で使う数（同じ月のうちに始まって終わる育児休業等の「十四日以上」・賞与を免除しない「一月以下」）と、
その決まりを使い始めた日（令和4年10月1日以後に開始した育児休業等）を、法令の条文（e-Gov 法令API の XML）から読み取って、
src/constants/insurance/childcareExemption.ts を作る（手で書き写さない）。

使い方:
  python3 -I scripts/import_childcare_exemption.py roumu-forms src/constants/insurance/childcareExemption.ts

読むもの（入手元と SHA-256 は roumu-forms/README.md）:
  roumu-forms/health-insurance-act-159.xml     健康保険法 第159条
  roumu-forms/employees-pension-act-81-2.xml   厚生年金保険法 第81条の2
    ・どちらも1項「（その育児休業等の期間が一月以下である者については、標準報酬月額に係る保険料に限る。）」
              2号「その育児休業等を開始した日の属する月とその育児休業等が終了する日の翌日が属する月とが同一であり、かつ、
                   当該月における育児休業等の日数として厚生労働省令で定めるところにより計算した日数が十四日以上である場合」
  roumu-forms/source/health-insurance-act.xml  健康保険法（全文。大きいので GitHub には上げない）
    ・附則（令和三年六月一一日法律第六六号）1条3号「第一条中健康保険法第百五十九条…の改正規定 … 令和四年十月一日」
    ・同 3条3項「第一条の規定による改正後の健康保険法第百五十九条の規定は、附則第一条第三号に掲げる規定の施行の日
                （以下「第三号施行日」という。）以後に開始する…育児休業等について適用し」
    ・本則の159条が、health-insurance-act-159.xml の159条と同じ字であること（同じ時点の法律を読んでいるか）

次のときは作らずに止まる:
  ・条文の言い回しが見つからない・漢数字を読めない
  ・健康保険法と厚生年金保険法で、日数・月数が違う
  ・全文の159条と、159条だけの XML の字が違う
  ・附則の1条3号・3条3項が見つからない
"""
import hashlib
import os
import re
import sys
import xml.etree.ElementTree as ET


def fail(message):
    sys.stderr.write(f"止まりました: {message}\n")
    sys.exit(1)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


DIGITS = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
SMALL = {"十": 10, "百": 100, "千": 1000}
KANJI = "〇一二三四五六七八九十百千"


def kanji_number(s):
    """「十四」「一」などを数にする（読めない字があれば止まる）"""
    section, digit = 0, None
    for ch in s:
        if ch in DIGITS:
            if digit is not None:
                fail(f"漢数字「{s}」を読めません")
            digit = DIGITS[ch]
        elif ch in SMALL:
            section += (1 if digit is None else digit) * SMALL[ch]
            digit = None
        else:
            fail(f"漢数字「{s}」の「{ch}」を読めません")
    return section + (digit or 0)


def find(text, pattern, label):
    """条文の言い回し（{n} が漢数字）を探して、見つけた数を返す"""
    rx = re.escape(pattern).replace(re.escape("{n}"), f"([{KANJI}]+)")
    m = re.search(rx, text)
    if not m:
        fail(f"{label}に「{pattern}」が見つかりません")
    return [kanji_number(g) for g in m.groups()]


def flat(e):
    return re.sub(r"\s+", "", "".join(e.itertext()))


def article_of(scope, num, label):
    for art in scope.iter("Article"):
        if art.get("Num") == num:
            return art
    fail(f"{label}が見つかりません")


def exemption_numbers(path, num, label):
    """1項の「一月以下」と、2号の「十四日以上」"""
    art = article_of(ET.parse(path).getroot(), num, label)
    p1 = next((p for p in art.iter("Paragraph") if p.get("Num") == "1"), None)
    if p1 is None:
        fail(f"{label}に1項がありません")
    text = flat(p1)
    (months,) = find(text, "（その育児休業等の期間が{n}月以下である者については、標準報酬月額に係る保険料に限る。）", f"{label} 1項")
    (days,) = find(
        text,
        "その育児休業等を開始した日の属する月とその育児休業等が終了する日の翌日が属する月とが同一であり、かつ、"
        "当該月における育児休業等の日数として厚生労働省令で定めるところにより計算した日数が{n}日以上である場合",
        f"{label} 1項2号",
    )
    return months, days, flat(art)


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_childcare_exemption.py roumu-forms src/constants/insurance/childcareExemption.ts")
    folder, out_path = sys.argv[1], sys.argv[2]
    kenpo_path = os.path.join(folder, "health-insurance-act-159.xml")
    kounen_path = os.path.join(folder, "employees-pension-act-81-2.xml")
    full_path = os.path.join(folder, "source", "health-insurance-act.xml")
    if not os.path.exists(full_path):
        fail(f"{full_path} がありません（入手元は roumu-forms/README.md）")

    k_months, k_days, k_text = exemption_numbers(kenpo_path, "159", "健康保険法159条")
    p_months, p_days, _ = exemption_numbers(kounen_path, "81_2", "厚生年金保険法81条の2")
    if (k_months, k_days) != (p_months, p_days):
        fail(f"健康保険法159条（{k_months}月・{k_days}日）と厚生年金保険法81条の2（{p_months}月・{p_days}日）が違います")

    full = ET.parse(full_path).getroot()
    main_provision = full.find(".//MainProvision")
    if main_provision is None:
        fail("健康保険法（全文）の本則が見つかりません")
    if flat(article_of(main_provision, "159", "健康保険法（全文）159条")) != k_text:
        fail("健康保険法（全文）の159条が、health-insurance-act-159.xml の159条と違います（取得した時点が違うかもしれません）")

    supl = next((sp for sp in full.iter("SupplProvision") if "令和三年六月一一日法律第六六号" in (sp.get("AmendLawNum") or "")), None)
    if supl is None:
        fail("健康保険法（全文）に、附則（令和三年六月一一日法律第六六号）が見つかりません")
    art1 = article_of(supl, "1", "附則（令和3年法律第66号）1条")
    item3 = next((it for it in art1.iter("Item") if it.get("Num") == "3"), None)
    if item3 is None:
        fail("附則（令和3年法律第66号）1条に3号がありません")
    item3_text = flat(item3)
    if "第一条中健康保険法第百五十九条" not in item3_text:
        fail("附則（令和3年法律第66号）1条3号に、健康保険法第百五十九条の改正規定がありません")
    m = re.search(f"令和([{KANJI}]+)年([{KANJI}]+)月([{KANJI}]+)日$", item3_text)
    if not m:
        fail("附則（令和3年法律第66号）1条3号の終わりに、施行の日が見つかりません")
    y, mo, d = (kanji_number(g) for g in m.groups())
    start = f"{2018 + y:04d}-{mo:02d}-{d:02d}"
    art3 = article_of(supl, "3", "附則（令和3年法律第66号）3条")
    p3 = next((p for p in art3.iter("Paragraph") if p.get("Num") == "3"), None)
    if p3 is None:
        fail("附則（令和3年法律第66号）3条に3項がありません")
    if ("第一条の規定による改正後の健康保険法第百五十九条の規定は、附則第一条第三号に掲げる規定の施行の日（以下「第三号施行日」という。）以後に開始する"
            not in flat(p3)):
        fail("附則（令和3年法律第66号）3条3項に、「改正後の健康保険法第百五十九条の規定は、…第三号施行日…以後に開始する」が見つかりません")

    ts = f"""// このファイルは scripts/import_childcare_exemption.py で作る（手で書き換えない）
// 健康保険法 第159条（roumu-forms/health-insurance-act-159.xml SHA-256 {sha256(kenpo_path)}）
// 厚生年金保険法 第81条の2（roumu-forms/employees-pension-act-81-2.xml SHA-256 {sha256(kounen_path)}）
// 健康保険法（全文。roumu-forms/source/health-insurance-act.xml SHA-256 {sha256(full_path)}）の附則（令和3年6月11日法律第66号）1条3号・3条3項

/**
 * 育児休業等の期間中の、健康保険・厚生年金保険の保険料の免除（健康保険法159条1項・厚生年金保険法81条の2第1項。2つの条文で同じ）
 * ・sameMonthMinDays：育児休業等を開始した日の月と、終了する日の翌日の月が同じとき、その月の育児休業等の日数（厚生労働省令で数える）が
 *   この日数以上なら、その月の保険料を免除する（1項2号）
 * ・bonusMonths：育児休業等の期間がこの月数以下の人は、標準報酬月額に係る保険料だけを免除する（賞与の保険料は免除しない。1項のかっこ書）
 */
export const CHILDCARE_EXEMPTION = {{ sameMonthMinDays: {k_days}, bonusMonths: {k_months} }} as const;

/**
 * 上の決まり（令和4年10月の改正）を使う育児休業等の開始日。この日以後に開始した育児休業等に使い、この日より前に開始したものは
 * 前の決まりによる（健康保険法の附則（令和3年6月11日法律第66号）1条3号の施行の日・3条3項）
 */
export const CHILDCARE_RULE_2022_START = "{start}";
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{out_path} を作りました：同じ月の育児休業等は{k_days}日以上で免除、{k_months}か月以下なら賞与は免除しない、{start} 以後に開始したものから")


if __name__ == "__main__":
    main()
