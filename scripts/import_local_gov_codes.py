#!/usr/bin/env python3
"""
総務省「都道府県コード及び市区町村コード」（全国地方公共団体コード）の Excel から、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_local_gov_codes.py \
        local-gov-codes/都道府県コード及び市区町村コード_令和6年1月1日現在.xlsx \
        2024-01-01 \
        src/constants/localGovCodes.ts

・AI や手作業でコードを書き写さないための道具。コードと名前はすべて Excel の表から機械的に読み取る。
・使うのは1枚目のシート（「…現在の団体」）。政令指定都市は区ではなく市の行だけが入っている（給与支払報告書の提出先は市）。
・次のときはエラーで止まる（中途半端なデータは作らない）
    - 都道府県が47そろわない
    - コードが6桁の数字でない、同じコードが2つある
    - 市区町村のコードの上2桁が、その都道府県のコードの上2桁と違う
    - 6桁目の検査数字が、上5桁から計算したものと違う
      （5桁に左から 6・5・4・3・2 を掛けて足し、11で割った余りを 11 から引いた数の1の位。総務省「全国地方公共団体コード」仕様）
・Excel のふりがな（ルビ）は読まない。
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SOURCE_URL = "https://www.soumu.go.jp/denshijiti/code.html"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
T = "{%s}t" % NS["m"]


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
    rows = []
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
        rows.append(cells)
    return name, rows


def check_digit(first5):
    total = sum(int(d) * w for d, w in zip(first5, [6, 5, 4, 3, 2]))
    return (11 - total % 11) % 10


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    src, as_of, out = sys.argv[1:]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
        sys.exit("2つ目は、いつ現在のコードか（YYYY-MM-DD）")
    sheet, rows = read_first_sheet(src)
    if "現在の団体" not in sheet:
        sys.exit(f"1枚目のシートが「…現在の団体」ではない: {sheet}")
    header = rows[0]
    if not header.get("A", "").startswith("団体コード") or not header.get("C", "").startswith("市区町村名"):
        sys.exit(f"見出しの行の形が違う: {header}")

    prefectures, municipalities, seen = {}, [], set()
    for cells in rows[1:]:
        code, pref, name = cells.get("A", ""), cells.get("B", ""), cells.get("C", "")
        if not code and not pref and not name:
            continue
        if not re.fullmatch(r"\d{6}", code):
            sys.exit(f"コードが6桁の数字でない: {cells}")
        if code in seen:
            sys.exit(f"同じコードが2つある: {code}")
        seen.add(code)
        if int(code[5]) != check_digit(code[:5]):
            sys.exit(f"検査数字が違う: {code} {pref}{name}")
        if not name:
            prefectures[code[:2]] = pref
        else:
            municipalities.append((code, pref, name))

    if len(prefectures) != 47:
        sys.exit(f"都道府県が47そろわない: {len(prefectures)}")
    for code, pref, name in municipalities:
        if prefectures.get(code[:2]) != pref:
            sys.exit(f"都道府県とコードが合わない: {code} {pref}{name}")

    digest = hashlib.sha256(open(src, "rb").read()).hexdigest()
    body = ",\n".join("  " + json.dumps([c, p, n], ensure_ascii=False) for c, p, n in municipalities)
    ts = f"""/**
 * 全国地方公共団体コード（市区町村。{as_of} 現在）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 総務省「都道府県コード及び市区町村コード」の Excel（{src.split('/')[-1]}。SHA-256 {digest}）
 * 出典    : 総務省ホームページ（{SOURCE_URL}）の「都道府県コード及び市区町村コード」を加工して作成
 *           （公共データ利用規約（第1.0版）。総務省が作成したものではありません）
 * 作り方  : python3 -I scripts/import_local_gov_codes.py <Excel> {as_of} <このファイル>
 * 中身    : [団体コード（6桁。6桁目は検査数字）, 都道府県名, 市区町村名]。政令指定都市は市（区は入れない）。東京都の特別区は区。
 */

export const LOCAL_GOV_CODES_AS_OF = "{as_of}";

export const LOCAL_GOV_CODES: [string, string, string][] = [
{body},
];
"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{len(municipalities)} 市区町村（都道府県 {len(prefectures)}）→ {out}")


if __name__ == "__main__":
    main()
