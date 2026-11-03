#!/usr/bin/env python3
"""
地方税共同機構「処分通知等（税額通知）CSVレイアウト仕様書（総務省通知形式）」の Excel から、
eLTAX で受け取る特別徴収税額通知（特別徴収義務者用）の CSV の項目の並び（Q で使うデータファイル。TypeScript）を作る。

使い方:
    python3 -I scripts/import_tokucho_notice_layout.py \
        <処分通知等（税額通知）CSVレイアウト仕様書(総務省通知形式)　平成29年1月1日～.xlsx> \
        src/constants/residentTaxNoticeCsvLayout.ts

・AI や手作業で項目を書き写さないための道具。番号・名前・文字属性・文字数は、すべて Excel の表から機械的に読み取る。
・Excel は地方税共同機構「仕様書・様式集」（https://www.lta.go.jp/support/documents/01/）の
  「処分通知等（税額通知）CSVレイアウト仕様書(総務省通知形式) 平成29年1月1日～」（https://www.lta.go.jp/documents/00084）。
  eLTAX「特別徴収税額通知（特別徴収義務者用）を確認するには」が、この CSV の形として案内している。
  著作権は地方税共同機構にあるので、Excel そのものはリポジトリに入れない。
・使うのは「個人別明細情報」のシート。次のときはエラーで止まる（中途半端なデータは作らない）
    - シートがない、表題が「特別徴収税額通知（総務省通知形式CSV)」で始まらない、見出しの行の形が違う
    - 項目の番号が 1 から順に並んでいない
    - 名前がない、文字数が正の整数でない、文字属性が 数字・半角・全角・半角カナ 以外
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SOURCE_URL = "https://www.lta.go.jp/documents/00084"
SHEET = "個人別明細情報"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
ATTRS = {"数字", "半角", "全角", "半角カナ"}


def text_of(si):
    """セルの文字（ルビ rPh の中の文字は入れない）"""
    direct = si.find("m:t", NS)
    if direct is not None:
        return direct.text or ""
    return "".join((r.find("m:t", NS).text or "") for r in si.findall("m:r", NS) if r.find("m:t", NS) is not None)


def read_sheet(path, sheet_name):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = [text_of(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheet = next((s for s in wb.find("m:sheets", NS) if s.get("name") == sheet_name), None)
    if sheet is None:
        sys.exit(f"「{sheet_name}」のシートがない")
    target = rels[sheet.get("{%s}id" % NS["r"])]
    target = target.lstrip("/") if target.startswith("/xl/") or target.startswith("xl/") else "xl/" + target
    root = ET.fromstring(z.read(target))
    rows = {}
    for row in root.iter("{%s}row" % NS["m"]):
        cells = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                val = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = text_of(c.find("m:is", NS))
            else:
                val = v.text if v is not None else ""
            cells[col] = (val or "").strip()
        rows[int(row.get("r"))] = cells
    return rows


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1:]
    rows = read_sheet(src, SHEET)
    title = rows.get(1, {}).get("A", "")
    if not title.startswith("特別徴収税額通知（総務省通知形式CSV)"):
        sys.exit(f"表題が違う: {title}")
    h2, h3 = rows.get(2, {}), rows.get(3, {})
    if (h2.get("A"), h2.get("B"), h3.get("D"), h3.get("E")) != ("No.", "CSV項目名称", "文字属性", "文字数"):
        sys.exit(f"見出しの行の形が違う: {h2} {h3}")

    fields = []
    for r in sorted(rows):
        cells = rows[r]
        if r < 4 or not re.fullmatch(r"\d+", cells.get("A", "")):
            continue
        no = int(cells["A"])
        if no != len(fields) + 1:
            sys.exit(f"項目の番号が順に並んでいない: {r}行目 {no}")
        name, attr, length = cells.get("B", ""), cells.get("D", ""), cells.get("E", "")
        if not name:
            sys.exit(f"{no}番の名前がない")
        if attr not in ATTRS:
            sys.exit(f"{no}番の文字属性が想定外: {attr}")
        if not re.fullmatch(r"[1-9]\d*", length):
            sys.exit(f"{no}番の文字数が正の整数でない: {length}")
        fields.append({"no": no, "name": name, "attr": attr, "max": int(length)})

    if not fields:
        sys.exit("項目が1つもない")

    digest = hashlib.sha256(open(src, "rb").read()).hexdigest()
    body = ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in fields)
    ts = f"""/**
 * eLTAX で受け取る特別徴収税額通知（特別徴収義務者用）の CSV の項目（{len(fields)}項目。1行に1人。項目名の行はない）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「{title.strip()}」の Excel（{src.split('/')[-1]}。SHA-256 {digest}）
 * 出典    : 地方税共同機構「仕様書・様式集」 処分通知等（税額通知）CSVレイアウト仕様書（総務省通知形式）（{SOURCE_URL}）
 * 作り方  : python3 -I scripts/import_tokucho_notice_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / name CSV項目名称 / attr 文字属性（数字・半角・全角・半角カナ）/ max 文字数
 */

export interface ResidentTaxNoticeCsvField {{
  no: number;
  name: string;
  attr: "数字" | "半角" | "全角" | "半角カナ";
  max: number;
}}

export const RESIDENT_TAX_NOTICE_CSV_FIELDS: ResidentTaxNoticeCsvField[] = [
{body},
];
"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{len(fields)} 項目 → {out}")


if __name__ == "__main__":
    main()
