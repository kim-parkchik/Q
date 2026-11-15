#!/usr/bin/env python3
"""
厚生労働大臣が定める現物給与の価額（食事・住宅。都道府県ごと）を、日本年金機構の「全国現物給与価額一覧表」の PDF から読み取って、
Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_genbutsu_values.py genbutsu-tables/source src/constants/genbutsu.ts

・genbutsu-tables/source/ に、日本年金機構の一覧表（2019.pdf〜2026.pdf）と、厚生労働省の令和8年度のお知らせ（001677803.pdf）を置いておく
  （入手元と SHA-256 は genbutsu-tables/README.md）
・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。全角は半角にし（NFKC）、空白を1つにまとめて読む。
・都道府県の名前（src/constants/prefectures.ts の name0。北海道・青森・…・沖縄）の順に、その後ろの数字を読む
  （1人1月当たりの食事の額・1人1日当たりの食事の額・朝食のみ・昼食のみ・夕食のみの額・住宅の利益の額。
   令和8年度は、住宅が【R8.9.30まで】の畳1畳につきの額と、【R8.10.1から】の総面積1平方メートルにつきの額の2つ）
・令和2年4月〜の表（2020.pdf）は、PDF に字の形の情報がなく日本語を取り出せないので、数字の並び
  （47都道府県の「1月・1日」の組、朝食、昼食、注の「1.65」「1」、夕食、住宅）で読む。
・次のときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）
  - 見出しの「平成31年4月から」「令和○年4月から」が、ファイルの年と合わない
  - 47都道府県のどれかが見つからない・数字が足りない・数字でない
  - 1人1月当たりの食事の額が、1日当たりの額の30倍でない／1日当たりの額が、朝食・昼食・夕食の額の合計でない
  - Q&A の「どこが変更になったのか」で住宅を変えていない年（令和4〜7年度と、令和8年度の畳の列）なのに、前の年と住宅の額が違う。
    令和2年度（日本語を読めない）の住宅の額が、平成31年度と違う
  - 令和8年度の表が、日本年金機構の PDF と厚生労働省のお知らせで違う
  - Q&A の計算例の額（東京の食事の1か月の額と、住宅の1畳・1平方メートルの額）が、読んだ表と合わない
・京都の令和8年度の住宅（畳）の額は、どちらの PDF も「1.810」と点で書いてあるので、3けたの区切りとして 1,810 と読む
  （令和7年度と同じ額で、住宅は令和8年9月30日まで変わらないので、上の「前の年と同じ」の確かめで合っていることがわかる）
"""
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent

# (ファイル, 適用が始まる日, 見出しの年, 入手元)
NENKIN_CURRENT = "https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150511.files/"
NENKIN_PAST = "https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.files/"
TABLES = [
    ("2019.pdf", "2019-04-01", "平成31年", NENKIN_PAST + "2019.pdf"),
    ("2020.pdf", "2020-04-01", "令和2年", NENKIN_PAST + "2020.pdf"),
    ("2021.pdf", "2021-04-01", "令和3年", NENKIN_PAST + "2021.pdf"),
    ("2022.pdf", "2022-04-01", "令和4年", NENKIN_PAST + "2022.pdf"),
    ("2023.pdf", "2023-04-01", "令和5年", NENKIN_PAST + "2023.pdf"),
    ("2024.pdf", "2024-04-01", "令和6年", NENKIN_PAST + "2024.pdf"),
    ("2025.pdf", "2025-04-01", "令和7年", NENKIN_CURRENT + "2025.pdf"),
    ("2026.pdf", "2026-04-01", "令和8年", NENKIN_CURRENT + "2026.pdf"),
]
MHLW_PDF = "001677803.pdf"
MHLW_URL = "https://www.mhlw.go.jp/content/001677803.pdf"
# 令和8年度の住宅の価額が、畳1畳につきから総面積1平方メートルにつきに変わる日
SQM_FROM = "2026-10-01"

MEAL_KEYS = ["month", "day", "breakfast", "lunch", "dinner"]


def fail(message):
    print(f"止まりました: {message}", file=sys.stderr)
    sys.exit(1)


def read_pages(pdf):
    """ページごとの文字（NFKC で全角を半角にし、空白を1つにまとめる）"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(pdf)], check=True, capture_output=True, text=True).stdout
    pages = {}
    for m in re.finditer(r"=== page (\d+) ===\n(.*?)(?==== page \d+ ===|\Z)", out, re.S):
        pages[int(m.group(1))] = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", m.group(2))).strip()
    if not pages:
        fail(f"{pdf.name}: PDF から文字を取り出せません")
    return pages


def prefecture_names():
    """src/constants/prefectures.ts の name0（北海道・青森・…・沖縄）を、JIS の順に読む"""
    text = (ROOT / "src/constants/prefectures.ts").read_text(encoding="utf-8")
    names = [(int(c), n) for c, n in re.findall(r"code:\s*(\d+),\s*name:\s*\"[^\"]+\",\s*name0:\s*\"([^\"]+)\"", text)]
    if [c for c, _ in names] != list(range(1, 48)):
        fail("src/constants/prefectures.ts の都道府県が、1〜47 の順に並んでいません")
    return [n for _, n in names]


NUMBER = re.compile(r"\d+(?:[,.]\d+)*")


def to_yen(token, where, warnings):
    """「1,110」を 1110 にする。「1.810」のように点で3けたを区切っているものも、3けたの区切りとして読む（知らせる）"""
    if re.fullmatch(r"\d{1,3}(?:,\d{3})*", token):
        return int(token.replace(",", ""))
    if re.fullmatch(r"\d{1,3}(?:[,.]\d{3})+", token):
        warnings.append(f"{where}：「{token}」と点で書いてあるので、3けたの区切りとして {int(re.sub(r'[,.]', '', token)):,} と読みました")
        return int(re.sub(r"[,.]", "", token))
    fail(f"{where}：「{token}」を金額として読めません")


def read_labeled_table(text, names, columns, file_name, warnings):
    """都道府県の名前の後ろの数字を columns 個ずつ読む（名前は「青 森」のように字の間に空白があってもよい）"""
    rows = {}
    pos = 0
    for name in names:
        m = re.compile(r"\s?".join(re.escape(c) for c in name)).search(text, pos)
        if not m:
            fail(f"{file_name}：「{name}」の行が見つかりません")
        nums = []
        for t in NUMBER.finditer(text, m.end()):
            # 数字の前に、数字でない字（「時 価」などの注）があってもよいが、次の都道府県の名前を越えて読まない
            nums.append(t)
            if len(nums) == columns:
                break
        if len(nums) < columns:
            fail(f"{file_name}：「{name}」の数字が {columns} 個ありません")
        between = text[m.end():nums[-1].end()]
        if re.search(r"[^\d,.\s時価自社製品通勤定期券など]", between):
            fail(f"{file_name}：「{name}」の数字のあいだに、ほかの字があります（{between}）")
        rows[name] = [to_yen(t.group(), f"{file_name} の{name}", warnings) for t in nums]
        pos = nums[-1].end()
    return rows


def read_2020_table(text, names, file_name):
    """令和2年度の表：日本語を取り出せないので、数字の並びで読む（47の「1月・1日」の組・朝食・昼食・注の 1.65 と 1・夕食・住宅）"""
    tokens = NUMBER.findall(text)
    vals = []
    for t in tokens:
        vals.append(t)
    n = len(names)
    start = None
    for i in range(len(vals) - 2 * n):
        try:
            pairs = [(int(vals[i + 2 * j].replace(",", "")), int(vals[i + 2 * j + 1].replace(",", ""))) for j in range(n)]
        except ValueError:
            continue
        if all(month == day * 30 and day > 0 for month, day in pairs):
            start = i
            break
    if start is None:
        fail(f"{file_name}：47都道府県の「1人1月当たり・1日当たりの食事の額」の組が見つかりません")
    rest = vals[start + 2 * n:]
    breakfast, lunch = rest[:n], rest[n:2 * n]
    if rest[2 * n:2 * n + 2] != ["1.65", "1"]:
        fail(f"{file_name}：昼食の額の後ろに、注の「1.65」「1」（洋間は1.65平方メートルを1畳に換算）がありません（{rest[2 * n:2 * n + 2]}）")
    dinner, housing = rest[2 * n + 2:3 * n + 2], rest[3 * n + 2:4 * n + 2]
    if len(housing) != n:
        fail(f"{file_name}：住宅の額が47ありません")
    if len(rest) != 4 * n + 2:
        fail(f"{file_name}：1ページ目の数字の数が合いません（住宅の額の後ろに {len(rest) - 4 * n - 2} 個あります）")
    rows = {}
    for j, name in enumerate(names):
        cells = [pairs[j][0], pairs[j][1]] + [int(v.replace(",", "")) for v in (breakfast[j], lunch[j], dinner[j], housing[j])]
        rows[name] = cells
    return rows


def check_meals(rows, where):
    for name, cells in rows.items():
        month, day, breakfast, lunch, dinner = cells[:5]
        if month != day * 30:
            fail(f"{where}：{name}の1人1月当たりの食事の額 {month:,} が、1日当たりの額 {day:,} の30倍ではありません")
        if day != breakfast + lunch + dinner:
            fail(f"{where}：{name}の1人1日当たりの食事の額 {day:,} が、朝食・昼食・夕食の額の合計 {breakfast + lunch + dinner:,} ではありません")


def check_examples(pages, tokyo, file_name, sqm=None):
    """Q&A の計算例（東京に所在する事業所の場合）の額が、読んだ表の東京の額と合うか"""
    qa = " ".join(pages[no] for no in sorted(pages) if no >= 2)
    meals = [int(v.replace(",", "")) for v in re.findall(r"1カ月当たりの現物給与価額\(東京に所在する事業所の場合\)[….\s]*([\d,]+)円\(B\)", qa)]
    if not meals or any(v != tokyo[0] for v in meals):
        fail(f"{file_name}：Q&A の食事の計算例の東京の1か月の額（{meals}）が、表の東京の額 {tokyo[0]:,} と合いません")
    tatami = [int(v.replace(",", "")) for v in re.findall(r"([\d,]+)円\(畳1畳につき\)", qa)]
    if not tatami or any(v != tokyo[5] for v in tatami):
        fail(f"{file_name}：Q&A の住宅の計算例の東京の畳1畳の額（{tatami}）が、表の東京の額 {tokyo[5]:,} と合いません")
    if sqm is not None:
        per_sqm = [int(v.replace(",", "")) for v in re.findall(r"([\d,]+)円\(総面積1平方メートルにつき\)", qa)]
        if not per_sqm or any(v != sqm for v in per_sqm):
            fail(f"{file_name}：Q&A の住宅の計算例の東京の1平方メートルの額（{per_sqm}）が、表の東京の額 {sqm:,} と合いません")
    return len(meals) + len(tatami)


def housing_changed(pages):
    """Q&A の「どこが変更になったのか」の答えに、住宅が書いてあるか（書いていなければ、住宅の額は前の年と同じ）"""
    qa = " ".join(pages[no] for no in sorted(pages) if no >= 2)
    m = re.search(r"どこが変更になったのか\? ?A:(.*?)Q3", qa)
    if not m:
        fail("Q&A の「どこが変更になったのか」が見つかりません")
    return "住宅" in m.group(1), m.group(1).strip()


def changed_count(answer, what):
    """Q&A の答えの「43都道府県において、食事の…」「全ての都道府県において、住宅の…」から、額が変わった都道府県の数（書いていなければ None）"""
    m = re.search(r"(全て|すべて|\d+) ?の? ?(?:都道府県|道府県|都府県|府県|都県|県)において、 ?" + what, answer)
    if not m:
        return None
    return 47 if m.group(1) in ("全て", "すべて") else int(m.group(1))


def check_changed_counts(answer, rows, previous_rows, file_name, compare_housing):
    """Q&A の「どこが変更になったのか」の都道府県の数と、前の年の表と比べて額が変わった都道府県の数が同じか"""
    notes = []
    meal = changed_count(answer, "食事")
    if meal is not None:
        actual = sum(1 for name in rows if rows[name][:5] != previous_rows[name][:5])
        if actual != meal:
            fail(f"{file_name}：Q&A では食事の額が変わったのは {meal} の都道府県（{answer}）なのに、前の年の表と比べると {actual} です")
        notes.append(f"食事の額が変わった都道府県が Q&A のとおり {meal}")
    housing = changed_count(answer, "住宅") if compare_housing else None
    if housing is not None:
        actual = sum(1 for name in rows if rows[name][5] != previous_rows[name][5])
        if actual != housing:
            fail(f"{file_name}：Q&A では住宅の額が変わったのは {housing} の都道府県（{answer}）なのに、前の年の表と比べると {actual} です")
        notes.append(f"住宅の額が変わった都道府県が Q&A のとおり {housing}")
    return notes


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_genbutsu_values.py genbutsu-tables/source src/constants/genbutsu.ts")
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    names = prefecture_names()
    warnings = []
    periods = []
    checks = []
    previous_housing = None
    previous_rows = None
    for file_name, start, heading, url in TABLES:
        pages = read_pages(src / file_name)
        page1 = pages.get(1, "")
        if file_name == "2020.pdf":
            rows = read_2020_table(page1, names, file_name)
            # 日本語を読めないので、Q&A の計算例の数字（東京の食事 21,300・住宅 2,590）が、読んだ東京の額とあるかを確かめる
            qa = " ".join(pages[no] for no in sorted(pages) if no >= 2)
            tokyo = rows["東京"]
            for v in (tokyo[0], tokyo[5]):
                if f"{v:,}" not in qa:
                    fail(f"{file_name}：Q&A の計算例に、読んだ東京の額 {v:,} がありません")
            if [cells[5] for cells in rows.values()] != previous_housing:
                fail(f"{file_name}：住宅の額が、平成31年度の表と違います（日本語を読めない表なので、数字の並びを読み違えているかもしれません）")
            checks.append(f"{file_name}：日本語を読めないので数字の並びで読み、住宅の額が平成31年度と同じ・Q&A の計算例に東京の {tokyo[0]:,}円と {tokyo[5]:,}円")
            changed_note = "（日本語を読めないので、住宅は平成31年度と同じことを確かめた）"
        else:
            m = re.search(r"(平成|令和) ?(\d+) ?年 ?4 ?月から現物給与の価額が改[正定]されます", page1)
            if not m or f"{m.group(1)}{int(m.group(2))}年" != heading:
                fail(f"{file_name}：見出しの「{heading}4月から現物給与の価額が改正されます」が見つかりません（{m.group(0) if m else 'なし'}）")
            two_housing = file_name == "2026.pdf"
            if two_housing:
                if "【R8.9.30まで】" not in page1 or "【R8.10.1から】" not in page1 or "総面積1平方 メートルにつき" not in page1:
                    fail(f"{file_name}：住宅の「【R8.9.30まで】畳一畳につき」「【R8.10.1から】総面積1平方メートルにつき」の見出しが見つかりません")
            rows = read_labeled_table(page1, names, 7 if two_housing else 6, file_name, warnings)
            changed, answer = housing_changed(pages)
            if file_name != "2019.pdf" and not changed and [cells[5] for cells in rows.values()] != previous_housing:
                fail(f"{file_name}：Q&A では住宅の額を変えていない（{answer}）のに、前の年の表と住宅の額が違います")
            # 令和8年度の【R8.9.30まで】の畳の列は、住宅の額が変わる前（令和7年度まで）と同じはず
            if two_housing and [cells[5] for cells in rows.values()] != previous_housing:
                fail(f"{file_name}：【R8.9.30まで】の住宅（畳1畳につき）の額が、令和7年度の表と違います")
            n = check_examples(pages, rows["東京"], file_name, rows["東京"][6] if two_housing else None)
            # 前の年の表と比べて、額が変わった都道府県の数が Q&A のとおりか（令和3年度の「43都道府県」で、令和2年度の数字の並びの読み方も確かめる）
            counts = check_changed_counts(answer, rows, previous_rows, file_name, not two_housing) if previous_rows else []
            checks.append(f"{file_name}：見出し「{heading}4月から」・Q&A の計算例 {n}つが表の東京の額と合う"
                          + "".join(f"・{c}" for c in counts)
                          + ("・【R8.9.30まで】の住宅（畳）の額は令和7年度と同じ" if two_housing
                             else "" if file_name == "2019.pdf" or changed else "・住宅の額は前の年と同じ"))
            changed_note = answer
        check_meals(rows, file_name)
        previous_housing = [cells[5] for cells in rows.values()]
        previous_rows = rows
        periods.append({"from": start, "file": file_name, "url": url, "unit": "tatami", "rows": {k: v[:6] for k, v in rows.items()}, "note": changed_note})
        if file_name == "2026.pdf":
            periods.append({"from": SQM_FROM, "file": file_name, "url": url, "unit": "sqm",
                            "rows": {k: v[:5] + [v[6]] for k, v in rows.items()}, "note": "住宅は総面積1平方メートルにつきの額"})
            # 厚生労働省のお知らせ（令和8年度）の表と、一つ残らず同じか
            mhlw = read_pages(src / MHLW_PDF)
            if "現物給与の価額改定について(令和8年度)" not in mhlw.get(2, ""):
                fail(f"{MHLW_PDF}：2ページ目に「現物給与の価額改定について（令和８年度）」の表が見つかりません")
            mrows = read_labeled_table(mhlw.get(2, ""), names, 7, MHLW_PDF, warnings)
            check_meals(mrows, MHLW_PDF)
            diff = [name for name in names if mrows[name] != rows[name]]
            if diff:
                fail(f"令和8年度の表が、日本年金機構の PDF と厚生労働省のお知らせで違います（{'・'.join(diff)}）")
            checks.append(f"{file_name}：厚生労働省のお知らせ（{MHLW_PDF}）の表と、47都道府県とも同じ")

    lines = []
    for p in periods:
        unit_label = "畳1畳につき（居住用の室）" if p["unit"] == "tatami" else "総面積1平方メートルにつき"
        lines.append("  {")
        lines.append(f"    from: '{p['from']}',")
        lines.append(f"    source: '日本年金機構「全国現物給与価額一覧表」{p['file']}（{p['url']}）',")
        lines.append(f"    housingUnit: '{p['unit']}', // 住宅の利益の額は、1人1月当たり、{unit_label}")
        lines.append("    values: {")
        for name in names:
            month, day, breakfast, lunch, dinner, housing = p["rows"][name]
            lines.append(f"      {name}: {{ meal: {{ month: {month}, day: {day}, breakfast: {breakfast}, lunch: {lunch}, dinner: {dinner} }}, housing: {housing} }},")
        lines.append("    },")
        lines.append("  },")

    header = f"""/**
 * 厚生労働大臣が定める現物給与の価額（食事・住宅。都道府県ごと）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 日本年金機構「全国現物給与価額一覧表（厚生労働大臣が定める現物給与の価額）」の PDF
 *   （genbutsu-tables/source/。入手元と SHA-256 は genbutsu-tables/README.md）
 *   https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150511.html （令和7年度・令和8年度）
 *   https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/genbutsukako.html （平成31年度〜令和6年度）
 *   令和8年度は、厚生労働省「現物給与の価額改定について（令和８年度）」（{MHLW_URL}）の表とも比べた
 *   （資料を加工して作成したもので、日本年金機構・厚生労働省が作成したものではありません）
 * 作り方  : python3 -I scripts/import_genbutsu_values.py genbutsu-tables/source src/constants/genbutsu.ts
 * 確認    :
""" + "".join(f" *   - {c}\n" for c in checks) + "".join(f" *   - 注：{w}\n" for w in warnings) + """ *
 * from は、その価額を使い始める日（その月の分の現物給与から。食事・住宅の価額は、給与の締め日にかかわらず、月の1日〜末日の1か月分で計算する）。
 * 食事（meal）は、1人1月当たりの額（month）・1人1日当たりの額（day）・1人1日当たりの朝食のみ・昼食のみ・夕食のみの額。
 * 住宅（housing）は、1人1月当たりの住宅の利益の額で、令和8年9月30日までは居住用の室（居間・寝室など。玄関・台所・トイレ・浴室・廊下は含めない）の
 * 畳1畳につき、令和8年10月1日からは住宅の総面積（玄関・台所・トイレ・浴室・廊下なども含める。別棟の物置・車庫と共用部分は除く）1平方メートルにつき。
 * 食事・住宅以外の現物（自社製品・通勤定期券など）は時価（労働協約に定めがあればその価額）。計算の結果の1円未満は切り捨てる。
 * 健康保険組合は、規約で別の価額を決めていることがある。
 * 価額は、勤務地（本社と支店が1つの適用事業所なら、それぞれの勤務地）の都道府県のものを使う（平成25年4月から）。
 */
import type { PrefectureName0 } from './prefectures';

export interface GenbutsuMeal {
  /** 1人1月当たりの食事の額 */
  month: number;
  /** 1人1日当たりの食事の額 */
  day: number;
  /** 1人1日当たりの朝食のみの額 */
  breakfast: number;
  /** 1人1日当たりの昼食のみの額 */
  lunch: number;
  /** 1人1日当たりの夕食のみの額 */
  dinner: number;
}

export interface GenbutsuPeriod {
  /** この価額を使い始める日 */
  from: string;
  /** 元の PDF */
  source: string;
  /** 住宅の利益の額の単位（tatami: 居住用の室の畳1畳につき / sqm: 住宅の総面積1平方メートルにつき） */
  housingUnit: 'tatami' | 'sqm';
  /** 都道府県ごとの価額（円） */
  values: Record<PrefectureName0, { meal: GenbutsuMeal; housing: number }>;
}

export const GENBUTSU_PERIODS: GenbutsuPeriod[] = [
"""
    out.write_text(header + "\n".join(lines) + "\n];\n", encoding="utf-8")
    print(f"{out} を作りました（{len(periods)} の期間）")
    for c in checks:
        print("  確認:", c)
    for w in warnings:
        print("  注:", w)


if __name__ == "__main__":
    main()
