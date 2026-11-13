#!/usr/bin/env python3
"""
e-Gov 法令検索の条文データ（XML）から、年次有給休暇の付与日数の表（TypeScript）を作る。

使い方:
    python3 -I scripts/import_annual_leave_tables.py \
        annual-leave-tables/rouki-39.xml \
        annual-leave-tables/roukisoku-24-3.xml \
        src/constants/annualLeave.ts

・AI や手作業で数字を書き写さないための道具。数字はすべて条文の文と表から機械的に読み取る（漢数字を数にする）。
・1つ目は労働基準法39条（e-Gov 法令検索 API の条文データ）。
  1項から「6か月継続勤務・全労働日の8割以上出勤・10労働日」、2項の表から「6か月経過日から数えた継続勤務年数ごとに足す日数」を読む。
  7項から、年5日の時季指定の義務があるのは「付与する日数が10労働日以上」の人であることを読む。
・2つ目は労働基準法施行規則24条の3（比例付与）。1項の30時間、2項の5.2日、3項の表（週所定労働日数・1年間の所定労働日数ごとの付与日数）、
  4項の4日、5項の216日を読む。
・照らし合わせ：比例付与の表の日数が、すべて「通常の付与日数 × 週所定労働日数 ÷ 5.2（1日未満切り捨て）」と同じか確かめ、違えば止まる
  （労働基準法39条3項：通常の労働者の週所定労働日数との比率を考慮して定める日数）。読めない・形が違うときも止まる。
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import math
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date

ROUKI_URL = "https://laws.e-gov.go.jp/api/1/articles;lawId=322AC0000000049;article=39"
ROUKISOKU_URL = "https://laws.e-gov.go.jp/api/1/articles;lawId=322M40000100023;article=24_3"

DIGITS = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
UNITS = {"十": 10, "百": 100, "千": 1000}


def kanji_int(text: str) -> int:
    """「二百十六」→ 216、「十」→ 10、「十五」→ 15"""
    total = 0
    num = 0
    for ch in text:
        if ch in DIGITS:
            num = DIGITS[ch]
        elif ch in UNITS:
            total += (num or 1) * UNITS[ch]
            num = 0
        else:
            raise SystemExit(f"漢数字として読めない文字があります: {text!r}")
    return total + num


def kanji_number(text: str) -> float:
    """「五・二」→ 5.2"""
    if "・" in text:
        whole, frac = text.split("・")
        return float(f"{kanji_int(whole)}.{''.join(str(DIGITS[c]) for c in frac)}")
    return kanji_int(text)


def fail(message: str):
    raise SystemExit(f"止まりました: {message}")


def load_article(path: str):
    root = ET.parse(path).getroot()
    code = root.findtext("Result/Code")
    if code != "0":
        fail(f"{path} の取得結果のコードが 0 ではありません（{code}）")
    art = root.find(".//LawContents/Article")
    if art is None:
        fail(f"{path} に条文がありません")
    return art


def paragraph(art, num: int):
    for p in art.findall("Paragraph"):
        if p.get("Num") == str(num):
            return p
    fail(f"{art.get('Num')}条{num}項がありません")


def sentence(p) -> str:
    return "".join(p.find("ParagraphSentence").itertext()).replace("\n", "").replace(" ", "").strip()


def table_rows(p):
    rows = []
    for t in p.iter("TableStruct"):
        for row in t.iter("TableRow"):
            rows.append(["".join(c.itertext()).replace("\n", "").replace(" ", "").strip() for c in row.findall("TableColumn")])
    if not rows:
        fail("表がありません")
    return rows


def read_rouki(path: str):
    art = load_article(path)
    if art.get("Num") != "39":
        fail("労働基準法の条文が39条ではありません")
    # 1項：6か月・8割・10労働日
    s1 = sentence(paragraph(art, 1))
    m = re.search(r"雇入れの日から起算して(.+?)箇月間継続勤務し全労働日の(.+?)割以上出勤した労働者に対して、継続し、又は分割した(.+?)労働日の有給休暇", s1)
    if not m:
        fail("39条1項の文の形が違います")
    first_months, attendance_tenths, base_days = kanji_int(m.group(1)), kanji_int(m.group(2)), kanji_int(m.group(3))
    # 2項：6か月経過日から数えた継続勤務年数ごとに足す日数
    rows = table_rows(paragraph(art, 2))
    if rows[0] != ["六箇月経過日から起算した継続勤務年数", "労働日"]:
        fail(f"39条2項の表の見出しが違います: {rows[0]}")
    additions = []
    for years_text, days_text in rows[1:]:
        ym = re.fullmatch(r"(.+?)年(以上)?", years_text)
        dm = re.fullmatch(r"(.+?)労働日", days_text)
        if not ym or not dm:
            fail(f"39条2項の表の行が読めません: {years_text} / {days_text}")
        additions.append((kanji_int(ym.group(1)), bool(ym.group(2)), kanji_int(dm.group(1))))
    years = [a[0] for a in additions]
    if years != list(range(1, len(additions) + 1)) or not additions[-1][1] or any(a[1] for a in additions[:-1]):
        fail(f"39条2項の表の年数が 1年〜「◯年以上」の形ではありません: {additions}")
    # 7項：年5日の時季指定の義務がある人（付与日数が10労働日以上）
    s7 = sentence(paragraph(art, 7))
    m7 = re.search(r"使用者が与えなければならない有給休暇の日数が(.+?)労働日以上である労働者", s7)
    m7b = re.search(r"日数のうち(.+?)日については、基準日", s7)
    if not m7 or not m7b:
        fail("39条7項の文の形が違います")
    return {
        "firstMonths": first_months,
        "attendanceRate": attendance_tenths / 10,
        "baseDays": base_days,
        "additions": [(y, d) for y, _, d in additions],
        "obligationMinGrantDays": kanji_int(m7.group(1)),
        "obligationDays": kanji_int(m7b.group(1)),
    }


def read_roukisoku(path: str):
    art = load_article(path)
    if art.get("Num") != "24_3":
        fail("労働基準法施行規則の条文が24条の3ではありません")
    m1 = re.fullmatch(r"法第三十九条第三項の厚生労働省令で定める時間は、(.+?)時間とする。", sentence(paragraph(art, 1)))
    m2 = re.fullmatch(r"法第三十九条第三項の通常の労働者の一週間の所定労働日数として厚生労働省令で定める日数は、(.+?)日とする。", sentence(paragraph(art, 2)))
    m4 = re.fullmatch(r"法第三十九条第三項第一号の厚生労働省令で定める日数は、(.+?)日とする。", sentence(paragraph(art, 4)))
    m5 = re.fullmatch(r"法第三十九条第三項第二号の厚生労働省令で定める日数は、(.+?)日とする。", sentence(paragraph(art, 5)))
    if not (m1 and m2 and m4 and m5):
        fail("24条の3の1・2・4・5項の文の形が違います")
    rows = table_rows(paragraph(art, 3))
    if rows[0] != ["週所定労働日数", "一年間の所定労働日数", "雇入れの日から起算した継続勤務期間"]:
        fail(f"24条の3の表の見出しが違います: {rows[0]}")
    periods = rows[1]
    expected_periods = ["六箇月", "一年六箇月", "二年六箇月", "三年六箇月", "四年六箇月", "五年六箇月", "六年六箇月以上"]
    if periods != expected_periods:
        fail(f"24条の3の表の継続勤務期間の並びが違います: {periods}")
    proportional = []
    for row in rows[2:]:
        if len(row) != 2 + len(periods):
            fail(f"24条の3の表の行の列の数が違います: {row}")
        wd = re.fullmatch(r"(.+?)日", row[0])
        ad = re.fullmatch(r"(.+?)日から(.+?)日まで", row[1])
        if not wd or not ad:
            fail(f"24条の3の表の行が読めません: {row}")
        days = []
        for cell in row[2:]:
            dm = re.fullmatch(r"(.+?)日", cell)
            if not dm:
                fail(f"24条の3の表の日数が読めません: {cell}")
            days.append(kanji_int(dm.group(1)))
        proportional.append({
            "weeklyDays": kanji_int(wd.group(1)),
            "annualDaysFrom": kanji_int(ad.group(1)),
            "annualDaysTo": kanji_int(ad.group(2)),
            "days": days,
        })
    return {
        "weeklyHoursLimit": kanji_int(m1.group(1)),
        "normalWeeklyDays": kanji_number(m2.group(1)),
        "proportionalMaxWeeklyDays": kanji_int(m4.group(1)),
        "proportionalMaxAnnualDays": kanji_int(m5.group(1)),
        "proportional": proportional,
    }


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    rouki = read_rouki(sys.argv[1])
    soku = read_roukisoku(sys.argv[2])

    # 通常の付与日数（6か月・1年6か月・…・6年6か月以上）
    normal = [rouki["baseDays"]] + [rouki["baseDays"] + d for _, d in rouki["additions"]]
    if len(normal) != 7:
        fail(f"通常の付与日数の段の数が7ではありません: {normal}")

    # 照らし合わせ：比例付与の日数 ＝ 通常の付与日数 × 週所定労働日数 ÷ 5.2（1日未満切り捨て）
    for row in soku["proportional"]:
        for i, days in enumerate(row["days"]):
            expected = math.floor(normal[i] * row["weeklyDays"] / soku["normalWeeklyDays"] + 1e-9)
            if days != expected:
                fail(f"比例付与の表（週{row['weeklyDays']}日・{i}段目）が {days}日ですが、計算では {expected}日です")
    weekly = [r["weeklyDays"] for r in soku["proportional"]]
    if weekly != list(range(soku["proportionalMaxWeeklyDays"], 0, -1)):
        fail(f"比例付与の表の週所定労働日数が {soku['proportionalMaxWeeklyDays']}日〜1日の並びではありません: {weekly}")
    if soku["proportional"][0]["annualDaysTo"] != soku["proportionalMaxAnnualDays"]:
        fail("比例付与の表の1年間の所定労働日数の上限が、24条の3第5項の日数と違います")

    today = date.today().isoformat()
    prop_lines = "\n".join(
        f"  {{ weeklyDays: {r['weeklyDays']}, annualDaysFrom: {r['annualDaysFrom']}, annualDaysTo: {r['annualDaysTo']}, days: [{', '.join(str(d) for d in r['days'])}] }},"
        for r in soku["proportional"]
    )
    out = f"""/**
 * 年次有給休暇の付与日数の表（このファイルは scripts/import_annual_leave_tables.py で作る。手で直さない）
 *
 * 出典：e-Gov 法令検索の条文データ（{today} に作成。元のファイルは annual-leave-tables/）
 *   ・労働基準法39条 {ROUKI_URL}
 *   ・労働基準法施行規則24条の3 {ROUKISOKU_URL}
 * 比例付与の表の日数は、すべて「通常の付与日数 × 週所定労働日数 ÷ {soku['normalWeeklyDays']}（1日未満切り捨て）」と同じことを確かめてある。
 */

/** 雇入れの日から、はじめて付与するまでの月数（労働基準法39条1項） */
export const FIRST_GRANT_MONTHS = {rouki['firstMonths']};

/** 付与の条件の出勤率（全労働日の8割以上。労働基準法39条1項） */
export const ATTENDANCE_RATE_REQUIRED = {rouki['attendanceRate']};

/**
 * 通常の付与日数（継続勤務期間 6か月・1年6か月・2年6か月・3年6か月・4年6か月・5年6か月・6年6か月以上 の順。
 * 労働基準法39条1項・2項）
 */
export const NORMAL_GRANT_DAYS: readonly number[] = [{', '.join(str(d) for d in normal)}];

/** 比例付与にならない、1週間の所定労働時間（この時間以上なら通常の付与。労働基準法施行規則24条の3第1項） */
export const PROPORTIONAL_WEEKLY_HOURS_LIMIT = {soku['weeklyHoursLimit']};

/** 通常の労働者の1週間の所定労働日数（労働基準法施行規則24条の3第2項） */
export const NORMAL_WEEKLY_DAYS = {soku['normalWeeklyDays']};

/** 比例付与になる1週間の所定労働日数の上限・1年間の所定労働日数の上限（労働基準法施行規則24条の3第4項・5項） */
export const PROPORTIONAL_MAX_WEEKLY_DAYS = {soku['proportionalMaxWeeklyDays']};
export const PROPORTIONAL_MAX_ANNUAL_DAYS = {soku['proportionalMaxAnnualDays']};

/** 比例付与の日数（労働基準法施行規則24条の3第3項の表。days は継続勤務期間の段の順） */
export const PROPORTIONAL_GRANT_DAYS: readonly {{ weeklyDays: number; annualDaysFrom: number; annualDaysTo: number; days: readonly number[] }}[] = [
{prop_lines}
];

/** 年5日の時季指定の義務がある人：付与する日数がこの日数以上（労働基準法39条7項） */
export const OBLIGATION_MIN_GRANT_DAYS = {rouki['obligationMinGrantDays']};

/** 年5日の時季指定の日数（労働基準法39条7項） */
export const OBLIGATION_DAYS = {rouki['obligationDays']};
"""
    with open(sys.argv[3], "w", encoding="utf-8") as f:
        f.write(out)
    print(f"作成しました: {sys.argv[3]}（通常 {normal}・比例付与 {len(soku['proportional'])}行）")


if __name__ == "__main__":
    main()
