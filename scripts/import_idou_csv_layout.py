#!/usr/bin/env python3
"""
地方税共同機構「給与所得者異動届出書CSVレイアウト仕様書」の Excel から、
eLTAX に取り込む給与所得者異動届出書の CSV の項目（Q で使うデータファイル。TypeScript）を作る。

使い方:
    python3 -I scripts/import_idou_csv_layout.py \
        <給与所得者異動届出書CSVレイアウト仕様書　令和3年4月1日～.xlsx> \
        src/constants/residentTaxIdouCsvLayout.ts

・AI や手作業で項目を書き写さないための道具。番号・名前・必須・書く条件・文字属性・文字数・コードと、元号の数字・使えない文字は、
  すべて Excel の表から機械的に読み取る。
・Excel は地方税共同機構「仕様書・様式集（電子申告・申請・届出）」（https://www.lta.go.jp/support/documents/01/）の
  「給与所得者異動届出書CSVレイアウト仕様書 令和3年4月1日～」（https://www.lta.go.jp/documents/05122）。
  著作権は地方税共同機構にあるので、Excel そのものはリポジトリに入れない。
・書く条件の列は「現年度・両年度」の「特徴継続」「一括徴収」「普通徴収」と「新年度」の4つ。表では、徴収の方法で変わらない項目は
  「特徴継続」の列にだけ書いてあり（「一括徴収」「普通徴収」は空）、新年度で変わらない項目は「新年度」の列が空なので、
  空の列は「特徴継続」の列と同じとして読む（例：1番「ファイルの種類」は4つとも「必須」）。
・コードは「データの意味」の欄の「1：退職」「「1：必要」」「…場合は「0」」の形から読む。
・次のときはエラーで止まる（中途半端なデータは作らない）
    - 1枚目のシートが「給与所得者異動届出書」でない、表題・見出しの行の形が違う、2枚目に「「年度」欄判定フロー」がない
    - 項目の番号が 1 から順に並んでいない、名前がない、文字数が正の整数でない
    - 必須の欄が「○」「△」・空 以外、文字属性が 数字・半角・全角 以外、書く条件が想定外の言い方
    - コードID のある項目のコードの数が、表の「備考」の範囲（「1～3の範囲内」「0 or 1」など）と合わない
    - 1番の「L01」・元号の数字（昭和・大正・明治・平成・令和）・使えない文字の凡例を読めない
・標準ライブラリだけで動く（追加のインストールは要らない）。
"""
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

SOURCE_URL = "https://www.lta.go.jp/documents/05122"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
ATTRS = {"数字", "半角", "全角"}
REQUIRED = {"○", "△", ""}
MODES = [("F", "tokucho"), ("G", "ikkatsu"), ("H", "futsu"), ("I", "newYear")]


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
    sheets = []
    for sh in wb.find("m:sheets", NS):
        target = rels[sh.get("{%s}id" % NS["r"])]
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
        sheets.append((sh.get("name"), rows))
    return sheets


def condition(text, no):
    """書く条件の欄を読む。必須・任意・設定不可と、条件付きのもの（「…が⏎1の場合は必須⏎0の場合は任意」）は文のまま"""
    t = re.sub(r"\s+", "", text)
    if t in ("必須", "任意", "設定不可"):
        return t
    if re.fullmatch(r".+の場合は(必須|任意|設定不可).+の場合は(必須|任意|設定不可)", t):
        return t
    sys.exit(f"{no}番の書く条件が想定外の言い方: {text}")


def codes_of(meaning, no):
    """「データの意味」から、コードと意味を読む"""
    found = []
    for code, label in re.findall(r"(?:^|\n)(\d)：([^\n]+)", meaning):
        found.append({"code": code, "label": label.strip()})
    if not found:
        # 「…（新規）が「1：新規」の場合のみ、該当する納入書の要否の「1：必要」又は「2：不要」を記録する」：
        # 前の「1：新規」は条件なので、「該当する」より後ろを読む
        tail = meaning.rsplit("該当する", 1)[-1]
        for code, label in re.findall(r"「(\d)：([^」]+)」", tail):
            found.append({"code": code, "label": label.strip()})
    if not found:
        # 「…から指定されている場合は「0」を、指定されたことがない場合は「1」を記録する」
        for label, code in re.findall(r"([^、。「」]+?)場合は「(\d)」", meaning):
            # 「新しい勤務先（特別徴収義務者）が」の主語だけ除く
            label = re.sub(r"^.*?）が", "", label.strip())
            found.append({"code": code, "label": label})
    codes = [c["code"] for c in found]
    if len(set(codes)) != len(codes):
        sys.exit(f"{no}番のコードが重なっている: {found}")
    return found


def code_range(note, no):
    """備考の「1～3の範囲内であること」「0 or 1であること」「1 or 2であること」から、コードの並び"""
    m = re.search(r"(\d)～(\d)の範囲内", note)
    if m:
        return [str(i) for i in range(int(m.group(1)), int(m.group(2)) + 1)]
    m = re.search(r"(\d) or (\d)であること", note)
    if m:
        return [m.group(1), m.group(2)]
    sys.exit(f"{no}番の備考からコードの範囲を読めない: {note}")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1:]
    sheets = read_sheets(src)
    if len(sheets) < 2 or sheets[0][0] != "給与所得者異動届出書" or sheets[1][0] != "「年度」欄判定フロー":
        sys.exit(f"シートの名前が違う: {[s[0] for s in sheets]}")
    rows = sheets[0][1]
    title = re.sub(r"\s+", " ", rows.get(1, {}).get("A", "")).strip()
    if title.replace(" ", "").replace("　", "") != "給与所得者異動届出書CSVファイルレイアウト":
        sys.exit(f"表題が違う: {title}")
    h2, h3, h4 = rows.get(2, {}), rows.get(3, {}), rows.get(4, {})
    head = (h2.get("A"), h2.get("B"), h2.get("D"), h2.get("M"), h2.get("N"), h3.get("E"), h3.get("F"), h3.get("I"),
            h3.get("J"), h3.get("K"), h3.get("L"), h4.get("F"), h4.get("G"), h4.get("H"))
    if head != ("No.", "CSV項目名称", "データの意味", "コードID", "備考", "必須", "現年度・両年度", "新年度", "型", "文字属性", "文字数",
                "特徴継続", "一括徴収", "普通徴収"):
        sys.exit(f"見出しの行の形が違う: {head}")

    fields = []
    group = ""
    for r in sorted(rows):
        cells = rows[r]
        if r < 5 or not re.fullmatch(r"\d+", cells.get("A", "")):
            continue
        no = int(cells["A"])
        if no != len(fields) + 1:
            sys.exit(f"項目の番号が順に並んでいない: {r}行目 {no}")
        b, c = cells.get("B", ""), cells.get("C", "")
        if c:
            if b:
                group = re.sub(r"※\d+$", "", b).strip()
            name = c
        else:
            group = ""
            name = b
        if not name:
            sys.exit(f"{no}番の名前がない")
        required = cells.get("E", "")
        if required not in REQUIRED:
            sys.exit(f"{no}番の必須の欄が想定外: {required}")
        attr = cells.get("K", "").split("\n")[-1].strip()
        if attr not in ATTRS:
            sys.exit(f"{no}番の文字属性が想定外: {attr}")
        length = cells.get("L", "")
        if not re.fullmatch(r"[1-9]\d*", length):
            sys.exit(f"{no}番の文字数が正の整数でない: {length}")
        base = condition(cells.get("F", ""), no)
        when = {}
        for col, key in MODES:
            raw = cells.get(col, "")
            when[key] = condition(raw, no) if raw else base
        meaning = cells.get("D", "")
        note = cells.get("N", "")
        code_id = cells.get("M", "")
        field = {"no": no, "group": group, "name": name, "required": required, "when": when, "attr": attr, "max": int(length)}
        if cells.get("J"):
            field["type"] = cells["J"]
        if code_id:
            codes = codes_of(meaning, no)
            expect = code_range(note, no)
            if [c["code"] for c in codes] != expect:
                sys.exit(f"{no}番のコード {[c['code'] for c in codes]} が、備考の範囲 {expect} と合わない")
            field["codeId"] = code_id
            field["codes"] = codes
        fields.append(field)

    if len(fields) == 0:
        sys.exit("項目が1つもない")

    # 1番：ファイルの種類（「L01」を記録する）
    m = re.search(r"「([A-Z]\d\d)」を記録する", rows_meaning(rows, 1))
    if not m or fields[0]["name"] != "ファイルの種類":
        sys.exit("1番のファイルの種類（「L01」）を読めない")
    file_kind = m.group(1)

    # 元号の数字（生年月日の欄の説明：昭和は「1」、大正は「2」…）
    eras = dict(re.findall(r"(昭和|大正|明治|平成|令和)は「(\d)」", rows_meaning(rows, 7)))
    if sorted(eras) != sorted(["昭和", "大正", "明治", "平成", "令和"]):
        sys.exit(f"元号の数字を読めない: {eras}")

    # 文字属性の凡例：全角で使えない文字・半角で使えない文字
    legend = "\n".join(v for cells in rows.values() for v in cells.values())
    m = re.search(r"使用不可となっている文字（([^）]+)）", legend)
    if not m:
        sys.exit("全角の項目で使えない文字の凡例を読めない")
    zen_ng = [ch.strip() for ch in m.group(1).split("、") if ch.strip()]
    han_ng = re.findall(r"\"(.)\"（", legend)
    if len(zen_ng) < 5 or sorted(han_ng) != sorted([",", "@"]):
        sys.exit(f"使えない文字の凡例が想定外: 全角 {zen_ng} 半角 {han_ng}")

    digest = hashlib.sha256(open(src, "rb").read()).hexdigest()
    body = ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in fields)
    ts = f"""/**
 * eLTAX に取り込む給与所得者異動届出書の CSV の項目（{len(fields)}項目。この順に、カンマで区切って1行に1枚の届出書）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 地方税共同機構「{title}」の Excel（{src.split('/')[-1]}。SHA-256 {digest}）
 * 出典    : 地方税共同機構「仕様書・様式集」 給与所得者異動届出書CSVレイアウト仕様書 令和3年4月1日～（{SOURCE_URL}）
 * 作り方  : python3 -I scripts/import_idou_csv_layout.py <Excel> <このファイル>
 * 中身    : no 項目の番号 / group まとまり（「特別徴収継続の場合」など）/ name CSV項目名称 /
 *           required 必須（○：いつも必須。△：条件によって必須。空：任意）/
 *           when 書く条件（年度が「1：現年度」「3：両年度」で、徴収の方法が特別徴収継続（tokucho）・一括徴収（ikkatsu）・
 *           普通徴収（futsu）のときと、年度が「2：新年度」のとき（newYear）。表で空の列は「特徴継続」の列と同じ）/
 *           type 型 / attr 文字属性（数字・半角・全角）/ max 文字数 / codeId コードID / codes コードと意味（「データの意味」から）
 */

export interface IdouCsvField {{
  no: number;
  group: string;
  name: string;
  required: "○" | "△" | "";
  when: {{ tokucho: string; ikkatsu: string; futsu: string; newYear: string }};
  type?: string;
  attr: "数字" | "半角" | "全角";
  max: number;
  codeId?: string;
  codes?: {{ code: string; label: string }}[];
}}

export const IDOU_CSV_TITLE = {json.dumps(title, ensure_ascii=False)};

/** 1番「ファイルの種類」に書く値 */
export const IDOU_FILE_KIND = {json.dumps(file_kind)};

/** 元号の数字（生年月日・期間・年月日の「元号」の項目） */
export const IDOU_ERA_CODES: Record<string, string> = {json.dumps(eras, ensure_ascii=False)};

/** 全角の項目で使えない文字（e-Tax で使えない文字） */
export const IDOU_NG_ZENKAKU: string[] = {json.dumps(zen_ng, ensure_ascii=False)};

/** 半角の項目で使えない文字（CSV の区切りに使うため） */
export const IDOU_NG_HANKAKU: string[] = {json.dumps(han_ng, ensure_ascii=False)};

export const IDOU_CSV_FIELDS: IdouCsvField[] = [
{body},
];
"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"{len(fields)} 項目 → {out}")


def rows_meaning(rows, no):
    for cells in rows.values():
        if cells.get("A") == str(no):
            return cells.get("D", "")
    return ""


if __name__ == "__main__":
    main()
