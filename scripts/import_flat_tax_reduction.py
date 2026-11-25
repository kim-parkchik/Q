#!/usr/bin/env python3
"""
令和6年分の所得税の定額減税（給与・賞与から引く「月次減税事務」）の年・始まりの日・1人あたりの額を、
租税特別措置法の条文（e-Gov 法令API の XML）から読み取って、src/constants/tax/flatTaxReduction.ts を作る（手で書き写さない）。

使い方:
  python3 -I scripts/import_flat_tax_reduction.py tax-tables src/constants/tax/flatTaxReduction.ts

読むもの（入手元と SHA-256 は tax-tables/README.md）:
  tax-tables/special-taxation-act-41-3-3.xml  租税特別措置法 第41条の3の3（令和六年分における所得税額の特別控除）
    ・1項「居住者の令和六年分の所得税については、…令和六年分特別税額控除額を控除する」
    ・2項「令和六年分特別税額控除額は、居住者について三万円（…当該同一生計配偶者又は当該扶養親族一人につき三万円を加算した金額）」
  tax-tables/special-taxation-act-41-3-7.xml  租税特別措置法 第41条の3の7（令和六年六月以後に支払われる給与等に係る特別控除の額の控除等）
    ・1項「令和六年六月一日において給与等…の支払者から主たる給与等…の支払を受ける者である居住者の
          同日以後最初に当該支払者から支払を受ける同年中の主たる給与等」
    ・3項「給与特別控除額は、三万円（次に掲げる者がある場合には、三万円にこれらの者一人につき三万円を加算した金額）」

次のときは作らずに止まる:
  ・条の見出し・言い回しが見つからない・漢数字を読めない
  ・41条の3の3 と 41条の3の7 の年（令和六年）・本人の額・1人あたりの額（三万円）が合わない、本人の額と1人あたりの額が違う
  ・始まりの日が月の初めの日でない
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
    """「三」「千八百五」などを数にする（読めない字があれば止まる）"""
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


def article(path, num, caption, label):
    """XML の中の条（Num）の見出しを確かめ、項の番号 → 項の字（号の字も続ける）を返す"""
    root = ET.parse(path).getroot()
    for art in root.iter("Article"):
        if art.get("Num") == num:
            cap = art.find("ArticleCaption")
            if cap is None or flat(cap) != caption:
                fail(f"{label}の見出しが「{caption}」ではありません（{flat(cap) if cap is not None else 'なし'}）")
            out = {p.get("Num"): flat(p) for p in art.iter("Paragraph") if p.get("Num")}
            if not out:
                fail(f"{label}に項がありません")
            return out
    fail(f"{label}が見つかりません")


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_flat_tax_reduction.py tax-tables src/constants/tax/flatTaxReduction.ts")
    folder, out_path = sys.argv[1], sys.argv[2]
    p3_path = os.path.join(folder, "special-taxation-act-41-3-3.xml")
    p7_path = os.path.join(folder, "special-taxation-act-41-3-7.xml")

    # ── 41条の3の3（減税の額） ──
    a3 = article(p3_path, "41_3_3", "（令和六年分における所得税額の特別控除）", "租税特別措置法41条の3の3")
    year3, year3b = find(a3.get("1", ""), "居住者の令和{n}年分の所得税については、その者のその年分の所得税の額から、令和{n}年分特別税額控除額を控除する",
                         "租税特別措置法41条の3の3 1項")
    year3c, self3, _, self3b, per3 = find(
        a3.get("2", ""),
        "令和{n}年分特別税額控除額は、居住者について{n}万円（{s}を有する居住者については、{n}万円に当該同一生計配偶者又は当該扶養親族一人につき{n}万円を加算した金額）",
        "租税特別措置法41条の3の3 2項",
    )
    if not (year3 == year3b == year3c):
        fail(f"租税特別措置法41条の3の3 の1項・2項の年（令和{year3}年・令和{year3b}年・令和{year3c}年）がそろいません")

    # ── 41条の3の7（給与から引く月次減税） ──
    a7 = article(p7_path, "41_3_7", "（令和六年六月以後に支払われる給与等に係る特別控除の額の控除等）", "租税特別措置法41条の3の7")
    p1 = a7.get("1", "")
    year7, month7, day7 = find(p1, "令和{n}年{n}月{n}日において給与等", "租税特別措置法41条の3の7 1項")
    find(p1, "の支払を受ける者である居住者の同日以後最初に当該支払者から支払を受ける同年中の主たる給与等", "租税特別措置法41条の3の7 1項")
    self7, self7b, per7 = find(
        a7.get("3", ""), "給与特別控除額は、{n}万円（次に掲げる者がある場合には、{n}万円にこれらの者一人につき{n}万円を加算した金額）",
        "租税特別措置法41条の3の7 3項",
    )

    if year3 != year7:
        fail(f"41条の3の3 の年（令和{year3}年）と、41条の3の7 の年（令和{year7}年）が違います")
    if len({self3, self3b, per3, self7, self7b, per7}) != 1:
        fail(f"本人の額・1人あたりの額がそろいません（41条の3の3：{self3}万円・{self3b}万円・{per3}万円、41条の3の7：{self7}万円・{self7b}万円・{per7}万円）")
    if day7 != 1:
        fail(f"始まりの日（{month7}月{day7}日）が月の初めの日ではありません")

    year = 2018 + year3
    per_person = per3 * 10000
    base_date = f"{year:04d}-{month7:02d}-{day7:02d}"
    yen = f"{per_person:,}円"

    ts = f"""/**
 * 令和{year3}年分 所得税の定額減税（給与・賞与の「月次減税事務」）
 *
 * このファイルは scripts/import_flat_tax_reduction.py で、租税特別措置法の条文（e-Gov 法令API の XML）から作る（手で書き換えない。入手元は tax-tables/README.md）
 *   41条の3の3（令和六年分における所得税額の特別控除。tax-tables/special-taxation-act-41-3-3.xml SHA-256 {sha256(p3_path)}）
 *   41条の3の7（令和六年六月以後に支払われる給与等に係る特別控除の額の控除等。tax-tables/special-taxation-act-41-3-7.xml SHA-256 {sha256(p7_path)}）
 * 説明: 国税庁「定額減税について」 https://www.nta.go.jp/users/gensen/teigakugenzei/01.htm
 *       国税庁「給与等の源泉徴収事務に係る令和６年分所得税の定額減税のしかた」 https://www.nta.go.jp/publication/pamph/gensen/0023012-317.pdf
 *
 * ・減税額は 本人 {yen} ＋ 同一生計配偶者・扶養親族（いずれも居住者）1人につき {yen}（41条の3の3 2項・41条の3の7 3項）
 *   （扶養親族には16歳未満の子も含むので、源泉徴収の「扶養親族等の数」とは人数が違うことがある）
 * ・令和{year3}年{month7}月{day7}日以後最初に支払う給与等（賞与も含む）の源泉所得税から差し引き、引ききれない分は
 *   令和{year3}年中に支払う給与等から順に差し引く。残った分は年末調整で精算する（41条の3の7 1項・2項）
 *   （給与・賞与のそれぞれで引ける額の数え方は utils/flatTaxReduction.ts。払う日の順に数える）
 * ・月次減税をするのは、令和{year3}年{month7}月{day7}日に在籍し、扶養控除等申告書を出している人（甲欄。41条の3の7 1項の「主たる給与等」）。
 *   その日より後に入社した人は、月次減税をせず年末調整で精算する
 */
export const FLAT_TAX_REDUCTION_2024 = {{
  /** 減税をする年（支払った年） */
  YEAR: {year},
  /** この月以後に支払う給与から差し引く */
  FROM_MONTH: {month7},
  /** この日に在籍している人が月次減税の対象 */
  BASE_DATE: "{base_date}",
  /** 1人あたりの減税額 */
  PER_PERSON: {per_person},
}};
"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{out_path} を作りました：令和{year3}年（{year}年）、{base_date} に在籍する人の、その日以後の給与から、1人 {yen}")


if __name__ == "__main__":
    main()
