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
    ・56条1項「児童が満十五歳に達した日以後の最初の三月三十一日が終了するまで、これを使用してはならない」
    ・60条1項「第三十二条の二から第三十二条の五まで、第三十六条、第四十条及び第四十一条の二の規定は、満十八才に満たない者については、
      これを適用しない」、3項「満十五歳以上で満十八歳に満たない者」・1号「一日の労働時間を四時間以内に短縮する場合において、
      他の日の労働時間を十時間まで延長すること」
    ・61条1項「満十八才に満たない者を午後十時から午前五時までの間において使用してはならない」・ただし書「交替制によつて使用する
      満十六才以上の男性」、4項「別表第一第六号、第七号若しくは第十三号に掲げる事業若しくは電話交換の業務については、適用しない」
    ・別表第一 第六号・第七号・第十三号の事業の名前
    ・附則（平成三〇年七月六日法律第七一号）1条3号「第一条中労働基準法第百三十八条の改正規定 令和五年四月一日」
      （中小事業主には60時間超の率を使わないとしていた附則138条を削った日）と、附則138条がいまはないこと
  roumu-forms/wage-premium-order.xml    労働基準法第三十七条第一項の時間外及び休日の割増賃金に係る率の最低限度を定める政令（平成六年政令第五号）
    ・「延長した労働時間の労働については二割五分とし、これらの規定により労働させた休日の労働については三割五分とする」

次のときは作らずに止まる:
  ・条文の言い回しが見つからない・漢数字や「○割○分」を読めない
  ・政令の率が、37条1項の範囲（二割五分以上五割以下）の外にある、60時間超の率が時間外の率より低い
  ・附則138条がまだある（削られていない）、附則137条・139条が見つからない（読む場所がちがう）
  ・60条・61条の年齢がそろわない、61条1項の深夜の時間が37条4項とちがう、56条・60条3項の年齢がそろわない
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

    # ── 年少者（56条・60条・61条） ──
    a56 = article_paragraphs(main_provision, "56", "労働基準法56条")
    (minimum_age,) = find(a56.get("1", ""), "児童が満{n}歳に達した日以後の最初の三月三十一日が終了するまで、これを使用してはならない", "労働基準法56条1項")
    a60 = article_paragraphs(main_provision, "60", "労働基準法60条")
    (minor_age,) = find(
        a60.get("1", ""), "第三十二条の二から第三十二条の五まで、第三十六条、第四十条及び第四十一条の二の規定は、満{n}才に満たない者については、これを適用しない",
        "労働基準法60条1項",
    )
    low_age, high_age = find(a60.get("3", ""), "満{n}歳以上で満{n}歳に満たない者", "労働基準法60条3項")
    short_day, long_day = find(
        a60.get("3", ""), "一週間のうち一日の労働時間を{n}時間以内に短縮する場合において、他の日の労働時間を{n}時間まで延長すること", "労働基準法60条3項1号",
    )
    a61 = article_paragraphs(main_provision, "61", "労働基準法61条")
    minor_age61, minor_night_start, minor_night_end = find(
        a61.get("1", ""), "満{n}才に満たない者を午後{n}時から午前{n}時までの間において使用してはならない", "労働基準法61条1項",
    )
    (shift_male_age,) = find(a61.get("1", ""), "交替制によつて使用する満{n}才以上の男性については、この限りでない", "労働基準法61条1項ただし書")
    night_exempt_items = find(
        a61.get("4", ""), "別表第一第{n}号、第{n}号若しくは第{n}号に掲げる事業若しくは電話交換の業務については、適用しない", "労働基準法61条4項",
    )
    if not (minor_age == minor_age61 == high_age):
        fail(f"年少者の年齢が、60条1項（{minor_age}）・60条3項（{high_age}）・61条1項（{minor_age61}）でそろいません")
    if low_age != minimum_age:
        fail(f"60条3項の年齢（{low_age}）が、56条1項の最低年齢（{minimum_age}）とちがいます")
    if (minor_night_start + 12, minor_night_end) != (night_start, night_end):
        fail(f"61条1項の深夜の時間（{minor_night_start + 12}時から{minor_night_end}時まで）が、37条4項とちがいます")
    if not (minimum_age < shift_male_age < minor_age and short_day < long_day):
        fail("61条1項ただし書の年齢・60条3項1号の時間の大きさの順がおかしいです")
    items = appendix1_items(act)
    for item in night_exempt_items:
        if item not in items:
            fail(f"労働基準法 別表第一に第{item}号がありません")

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
// 労働基準法（roumu-forms/labor-standards-act.xml SHA-256 {sha256(act_path)}）37条1項・4項・39条4項・56条・60条・61条・別表第一・附則
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

/**
 * 年少者（労働基準法60条1項・61条1項）：満{minor_age}歳に満たない人には、変形労働時間制・フレックスタイム制（32条の2〜32条の5）、
 * 時間外と休日の労働（36条。36協定）、週44時間の特例など（40条）、高度プロフェッショナル制度（41条の2）を使わない。
 * 午後{minor_night_start}時から午前{minor_night_end}時までの間（深夜）に使わない（例外は MINOR_NIGHT_EXCEPTIONS）
 */
export const MINOR_AGE = {minor_age};

/** 最低年齢（労働基準法56条1項）：満{minimum_age}歳に達した日以後の最初の3月31日が終わるまで使えない（2項の許可を受けたときを除く） */
export const MINIMUM_WORK_AGE = {minimum_age};

/**
 * 満{minimum_age}歳以上{minor_age}歳未満の人の、1週間の労働時間の例外（労働基準法60条3項1号）：1週間の労働時間が法定労働時間を超えない範囲で、
 * 1日を{short_day}時間以内にすれば、ほかの日を{long_day}時間まで延ばせる
 */
export const MINOR_SHORTENED_DAY_HOURS = {{ short: {short_day}, long: {long_day} }} as const;

/**
 * 年少者の深夜業の禁止の例外（労働基準法61条）
 * ・shiftMaleAge：交替制で使う満{shift_male_age}歳以上の男性（1項ただし書）
 * ・businesses：禁止を使わない事業（4項。名前は労働基準法 別表第一）。ほかに、電話交換の業務と、
 *   災害など臨時の必要で33条1項により時間を延ばし・休日に働かせるとき
 */
export const MINOR_NIGHT_EXCEPTIONS = {{
  shiftMaleAge: {shift_male_age},
  businesses: [
{chr(10).join(f'    {{ item: {i}, name: "{items[i]}" }},' for i in night_exempt_items)}
  ],
}} as const;
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{out_path} を作りました：時間外 {overtime}%・休日 {holiday}%・月{over60_hours}時間超 {over60}%・深夜 {night}%（{night_start}時〜{night_end}時）、"
          f"中小事業主は {sme_from} から、時間単位の年休 {hourly_days}日まで、年少者 {minor_age}歳未満（最低年齢 {minimum_age}歳）")


if __name__ == "__main__":
    main()
