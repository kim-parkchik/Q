#!/usr/bin/env python3
"""
年4回以上払う賞与（社会保険の「賞与に係る報酬」）の決まりの数を、厚生労働省の通知から読み取って、
src/constants/shoyoHoushu.ts を作る（手で書き写さない）。

使い方:
  python3 -I scripts/import_shoyo_houshu.py shoyo-houshu src/constants/shoyoHoushu.ts

読むもの（入手元と SHA-256 は shoyo-houshu/README.md）:
  shoyo-houshu/houshu-tsuchi-s53.html
    厚生労働省 法令等データベース「健康保険法及び厚生年金保険法における賞与に係る報酬の取扱いについて」
    （昭和53年6月20日 保発第47号・庁保発第21号）
    ・1(1)ア「年間を通じ四回以上の支給につき客観的に定められているとき」
    ・1(1)イ「七月一日前の一年間を通じ四回以上行われているとき」
    ・1(1)「当該年の七月二日以降新たに年間を通じて四回以上又は四回未満に変更された場合」
      「次期標準報酬月額の定時決定(七月、八月又は九月の随時改定を含む。)」
    ・2(1)「標準報酬月額の定時決定又は七月、八月若しくは九月の随時改定の際」
      ア「七月一日前の一年間に受けた賞与の額を一二で除して得た額」・イ「その額を一二で除して得た額」
    ・2(3)「随時改定(七月、八月又は九月の随時改定を除く。)を行う場合は、新たに賞与に係る報酬の額を算定することなく」

次のときは作らずに止まる:
  ・言い回しが見つからない・漢数字を読めない
  ・同じ数が、ところによって違う（回数・12・7月1日と7月2日・7月、8月、9月）
"""
import hashlib
import html
import os
import re
import sys
import unicodedata

DIGITS = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
KANJI = "〇一二三四五六七八九十"


def fail(message):
    sys.stderr.write(f"止まりました: {message}\n")
    sys.exit(1)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def kanji_number(s):
    """漢数字を数にする。「四」「七」のような1けたと「十二」の形のほか、「一二」のように位を並べた書き方も読む"""
    if not s or any(ch not in KANJI for ch in s):
        fail(f"漢数字「{s}」を読めません")
    if "十" in s:
        head, _, tail = s.partition("十")
        if "十" in tail or len(head) > 1 or len(tail) > 1:
            fail(f"漢数字「{s}」を読めません")
        return (DIGITS[head] if head else 1) * 10 + (DIGITS[tail] if tail else 0)
    value = 0
    for ch in s:
        value = value * 10 + DIGITS[ch]
    return value


def notice_text(path):
    """HTML のタグを除き、全角の英数字・かっこを半角にして（NFKC。漢字はそのまま）、空白をすべて除いた1つの文字列にする"""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    raw = re.sub(r"<(script|style)\b.*?</\1>", " ", raw, flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))


def numbers(text, pattern, what):
    """言い回し（{n} が漢数字）を探して、その数を返す。見つからなければ止まる"""
    rx = re.escape(pattern).replace(re.escape("{n}"), f"([{KANJI}]+)")
    m = re.search(rx, text)
    if not m:
        fail(f"{what}：通知に「{pattern}」が見つかりません")
    return [kanji_number(g) for g in m.groups()]


def same(values, what):
    if len(set(values)) != 1:
        fail(f"{what}が、ところによって違います: {values}")
    return values[0]


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_shoyo_houshu.py shoyo-houshu src/constants/shoyoHoushu.ts")
    folder, out_path = sys.argv[1], sys.argv[2]
    notice = os.path.join(folder, "houshu-tsuchi-s53.html")
    text = notice_text(notice)
    if "健康保険法及び厚生年金保険法における賞与に係る報酬の取扱いについて" not in text:
        fail(f"{notice} が、賞与に係る報酬の取扱いの通知ではありません")

    # 1(1)：何回以上なら報酬か（諸規定で決めている・7月1日前の1年間に支給した・7月2日以降に変わったとき）
    times = same(
        numbers(text, "年間を通じ{n}回以上の支給につき客観的に定められているとき", "1(1)ア")
        + numbers(text, "{n}月{n}日前の一年間を通じ{n}回以上行われているとき", "1(1)イ")[2:]
        + numbers(text, "年間を通じて{n}回以上又は{n}回未満に変更された場合", "1(1)"),
        "報酬になる賞与の回数",
    )
    # 7月1日前の1年間で数える（7月1日現在で判断し、7月2日以降に変わっても次の定時決定まではそのまま）
    base = numbers(text, "毎年{n}月{n}日現在における", "1(1)")
    before = numbers(text, "{n}月{n}日前の一年間を通じ", "1(1)イ") + numbers(text, "{n}月{n}日前の一年間に受けた賞与の額", "2(1)ア")
    after = numbers(text, "当該年の{n}月{n}日以降新たに", "1(1)")
    base_month = same([base[0], before[0], before[2], after[0]], "基準の月（7月）")
    base_day = same([base[1], before[1], before[3]], "基準の日（7月1日）")
    if after[1] != base_day + 1:
        fail(f"変わったときの日（{after[0]}月{after[1]}日以降）が、基準の日（{base_month}月{base_day}日）の次の日ではありません")

    # 2(1)：12で除した額
    divisor = same(
        numbers(text, "一年間に受けた賞与の額を{n}で除して得た額", "2(1)ア")
        + numbers(text, "その額を{n}で除して得た額", "2(1)イ"),
        "除する数",
    )

    # 定時決定と同じく計算し直す随時改定の月（7月・8月・9月）。2(3) の「除く」も同じ月でなければ止まる
    month_lists = [
        numbers(text, "定時決定({n}月、{n}月又は{n}月の随時改定を含む。)", "1(1)"),
        numbers(text, "定時決定又は{n}月、{n}月若しくは{n}月の随時改定の際", "2(1)"),
        numbers(text, "随時改定({n}月、{n}月又は{n}月の随時改定を除く。)", "2(3)"),
    ]
    if any(m != month_lists[0] for m in month_lists):
        fail(f"随時改定の月が、ところによって違います: {month_lists}")
    recalc = month_lists[0]
    if recalc[0] != base_month or recalc != list(range(recalc[0], recalc[0] + len(recalc))):
        fail(f"随時改定の月 {recalc} が、{base_month}月から続く月ではありません")
    if "新たに賞与に係る報酬の額を算定することなく" not in text:
        fail("2(3)：ほかの月の随時改定で計算し直さない、という言い回しが見つかりません")

    lines = [
        "// このファイルは scripts/import_shoyo_houshu.py で作ったものです。手で直さないでください。",
        "// 入手元・SHA-256・作り直し方は shoyo-houshu/README.md",
        "// 厚生労働省「健康保険法及び厚生年金保険法における賞与に係る報酬の取扱いについて」（昭和53年6月20日 保発第47号・庁保発第21号）",
        f"// （houshu-tsuchi-s53.html SHA-256 {sha256(notice)}）",
        "",
        "/** 年4回以上払う賞与（社会保険の「賞与に係る報酬」）の決まり（使い方は utils/shoyoHoushu.ts） */",
        "export const SHOYO_HOUSHU = {",
        f"  /** 1(1)：同じ性質の賞与を、年間を通じ {times}回以上 払う（諸規定で決めている・7月1日前の1年間に払った）と、報酬になる */",
        f"  minTimes: {times},",
        f"  /** 2(1)：{base_month}月{base_day}日前の1年間に受けた賞与の額を {divisor} で割った額を、毎月の報酬に足す */",
        f"  divisor: {divisor},",
        f"  /** 1(1)：毎年{base_month}月{base_day}日現在で判断し、{base_month}月{base_day}日前の1年間（前の年の{base_month}月{base_day}日から）で数える。"
        f"{base_month}月{after[1]}日以降に回数が変わっても、次の定時決定の標準報酬月額を使うまでは、前の扱いのまま */",
        f"  baseMonth: {base_month},",
        f"  baseDay: {base_day},",
        f"  /** 2(1)・(3)：定時決定と、{'・'.join(f'{m}月' for m in recalc)}の随時改定のときに計算し直す。ほかの月の随時改定は、計算し直さずに前の額を足す */",
        f"  recalcMonths: [{', '.join(str(m) for m in recalc)}],",
        "} as const;",
        "",
    ]
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"{out_path} を作りました（{times}回以上・{divisor}で割る・{base_month}月{base_day}日・{recalc}月の随時改定）")


if __name__ == "__main__":
    main()
