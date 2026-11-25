#!/usr/bin/env python3
"""
割増賃金の率の最低（時間外・休日・1か月60時間超・深夜）、深夜の時間、中小事業主にも60時間超の率を使い始めた日、
時間単位の年次有給休暇の上限の日数を、法令の条文（e-Gov 法令API の XML）から読み取って、src/constants/laborStandards.ts を作る
（手で書き写さない）。

使い方:
  python3 -I scripts/import_labor_standards.py roumu-forms src/constants/laborStandards.ts

読むもの（入手元と SHA-256 は roumu-forms/README.md）:
  roumu-forms/labor-standards-act.xml   労働基準法（全文）
    ・37条1項「二割五分以上五割以下の範囲内でそれぞれ政令で定める率以上の率」
             ただし書「一箇月について六十時間を超えた場合 … 五割以上の率」
    ・37条4項「午後十時から午前五時まで（…）の間において労働させた場合 … 二割五分以上の率」
    ・39条4項2号「時間を単位として与えることができることとされる有給休暇の日数（五日以内に限る。）」
    ・附則（平成三〇年七月六日法律第七一号）1条3号「第一条中労働基準法第百三十八条の改正規定 令和五年四月一日」
      （中小事業主には60時間超の率を使わないとしていた附則138条を削った日）と、附則138条がいまはないこと
  roumu-forms/wage-premium-order.xml    労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令（平成六年政令第五号）
    ・「延長した労働時間の労働については二割五分とし、これらの規定により労働させた休日の労働については三割五分とする」

次のときは作らずに止まる:
  ・条文の言い回しが見つからない・漢数字や「○割○分」を読めない
  ・政令の率が、37条1項の範囲（二割五分以上五割以下）の外にある、60時間超の率が時間外の率より低い
  ・附則138条がまだある（削られていない）、附則137条・139条が見つからない（読む場所がちがう）
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
    """「六十」「十三」などを数にする（読めない字があれば止まる）"""
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


def percent_of(s):
    """「二割五分」「五割」を % にする（二割五分 → 25）"""
    m = re.fullmatch(f"([{KANJI}]+)割(?:([{KANJI}])分)?", s)
    if not m:
        fail(f"「{s}」を率として読めません")
    return kanji_number(m.group(1)) * 10 + (kanji_number(m.group(2)) if m.group(2) else 0)


def find(text, pattern, label):
    """条文の言い回し（{n} が漢数字、{w} が「○割○分」）を探して、見つけたもの（数・%）を返す"""
    rx = (re.escape(pattern)
          .replace(re.escape("{n}"), f"([{KANJI}]+)")
          .replace(re.escape("{w}"), f"([{KANJI}]+割(?:[{KANJI}]分)?)"))
    m = re.search(rx, text)
    if not m:
        fail(f"{label}に「{pattern}」が見つかりません")
    return [percent_of(g) if g.endswith(("割", "分")) else kanji_number(g) for g in m.groups()]


def flat(e):
    return re.sub(r"\s+", "", "".join(e.itertext()))


def article_paragraphs(scope, num, label):
    """scope の中の条（Num）の、項の番号 → 項の字（号の字も続ける）"""
    for art in scope.iter("Article"):
        if art.get("Num") == num:
            out = {p.get("Num"): flat(p) for p in art.iter("Paragraph") if p.get("Num")}
            if not out:
                fail(f"{label}に項がありません")
            return out
    fail(f"{label}が見つかりません")


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_labor_standards.py roumu-forms src/constants/laborStandards.ts")
    folder, out_path = sys.argv[1], sys.argv[2]
    act_path = os.path.join(folder, "labor-standards-act.xml")
    order_path = os.path.join(folder, "wage-premium-order.xml")
    act = ET.parse(act_path).getroot()
    order = ET.parse(order_path).getroot()

    main_provision = act.find(".//MainProvision")
    if main_provision is None:
        fail("労働基準法の本則が見つかりません")

    # ── 労働基準法37条 ──
    a37 = article_paragraphs(main_provision, "37", "労働基準法37条")
    p1 = a37.get("1", "")
    range_low, range_high = find(p1, "賃金の計算額の{w}以上{w}以下の範囲内でそれぞれ政令で定める率以上の率", "労働基準法37条1項")
    over60_hours, over60 = find(
        p1, "当該延長して労働させた時間が一箇月について{n}時間を超えた場合においては、その超えた時間の労働については、通常の労働時間の賃金の計算額の{w}以上の率",
        "労働基準法37条1項ただし書",
    )
    p4 = a37.get("4", "")
    night_start, night_end = find(p4, "午後{n}時から午前{n}時まで（", "労働基準法37条4項")
    (night,) = find(p4, "の間において労働させた場合においては、その時間の労働については、通常の労働時間の賃金の計算額の{w}以上の率", "労働基準法37条4項")
    night_start += 12
    if not (12 <= night_start < 24 and 0 <= night_end < 12):
        fail(f"深夜の時間（{night_start}時から{night_end}時まで）がおかしいです")

    # ── 労働基準法39条4項（時間単位の年次有給休暇） ──
    a39 = article_paragraphs(main_provision, "39", "労働基準法39条")
    (hourly_days,) = find(a39.get("4", ""), "時間を単位として与えることができることとされる有給休暇の日数（{n}日以内に限る。）", "労働基準法39条4項2号")

    # ── 割増賃金令 ──
    order_title = order.find(".//LawTitle")
    if order_title is None or flat(order_title) != "労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令":
        fail("wage-premium-order.xml が割増賃金令ではありません")
    order_main = order.find(".//MainProvision")
    if order_main is None:
        fail("割増賃金令の本則が見つかりません")
    overtime, holiday = find(
        flat(order_main), "延長した労働時間の労働については{w}とし、これらの規定により労働させた休日の労働については{w}とする", "割増賃金令",
    )
    for label, value in (("時間外労働", overtime), ("休日の労働", holiday)):
        if not (range_low <= value <= range_high):
            fail(f"割増賃金令の{label}の率（{value}%）が、労働基準法37条1項の範囲（{range_low}%〜{range_high}%）の外にあります")
    if over60 < overtime:
        fail(f"60時間を超えた分の率（{over60}%）が、時間外労働の率（{overtime}%）より低いです")

    # ── 中小事業主にも60時間超の率を使い始めた日（附則138条を削った日） ──
    sme_from = None
    for sp in act.iter("SupplProvision"):
        if "平成三〇年七月六日法律第七一号" not in (sp.get("AmendLawNum") or ""):
            continue
        for art in sp.iter("Article"):
            if art.get("Num") != "1":
                continue
            for item in art.iter("Item"):
                text = flat(item)
                if "第一条中労働基準法第百三十八条の改正規定" in text:
                    y, m, d = find(text, "第一条中労働基準法第百三十八条の改正規定令和{n}年{n}月{n}日", "附則（平成30年法律第71号）1条")
                    sme_from = f"{2018 + y:04d}-{m:02d}-{d:02d}"
    if sme_from is None:
        fail("附則（平成三〇年七月六日法律第七一号）1条に、労働基準法第百三十八条の改正規定の施行の日が見つかりません")
    original = next((sp for sp in act.iter("SupplProvision") if not sp.get("AmendLawNum")), None)
    if original is None:
        fail("労働基準法の附則（制定のときのもの）が見つかりません")
    nums = {a.get("Num") for a in original.iter("Article")}
    if "137" not in nums or "139" not in nums:
        fail("労働基準法の附則に137条・139条が見つかりません（読む場所がちがいます）")
    if "138" in nums:
        fail("労働基準法の附則138条（中小事業主には60時間超の率を使わない）が、まだあります")

    ts = f"""// このファイルは scripts/import_labor_standards.py で作る（手で書き換えない）
// 労働基準法（roumu-forms/labor-standards-act.xml SHA-256 {sha256(act_path)}）37条1項・4項・39条4項・附則
// 労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令（平成六年政令第五号。
//   roumu-forms/wage-premium-order.xml SHA-256 {sha256(order_path)}）

/**
 * 割増賃金の率の最低（%）。これより低くはできない
 * ・overtime：時間外労働、holiday：法定休日の労働（労働基準法37条1項・割増賃金令。政令の率は37条1項の{range_low}%〜{range_high}%の範囲）
 * ・over60：1か月の時間外労働が{over60_hours}時間を超えた分（37条1項ただし書）
 * ・night：深夜の労働（37条4項）
 */
export const LEGAL_PREMIUM_PERCENT = {{ overtime: {overtime}, holiday: {holiday}, over60: {over60}, night: {night} }} as const;

/** 1か月の時間外労働がこの時間を超えた分は、over60 の率（労働基準法37条1項ただし書） */
export const OVER60_HOURS = {over60_hours};

/**
 * 深夜の時間（労働基準法37条4項：午後{night_start - 12}時から午前{night_end}時まで）。
 * 厚生労働大臣が必要と認めて定める地域・期間の「午後11時から午前6時まで」は、Q では使わない
 */
export const NIGHT_HOURS = {{ start: {night_start}, end: {night_end} }} as const;

/**
 * 中小事業主にも、1か月{over60_hours}時間を超えた時間外労働の率（over60）を使い始めた日。この日より前は、労働基準法の附則138条で、
 * 中小事業主には使わなかった（附則138条を削った日。平成30年7月6日法律第71号 附則1条3号）
 */
export const SME_OVER60_FROM = "{sme_from}";

/** 時間を単位として与えることができる年次有給休暇の日数の上限（1年に。労働基準法39条4項2号：{hourly_days}日以内） */
export const HOURLY_PAID_LEAVE_MAX_DAYS = {hourly_days};
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{out_path} を作りました：時間外 {overtime}%・休日 {holiday}%・月{over60_hours}時間超 {over60}%・深夜 {night}%（{night_start}時〜{night_end}時）、"
          f"中小事業主は {sme_from} から、時間単位の年休 {hourly_days}日まで")


if __name__ == "__main__":
    main()
