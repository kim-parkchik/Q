#!/usr/bin/env python3
"""
労災保険率（事業の種類ごとの率）と一般拠出金率を、厚生労働省の PDF から読み取って、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_rousai_rates.py nendo-koshin/source src/constants/insurance/rousaiRates.ts

読むもの（nendo-koshin/source に置く。入手元は nendo-koshin/README.md）:
・001221989.pdf  厚生労働省「労災保険率表（令和６年度～）」（令和6年4月1日施行）
  字が「字の形の線」で描かれていて PDFKit では字を取り出せないので、ページを画像にして macOS の文字認識（scripts/pdf_ocr.swift）で
  事業の種類の番号・事業の種類・労災保険率を読む。
・001184407.pdf  厚生労働省「労災保険率の改定について」（労働政策審議会の答申の別添３。字を取り出せる）
  業種・現行・改定の率の表。率表から読んだ 54 の事業の種類が、この表の業種と名前で1つずつ結び付き、率がこの表の「改定」の率と
  すべて同じことを確かめる（文字認識の読み違いを見つけるため）。名前は、この表の字（文字認識でない字）を使う。
・keizoku-12.pdf  厚生労働省「令和８年度 労働保険年度更新申告書の書き方（継続事業用）」の 12・13
  「賃金総額（千円未満は切り捨て） × 一般拠出金率（1,000分の0.02）」から一般拠出金率を読む。

どれか1つでも読めないとき、合わないときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
"""
import difflib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def fail(message):
    print(f"止まりました: {message}", file=sys.stderr)
    sys.exit(1)


def nfkc(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def ocr_lines(pdf):
    out = run(["swift", str(SCRIPT_DIR / "pdf_ocr.swift"), str(pdf), "1"])
    rows = []
    for raw in out.splitlines():
        if raw.startswith("==="):
            continue
        x, y, w, h, t = raw.split("\t", 4)
        rows.append((float(x), float(y), float(w), float(h), nfkc(t)))
    if len(rows) < 100:
        fail(f"{pdf.name} を文字認識で読めません（{len(rows)}行）")
    return rows


def key(name):
    """名前を比べるための形（かっこの中・句読点・空白を除く）"""
    s = re.sub(r"[（(].*?[）)]", "", nfkc(name))
    s = re.sub(r"[（(].*$", "", s)
    return re.sub(r"[\s、。.・,]", "", s)


def read_rate_table(pdf):
    """労災保険率表（文字認識）：[(番号の並び, 名前, 率, まとまり)]"""
    lines = ocr_lines(pdf)
    head = " ".join(t for *_, t in lines)
    if "労災保険率表" not in head or "令和6年4月1日施行" not in head.replace(" ", ""):
        fail("労災保険率表の見出し（令和6年4月1日施行）を読めません")
    rate_head = [l for l in lines if l[4] == "労災保険率"]
    if not rate_head:
        fail("労災保険率表の「労災保険率」の列が見つかりません")
    rx = rate_head[0][0]
    rates = sorted([(y + h / 2, float(t)) for x, y, w, h, t in lines if x > rx - 5 and re.fullmatch(r"\d+(?:\.\d+)?", t)], key=lambda v: -v[0])
    nums = [(y + h / 2, t) for x, y, w, h, t in lines if 125 <= x <= 145 and re.fullmatch(r"\d{2}", t)]
    names = [(x, y + h / 2, t) for x, y, w, h, t in lines if 145 <= x < rx - 20 and not re.fullmatch(r"[\d.]+", t)]
    # 「90 船舶所有者の事業」のように、番号と名前が1つになった行
    for x, y, w, h, t in lines:
        m = re.fullmatch(r"(\d{2}) (\S.+)", t)
        if 125 <= x <= 145 and m:
            nums.append((y + h / 2, m.group(1)))
            names.append((x + 15, y + h / 2, m.group(2)))
    groups = [(y + h / 2, t) for x, y, w, h, t in lines if x < 120 and t not in ("事業の種類の分類",) and not t.startswith("(")]
    rows = []
    used = set()
    for y, rate in rates:
        cand = [n for n in names if abs(n[1] - y) <= 6 and id(n) not in used]
        if not cand:
            fail(f"労災保険率表の、高さ {y:.1f} の率 {rate} の事業の種類を読めません")
        # 2行にわたる名前は、上の行から読む（率は2行のまん中の高さにある）
        name = max(cand, key=lambda n: n[1])
        used.add(id(name))
        text = name[2]
        # 2行にわたる名前（すぐ下の、率のない行）
        below = [n for n in names if 0 < name[1] - n[1] <= 9 and abs(n[0] - name[0]) <= 4 and id(n) not in used
                 and not any(abs(r[0] - n[1]) <= 5 for r in rates)]
        for n in sorted(below, key=lambda n: -n[1]):
            used.add(id(n))
            text += n[2]
        # 番号は、いちばん近い率の行のもの（林業は 02・03 の2つが、率の上と下にある）
        codes = sorted({c for cy, c in nums if abs(cy - y) <= 9.5 and min(rates, key=lambda r: abs(r[0] - cy))[0] == y})
        if not codes:
            fail(f"労災保険率表の「{text}」の番号を読めません")
        group = max([g for g in groups if g[0] >= y - 6], key=lambda g: -g[0], default=None)
        rows.append((codes, text, rate, group[1] if group else ""))
    return rows


def read_answer_table(pdf):
    """労災保険率の改定について（別添３）の、業種・現行・改定の表"""
    out = run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(pdf)])
    page = out.split("=== page 2 ===")[0]
    text = nfkc(page)
    if "労災保険率及び第一種特別加入保険料率" not in text or "現行 改定(案)" not in text:
        fail("「労災保険率の改定について」の表の見出しを読めません")
    rows = []
    for line in page.splitlines():
        t = nfkc(line)
        m = re.fullmatch(r"(\S.+?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)(?: [↘↗])?", t)
        if m and not t.startswith("業種"):
            rows.append((m.group(1), float(m.group(2)), float(m.group(3))))
    if len(rows) != 54:
        fail(f"「労災保険率の改定について」の業種が 54 ではありません（{len(rows)}）")
    return rows


def read_general_contribution(pdf):
    text = nfkc(run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(pdf)]))
    m = re.search(r"賃金総額\(千円未満は切り捨て\) × 一般拠出金率\(1,000分の([\d.]+)\)", text)
    if not m:
        fail("一般拠出金率を読めません")
    return float(m.group(1))


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_rousai_rates.py <nendo-koshin/source> <出力 rousaiRates.ts>")
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    table = read_rate_table(src / "001221989.pdf")
    answer = read_answer_table(src / "001184407.pdf")
    if len(table) != 54:
        fail(f"労災保険率表の事業の種類が 54 ではありません（{len(table)}）")
    # 率表の1行ずつ、答申の表の業種と名前で結び付ける（いちばん似ているもの。似ている度合いが低い・同じ業種に2つは止まる）
    taken = {}
    result = []
    for codes, name, rate, group in table:
        scored = sorted(((difflib.SequenceMatcher(None, key(name), key(a[0])).ratio(), i) for i, a in enumerate(answer)), reverse=True)
        score, i = scored[0]
        if score < 0.8:
            fail(f"労災保険率表の「{name}」を、「労災保険率の改定について」の業種と結び付けられません（いちばん近いのは「{answer[i][0]}」{score:.2f}）")
        if i in taken:
            fail(f"「労災保険率の改定について」の「{answer[i][0]}」に、率表の「{taken[i]}」と「{name}」の2つが結び付きました")
        taken[i] = name
        a_name, old, new = answer[i]
        if new != rate:
            fail(f"「{a_name}」の率が、率表（文字認識）{rate} と「労災保険率の改定について」の改定 {new} で違います")
        if any(not re.fullmatch(r"\d{2}", c) for c in codes) or len(codes) > 2:
            fail(f"「{a_name}」の番号 {codes} を読めません")
        result.append({"codes": codes, "name": a_name, "rate": rate})
    all_codes = [c for r in result for c in r["codes"]]
    if len(set(all_codes)) != len(all_codes):
        fail(f"労災保険率表の番号が重なっています（{sorted(c for c in set(all_codes) if all_codes.count(c) > 1)}）")
    general = read_general_contribution(src / "keizoku-12.pdf")

    rows_ts = ",\n".join("      " + json.dumps(r, ensure_ascii=False) for r in result)
    ts = f"""/**
 * 労災保険率（事業の種類ごと）と一般拠出金率
 *
 * scripts/import_rousai_rates.py で、厚生労働省「労災保険率表（令和６年度～）」（文字認識で読み、「労災保険率の改定について」の率と
 * すべて同じことを確かめた）と「令和８年度 労働保険年度更新申告書の書き方（継続事業用）」から作ったファイルです。手で直さないでください。
 * 作り方と入手元は nendo-koshin/README.md
 */
import type {{ YearMonth }} from './kenpoTableTypes';

/** 事業の種類（codes は労災保険率表の事業の種類の番号。林業は 02・03 の2つ）と労災保険率（1,000分の rate） */
export interface RousaiRateRow {{
  codes: string[];
  name: string;
  rate: number;
}}

export interface RousaiRatePeriod {{
  /** この月の分から使う（労災保険率は、原則3年ごとに4月1日から変わる） */
  from: YearMonth;
  source: string;
  rows: RousaiRateRow[];
}}

export const ROUSAI_RATE_PERIODS: RousaiRatePeriod[] = [
  {{
    from: {{ year: 2024, month: 4 }},
    source: "https://www.mhlw.go.jp/content/11200000/001221989.pdf",
    rows: [
{rows_ts},
    ],
  }},
];

/** 一般拠出金率（1,000分の）。賃金総額（千円未満は切り捨て）にかける */
export const GENERAL_CONTRIBUTION_RATE = {general};
"""
    out.write_text(ts, encoding="utf-8")
    print(f"{out} を作りました（事業の種類 {len(result)}・一般拠出金率 {general}/1000）")


if __name__ == "__main__":
    main()
