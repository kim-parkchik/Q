#!/usr/bin/env python3
"""
源泉所得税（税額表の甲欄）の「扶養親族等の数」の数え方と、その線（源泉控除対象配偶者・源泉控除対象親族・同一生計配偶者・扶養親族の
所得の見積額と年齢）を、国税庁「令和○年分 源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」（19〜22ページ）の PDF から読み取って、
src/constants/tax/withholdingDependentRules.ts を作る（手や AI で書き写さない。見直しの P9）。

使い方:
    python3 -I scripts/import_withholding_dependents.py tax-tables/source src/constants/tax/withholdingDependentRules.ts

読むもの（tax-tables/source に置く。入手元と SHA-256 は tax-tables/README.md。下の SOURCES も同じ）:
・zeigakuhyo2026-19-22.pdf（令和8年分）・zeigakuhyo2027-19-22.pdf（令和9年分）
  字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出し、全角を半角にして（NFKC）、空白・ページの区切り・ページ番号を除いて
  1つの文にしてから読む。

読むこと:
・「2 税額表の使い方」⑵ の「扶養親族等の数」の文：源泉控除対象配偶者と源泉控除対象親族との合計数に、本人が障害者（特別障害者を含む）・
  寡婦・ひとり親・勤労学生に該当するごとに○人を足し、同一生計配偶者や扶養親族（年齢○歳未満の人を含む）のうちに障害者（特別障害者を含む）
  又は同居特別障害者に該当する人がいれば、これらの一に該当するごとに○人を足す
・（注）2 源泉控除対象配偶者：給与等の支払を受ける人の所得の見積額が○万円以下、配偶者の所得の見積額が○万円以下
・（注）3 源泉控除対象親族：控除対象扶養親族と、特定親族（年齢○歳以上○歳未満（生年月日の範囲）で、所得の見積額が○万円超○万円以下）
  のうち所得の見積額が○万円以下の人
・（※）控除対象扶養親族：扶養親族（所得の見積額が○万円以下）のうち、居住者は年齢○歳以上（○年○月○日以前に生まれた人）
・（注）6 同一生計配偶者：所得の見積額が○万円以下

確かめること（1つでも合わなければ、ファイルを作らずに止まる）:
・それぞれの文が1つだけある。文の中の年分（「令和○年中」「令和○年分の所得税については」）が、SOURCES の年と同じ
・扶養親族・同一生計配偶者の線と、特定親族の下の線が同じ。線の大きさの順（扶養親族の線 < 源泉控除対象親族の線 < 特定親族の上の線、
  扶養親族の線 < 源泉控除対象配偶者の線 < 給与等の支払を受ける人の線）
・生年月日の範囲が、その年の12月31日の年齢と合う（年齢は誕生日の前日に1つ上がるので、1月1日生まれは、その年の12月31日に1つ上がる）
・数え方の文で、障害者を数える扶養親族に含む「○歳未満」が、控除対象扶養親族の「○歳以上」と同じ

令和8年分の PDF（令和7年8月に出たもの）は、令和8年度の税制改正（令和8年12月1日以後に支払う給与から、扶養親族などの所得の線を
引き上げた）より前のものなので、令和8年分の線は、11月30日以前に支払う給与の線。12月1日以後の線は、国税庁の法定調書の手引から作った
constants/nencho/gensen2026.ts（withoutAdjustment）にある（Q の数え方は、手引から作ったほうの線を使い、このファイルの線とは
src/utils/withholdingDependents.test.ts で照らし合わせる）。

標準ライブラリと macOS の PDFKit（scripts/pdf_to_text.swift）だけで動く（追加のインストールは要らない）。
"""
import hashlib
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# （年分, ファイル, 入手元, 入手元のページ）。新しい年分の PDF を足すときは、ここと tax-tables/README.md に足す
SOURCES = [
    (2026, "zeigakuhyo2026-19-22.pdf", "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/19-22.pdf",
     "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm"),
    (2027, "zeigakuhyo2027-19-22.pdf", "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/19-22.pdf",
     "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm"),
]

# 元号の元年の前の年（平成1年 = 1989年）
ERA_BASE = {"昭和": 1925, "平成": 1988, "令和": 2018}

# 「2 税額表の使い方」⑵ の「扶養親族等の数」の文（注の番号は数えない）
RULE = (
    r"この「扶養親族等の数」とは、源泉控除対象配偶者\(注[\d・]+\)と源泉控除対象親族\(注[\d・]+\)との合計数をいいます\(注\d+\)。"
    r"また、給与等の支払を受ける人が、障害者\(特別障害者を含みます。\)、寡婦、ひとり親又は勤労学生に該当する場合\(注\d+\)には、"
    r"これらの一に該当するごとに扶養親族等の数に(\d+)人を加算し、"
    r"その人の同一生計配偶者\(注\d+\)や扶養親族\(年齢(\d+)歳未満の人を含みます。\)のうちに障害者\(特別障害者を含みます。\)"
    r"又は同居特別障害者に該当する人\(注[\d・]+\)がいる場合には、"
    r"これらの一に該当するごとに扶養親族等の数に(\d+)人を加算した数を扶養親族等の数とします。"
)
# （注）2 源泉控除対象配偶者
SPOUSE = (
    r"2「源泉控除対象配偶者」とは、給与等の支払を受ける人\(令和(\d+)年中の所得の見積額が([\d,]+)万円以下である人に限ります。\)"
    r"と生計を一にする配偶者\(.*?\)で、令和(\d+)年中の所得の見積額が([\d,]+)万円以下の人をいいます。"
)
# （注）3⑵ 特定親族のうち、源泉控除対象親族になる人（生年月日の範囲の書き方は、年分によって少し違う）
DATE = r"(昭和|平成|令和)(\d+)年(\d+)月(\d+)日"
SPECIFIC = (
    r"\(2\)特定親族\(給与等の支払を受ける人と生計を一にする年齢(\d+)歳以上(\d+)歳未満\(令和(\d+)年分の所得税については、"
    + DATE + r"(?:生まれ)?から" + DATE + r"(?:までの間に生まれた人|生まれまで)\)"
    r"の親族\(.*?\)で令和(\d+)年中の所得の見積額が([\d,]+)万円超([\d,]+)万円以下の人をいいます。\)"
    r"のうち、令和(\d+)年中の所得の見積額が([\d,]+)万円以下の人"
)
# （※）控除対象扶養親族（扶養親族が居住者の場合）
DEPENDENT = (
    r"\(※\)「控除対象扶養親族」とは、扶養親族\(給与等の支払を受ける人と生計を一にする親族\(.*?\)で、"
    r"令和(\d+)年中の所得の見積額が([\d,]+)万円以下の人をいいます。\)のうち、次の1又は2の場合に応じそれぞれ次に定める人をいいます。"
    r"1扶養親族が居住者の場合年齢(\d+)歳以上の人\(令和(\d+)年分の所得税については、" + DATE + r"以前に生まれた人\)"
)
# （注）6 同一生計配偶者
SAME_SPOUSE = r"6「同一生計配偶者」とは、給与等の支払を受ける人と生計を一にする配偶者\(.*?\)で、令和(\d+)年中の所得の見積額が([\d,]+)万円以下の人をいいます。"


def fail(message):
    sys.stderr.write(f"止まりました: {message}\n")
    sys.exit(1)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def joined_text(pdf):
    """
    PDF の字を、全角を半角にして（NFKC）、空白・ページの区切り（=== page N ===）・ページ番号（― ― 19）を除いた1つの文にする。
    見えない制御文字（「⑵」のあとに入っている BEL など）も除く
    """
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(pdf)], check=True, capture_output=True, text=True).stdout
    lines = unicodedata.normalize("NFKC", out).splitlines()
    keep = [line for line in lines
            if not re.fullmatch(r"\s*===\s*page\s*\d+\s*===\s*", line) and not re.fullmatch(r"\s*―\s*―\s*\d+\s*", line)]
    text = "".join(re.sub(r"\s+", "", line) for line in keep)
    return "".join(c for c in text if unicodedata.category(c) != "Cc")


def one(pattern, text, what):
    found = re.findall(pattern, text)
    if len(found) != 1:
        fail(f"{what} が1つに決まりません（{len(found)}か所）")
    return found[0]


def man(v):
    """「1,000」万円 → 10000000 円"""
    return int(v.replace(",", "")) * 10000


def era_date(era, y, m, d):
    return f"{ERA_BASE[era] + int(y):04d}-{int(m):02d}-{int(d):02d}"


def read_pdf(path, year):
    j = joined_text(path)
    reiwa = str(year - 2018)
    where = path.name

    per_self, young_under, per_family = one(RULE, j, f"{where} の「扶養親族等の数」の数え方の文")
    s_year1, recipient, s_year2, spouse = one(SPOUSE, j, f"{where} の（注）2 源泉控除対象配偶者")
    sp = one(SPECIFIC, j, f"{where} の（注）3⑵ 特定親族")
    sp_age_from, sp_age_until, sp_year1 = sp[0:3]
    sp_born_from, sp_born_to = era_date(*sp[3:7]), era_date(*sp[7:11])
    sp_year2, sp_over, sp_up_to, sp_year3, sp_source = sp[11:16]
    d = one(DEPENDENT, j, f"{where} の（※）控除対象扶養親族")
    d_year1, dependent_line, deductible_from, d_year2 = d[0:4]
    deductible_born_on_or_before = era_date(*d[4:8])
    ss_year, same_spouse_line = one(SAME_SPOUSE, j, f"{where} の（注）6 同一生計配偶者")

    years = [s_year1, s_year2, sp_year1, sp_year2, sp_year3, d_year1, d_year2, ss_year]
    if any(y != reiwa for y in years):
        fail(f"{where} の文の年分（令和{sorted(set(years))}年）が、令和{reiwa}年分ではありません")

    rule = {
        "year": year,
        "perSelfItem": int(per_self),
        "perFamilyItem": int(per_family),
        "familyIncludesUnder": int(young_under),
        "recipientIncomeLimit": man(recipient),
        "spouseIncomeLimit": man(spouse),
        "dependentIncomeLimit": man(dependent_line),
        "deductibleAgeFrom": int(deductible_from),
        "deductibleBornOnOrBefore": deductible_born_on_or_before,
        "specificRelative": {
            "ageFrom": int(sp_age_from), "ageUntil": int(sp_age_until), "bornFrom": sp_born_from, "bornTo": sp_born_to,
            "over": man(sp_over), "upTo": man(sp_up_to), "sourceLimit": man(sp_source),
        },
    }

    # 線がそろっているか・大きさの順
    s = rule["specificRelative"]
    if not (rule["dependentIncomeLimit"] == man(same_spouse_line) == s["over"]):
        fail(f"{where} の扶養親族（{dependent_line}万円）・同一生計配偶者（{same_spouse_line}万円）・特定親族の下の線（{sp_over}万円）が違います")
    if not (rule["dependentIncomeLimit"] < s["sourceLimit"] < s["upTo"]):
        fail(f"{where} の特定親族の線の大きさの順がおかしい（{sp_over}万円超・{sp_source}万円以下・{sp_up_to}万円以下）")
    if not (rule["dependentIncomeLimit"] < rule["spouseIncomeLimit"] < rule["recipientIncomeLimit"]):
        fail(f"{where} の源泉控除対象配偶者の線の大きさの順がおかしい（{dependent_line}万円・{spouse}万円・{recipient}万円）")
    # 生年月日の範囲が、その年の12月31日の年齢と合うか（1月1日生まれは、その年の12月31日に1つ上がる）
    if deductible_born_on_or_before != f"{year - rule['deductibleAgeFrom'] + 1:04d}-01-01":
        fail(f"{where} の控除対象扶養親族の生年月日（{deductible_born_on_or_before}以前）が、{deductible_from}歳以上と合いません")
    if s["bornFrom"] != f"{year - s['ageUntil'] + 1:04d}-01-02" or s["bornTo"] != f"{year - s['ageFrom'] + 1:04d}-01-01":
        fail(f"{where} の特定親族の生年月日（{s['bornFrom']}〜{s['bornTo']}）が、{sp_age_from}歳以上{sp_age_until}歳未満と合いません")
    if rule["familyIncludesUnder"] != rule["deductibleAgeFrom"]:
        fail(f"{where} の数え方の文の「{young_under}歳未満」が、控除対象扶養親族の「{deductible_from}歳以上」と合いません")
    return rule


def ts_value(v, indent):
    if isinstance(v, dict):
        pad = " " * (indent + 2)
        body = ",\n".join(f"{pad}{k}: {ts_value(x, indent + 2)}" for k, x in v.items())
        return "{\n" + body + "\n" + " " * indent + "}"
    if isinstance(v, str):
        return f'"{v}"'
    return str(v)


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_withholding_dependents.py tax-tables/source src/constants/tax/withholdingDependentRules.ts")
    folder, out_path = Path(sys.argv[1]), Path(sys.argv[2])

    rules, hashes = [], []
    for year, file, url, page in SOURCES:
        path = folder / file
        if not path.exists():
            fail(f"{path} がありません（入手元 {url}）")
        hashes.append((file, url, page, sha256(path)))
        rules.append(read_pdf(path, year))

    sources = "\n".join(f" *   tax-tables/source/{file}（{url}。{page}）SHA-256 {h}" for file, url, page, h in hashes)
    body = "\n".join(f"  {r['year']}: {ts_value(r, 2)}," for r in rules)
    ts = f"""/**
 * 源泉所得税（税額表の甲欄）の「扶養親族等の数」の数え方と、その線（年分ごと）
 *
 * このファイルは scripts/import_withholding_dependents.py で、国税庁「令和○年分 源泉徴収税額表」の「給与所得の源泉徴収税額の求め方」
 * （19〜22ページ）の PDF から作る（手で書き換えない。作り方は tax-tables/README.md）:
{sources}
 *
 * 令和8年分の PDF は、令和8年度の税制改正（令和8年12月1日以後に支払う給与から、扶養親族などの所得の線を引き上げた）より前のもの。
 * 12月1日以後の線は constants/nencho/gensen2026.ts（国税庁の法定調書の手引から作ったもの）にあり、Q の数え方（utils/withholdingDependents.ts）は
 * そちらの線を使う（このファイルの線とは、utils/withholdingDependents.test.ts で照らし合わせる）。
 */

export interface WithholdingDependentRule {{
  year: number;
  /** 本人が障害者（特別障害者を含む）・寡婦・ひとり親・勤労学生に該当するごとに、扶養親族等の数に足す人数 */
  perSelfItem: number;
  /** 同一生計配偶者・扶養親族のうちに障害者（特別障害者を含む）・同居特別障害者に該当する人がいれば、これらの一に該当するごとに足す人数 */
  perFamilyItem: number;
  /** 障害者を数える扶養親族には、この年齢未満の人も含む */
  familyIncludesUnder: number;
  /** 源泉控除対象配偶者：給与等の支払を受ける人の所得の見積額の上限 */
  recipientIncomeLimit: number;
  /** 源泉控除対象配偶者：配偶者の所得の見積額の上限 */
  spouseIncomeLimit: number;
  /** 扶養親族・同一生計配偶者の所得の見積額の上限 */
  dependentIncomeLimit: number;
  /** 控除対象扶養親族（居住者）：この年齢以上（その年の12月31日の年齢） */
  deductibleAgeFrom: number;
  /** 控除対象扶養親族（居住者）：この日以前に生まれた人 */
  deductibleBornOnOrBefore: string;
  /**
   * 特定親族：年齢（ageFrom 歳以上 ageUntil 歳未満）・生年月日の範囲（bornFrom〜bornTo）・所得の見積額（over 超 upTo 以下）。
   * そのうち所得の見積額が sourceLimit 以下の人が、源泉控除対象親族
   */
  specificRelative: {{ ageFrom: number; ageUntil: number; bornFrom: string; bornTo: string; over: number; upTo: number; sourceLimit: number }};
}}

export const WITHHOLDING_DEPENDENT_RULES: Record<number, WithholdingDependentRule> = {{
{body}
}};
"""
    out_path.write_text(ts, encoding="utf-8")
    for r in rules:
        print(f"令和{r['year'] - 2018}年分: 本人 {r['perSelfItem']}人ずつ・家族 {r['perFamilyItem']}人ずつ（{r['familyIncludesUnder']}歳未満も含む）、"
              f"源泉控除対象配偶者 {r['recipientIncomeLimit']:,}円・{r['spouseIncomeLimit']:,}円、扶養親族 {r['dependentIncomeLimit']:,}円、"
              f"控除対象扶養親族 {r['deductibleAgeFrom']}歳以上（{r['deductibleBornOnOrBefore']}以前）、特定親族 {r['specificRelative']}")
    print(f"{out_path} を作りました")


if __name__ == "__main__":
    main()
