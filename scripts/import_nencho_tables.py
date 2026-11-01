#!/usr/bin/env python3
"""
国税庁「令和N年分 年末調整のしかた」の PDF から、年末調整の計算に使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_nencho_tables.py nencho-tables 2026 src/constants/nencho/nencho2026.ts

・nencho-tables/ には、国税庁のページ（https://www.nta.go.jp/publication/pamph/gensen/nencho2026/01.htm）の
  PDF を置いておく（114.pdf・115.pdf・204.pdf・107.pdf・110rei.pdf。入手元とハッシュは nencho-tables/README.md）。
・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。
・AI や手作業で数字を書き写さないための道具。数字はすべて PDF の文字から機械的に読み取る。
・読み取った「給与所得控除後の給与等の金額」の計算式で表の全行を作り、114.pdf の表の数字と一つ残らず合うか確かめる。
・国税庁の様式が変わって読み取れない・数字が合わない場合は、エラーで止まる（中途半端なデータは作らない）。
"""
import collections
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def pdf_lines(pdf_dir, name, keep_spaces=False):
    """
    PDF の文字を、全角を半角にし（NFKC。①→1、…→... にもなる）、空白を除いた行のリストにする
    keep_spaces: 空白を残す（数字が並んでいる表で、数字どうしがつながらないように）
    """
    out = subprocess.run(
        ["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(Path(pdf_dir) / f"{name}.pdf")],
        check=True, capture_output=True, text=True,
    ).stdout
    text = unicodedata.normalize("NFKC", out)
    return [line if keep_spaces else re.sub(r"\s+", "", line) for line in text.splitlines()]


def num(s):
    return int(s.replace(",", ""))


def man(s):
    """「489」万円 → 4,890,000"""
    return num(s) * 10000


def one(pattern, text, what):
    found = re.findall(pattern, text)
    assert len(found) == 1, f"{what} が1つに決まりません: {found}"
    return found[0]


# ─────────────────────────────────────────────────────────────
# 204.pdf 電子計算機等による年末調整：年調給与額・給与所得控除後の給与等の金額・年調年税額
# ─────────────────────────────────────────────────────────────
def parse_204(lines):
    joined = "".join(lines)
    # 年調給与額：この範囲は、(給与の総額 - 起点) を刻みで割った余りを引く
    start, end = (num(x) for x in one(r"給与の総額をそのまま年調給与額とします。(\d[\d,]*)円から(\d[\d,]*)円まで次の算式", joined, "年調給与額の範囲"))
    origin, step = one(r"\(給与の総額\)-(\d[\d,]*)円=商\.\.\.余り(\d[\d,]*)円", joined, "年調給与額の算式")
    assert num(origin) == start, "年調給与額の算式の起点が範囲と違います"
    rounding = {"from": start, "to": end, "step": num(step)}

    # 給与所得控除後の給与等の金額の表：「から」の列・「まで」の列・計算式の列が、この順に並ぶ
    i = lines.index("年調給与額Aの区分給与所得控除後の給与等の金額の計算式")
    froms, tos, formulas = [], [], []
    for line in lines[i + 1:]:
        if line.startswith("(注)"):
            break
        m = re.fullmatch(r"(\d[\d,]*)円?(から|まで|〃)", line)
        if m and not tos and (m.group(2) == "から" or (froms and m.group(2) == "〃")):
            froms.append(num(m.group(1)))
        elif m:
            tos.append(num(m.group(1)))
        else:
            formulas.append(line)
    assert len(froms) == len(tos) == len(formulas) >= 5, f"表の列の数が合いません: {froms} {tos} {formulas}"
    segments = []
    for f, t, formula in zip(froms, tos, formulas):
        if m := re.fullmatch(r"(\d[\d,]*)円", formula):
            seg = {"from": f, "to": t, "fixed": num(m.group(1))}
        elif m := re.fullmatch(r"A-(\d[\d,]*)円", formula):
            seg = {"from": f, "to": t, "rate": 100, "minus": num(m.group(1))}
        elif m := re.fullmatch(r"A×(\d+)%-(\d[\d,]*)円", formula):
            seg = {"from": f, "to": t, "rate": int(m.group(1)), "minus": num(m.group(2))}
        else:
            raise AssertionError(f"計算式を読み取れません: {formula}")
        segments.append(seg)
    for a, b in zip(segments, segments[1:]):
        assert a["to"] + 1 == b["from"], f"区分がつながっていません: {a} {b}"
    salary_limit = num(one(r"給与の総額が(\d[\d,]*)万円を超える場合には年末調整を行いません", joined, "年末調整の対象の上限")) * 10000
    assert segments[-1]["to"] == salary_limit, "表の最後と年末調整の対象の上限が違います"

    recon = one(r"年調所得税額に(\d+\.\d+)%を乗じた金額が復興特別所得税を含む年調年税額\((\d+)円未満の端数切捨て\)", joined, "年調年税額の率")
    return rounding, segments, salary_limit, {"ratePercent": float(recon[0]), "roundTo": int(recon[1])}


def employment_income(salary, rounding, segments):
    """年調給与額に直してから、給与所得控除後の給与等の金額を求める（1円未満切り捨て）"""
    a = salary
    if rounding["from"] <= salary <= rounding["to"]:
        a = salary - (salary - rounding["from"]) % rounding["step"]
    for s in segments:
        if s["from"] <= a <= s["to"]:
            if "fixed" in s:
                return s["fixed"]
            return max(0, a * s["rate"] // 100 - s["minus"])
    raise AssertionError(f"区分がありません: {salary}")


# ─────────────────────────────────────────────────────────────
# 114.pdf 給与所得控除後の給与等の金額の表：計算式で作った全行の数字が、表の数字と合うか
# ─────────────────────────────────────────────────────────────
def verify_114(lines, rounding, segments):
    text = "\n".join(lines)
    in_table = collections.Counter(num(x) for x in re.findall(r"(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d,])", text))
    expected = collections.Counter()
    # 4,000円刻みの行（以上・未満・給与所得控除後の金額）
    a = rounding["from"]
    while a <= rounding["to"]:
        expected.update([a, a + rounding["step"], employment_income(a, rounding, segments)])
        a += rounding["step"]
    # 決まった金額の区分の行
    for s in segments:
        if "fixed" in s and s["fixed"] > 0:
            expected.update([s["from"], s["to"] + 1, s["fixed"]])
    missing = expected - in_table
    assert not missing, f"計算式で作った行の数字が、表にありません（{sum(missing.values())}個）: {sorted(missing)[:20]}"
    extra = in_table - expected
    # 表の見出し・注記の金額（741,000円未満 など）だけが残るはず
    assert sum(extra.values()) < 40, f"表に、計算式で作っていない数字が多すぎます: {sorted(extra)}"
    return sum(expected.values()), sorted(extra.elements())


# ─────────────────────────────────────────────────────────────
# 115.pdf 速算表・配偶者控除額・基礎控除額・特定親族特別控除額・扶養控除額等
# ─────────────────────────────────────────────────────────────
def parse_115(lines):
    joined = "".join(lines)
    # 速算表：税率と控除額（区切りの金額は、税率と控除額から求めて、表にあるか確かめる）
    rates = [(int(r), num(m) if m else 0) for r, m in re.findall(r"\(A\)×(\d+)%(?:-(\d[\d,]*)円)?", joined)]
    assert len(rates) >= 5 and rates[0][1] == 0, f"速算表を読み取れません: {rates}"
    limit = num(one(r"課税給与所得金額が(\d[\d,]*)円を超える場合は、年末調整の対象となりません", joined, "速算表の上限"))
    bounds = []
    for (r1, m1), (r2, m2) in zip(rates, rates[1:]):
        assert (m2 - m1) * 100 % (r2 - r1) == 0, "速算表の区切りが整数になりません"
        bounds.append((m2 - m1) * 100 // (r2 - r1))
    bounds.append(limit)
    for b in bounds:
        assert f"{b:,}円" in joined, f"速算表の区切り {b:,}円 が表にありません"
    tax_rates = [{"upTo": b, "rate": r, "minus": m} for b, (r, m) in zip(bounds, rates)]
    taxable_round = num(one(r"課税給与所得金額に(\d[\d,]*)円未満の端数があるときは、これを切り捨てます", joined, "課税給与所得金額の端数"))

    # 配偶者控除・配偶者特別控除：所得者の合計所得金額の区分（900万円以下・950万円以下・1,000万円以下）
    owner_limit = man(one(r"合計所得金額\(9ページ参照\)が(\d[\d,]*)万円を超える所得者は、配偶者控除及び配偶者特別控除", joined, "配偶者控除の所得者の上限"))
    b1 = man(one(r"\(注3\)\)(\d[\d,]*)万円超(\d[\d,]*)万円以下", joined, "所得者の区分")[0])
    b2 = man(one(r"(\d[\d,]*)万円超1,000万円以下", joined, "所得者の区分2"))
    owner_bands = [b1, b2, owner_limit]
    assert b1 < b2 < owner_limit
    spouse_rows = []
    for line in lines:
        if m := re.fullmatch(r"(\d+)万円以下(\d+)万円(\d+)万円(\d+)万円", line):
            spouse_limit = man(m.group(1))
            normal = [man(x) for x in m.groups()[1:]]
        elif m := re.fullmatch(r"老人控除対象配偶者(\d+)万円(\d+)万円(\d+)万円", line):
            elderly = [man(x) for x in m.groups()]
        elif m := re.match(r"(\d+)万円超(\d+)万円以下(\d+)万円(\d+)万円(\d+)万円\d[\d,]*円超$", line):
            spouse_rows.append({"over": man(m.group(1)), "upTo": man(m.group(2)), "amounts": [man(x) for x in m.groups()[2:]]})
        elif m := re.match(r"(\d+)万円超0円0円0円", line):
            spouse_special_limit = man(m.group(1))
    assert spouse_rows[0]["over"] == spouse_limit and spouse_rows[-1]["upTo"] == spouse_special_limit, "配偶者特別控除の行がつながっていません"
    for a, b in zip(spouse_rows, spouse_rows[1:]):
        assert a["upTo"] == b["over"], "配偶者特別控除の行がつながっていません"

    # 基礎控除額
    basic_limit = man(one(r"合計所得金額\(9ページ参照\)が(\d[\d,]*)万円を超える所得者は、基礎控除の適用を受けることはできません", joined, "基礎控除の上限"))
    # 基礎控除の表は「489万円以下」から始まる行（配偶者控除の行と見分けるため、表の見出しの後だけを使う）
    i = next(k for k, l in enumerate(lines) if "基礎控除額の表" in l)
    basic = []
    for line in lines[i + 1:]:
        if m := re.fullmatch(r"(?:(\d[\d,]*)万円超)?(\d[\d,]*)万円以下(\d+)万円", line):
            basic.append({"upTo": man(m.group(2)), "amount": man(m.group(3))})
        elif line.startswith("(注)"):
            break
    assert basic and basic[-1]["upTo"] == basic_limit, f"基礎控除の表を読み取れません: {basic}"

    # 特定親族特別控除額
    specific = [{"over": man(a), "upTo": man(b), "amount": man(c)}
                for a, b, _, _, c in (re.fullmatch(r"(\d+)万円超(\d+)万円以下\((\d+)万円超(\d+)万円以下\)(\d+)万円", l).groups()
                                      for l in lines if re.fullmatch(r"(\d+)万円超(\d+)万円以下\((\d+)万円超(\d+)万円以下\)(\d+)万円", l))]
    assert len(specific) >= 5, "特定親族特別控除の表を読み取れません"
    for a, b in zip(specific, specific[1:]):
        assert a["upTo"] == b["over"], "特定親族特別控除の行がつながっていません"

    # 扶養控除額等（行の頭から合わせるので、「同居老親等」は「同居老親等以外の者」と、「特別障害者」は「同居特別障害者」と混ざらない）
    def amount(pattern, what):
        found = [m for m in (re.fullmatch(pattern + r"(\d[\d,]*)円", l) for l in lines) if m]
        assert len(found) == 1, f"{what} の控除額が1つに決まりません"
        return num(found[0].group(1))
    deductions = {
        "dependentGeneral": amount(r"一般の控除対象扶養親族", "一般の控除対象扶養親族"),
        "dependentSpecific": amount(r"年齢19歳以上23歳未満の人\(.*\)", "特定扶養親族"),
        "dependentElderlyOther": amount(r"同居老親等以外の者", "同居老親等以外"),
        "dependentElderlyLivingTogether": amount(r"同居老親等", "同居老親等"),
        "disabilityGeneral": amount(r"一般の障害者", "一般の障害者"),
        "disabilitySpecial": amount(r"特別障害者", "特別障害者"),
        "disabilitySpecialLivingTogether": amount(r"同居特別障害者", "同居特別障害者"),
        "widow": amount(r"\(3\)寡婦控除", "寡婦控除"),
        "singleParent": amount(r"\(4\)ひとり親控除", "ひとり親控除"),
        "workingStudent": amount(r"\(5\)勤労学生控除", "勤労学生控除"),
    }
    # 配偶者・扶養親族などの「合計所得金額」の上限（配偶者控除の行と同じ）
    return {
        "taxRates": tax_rates, "taxableLimit": limit, "taxableRoundTo": taxable_round,
        "spouse": {"ownerBands": owner_bands, "spouseIncomeLimit": spouse_limit, "normal": normal, "elderly": elderly,
                   "special": spouse_rows, "specialIncomeLimit": spouse_special_limit},
        "basic": basic, "specificRelative": specific, "deductions": deductions,
    }


# ─────────────────────────────────────────────────────────────
# 107.pdf 生命保険料控除・地震保険料控除
# ─────────────────────────────────────────────────────────────
def parse_brackets(block, what):
    """「X円以下 全額」「A円からB円まで ×1/n + p」「C円以上 一律にD円」を、[上限, 分母, 加算] の列にする"""
    full = num(one(r"(\d[\d,]*)円以下支払った保険料等の金額の全額", block, f"{what} の全額の行"))
    rows = [{"upTo": full, "divisor": 1, "plus": 0}]
    for _, to, d, plus in re.findall(r"(\d[\d,]*)円から(\d[\d,]*)円まで\(支払った保険料等の金額の合計額\)×1(\d)\+(\d[\d,]*)円", block):
        rows.append({"upTo": num(to), "divisor": int(d), "plus": num(plus)})
    cap = num(one(r"円以上一律に(\d[\d,]*)円", block, f"{what} の一律の行"))
    assert len(rows) == 3, f"{what} の行の数が違います: {rows}"
    return {"brackets": rows, "max": cap}


def parse_107(lines):
    joined = "".join(lines)
    # 計算式Ⅰ〜Ⅲ（NFKC で I・II・III になる）
    parts = re.split(r"【計算式(III|II|I)", joined)
    by_name = dict(zip(parts[1::2], parts[2::2]))
    assert set(by_name) == {"I", "II", "III"}, f"計算式Ⅰ〜Ⅲを読み取れません: {list(by_name)}"
    formulas = {k: parse_brackets(v.split("(注)")[0], f"計算式{k}") for k, v in by_name.items()}
    general_max, general_max_young = (man(x) for x in one(r"最高(\d+)万円\(年齢23歳未満の扶養親族を有する場合は最高(\d+)万円\)", joined, "一般の生命保険料の上限"))
    pension_max = man(one(r"上記4及び5の金額の合計額\(最高(\d+)万円\)", joined, "個人年金保険料の上限"))
    total_max = man(one(r"生命保険料の控除額は最高(\d+)万円が限度", joined, "生命保険料の控除額の上限"))
    assert "控除額の計算において算出した金額に1円未満の端数があるときは、その端数を切り上げます" in joined
    life = {"new": formulas["I"], "newYoung": formulas["II"], "old": formulas["III"],
            "generalMax": general_max, "generalMaxYoung": general_max_young, "pensionMax": pension_max, "totalMax": total_max}

    eq_max = man(one(r"その年中に支払った地震保険料の金額の合計額\(最高(\d+)万円\)", joined, "地震保険料の上限"))
    # 「X円以下 その合計額」は、②旧長期損害保険料の行と、③①と②がある場合の行の2つ（この順）
    full_rows = re.findall(r"(\d[\d,]*)円以下その合計額", joined)
    assert len(full_rows) == 2, f"「円以下 その合計額」の行が2つではありません: {full_rows}"
    old_full = num(full_rows[0])
    old_to, old_d, old_plus = one(r"\d[\d,]*円超(\d[\d,]*)円以下\(支払った保険料等の金額の合計額\)×1(\d)\+(\d[\d,]*)円", joined, "旧長期損害保険料の行")
    old_cap = num(one(r"円超一律に(\d[\d,]*)円", joined, "旧長期損害保険料の一律の行"))
    total = man(one(r"\d[\d,]*円超一律に(\d+)万円", joined, "地震保険料控除の上限"))
    assert num(full_rows[1]) == total, "③の行の金額と、地震保険料控除の上限が違います"
    assert "地震保険料の控除額の計算において算出した金額に1円未満の端数があるときは、その端数を切り上げます" in joined
    earthquake = {"earthquakeMax": eq_max, "totalMax": total,
                  "oldLongTerm": {"brackets": [{"upTo": old_full, "divisor": 1, "plus": 0},
                                               {"upTo": num(old_to), "divisor": int(old_d), "plus": num(old_plus)}], "max": old_cap}}
    return life, earthquake


# ─────────────────────────────────────────────────────────────
# 110rei.pdf 設例：所得金額調整控除の計算式
# ─────────────────────────────────────────────────────────────
def parse_110rei(lines):
    joined = "".join(lines)
    formulas = set(re.findall(r"\(\(7-(\d[\d,]*)円\)×(\d+)%、マイナスの場合は0\)", joined))
    assert len(formulas) == 1, f"所得金額調整控除の計算式を読み取れません: {formulas}"
    base, rate = formulas.pop()
    cap = re.findall(r"\(1円未満切上げ、最高(\d[\d,]*)円\)", joined)
    assert cap and len(set(cap)) == 1, f"所得金額調整控除の上限を読み取れません: {cap}"
    return {"threshold": num(base), "ratePercent": int(rate), "max": num(cap[0])}


def ts(value, indent=2):
    """Python の値を TypeScript の値の書き方にする"""
    pad = " " * indent
    if isinstance(value, dict):
        inner = ",\n".join(f"{pad}  {k}: {ts(v, indent + 2)}" for k, v in value.items())
        return "{\n" + inner + f",\n{pad}}}"
    if isinstance(value, list):
        if all(not isinstance(v, (dict, list)) for v in value):
            return "[" + ", ".join(ts(v) for v in value) + "]"
        return "[\n" + ",\n".join(f"{pad}  {ts(v, indent + 2)}" for v in value) + f",\n{pad}]"
    if isinstance(value, float):
        return repr(value)
    return str(value)


def main():
    pdf_dir, year, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rounding, segments, salary_limit, recon = parse_204(pdf_lines(pdf_dir, "204"))
    rows, extra = verify_114(pdf_lines(pdf_dir, "114", keep_spaces=True), rounding, segments)
    t115 = parse_115(pdf_lines(pdf_dir, "115"))
    life, earthquake = parse_107(pdf_lines(pdf_dir, "107"))
    adjustment = parse_110rei(pdf_lines(pdf_dir, "110rei"))

    master = {
        "year": year,
        "salaryLimit": salary_limit,
        "rounding": rounding,
        "employmentIncome": segments,
        "incomeAdjustment": adjustment,
        "basic": t115["basic"],
        "spouse": t115["spouse"],
        "specificRelative": t115["specificRelative"],
        "deductions": t115["deductions"],
        "lifeInsurance": life,
        "earthquake": earthquake,
        "taxRates": t115["taxRates"],
        "taxableLimit": t115["taxableLimit"],
        "taxableRoundTo": t115["taxableRoundTo"],
        "reconstruction": recon,
    }
    url = f"https://www.nta.go.jp/publication/pamph/gensen/nencho{year}/01.htm"
    lines = [
        "/**",
        f" * 令和{year - 2018}年分の年末調整の計算に使う表・計算式",
        " *",
        " * ⚠️ このファイルは自動生成です。手で書き換えないでください。",
        " * 元データ: 国税庁「年末調整のしかた」の PDF（nencho-tables/ フォルダ。入手元とハッシュは nencho-tables/README.md）",
        f" * 出典    : 国税庁ホームページ（{url}）の「年末調整のしかた」を加工して作成",
        " *           （PDF の表と計算式を Q で使える形に変換したもので、国税庁が作成したものではありません）",
        f" * 確認    : 給与所得控除後の給与等の金額の計算式で表の全{rows // 3}行を作り、114.pdf の表の数字（{rows}個）と一致することを確認済み",
        " * 作り方  : python3 -I scripts/import_nencho_tables.py <PDFのフォルダ> <年> <このファイル>",
        " */",
        "import type { NenchoMaster } from './nenchoTypes';",
        "",
        f"export const NENCHO_{year}: NenchoMaster = {ts(master, 0)};",
    ]
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{out} を作りました（114.pdf の表 {rows // 3}行・数字{rows}個と一致。表の見出し・注記の数字 {len(extra)}個: {extra}）")


if __name__ == "__main__":
    main()
