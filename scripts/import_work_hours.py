#!/usr/bin/env python3
"""
法定労働時間（週40時間・1日8時間）と、週44時間の特例（特例措置対象事業場）・フレックスタイム制の週平均50時間を、
法令の条文（e-Gov 法令API の XML）から読み取って、src/constants/workHours.ts を作る（手で書き写さない）。

使い方:
  python3 -I scripts/import_work_hours.py roumu-forms src/constants/workHours.ts

読むもの（入手元と SHA-256 は roumu-forms/README.md）:
  roumu-forms/labor-standards-act.xml        労働基準法（全文）
    ・32条1項「一週間について四十時間」・2項「一日について八時間」
    ・32条の3 1項2号 清算期間「三箇月以内」・2項「一週間当たりの労働時間が五十時間を超えない」
    ・別表第一 第八号・第十号・第十三号・第十四号の事業の名前
  roumu-forms/labor-standards-rule-25-2.xml  労働基準法施行規則 第25条の2（週44時間の特例）
    ・1項「法別表第一第八号、第十号（映画の製作の事業を除く。）、第十三号及び第十四号に掲げる事業のうち常時十人未満の労働者を使用するもの」
          「一週間について四十四時間、一日について八時間まで」
    ・3項 フレックスタイム制「一週間当たりの労働時間が四十四時間を超えない」・清算期間「一箇月以内の期間に限る」
    ・4項「清算期間が一箇月を超えるものである場合に限る」と、第三十二条の四・第三十二条の五（1年単位・1週間単位の変形労働時間制）には使わない

次のときは作らずに止まる:
  ・条文の言い回しが見つからない・漢数字を読めない
  ・1項と3項の44時間、1項の8時間と労働基準法32条の8時間が違う、44時間が40時間より短い
  ・3項の清算期間と4項の清算期間が違う、4項に1年単位・1週間単位の変形労働時間制（32条の4・32条の5）がない
  ・別表第一に、特例の号がない・除く事業（映画の製作）が、その号の事業の名前にない
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
    """「四十四」「十三」などを数にする（読めない字があれば止まる）"""
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
    """条文の言い回し（{n} が漢数字、{s} が字）を探して、見つけたものを返す"""
    rx = re.escape(pattern).replace(re.escape("{n}"), f"([{KANJI}]+)").replace(re.escape("{s}"), "(.+?)")
    m = re.search(rx, text)
    if not m:
        fail(f"{label}に「{pattern}」が見つかりません")
    return [kanji_number(g) if re.fullmatch(f"[{KANJI}]+", g) else g for g in m.groups()]


def flat(e):
    return re.sub(r"\s+", "", "".join(e.itertext()))


def article_paragraphs(root, num, label):
    """XML の中の条（Num）の、項の番号 → 項の字（号の字も続ける）"""
    for art in root.iter("Article"):
        if art.get("Num") == num:
            out = {p.get("Num"): flat(p) for p in art.iter("Paragraph") if p.get("Num")}
            if not out:
                fail(f"{label}に項がありません")
            return out
    fail(f"{label}が見つかりません")


def appendix1_items(root):
    """労働基準法 別表第一の号 → 事業の名前"""
    for ap in root.iter("AppdxTable"):
        title = ap.find("AppdxTableTitle")
        if title is None or flat(title) != "別表第一":
            continue
        out = {}
        for item in ap.iter("Item"):
            sentence = item.find("ItemSentence")
            if item.get("Num") and sentence is not None:
                out[int(item.get("Num"))] = flat(sentence)
        if not out:
            fail("労働基準法 別表第一に号がありません")
        return out
    fail("労働基準法に別表第一が見つかりません")


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_work_hours.py roumu-forms src/constants/workHours.ts")
    folder, out_path = sys.argv[1], sys.argv[2]
    act_path = os.path.join(folder, "labor-standards-act.xml")
    rule_path = os.path.join(folder, "labor-standards-rule-25-2.xml")
    act = ET.parse(act_path).getroot()
    rule = ET.parse(rule_path).getroot()

    # ── 労働基準法32条・32条の3・別表第一 ──
    a32 = article_paragraphs(act, "32", "労働基準法32条")
    (weekly,) = find(a32.get("1", ""), "一週間について{n}時間を超えて", "労働基準法32条1項")
    (daily,) = find(a32.get("2", ""), "一日について{n}時間を超えて", "労働基準法32条2項")
    a323 = article_paragraphs(act, "32_3", "労働基準法32条の3")
    (flex_max_months,) = find(a323.get("1", ""), "{n}箇月以内の期間に限るものとする", "労働基準法32条の3 1項2号")
    (flex_cap,) = find(a323.get("2", ""), "一週間当たりの労働時間が{n}時間を超えない", "労働基準法32条の3 2項")
    (flex_cap_split,) = find(a323.get("2", ""), "清算期間が{n}箇月を超えるものである場合", "労働基準法32条の3 2項")
    if flex_cap <= weekly:
        fail(f"フレックスタイム制の週平均の上限（{flex_cap}時間）が、週の法定労働時間（{weekly}時間）以下です")
    items = appendix1_items(act)

    # ── 労働基準法施行規則25条の2 ──
    r = article_paragraphs(rule, "25_2", "労働基準法施行規則25条の2")
    p1 = r.get("1", "")
    i1, i2, excluded, i3, i4, workers = find(
        p1, "法別表第一第{n}号、第{n}号（{s}を除く。）、第{n}号及び第{n}号に掲げる事業のうち常時{n}人未満の労働者を使用するもの",
        "施行規則25条の2 1項",
    )
    weekly44, daily44 = find(p1, "一週間について{n}時間、一日について{n}時間まで", "施行規則25条の2 1項")
    (weekly44_flex,) = find(r.get("3", ""), "一週間当たりの労働時間が{n}時間を超えない", "施行規則25条の2 3項")
    (flex44_months,) = find(r.get("3", ""), "{n}箇月以内の期間に限る", "施行規則25条の2 3項2号")
    p4 = r.get("4", "")
    (flex44_split,) = find(p4, "清算期間が{n}箇月を超えるものである場合に限る", "施行規則25条の2 4項")
    if "第三十二条の四" not in p4 or "第三十二条の五" not in p4:
        fail("施行規則25条の2 4項に、1年単位・1週間単位の変形労働時間制（第三十二条の四・第三十二条の五）が見つかりません")
    if weekly44 != weekly44_flex:
        fail(f"施行規則25条の2の1項（{weekly44}時間）と3項（{weekly44_flex}時間）の週の時間が違います")
    if daily44 != daily:
        fail(f"施行規則25条の2の1日（{daily44}時間）が、労働基準法32条の1日（{daily}時間）と違います")
    if weekly44 <= weekly:
        fail(f"特例の週の時間（{weekly44}時間）が、法定労働時間（{weekly}時間）以下です")
    if flex44_months != flex44_split or flex44_split != flex_cap_split:
        fail(f"特例のフレックスタイム制の清算期間（3項 {flex44_months}か月・4項 {flex44_split}か月・法32条の3 2項 {flex_cap_split}か月）がそろいません")
    if flex44_months >= flex_max_months:
        fail(f"特例のフレックスタイム制の清算期間（{flex44_months}か月）が、法32条の3の上限（{flex_max_months}か月）以上です")
    businesses = []
    for item in (i1, i2, i3, i4):
        if item not in items:
            fail(f"労働基準法 別表第一に第{item}号がありません")
        businesses.append({"item": item, "name": items[item], "excluded": excluded if item == i2 else ""})
    film = excluded.replace("の事業", "")
    if film not in items[i2]:
        fail(f"除く事業（{excluded}）が、別表第一第{i2}号（{items[i2]}）にありません")

    def q(s):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'

    rows = "\n".join(
        f"  {{ item: {b['item']}, name: {q(b['name'])}, excluded: {q(b['excluded'])} }}," for b in businesses
    )
    ts = f"""// このファイルは scripts/import_work_hours.py で作る（手で書き換えない）
// 労働基準法（roumu-forms/labor-standards-act.xml SHA-256 {sha256(act_path)}）32条・32条の3・別表第一
// 労働基準法施行規則 第25条の2（roumu-forms/labor-standards-rule-25-2.xml SHA-256 {sha256(rule_path)}）

/** 法定労働時間（労働基準法32条1項：1週間{weekly}時間、2項：1日{daily}時間） */
export const LEGAL_WORK_HOURS = {{ weekly: {weekly}, daily: {daily} }} as const;

/**
 * フレックスタイム制（労働基準法32条の3）：清算期間の上限（1項2号：{flex_max_months}か月以内）と、清算期間が{flex_cap_split}か月を超えるときの
 * 1か月ごとの週平均の上限（2項：{flex_cap}時間）
 */
export const FLEX_LIMITS = {{ maxMonths: {flex_max_months}, monthCapWeeklyHours: {flex_cap} }} as const;

/**
 * 週44時間の特例（特例措置対象事業場。労働基準法施行規則25条の2）：別表第一の事業のうち常時{workers}人未満の労働者を使用する事業場は、
 * 1週間{weekly44}時間・1日{daily44}時間まで（1項）。フレックスタイム制は清算期間が{flex44_months}か月以内のときだけ（3項）。
 * 清算期間が{flex44_split}か月を超えるフレックスタイム制・1年単位・1週間単位の変形労働時間制には使わない（4項）
 */
export const WEEKLY_44 = {{ weekly: {weekly44}, daily: {daily44}, workersBelow: {workers}, flexMaxMonths: {flex44_months} }} as const;

/** 週44時間の特例の事業（施行規則25条の2 1項。名前は労働基準法 別表第一。excluded はその号から除く事業） */
export const WEEKLY_44_BUSINESSES = [
{rows}
] as const;
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{out_path} を作りました：週{weekly}時間・1日{daily}時間、特例 週{weekly44}時間（常時{workers}人未満・第{i1}・{i2}・{i3}・{i4}号）、"
          f"フレックス {flex_max_months}か月まで・週平均{flex_cap}時間、特例のフレックス {flex44_months}か月まで")


if __name__ == "__main__":
    main()
