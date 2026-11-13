#!/usr/bin/env python3
"""
全銀協規定形式（給与・賞与振込）のレコードの形を、銀行の仕様書の PDF から読み取って、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_zengin_format.py \
        zengin-format/source/mufg/form_4_1_2_20080512.pdf \
        zengin-format/source/jp-bank/dataform_kyuyo.pdf \
        src/constants/zengin.ts

・1つ目（三菱UFJ銀行 BizSTATION「給与・賞与振込（全銀形式）レコードフォーマット」）から、ヘッダー・データ・トレーラー・エンドの
  各レコードの項目（名前・数字か文字か・バイト数）と、データ区分・種別コード・預金種目などの値を読む。
・2つ目（ゆうちょ銀行「給与振込媒体仕様説明書（ゆうちょBizダイレクト全銀形式）」）の、各項目の位置・桁数・属性と照らし合わせ、
  食い違えば止まる（ゆうちょ銀行は、レコードの終わりの「ダミー」を、処理結果を書く欄などに分けているので、その分は合計で比べる）。
・受取人名などに使える記号は、1つ目の許容記号のうち、2つ目の使用可能文字一覧にもあり、他金融機関あての従業員カナ名に
  使えない文字でないもの（どの銀行でも通るように、両方で使えるものだけにする）。
・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。全角は半角にする（NFKC）。
・AI や手作業で書き写さないための道具。各レコードのバイト数の合計が120でないとき、読めない行があるとき、2つが食い違うときは、
  ファイルを作らずに止まる。
・銀行の仕様書は銀行に著作権があるので、リポジトリには入れない（zengin-format/README.md の入手元から取ってくる）。
"""
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RECORD_LENGTH = 120
SECTIONS = ["header", "data", "trailer", "end"]


def pdf_lines(path, keep_spaces):
    """PDF の文字を行に分け、全角を半角にする（NFKC）。keep_spaces なら空白を1つにまとめ、そうでなければ空白を除く"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(path)], check=True, capture_output=True, text=True).stdout
    lines = []
    for line in out.splitlines():
        s = unicodedata.normalize("NFKC", line)
        s = re.sub(r"\s+", " ", s).strip() if keep_spaces else re.sub(r"\s+", "", s)
        if s:
            lines.append(s)
    return lines


def fail(message):
    sys.exit(f"止めました: {message}")


# ── 1つ目：三菱UFJ銀行（項目の名前・属性・バイト数と、値） ──────────────────────────
def read_mufg(path):
    lines = pdf_lines(path, keep_spaces=False)
    headings = {"1ヘッダーレコード": "header", "2データレコード": "data", "3トレーラーレコード": "trailer", "4エンドレコード": "end"}
    fields = {k: [] for k in SECTIONS}
    section = None
    text = "\n".join(lines)
    for line in lines:
        if line in headings:
            section = headings[line]
            continue
        if section is None:
            continue
        m = re.match(r"^(\d+)(.+?)([NC])\((\d+)\)(.*)$", line)
        if not m:
            continue
        no, name, attr, length = int(m.group(1)), m.group(2), m.group(3), int(m.group(4))
        if no != len(fields[section]) + 1:
            fail(f"{section} の項番が {no} です（{len(fields[section]) + 1} のはず）: {line}")
        fields[section].append({"name": name, "type": attr, "length": length})
    for k in SECTIONS:
        total = sum(f["length"] for f in fields[k])
        if not fields[k] or total != RECORD_LENGTH:
            fail(f"三菱UFJ銀行の {k} レコードのバイト数の合計が {total} です（{RECORD_LENGTH} のはず）")

    def one(pattern, what):
        found = re.findall(pattern, text)
        if len(set(found)) != 1:
            fail(f"{what} を1つに決められません: {found}")
        return found[0]

    values = {
        "record_kind": {
            "header": one(r"「(\d)」ヘッダーレコードをセット", "ヘッダーレコードのデータ区分"),
            "data": one(r"「(\d)」データレコードをセット", "データレコードのデータ区分"),
            "trailer": one(r"「(\d)」トレーラーレコードをセット", "トレーラーレコードのデータ区分"),
            "end": one(r"「(\d)」エンドレコードをセット", "エンドレコードのデータ区分"),
        },
        "kind_code": {"salary": one(r"(\d+):給与振込", "給与振込の種別コード"), "bonus": one(r"(\d+):賞与振込", "賞与振込の種別コード")},
        "code_jis": one(r"(\d):JIS", "コード区分（JIS）"),
        "account_type": {"ordinary": one(r"(\d):普通預金", "普通預金の預金種目"), "current": one(r"(\d):当座預金", "当座預金の預金種目")},
        "new_code": one(r"新規コードN\(1\)「(\d)」固定", "新規コード"),
    }
    m = re.search(r"※1許容記号:(.+?)スペース\((\d+)文字\)", text)
    if not m:
        fail("三菱UFJ銀行の許容記号（※1）が読めません")
    symbols, count = m.group(1), int(m.group(2))
    if len(symbols) + 1 != count:  # スペースを入れて count 文字
        fail(f"三菱UFJ銀行の許容記号の数が合いません（{symbols}・スペースで {count} 文字のはず）")
    values["mufg_symbols"] = symbols
    return fields, values


# ── 2つ目：ゆうちょ銀行（位置・桁数・属性） ──────────────────────────────────────
POSITION = re.compile(r"(?<!\S)(\d+)(?:~(\d+))? (\d+) ([9C])(?: ([○△-]))?(?!\S)")


def read_jp_bank(path):
    lines = pdf_lines(path, keep_spaces=True)
    headings = {"(1) ヘッダレコード": "header", "(2) データレコード": "data", "(3) トレーラレコード": "trailer", "(4) エンドレコード": "end"}
    fields = {k: [] for k in SECTIONS}
    section = None
    for line in lines:
        if line in headings:
            section = headings[line]
            continue
        if line.startswith("4 処理結果データ"):  # この後は、銀行から返ってくる処理結果の説明
            break
        if section is None:
            continue
        for m in POSITION.finditer(line):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else start
            fields[section].append({"start": start, "end": end, "length": int(m.group(3)), "type": "N" if m.group(4) == "9" else "C", "required": m.group(5) in ("○", "△")})
    for k in SECTIONS:
        pos = 1
        for f in fields[k]:
            if f["start"] != pos or f["end"] - f["start"] + 1 != f["length"]:
                fail(f"ゆうちょ銀行の {k} レコードの位置と桁数が合いません（{pos} から始まるはず）: {f}")
            pos = f["end"] + 1
        if pos != RECORD_LENGTH + 1:
            fail(f"ゆうちょ銀行の {k} レコードが {pos - 1} バイトで終わります（{RECORD_LENGTH} のはず）")

    text = "\n".join(pdf_lines(path, keep_spaces=False))
    m = re.search(r"5使用可能文字一覧(.+?)※カナ小文字は使用不可能", text, re.S)
    if not m:
        fail("ゆうちょ銀行の使用可能文字一覧が読めません")
    table = m.group(1)
    m = re.search(r"使用不可能文字.*?従業員カナ名(\S+)", text, re.S)
    if not m:
        fail("ゆうちょ銀行の、他金融機関あての従業員カナ名に使えない文字が読めません")
    return fields, table, m.group(1)


def compare(mufg, jp):
    """三菱UFJ銀行の項目と、ゆうちょ銀行の位置・桁数を照らし合わせる（終わりのダミーは合計で比べる）"""
    for k in SECTIONS:
        a, b = mufg[k], jp[k]
        tail = a[-1]
        if not tail["name"].startswith("ダミー"):
            fail(f"三菱UFJ銀行の {k} レコードの最後がダミーではありません: {tail}")
        head = a[:-1]
        if len(b) < len(head):
            fail(f"{k} レコードの項目の数が足りません（三菱UFJ {len(a)}・ゆうちょ {len(b)}）")
        for i, f in enumerate(head):
            g = b[i]
            if f["length"] != g["length"]:
                fail(f"{k} レコードの {i + 1} 番目（{f['name']}）のバイト数が違います（三菱UFJ {f['length']}・ゆうちょ {g['length']}）")
            # 任意（－）の項目は、銀行によって数字か文字かの書き方が違う（スペースでよい）ので、決まった値を入れる項目だけ比べる
            if g["required"] and f["type"] != g["type"]:
                fail(f"{k} レコードの {i + 1} 番目（{f['name']}）の属性が違います（三菱UFJ {f['type']}・ゆうちょ {g['type']}）")
        rest = sum(g["length"] for g in b[len(head):])
        if rest != tail["length"]:
            fail(f"{k} レコードの終わりのダミーの長さが違います（三菱UFJ {tail['length']}・ゆうちょ {rest}）")


def ts_fields(name, fields):
    rows = ",\n".join(f'  {{ name: "{f["name"]}", type: "{f["type"]}", length: {f["length"]} }}' for f in fields)
    return f"export const {name}: ZenginField[] = [\n{rows},\n];\n"


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    mufg_pdf, jp_pdf, out = sys.argv[1:4]
    mufg, values = read_mufg(mufg_pdf)
    jp, jp_table, jp_name_ng = read_jp_bank(jp_pdf)
    compare(mufg, jp)
    # 受取人名などに使える記号：三菱UFJの許容記号のうち、ゆうちょの使用可能文字一覧にもあり、従業員カナ名に使えない文字でないもの
    symbols = "".join(c for c in values["mufg_symbols"] if c in jp_table and c not in jp_name_ng)
    if not symbols:
        fail("両方の銀行で使える記号がありません")
    v = values
    source = "\n".join([
        "/**",
        " * 全銀協規定形式（給与・賞与振込）のレコードの形（scripts/import_zengin_format.py が銀行の仕様書の PDF から作る。手で直さない）",
        " * 出典: 三菱UFJ銀行 BizSTATION「給与・賞与振込（全銀形式）レコードフォーマット」（form_4_1_2_20080512.pdf）",
        " * 照らし合わせ: ゆうちょ銀行「給与振込媒体仕様説明書（ゆうちょBizダイレクト全銀形式）」1.1版（dataform_kyuyo.pdf）",
        " * 入手元と SHA-256 は zengin-format/README.md",
        " */",
        "",
        "/** 項目（type は N：数字（右詰め・前を0で埋める）／C：文字（左詰め・後ろをスペースで埋める）。length はバイト数） */",
        "export interface ZenginField {",
        "  name: string;",
        '  type: "N" | "C";',
        "  length: number;",
        "}",
        "",
        f"/** 1レコードのバイト数 */\nexport const ZENGIN_RECORD_LENGTH = {RECORD_LENGTH};",
        "",
        "/** ヘッダーレコード */",
        ts_fields("ZENGIN_HEADER", mufg["header"]),
        "/** データレコード（振込1件） */",
        ts_fields("ZENGIN_DATA", mufg["data"]),
        "/** トレーラーレコード */",
        ts_fields("ZENGIN_TRAILER", mufg["trailer"]),
        "/** エンドレコード */",
        ts_fields("ZENGIN_END", mufg["end"]),
        "/** データ区分 */",
        f'export const ZENGIN_RECORD_KIND = {{ header: "{v["record_kind"]["header"]}", data: "{v["record_kind"]["data"]}", trailer: "{v["record_kind"]["trailer"]}", end: "{v["record_kind"]["end"]}" }} as const;',
        "",
        "/** 種別コード（給与振込・賞与振込） */",
        f'export const ZENGIN_KIND_CODE = {{ salary: "{v["kind_code"]["salary"]}", bonus: "{v["kind_code"]["bonus"]}" }} as const;',
        "",
        "/** コード区分（JIS） */",
        f'export const ZENGIN_CODE_JIS = "{v["code_jis"]}";',
        "",
        "/** 預金種目（普通預金・当座預金） */",
        f'export const ZENGIN_ACCOUNT_TYPE = {{ ordinary: "{v["account_type"]["ordinary"]}", current: "{v["account_type"]["current"]}" }} as const;',
        "",
        "/** 新規コード */",
        f'export const ZENGIN_NEW_CODE = "{v["new_code"]}";',
        "",
        "/** 受取人名・依頼人名などに使える記号（数字・英大文字・半角カナ・スペースのほか。両方の銀行で使えるものだけ） */",
        f'export const ZENGIN_NAME_SYMBOLS = "{symbols}";',
        "",
    ])
    Path(out).write_text(source, encoding="utf-8")
    print(f"{out} を作りました（記号：{symbols}）")


if __name__ == "__main__":
    main()
