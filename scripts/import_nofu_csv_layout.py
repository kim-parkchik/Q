#!/usr/bin/env python3
"""
地方税共同機構「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」の Excel から、
eLTAX の納付情報発行依頼（個人住民税（特別徴収））に取り込む CSV の項目の並び（Q で使うデータファイル。TypeScript）を作る。

使い方:
    python3 -I scripts/import_nofu_csv_layout.py \
        <個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）.xlsx> \
        src/constants/residentTaxPaymentCsvLayout.ts

・AI や手作業で項目を書き写さないための道具。番号・名前・必須・文字属性・文字数・決まった値は、すべて Excel の表から機械的に読み取る。
・Excel は地方税共同機構「共通納税（電子納付） 仕様書・様式集」（https://www.lta.go.jp/support/documents/02/）の
  「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」（https://www.lta.go.jp/documents/00103。変更履歴は 1.0 版）。
  著作権は地方税共同機構にあるので、Excel そのものはリポジトリに入れない。
・使うシートは「ヘッダー・レコード」「データ・レコード」「トレーラー・レコード」「エンド・レコード」。
  「このCSVファイルについて」シートに、文字コードが UTF-8 と書いてあることも確かめる。
・次のときはエラーで止まる（中途半端なデータは作らない）
    - シートがない、表題・見出しの行の形が違う、項目の番号が 1 から順に並んでいない
    - 名前がない、文字数が正の整数でない、文字属性が 数字・半角・全角・半角カナ 以外
    - 各レコードの1つ目が「データ区分」でない、またはその決まった値（「○であること」）が読めない
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SOURCE_URL = "https://www.lta.go.jp/documents/00103"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
ATTRS = {"数字", "半角", "全角", "半角カナ"}
RECORDS = [("header", "ヘッダー・レコード"), ("data", "データ・レコード"), ("trailer", "トレーラー・レコード"), ("end", "エンド・レコード")]


def text_of(si):
    """セルの文字（ルビ rPh の中の文字は入れない）"""
    direct = si.find("m:t", NS)
    if direct is not None:
        return direct.text or ""
    return "".join((r.find("m:t", NS).text or "") for r in si.findall("m:r", NS) if r.find("m:t", NS) is not None)


def read_sheets(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = [text_of(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for sheet in wb.find("m:sheets", NS):
        target = rels[sheet.get("{%s}id" % NS["r"])]
        target = target.lstrip("/") if target.startswith("/xl/") or target.startswith("xl/") else "xl/" + target
        rows = {}
        for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
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
        sheets[sheet.get("name")] = rows
    return sheets


def read_record(rows, label):
    if not rows.get(1, {}).get("A", "").startswith("個人住民税(特徴)(CSVフォーマット)"):
        sys.exit(f"{label}：表題が違う: {rows.get(1)}")
    h2, h3 = rows.get(2, {}), rows.get(3, {})
    if (h2.get("A"), h2.get("B"), h3.get("D"), h3.get("F"), h3.get("G")) != ("No.", "CSV項目名称", "必須", "文字属性", "文字数"):
        sys.exit(f"{label}：見出しの行の形が違う: {h2} {h3}")
    if rows.get(4, {}).get("A") != label:
        sys.exit(f"{label}：4行目がレコード名ではない: {rows.get(4)}")
    fields = []
    for r in sorted(rows):
        cells = rows[r]
        if r < 5 or not re.fullmatch(r"\d+", cells.get("A", "")):
            continue
        no = int(cells["A"])
        if no != len(fields) + 1:
            sys.exit(f"{label}：項目の番号が順に並んでいない: {r}行目 {no}")
        name, required, attr, length, note = (cells.get(k, "") for k in ("B", "D", "F", "G", "I"))
        if not name:
            sys.exit(f"{label}：{no}番の名前がない")
        if attr not in ATTRS:
            sys.exit(f"{label}：{no}番の文字属性が想定外: {attr}")
        if not re.fullmatch(r"[1-9]\d*", length):
            sys.exit(f"{label}：{no}番の文字数が正の整数でない: {length}")
        field = {"no": no, "name": name, "required": required.replace("〇", "○"), "attr": attr, "max": int(length)}
        # 決まった値（「1であること」「99であること」）。ダミーは「スペースであること」なので空にしておく
        m = re.match(r"^(\d+)であること", note)
        if m:
            field["fixed"] = m.group(1)
        fields.append(field)
    if not fields or fields[0]["name"] != "データ区分" or "fixed" not in fields[0]:
        sys.exit(f"{label}：1つ目の項目が、決まった値のデータ区分ではない: {fields[:1]}")
    return fields


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1:]
    sheets = read_sheets(src)
    about = " ".join(c for row in sheets.get("このCSVファイルについて", {}).values() for c in row.values())
    if "文字コード形式はUTF-8" not in about:
        sys.exit("「このCSVファイルについて」に、文字コードが UTF-8 と書いていない")
    layout = {}
    for key, label in RECORDS:
        if label not in sheets:
            sys.exit(f"「{label}」のシートがない")
        layout[key] = read_record(sheets[label], label)

    digest = hashlib.sha256(open(src, "rb").read()).hexdigest()
    body = ",\n".join(f"  {key}: [\n" + ",\n".join("    " + json.dumps(f, ensure_ascii=False) for f in layout[key]) + ",\n  ]" for key, _ in RECORDS)
    counts = "・".join(f"{label} {len(layout[key])}項目" for key, label in RECORDS)
    ts = f"""/**
 * eLTAX の納付情報発行依頼（個人住民税（特別徴収））に取り込む CSV の項目（{counts}）
 * ファイルは ヘッダー・レコード（1行）→ データ・レコード（市区町村ごと）→ トレーラー・レコード → エンド・レコード の順。文字コードは UTF-8
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」の Excel（{src.split('/')[-1]}。SHA-256 {digest}）
 * 出典    : 地方税共同機構「共通納税（電子納付） 仕様書・様式集」（{SOURCE_URL}）
 * 作り方  : python3 -I scripts/import_nofu_csv_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / name CSV項目名称 / required 必須（○：必須。※１：取り込むときは必須でないが、計算を確かめるので入れる）/
 *           attr 文字属性 / max 文字数 / fixed 決まった値（「○であること」）
 */

export interface ResidentTaxPaymentCsvField {{
  no: number;
  name: string;
  required: string;
  attr: "数字" | "半角" | "全角" | "半角カナ";
  max: number;
  fixed?: string;
}}

export const RESIDENT_TAX_PAYMENT_CSV: Record<"header" | "data" | "trailer" | "end", ResidentTaxPaymentCsvField[]> = {{
{body},
}};
"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{counts} → {out}")


if __name__ == "__main__":
    main()
