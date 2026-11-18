#!/usr/bin/env python3
"""
現物で払う食事・社宅の所得税の決まり（給与として課税しない条件と、社宅の賃貸料相当額の計算）を、国税庁のタックスアンサーの HTML から
読み取って、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_genbutsu_tax.py genbutsu-tables/source koyo-format/source/001738607.pdf src/constants/genbutsuTax.ts

読むもの（入手元は genbutsu-tables/README.md）:
・ta2594.htm  タックスアンサー No.2594「食事を支給したとき」
    本人が食事の価額の半分以上を負担し、（食事の価額 − 負担額）が1か月当たりの額（消費税を除く。10円未満切り捨て）以下なら課税しない。
    軽減税率・標準税率の率
・ta2597.htm  タックスアンサー No.2597「使用人に社宅や寮などを貸したとき」
    賃貸料相当額（建物の固定資産税の課税標準額 × 率 ＋ 12円 ×（総床面積 ÷ 3.3㎡）＋ 敷地の課税標準額 × 率）と、本人が50％以上を払えば課税しないこと
・ta2600.htm  タックスアンサー No.2600「役員に社宅などを貸したとき」
    小規模な住宅（法定耐用年数30年以下は132㎡以下、30年超は99㎡以下）は No.2597 と同じ式、それ以外は（建物 × 12％（30年超は10％）＋ 敷地 × 6％）÷ 12、
    借り上げは家賃の50％と比べて多い方。豪華社宅の床面積（240㎡）
・koyo-format/source/001738607.pdf  厚生労働省「雇用保険事務手続きの手引き【第２編】」の「４ 賃金の範囲に算入される現物給与とは」
    現物給与の代金を徴収していても、実際費用の3分の1を下回るときは、3分の1に相当する額と徴収金額との差額を賃金とする（雇用保険の賃金に入れる額）

次のときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
・決まった言い回しが見つからない（タックスアンサーが書き換えられた）、「令和○年○月○日現在法令等」が3つで違う
・具体例（No.2594：13,000円と6,000円 → 7,000円が課税。No.2597：10,000円の社宅で3,000円 → 7,000円、6,000円 → 課税しない）が、読んだ決まりで計算した額と合わない
・No.2600 の小規模な住宅の式が No.2597 の式と違う
"""
import hashlib
import re
import subprocess
import sys
import unicodedata
from html import unescape
from pathlib import Path

SOURCES = {
    "ta2594.htm": "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2594.htm",
    "ta2597.htm": "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2597.htm",
    "ta2600.htm": "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm",
}


def fail(message):
    print(f"止まりました: {message}", file=sys.stderr)
    sys.exit(1)


def page_text(path):
    raw = path.read_bytes().decode("utf-8", errors="replace")
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S)
    t = unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", t))


def find(text, pattern, name, what):
    m = re.search(pattern, text)
    if not m:
        fail(f"{name} に「{what}」が見つかりません")
    return m.groups()


def as_of(text, name, number):
    if f"No.{number}" not in text:
        fail(f"{name} がタックスアンサー No.{number} ではありません")
    y, mo, d = find(text, r"\[令和(\d+)年(\d+)月(\d+)日現在法令等\]", name, "令和○年○月○日現在法令等")
    return f"{2018 + int(y):04d}-{int(mo):02d}-{int(d):02d}"


def yen(s):
    return int(s.replace(",", ""))


def ratio(s, percent):
    """「0.22」→ [22, 10000]（percent なら ％ として 100 で割る）、「3.3」→ [33, 10]"""
    whole, _, dec = s.partition(".")
    num = int(whole + dec)
    den = 10 ** len(dec) * (100 if percent else 1)
    return [num, den]


def housing_formula(text, name):
    b = find(text, r"\(1\)\(その年度の建物の固定資産税の課税標準額\)×([\d.]+)パーセント", name, "(1)建物の固定資産税の課税標準額×○パーセント")[0]
    per, unit = find(text, r"\(2\)(\d+)円×\(その建物の総床面積\(平方メートル\)/\(?([\d.]+)\(?平方メートル\)\)?", name, "(2)○円×(その建物の総床面積/○平方メートル)")
    land = find(text, r"\(3\)\(その年度の敷地の固定資産税の課税標準額\)×([\d.]+)パーセント", name, "(3)敷地の固定資産税の課税標準額×○パーセント")[0]
    return {"building": ratio(b, True), "perArea": int(per), "areaUnit": ratio(unit, False), "land": ratio(land, True)}


def koyo_share(path):
    """手引き 第2編：代金を徴収する現物給与で、賃金にする部分（実際費用の○分の1）"""
    script = Path(__file__).resolve().parent / "pdf_to_text.swift"
    raw = subprocess.run(["swift", str(script), str(path)], check=True, capture_output=True, text=True).stdout
    t = re.sub(r"\s+", "", unicodedata.normalize("NFKC", raw))
    if "雇用保険事務手続きの手引き" not in t and "賃金の範囲に算入される現物給与とは" not in t:
        fail(f"{path.name} が雇用保険事務手続きの手引き【第２編】ではありません")
    m = re.search(r"現物給与について代金を徴収するものは、原則として賃金とはなりませんが、当該徴収金額が実際費用の(\d+)分の(\d+)を下回っている場合は、"
                  r"実際費用の(\d+)分の(\d+)に相当する額と徴収金額との差額部分は、賃金として取扱いますが、実際費用の(\d+)分の(\d+)を上回る代金を徴収するものは現物給与とはなりません", t)
    if not m:
        fail(f"{path.name} に「当該徴収金額が実際費用の○分の○を下回っている場合は…」が見つかりません")
    d1, n1, d2, n2, d3, n3 = (int(x) for x in m.groups())
    if not (d1 == d2 == d3 and n1 == n2 == n3):
        fail("手引きの現物給与の「実際費用の○分の○」が3か所で違います")
    return [n1, d1]


def main():
    if len(sys.argv) != 4:
        fail("使い方: python3 -I scripts/import_genbutsu_tax.py <genbutsu-tables/source> <koyo-format/source/001738607.pdf> <出力 src/constants/genbutsuTax.ts>")
    folder, koyo, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    if not koyo.exists():
        fail(f"{koyo} がありません（入手元は koyo-format/README.md）")
    emp_share = koyo_share(koyo)
    texts = {}
    for name in SOURCES:
        path = folder / name
        if not path.exists():
            fail(f"{path} がありません（入手元は genbutsu-tables/README.md）")
        texts[name] = page_text(path)

    # ── No.2594 食事 ──
    t = texts["ta2594.htm"]
    meal_since = as_of(t, "ta2594.htm", 2594)
    find(t, r"\(1\)役員や使用人が食事の価額の半分以上を負担していること。", "ta2594.htm", "(1)食事の価額の半分以上を負担")
    limit = yen(find(t, r"\(2\)次の金額が1か月当たり([\d,]+)円\(消費税および地方消費税の額を除きます。\)以下であること。", "ta2594.htm", "(2)1か月当たり○円以下")[0])
    round_to = int(find(t, r"その金額に(\d+)円未満の端数が生じた場合にはこれを切り捨てる", "ta2594.htm", "○円未満の端数を切り捨てる")[0])
    reduced, standard = (int(x) for x in find(t, r"軽減税率\((\d+)パーセント\)と標準税率\((\d+)パーセント\)", "ta2594.htm", "軽減税率と標準税率"))
    price, burden = (yen(x) for x in find(t, r"1か月当たりの食事の価額が([\d,]+)円で、役員や使用人の負担している金額が([\d,]+)円の場合", "ta2594.htm", "具体例"))
    taxed = yen(find(t, r"との差額の([\d,]+)円が、給与として課税されます", "ta2594.htm", "具体例の課税される額")[0])
    if "(1)の要件を満たしていません" not in t or burden * 2 >= price or price - burden != taxed:
        fail("No.2594 の具体例が、読んだ決まり（半分以上の負担）で計算した結果と合いません")

    # ── No.2597 使用人の社宅 ──
    t = texts["ta2597.htm"]
    house_since = as_of(t, "ta2597.htm", 2597)
    formula = housing_formula(t, "ta2597.htm")
    share = int(find(t, r"使用人から受け取っている家賃が、賃貸料相当額の(\d+)パーセント以上であれば", "ta2597.htm", "賃貸料相当額の○パーセント以上")[0])
    eq = yen(find(t, r"賃貸料相当額が([\d,]+)円の社宅を使用人に貸与した場合", "ta2597.htm", "具体例の賃貸料相当額")[0])
    low, low_taxed = (yen(x) for x in find(t, r"\(2\)使用人から([\d,]+)円の家賃を受け取る場合には、賃貸料相当額である[\d,]+円と[\d,]+円との差額の([\d,]+)円が給与として課税されます", "ta2597.htm", "具体例(2)"))
    high = yen(find(t, r"\(3\)使用人から([\d,]+)円の家賃を受け取る場合には、[\d,]+円は賃貸料相当額である[\d,]+円の\d+パーセント以上ですので", "ta2597.htm", "具体例(3)")[0])
    if not (low * 100 < eq * share and eq - low == low_taxed and high * 100 >= eq * share):
        fail("No.2597 の具体例が、読んだ決まり（50パーセント以上）で計算した結果と合いません")

    # ── No.2600 役員の社宅 ──
    t = texts["ta2600.htm"]
    officer_since = as_of(t, "ta2600.htm", 2600)
    if len({meal_since, house_since, officer_since}) != 1:
        fail(f"3つのタックスアンサーの「現在法令等」の日が違います（{meal_since}・{house_since}・{officer_since}）")
    if housing_formula(t, "ta2600.htm") != formula:
        fail("No.2600 の小規模な住宅の式が、No.2597 の式と違います")
    y1, short_area, y2, long_area = (int(x) for x in find(
        t, r"法定耐用年数が(\d+)年以下の建物の場合には床面積が(\d+)平方メートル以下である住宅、法定耐用年数が(\d+)年を超える建物の場合には床面積が(\d+)平方メートル以下",
        "ta2600.htm", "小規模な住宅"))
    if y1 != y2:
        fail("No.2600 の法定耐用年数の境目が2か所で違います")
    luxury = int(find(t, r"床面積が(\d+)平方メートルを超えるもののうち", "ta2600.htm", "豪華社宅の床面積")[0])
    months = int(find(t, r"次のイとロの合計額の(\d+)分の1が賃貸料相当額", "ta2600.htm", "イとロの合計額の○分の1")[0])
    b_short, y3, b_long = find(t, r"イ\(その年度の建物の固定資産税の課税標準額\)×(\d+)パーセントただし、法定耐用年数が(\d+)年を超える建物の場合には\d+パーセントではなく、(\d+)パーセントを乗じます。",
                               "ta2600.htm", "イ 建物×○パーセント")
    if int(y3) != y1:
        fail("No.2600 のイの法定耐用年数が、小規模な住宅の境目と違います")
    land_rate = find(t, r"ロ\(その年度の敷地の固定資産税の課税標準額\)×(\d+)パーセント", "ta2600.htm", "ロ 敷地×○パーセント")[0]
    leased = find(t, r"会社が家主に支払う家賃の(\d+)パーセントの金額と、上記\(1\)で算出した賃貸料相当額とのいずれか多い金額", "ta2600.htm", "借り上げの家賃の○パーセント")[0]

    def h(name):
        return hashlib.sha256((folder / name).read_bytes()).hexdigest()

    src_lines = "\n".join(f" *   source/{n}（SHA-256 {h(n)}）\n *     {u}" for n, u in SOURCES.items())
    j = lambda v: f"[{v[0]}, {v[1]}] as [number, number]"
    body = f"""/**
 * 現物で払う食事・社宅の所得税の決まり（給与として課税しない条件と、社宅の賃貸料相当額）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_genbutsu_tax.py genbutsu-tables/source koyo-format/source/001738607.pdf src/constants/genbutsuTax.ts
 *           （入手元は genbutsu-tables/README.md・koyo-format/README.md）
 * 元データ:
{src_lines}
 *   koyo-format/source/001738607.pdf（SHA-256 {hashlib.sha256(koyo.read_bytes()).hexdigest()}）
 */

/** タックスアンサーの「令和○年○月○日現在法令等」の日（Q は、この日の月の分から、この決まりで計算する） */
export const GENBUTSU_TAX_SINCE = "{meal_since}";

/** 食事（No.2594）：本人が食事の価額の selfShare 以上を払い、（食事の価額 − 本人が払う額）が1か月当たり monthlyLimit 円
 *  （消費税を除く。roundTo 円未満の端数は切り捨て）以下なら課税しない。満たさなければ、食事の価額 − 本人が払う額が課税される */
export const MEAL_TAX = {{
  selfShare: [1, 2] as [number, number],
  monthlyLimit: {limit},
  roundTo: {round_to},
  /** 消費税の率（％。軽減税率・標準税率） */
  rates: {{ reduced: {reduced}, standard: {standard} }},
}} as const;

/** 社宅（No.2597・No.2600）：賃貸料相当額（1か月）＝ 建物の課税標準額 × building ＋ perArea 円 ×（総床面積 ÷ areaUnit ㎡）＋ 敷地の課税標準額 × land */
export const HOUSING_TAX = {{
  building: {j(formula["building"])},
  perArea: {formula["perArea"]},
  areaUnit: {j(formula["areaUnit"])},
  land: {j(formula["land"])},
  /** 使用人：本人が賃貸料相当額の employeeShare 以上を払えば課税しない（No.2597） */
  employeeShare: [{share}, 100] as [number, number],
  /** 役員（No.2600）：小規模な住宅（法定耐用年数 lifeYears 年以下は smallArea.short ㎡以下、超えるものは smallArea.long ㎡以下）は上の式。
   *  それ以外は（建物 × building ＋ 敷地 × land）÷ months。借り上げは、家主に払う家賃 × leasedShare と比べて多い方。
   *  床面積が luxuryArea ㎡を超えるものは、豪華社宅（時価）かどうかを確かめる */
  officer: {{
    lifeYears: {y1},
    smallArea: {{ short: {short_area}, long: {long_area} }},
    building: {{ short: [{b_short}, 100] as [number, number], long: [{b_long}, 100] as [number, number] }},
    land: [{land_rate}, 100] as [number, number],
    months: {months},
    leasedShare: [{leased}, 100] as [number, number],
    luxuryArea: {luxury},
  }},
}} as const;

/** 雇用保険（手引き 第2編「賃金の範囲に算入される現物給与とは」）：代金を徴収する現物給与は原則として賃金にならないが、
 *  徴収金額が実際費用の share を下回るときは、実際費用 × share と徴収金額との差額を賃金にする */
export const EMP_IN_KIND = {{
  share: [{emp_share[0]}, {emp_share[1]}] as [number, number],
}} as const;
"""
    out.write_text(body, encoding="utf-8")
    print(f"{out} を作りました（{meal_since} 現在。食事 {limit}円・{round_to}円未満切り捨て・消費税 {reduced}/{standard}％、社宅 {formula}、役員 {short_area}/{long_area}㎡・{b_short}/{b_long}％・{land_rate}％・1/{months}・借り上げ {leased}％・豪華 {luxury}㎡）")


if __name__ == "__main__":
    main()
