#!/usr/bin/env python3
"""
地方税共同機構「給与支払報告書CSVレイアウト仕様書（総務省通知形式）」の Excel から、
eLTAX に取り込む CSV の項目の並び（Q で使うデータファイル。TypeScript）を作る。

使い方:
    python3 -I scripts/import_kyuho_csv_layout.py \
        <給与支払報告書CSVレイアウト仕様書（総務省通知形式）　令和07年分.xlsx> \
        src/constants/salaryPaymentReportCsvLayout.ts

・AI や手作業で項目を書き写さないための道具。番号・名前・必須・文字属性・文字数は、すべて Excel の表から機械的に読み取る。
・Excel は地方税共同機構「仕様書・様式集」（https://www.lta.go.jp/support/documents/01/）の
  「給与支払報告書CSVレイアウト仕様書（総務省通知形式） 令和07年分(CSV)」（https://www.lta.go.jp/documents/17254）。
  著作権は地方税共同機構にあるので、Excel そのものはリポジトリに入れない。
・使うのは1枚目のシート（「給与支払報告書」）。次のときはエラーで止まる（中途半端なデータは作らない）
    - 表題が「給与支払報告書（総務省通知形式CSV）」で始まらない、見出しの行の形が違う
    - 項目の番号が 1 から順に並んでいない
    - 名前がない、文字数が正の整数でない
    - 必須の欄が「○」「※3」「※4」・空 以外、文字属性が 数字・半角・全角・半角カナ 以外
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SOURCE_URL = "https://www.lta.go.jp/documents/17254"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
ATTRS = {"数字", "半角", "全角", "半角カナ"}
REQUIRED = {"○", "※3", "※4", ""}


def text_of(si):
    """セルの文字（ルビ rPh の中の文字は入れない）"""
    direct = si.find("m:t", NS)
    if direct is not None:
        return direct.text or ""
    return "".join((r.find("m:t", NS).text or "") for r in si.findall("m:r", NS) if r.find("m:t", NS) is not None)


def read_first_sheet(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = [text_of(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    first = wb.find("m:sheets", NS)[0]
    name = first.get("name")
    target = rels[first.get("{%s}id" % NS["r"])]
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
    return name, rows


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1:]
    sheet, rows = read_first_sheet(src)
    if sheet != "給与支払報告書":
        sys.exit(f"1枚目のシートが「給与支払報告書」ではない: {sheet}")
    title = rows.get(1, {}).get("A", "")
    if not title.startswith("給与支払報告書（総務省通知形式CSV）"):
        sys.exit(f"表題が違う: {title}")
    h2, h3 = rows.get(2, {}), rows.get(3, {})
    if (h2.get("A"), h2.get("B"), h3.get("D"), h3.get("F"), h3.get("G")) != ("No.", "CSV項目名称", "必須", "文字属性", "文字数"):
        sys.exit(f"見出しの行の形が違う: {h2} {h3}")

    fields = []
    for r in sorted(rows):
        cells = rows[r]
        if r < 4 or not re.fullmatch(r"\d+", cells.get("A", "")):
            continue
        no = int(cells["A"])
        if no != len(fields) + 1:
            sys.exit(f"項目の番号が順に並んでいない: {r}行目 {no}")
        name = cells.get("B", "")
        required = cells.get("D", "")
        # 「※1⏎半角カナ」のように注の印が付いているものは、最後の行が文字属性
        attr = cells.get("F", "").split("\n")[-1].strip()
        length = cells.get("G", "")
        if not name:
            sys.exit(f"{no}番の名前がない")
        if required not in REQUIRED:
            sys.exit(f"{no}番の必須の欄が想定外: {required}")
        if attr not in ATTRS:
            sys.exit(f"{no}番の文字属性が想定外: {attr}")
        if not re.fullmatch(r"[1-9]\d*", length):
            sys.exit(f"{no}番の文字数が正の整数でない: {length}")
        fields.append({"no": no, "name": name, "required": required, "attr": attr, "max": int(length)})

    if not fields:
        sys.exit("項目が1つもない")

    digest = hashlib.sha256(open(src, "rb").read()).hexdigest()
    body = ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in fields)
    ts = f"""/**
 * eLTAX に取り込む給与支払報告書の CSV の項目（{len(fields)}項目。この順に、カンマで区切って1行に1人）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「{title}」の Excel（{src.split('/')[-1]}。SHA-256 {digest}）
 * 出典    : 地方税共同機構「仕様書・様式集」 給与支払報告書CSVレイアウト仕様書（総務省通知形式）（{SOURCE_URL}）
 * 作り方  : python3 -I scripts/import_kyuho_csv_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / name CSV項目名称 / required 必須（○：必須。※3・※4：条件によって必須。空：必須でない）/
 *           attr 文字属性（数字・半角・全角・半角カナ）/ max 文字数
 */

export interface SalaryReportCsvField {{
  no: number;
  name: string;
  required: "○" | "※3" | "※4" | "";
  attr: "数字" | "半角" | "全角" | "半角カナ";
  max: number;
}}

export const SALARY_REPORT_CSV_TITLE = {json.dumps(title, ensure_ascii=False)};

export const SALARY_REPORT_CSV_FIELDS: SalaryReportCsvField[] = [
{body},
];
"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{len(fields)} 項目 → {out}")


if __name__ == "__main__":
    main()
