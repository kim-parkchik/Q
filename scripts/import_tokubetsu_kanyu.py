#!/usr/bin/env python3
"""
労災保険の特別加入（第1種。中小事業主・家族従事者・役員など）の保険料算定基礎額の表を、山形労働局「年度更新の手引き」（令和8年度）の
「特別加入保険料算定基礎額表」から読み取って、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_tokubetsu_kanyu.py nendo-koshin/source/yamagata-tebiki-2026.pdf src/constants/tokubetsuKanyu.ts

読むもの（入手元は nendo-koshin/README.md）:
・給付基礎日額ごとの、保険料算定基礎額（1年分）と「特例による 1/12 の額」（年度の途中で加入・脱退した人は、この額 × 加入月数）
・記入例の「算定基礎額の計」（千円単位）× 料率（1,000分の）＝ 特別加入保険料（円）

次のときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
・表の見出し（給付基礎日額・保険料算定基礎額・特例による 1/12 の額）が見つからない、行が読めない
・保険料算定基礎額が、どの行も給付基礎日額の同じ倍数（日数）になっていない
・1/12 の額が、保険料算定基礎額 ÷ 12 の1円未満を切り上げた額と違う
・給付基礎日額が大きい順に並んでいない
・記入例の「算定基礎額の計」× 料率が、記入例の特別加入保険料と合わない
"""
import hashlib
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SOURCE_URL = "https://jsite.mhlw.go.jp/yamagata-roudoukyoku/content/contents/002587832.pdf"


def fail(message):
    print(f"止まりました: {message}", file=sys.stderr)
    sys.exit(1)


def yen(s):
    return int(s.replace(",", ""))


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_tokubetsu_kanyu.py <yamagata-tebiki-2026.pdf> <出力 src/constants/tokubetsuKanyu.ts>")
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if not src.exists():
        fail(f"{src} がありません（入手元は nendo-koshin/README.md）")
    script = Path(__file__).resolve().parent / "pdf_to_text.swift"
    raw = subprocess.run(["swift", str(script), str(src)], check=True, capture_output=True, text=True).stdout
    text = unicodedata.normalize("NFKC", raw)
    i = text.find("特別加入保険料算定基礎額表")
    if i < 0:
        fail("「特別加入保険料算定基礎額表」が見つかりません")
    head = re.match(r"特別加入保険料算定基礎額表\s*給付基礎日額\s*保険料算定基礎額\s*特例による\s*1/12\s*の額", text[i:])
    if not head:
        fail("表の見出し（給付基礎日額・保険料算定基礎額・特例による 1/12 の額）が見つかりません")
    rows = []
    for line in text[i + head.end():].splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.fullmatch(r"([\d,]+)\s*円\s+([\d,]+)\s*円\s+([\d,]+)\s*円", line)
        if not m:
            break
        rows.append({"daily": yen(m.group(1)), "yearly": yen(m.group(2)), "monthly": yen(m.group(3))})
    if len(rows) < 10:
        fail(f"表の行が少なすぎます（{len(rows)}行）")
    days = {r["yearly"] // r["daily"] for r in rows if r["yearly"] % r["daily"] == 0}
    if len(days) != 1 or any(r["yearly"] % r["daily"] for r in rows):
        fail("保険料算定基礎額が、どの行も給付基礎日額の同じ倍数になっていません")
    for r in rows:
        if r["monthly"] != -(-r["yearly"] // 12):
            fail(f"給付基礎日額 {r['daily']:,}円 の 1/12 の額（{r['monthly']:,}円）が、{r['yearly']:,}円 ÷ 12 の1円未満を切り上げた額と違います")
    if [r["daily"] for r in rows] != sorted({r["daily"] for r in rows}, reverse=True):
        fail("給付基礎日額が大きい順に並んでいません")
    # 記入例：「算定基礎額の計」（千円）× 料率 ＝ 特別加入保険料
    flat = re.sub(r"\s+", " ", text)
    m = re.search(r"\*2\.特別加入者・保険料 算定基礎額の計 \d+ \*2 ([\d,]+) ([\d.]+) ([\d,]+)", flat)
    if not m:
        fail("記入例の「算定基礎額の計」と特別加入保険料が見つかりません")
    kilo, rate, premium = yen(m.group(1)), m.group(2), yen(m.group(3))
    whole, _, dec = rate.partition(".")
    if (kilo * int(whole + dec)) // (10 ** len(dec)) != premium:
        fail(f"記入例の「算定基礎額の計」{kilo:,}千円 × {rate}/1000 が、特別加入保険料 {premium:,}円 と合いません")

    digest = hashlib.sha256(src.read_bytes()).hexdigest()
    lines = ",\n".join(f"  {{ daily: {r['daily']}, yearly: {r['yearly']}, monthly: {r['monthly']} }}" for r in rows)
    body = f"""/**
 * 労災保険の特別加入（第1種。中小事業主・家族従事者・役員など）の保険料算定基礎額
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 作り方  : python3 -I scripts/import_tokubetsu_kanyu.py nendo-koshin/source/yamagata-tebiki-2026.pdf src/constants/tokubetsuKanyu.ts
 * 元データ: 山形労働局「年度更新の手引き」（令和8年度）の「特別加入保険料算定基礎額表」
 *   source/yamagata-tebiki-2026.pdf（SHA-256 {digest}）
 *     {SOURCE_URL}
 * 保険料算定基礎額は給付基礎日額 × {days.pop()}日。年度の途中で加入・脱退した人は「特例による 1/12 の額」× 加入月数。
 * 特別加入者全員の算定基礎額を足して千円未満を切り捨て、労災保険率（1,000分の）をかけて1円未満を切り捨てる（記入例の
 * 「算定基礎額の計」{kilo:,}千円 × {rate}/1000 ＝ {premium:,}円 と合うことを確かめた）
 */

export interface TokubetsuRow {{
  /** 給付基礎日額（円） */
  daily: number;
  /** 保険料算定基礎額（1年分。円） */
  yearly: number;
  /** 特例による 1/12 の額（年度の途中で加入・脱退した人の1か月分。円） */
  monthly: number;
}}

export const TOKUBETSU_TABLE: TokubetsuRow[] = [
{lines},
];
"""
    out.write_text(body, encoding="utf-8")
    print(f"{out} を作りました（{len(rows)}行。給付基礎日額 {rows[-1]['daily']:,}円〜{rows[0]['daily']:,}円）")


if __name__ == "__main__":
    main()
