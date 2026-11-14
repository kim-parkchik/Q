#!/usr/bin/env python3
"""
健康保険・厚生年金保険の届書の電子申請用ファイル（CSV形式届書ファイル。年金事務所提出の SHFD0006.CSV）の形を、
厚生労働省・日本年金機構の仕様書の PDF から読み取って、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_shaho_format.py shaho-format/source/specs081001_17.0.pdf src/constants/shahoTodoke.ts

読むもの（「CSV形式届書作成仕様書（電子申請）・電子媒体届書作成仕様書（CD/DVD仕様書）（健康保険・厚生年金保険適用関係届書）」）:
・表紙の版（令和8年10月（第17.0版）など）
・3.1.1 ファイル名（年金事務所提出の CSV 形式届書ファイルの名前）
・表3.3-1 ファイルの構成要素（事業所識別符号・データ識別符号）
・表3.4-2 使用可能文字一覧（1バイト文字）・表3.4-3 使用可能コード範囲（2バイト文字）
・4.1.1 媒体管理レコード（年金事務所提出）の項目構成（図4.1.1-1）と項目説明（表4.1.1-1。代表届書コード）
・4.3.1 事業所数情報の項目説明（表4.3.1-1）
・4.3.2.1 事業所情報（年金事務所提出）の項目構成（図4.3.2.1-1）と項目説明（表4.3.2.1-1）
・4.9.1 賞与支払届・70歳以上被用者賞与支払届データレコード（年金事務所提出）の項目構成（図4.9.1-1）と
  項目説明（表4.9.1-1。様式コード・元号のコード）
・参考資料3 都道府県コード一覧（全国地方公共団体コードとは違う。東京都は 21）

・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。全角は半角にし（NFKC）、空白を1つにまとめて読む。
・表の枠がつながっている項目（事業所整理記号・生年月日・基礎年金番号など）は、PDF から取り出した字の並びが崩れるので、
  項目ごとに並びを決めて読む。どれか1つでも読めないとき、項目構成の図と項目説明の数が合わないとき、都道府県が47でないとき、
  使える字の数が合わないときは、ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
・仕様書（約16MB）はリポジトリに入れない（shaho-format/README.md の入手元から取ってくる）。
"""
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


def read_pages(pdf):
    """ページごとの文字（NFKC で全角を半角にし、空白を1つにまとめる）"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(pdf)], check=True, capture_output=True, text=True).stdout
    pages = {}
    for m in re.finditer(r"=== page (\d+) ===\n(.*?)(?==== page \d+ ===|\Z)", out, re.S):
        pages[int(m.group(1))] = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", m.group(2))).strip()
    if not pages:
        fail("PDF から文字を取り出せません")
    return pages


def find_page(pages, needle, start=1):
    """needle を含む最初のページ（目次のページは除く）"""
    for no in sorted(pages):
        if no >= start and needle in pages[no] and "・・・" not in pages[no]:
            return no
    fail(f"「{needle}」が書いてあるページが見つかりません")


def table_text(pages, caption):
    """表の見出し（「表4.9.1-1 …の項目説明」）があるページを続けてつなぐ"""
    nos = [no for no in sorted(pages) if caption in pages[no] and "・・・" not in pages[no]]
    if not nos:
        fail(f"「{caption}」の表が見つかりません")
    return " ".join(pages[no] for no in nos)


def search(pattern, text, what):
    m = re.search(pattern, text)
    if not m:
        fail(f"{what}を読めません（仕様書の書き方が変わったかもしれません。中身を読んでから、このスクリプトを直してください）")
    return m


def figure_names(pages, caption):
    """項目構成の図（「【様式コード】,【都道府県コード】,…↓ 図4.9.1-1…」）の項目の名前（順番どおり）"""
    no = find_page(pages, caption)
    text = pages[no]
    end = text.index(caption)
    start = text.rfind("[data]", 0, end)
    names = re.findall(r"【([^】]+)】", text[start if start >= 0 else 0:end])
    if not names:
        fail(f"{caption}の項目の名前を読めません")
    return names


KIND_WORDS = ("数字", "英字", "カナ", "漢字", "-")


def field(name, kinds, length, alt=None):
    """種別（「数字」「数字 英字 カナ」）と文字数（「7」「1~4」「0~6」「0,12」）から、項目の決まりを作る"""
    ks = kinds.split()
    if not ks or any(k not in KIND_WORDS for k in ks):
        fail(f"{name}の種別「{kinds}」を読めません")
    if re.fullmatch(r"\d+", length):
        n = int(length)
        lengths = {"min": n, "max": n}
    elif re.fullmatch(r"\d+~\d+", length):
        a, b = map(int, length.split("~"))
        lengths = {"min": a, "max": b}
    elif re.fullmatch(r"\d+,\d+", length):
        a, b = map(int, length.split(","))
        lengths = {"min": a, "max": b, "only": [a, b]}
    else:
        fail(f"{name}の文字数「{length}」を読めません")
    f = {"name": name, "kinds": ks, **lengths}
    if alt:
        f["alt"] = alt
    return f


def check_names(fields, names, what):
    if [f["name"] for f in fields] != names:
        fail(f"{what}の項目構成の図と、読んだ項目説明の並びが合いません:\n図: {names}\n説明: {[f['name'] for f in fields]}")


def office_symbol_fields(m, names):
    """事業所整理記号（都道府県コード・郡市区符号・事業所記号）の3つ"""
    return [
        field(names[0], m.group("k1"), m.group("n1")),
        field(names[1], m.group("k2"), m.group("n2")),
        field(names[2], m.group("k3"), m.group("n3")),
    ]


def read_media_record(pages):
    names = figure_names(pages, "図4.1.1-1 媒体管理レコード(年金事務所提出)の項目構成")
    t = table_text(pages, "表4.1.1-1 媒体管理レコード(年金事務所提出)の項目説明")
    m = search(
        r"1 都道府 県コー ド (?P<k1>数字) 提 2 郡市区 符号 出 元 3 事業所 I 記号 D (?P<k2>数字) (?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) イ "
        r"事業所記号に分けて設定する ア (?P<k3>数字 英字 カナ) .*? (?P<n3>[\d~]+) ウ ", t, "媒体管理レコードの事業所整理記号")
    fields = office_symbol_fields(m, names[0:3])
    m = search(r"4 媒体通番 別 (数字) 情 報 (\d+) 媒体通番は", t, "媒体通番")
    fields.append(field(names[3], m.group(1), m.group(2)))
    m = search(r"5 作成年月日 (数字) (\d+) ファイルの作成年月日\(西暦\)", t, "作成年月日")
    fields.append(field(names[4], m.group(1), m.group(2)))
    m = search(r"6 代表届書コード (数字) (\d+) 「(\d+)」を設定する", t, "代表届書コード")
    fields.append(field(names[5], m.group(1), m.group(2)))
    code = m.group(3)
    check_names(fields, names, "媒体管理レコード")
    return fields, code


def read_office_count(pages):
    t = table_text(pages, "表4.3.1")
    m = search(r"2 事業所情報数 (数字) ([\d~]+) 「(\d+)」を設定する", t, "事業所情報数")
    return field("事業所情報数", m.group(1), m.group(2)), m.group(3)


def read_office_record(pages):
    names = figure_names(pages, "図4.3.2.1-1 事業所情報(年金事務所提出)の項目構成")
    t = table_text(pages, "事業所情報(年金事務所提出)の項目説明")
    m = search(
        r"1 都 道 府 県 コ ード (?P<k1>数字) 事 業 2 郡市区 符号 所 整 3 事業所 理 記号 記 号 (?P<k2>数字) (?P<n1>\d+) 都道府県コードは.*? "
        r"(?P<n2>\d+) イ 外を事業所記号に分けて設定する ア (?P<k3>数字 英字 カナ) .*? (?P<n3>[\d~]+) ウ ", t, "事業所情報の事業所整理記号")
    fields = office_symbol_fields(m, names[0:3])
    m = search(r"4 事業所番号 (数字) ([\d~]+) 「納入告知書", t, "事業所番号")
    fields.append(field(names[3], m.group(1), m.group(2)))
    m = search(r"5 親番号 (数字) 郵 便 番 6 子番号 号 (数字) (\d+) 事業所所在地の郵便番号を.*? (\d+) カ ", t, "郵便番号")
    fields.append(field(names[4], m.group(1), m.group(3)))
    fields.append(field(names[5], m.group(2), m.group(4)))
    m = search(r"7 事業所所在地 (漢字) ([\d~]+) (数字 英字 カナ) ([\d~]+) 事業所所在地を", t, "事業所所在地")
    fields.append(field(names[6], m.group(1), m.group(2), field("カナで書くとき", m.group(3), m.group(4))))
    m = search(r"8 事業所名称 (漢字) ([\d~]+) (カナ) ([\d~]+) 事業所名称を", t, "事業所名称")
    fields.append(field(names[7], m.group(1), m.group(2), field("カナで書くとき", m.group(3), m.group(4))))
    m = search(r"9 事業主氏名 (漢字) ([\d~]+) (カナ) ([\d~]+) 事業主氏名を", t, "事業主氏名")
    fields.append(field(names[8], m.group(1), m.group(2), field("カナで書くとき", m.group(3), m.group(4))))
    m = search(r"10 局番1 (数字) ([\d~]+) 事業所の電話番号\(市外局番等\)", t, "局番1")
    fields.append(field(names[9], m.group(1), m.group(2)))
    m = search(r"11 12 電 話 番 号 局番2 (数字) ([\d~]+) 事業所の電話番号\(市内局番等\).*? 局番3 (数字) ([\d~]+) 事業所の電話番号\(番号\)", t, "局番2・局番3")
    fields.append(field(names[10], m.group(1), m.group(2)))
    fields.append(field(names[11], m.group(3), m.group(4)))
    check_names(fields, names, "事業所情報")
    return fields


def eras(text, what):
    found = re.findall(r"・(\S+?):「(\d)」", text)
    if not found:
        fail(f"{what}の元号のコードを読めません")
    return {name: code for name, code in found}


def read_bonus_record(pages):
    names = figure_names(pages, "図4.9.1-1賞与支払届・70歳以上被用者賞与支払届データレコード(年金事務所提出)の項目構成")
    t = table_text(pages, "表4.9.1-1 賞与支払届・70歳以上被用者賞与支払届データレコード(年金事務所提出)の項目説明")
    fields = []
    m = search(r"1 様式コード (数字) (\d+) 「(\d+)」を設定する", t, "様式コード")
    fields.append(field(names[0], m.group(1), m.group(2)))
    form_code = m.group(3)
    m = search(
        r"2 都 道 府 県 コード (?P<k1>数字) イ 事 3 郡市区符号 業 所 整 4 事業所記号 理 記 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) "
        r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>[\d~]+) エ ", t, "賞与支払届の事業所整理記号")
    fields += office_symbol_fields(m, names[1:4])
    for no, label, pattern in [
        (4, "被保険者整理番号", r"5 被保険者 整理番号 (数字) ([\d~,]+) 「被保険者資格取得確認"),
        (5, "被保険者氏名(カナ)", r"6 被保険者氏名 \(カナ\) (カナ) ([\d~,]+) 被保険者氏名を設定する"),
        (6, "被保険者氏名(漢字)", r"7 被保険者氏名 \(漢字\) (漢字) ([\d~,]+) 被保険者氏名を漢字で"),
    ]:
        m = search(pattern, t, label)
        fields.append(field(names[no], m.group(1), m.group(2)))
    m = search(r"8 元号 (数字) 生 年 月 9 年月日 日 (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)ク (数字) (\d+) 生年月日\(和暦\)", t, "生年月日")
    fields.append(field(names[7], m.group(1), m.group(2)))
    fields.append(field(names[8], m.group(4), m.group(5)))
    birth_eras = eras(m.group(3), "生年月日")
    m = search(r"10 元号 (数字) 11 賞 与 支 払 年 月 日 (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)コ 年月日 (数字) (\d+) 賞与の支給を行った", t, "賞与支払年月日")
    fields.append(field(names[9], m.group(1), m.group(2)))
    fields.append(field(names[10], m.group(4), m.group(5)))
    pay_eras = eras(m.group(3), "賞与支払年月日")
    m = search(r"12 通貨によるもの の額 (数字) ([\d~]+) 通貨\(金銭\)で支払われた", t, "通貨によるものの額")
    fields.append(field(names[11], m.group(1), m.group(2)))
    m = search(r"(数字) 13 種別 現物によるもの の額 文字数 設 定 内 容 作成例 ([\d~]+) 賞与のうち物品など", t, "現物によるものの額")
    fields.append(field(names[12], m.group(1), m.group(2)))
    m = search(r"14 合計\(賞与額\) (数字) ([\d~]+) 「通貨によるものの額」", t, "合計(賞与額)")
    fields.append(field(names[13], m.group(1), m.group(2)))
    m = search(r"15 個人番号 (数字) ([\d,]+) 被保険者が「70歳以上被用者」", t, "個人番号")
    fields.append(field(names[14], m.group(1), m.group(2)))
    m = search(r"課所符号 (数字) ([\d,]+) タ 16 基 礎 年 金 番 号 17 一連番号 (数字) 個人番号を入力した場合は.*? ([\d,]+) チ ", t, "基礎年金番号")
    fields.append(field(names[15], m.group(1), m.group(2)))
    fields.append(field(names[16], m.group(3), m.group(4)))
    for no, pattern in [
        (17, r"18 備考欄項目1 (数字) ([\d,]+) 70歳以上被用者の場合は「1」"),
        (18, r"19 備考欄項目2 (数字) ([\d,]+) 二以上事業所勤務者の場合は「1」"),
        (19, r"20 備考欄項目3 (数字) ([\d,]+) 同一月内の賞与合算の場合は初回支払日"),
        (20, r"21 70歳以上被用者 届のみ提出 (数字) ([\d,]+) 70歳以上被用者賞与支払届のみを提出する場合"),
    ]:
        m = search(pattern, t, names[no])
        fields.append(field(names[no], m.group(1), m.group(2)))
    check_names(fields, names, "賞与支払届データレコード")
    return fields, form_code, birth_eras, pay_eras


def read_prefectures(pages):
    no = find_page(pages, "都道府県コード一覧 No 都道府県コード 漢字都道府県名")
    rows = re.findall(r"(\d+) (\d{2}) (\S+?[都道府県])(?= |$)", pages[no])
    codes = {name: code for _, code, name in rows}
    if len(rows) != 47 or len(codes) != 47 or len(set(codes.values())) != 47 or [int(n) for n, _, _ in rows] != list(range(1, 48)):
        fail(f"都道府県コード一覧を読めません（{len(rows)}件）")
    return codes


def read_single_byte_chars(pages):
    """表3.4-2 の1バイト文字のうち、項目に書ける字（数字・英字・半角カナ・ハイフン・スペース）"""
    no = find_page(pages, "表3.4-2 使用可能文字一覧(1バイト文字)")
    text = pages[no]
    body = text[text.index("表3.4-2"):text.index("◎")]
    half = {unicodedata.normalize("NFKC", chr(c)): chr(c) for c in range(0xFF61, 0xFFA0)}
    chars = set()
    for token in body.split(" "):
        if len(token) != 1:
            continue
        if re.fullmatch(r"[0-9A-Za-z]", token):
            chars.add(token)
        elif token in half:
            chars.add(half[token])
    if "- (ハイフン)" in body:
        chars.add("-")
    if "“SP”「20(16進)」はスペースでのみ使用可能" in text:
        chars.add(" ")
    digits = [c for c in chars if c.isdigit()]
    upper = [c for c in chars if "A" <= c <= "Z"]
    lower = [c for c in chars if "a" <= c <= "z"]
    kana = [c for c in chars if "｡" <= c <= "ﾟ"]
    if (len(digits), len(upper), len(lower), len(kana)) != (10, 26, 26, 58) or "-" not in chars or " " not in chars:
        fail(f"1バイト文字の一覧を読めません（数字{len(digits)}・英大文字{len(upper)}・英小文字{len(lower)}・カナ{len(kana)}）")
    return "".join(sorted(chars, key=ord))


def read_double_byte_ranges(pages):
    """表3.4-3 の「使用可能コード範囲」（使える2バイト文字のシフトJISのコード）"""
    no = find_page(pages, "表3.4-3 使用可能コード範囲(2バイト文字)")
    text = pages[no]
    ranges = []
    for m in re.finditer(r"(?:全て使用可|一部使用不可) ((?:(?:※\d )?[0-9A-F]{4}(?:~[0-9A-F]{4})? )+)", text):
        for a, b in re.findall(r"([0-9A-F]{4})(?:~([0-9A-F]{4}))?", m.group(1)):
            ranges.append([int(a, 16), int(b or a, 16)])
    if len(ranges) < 10 or not any(a == 0x889F for a, _ in ranges) or not any(b == 0xEAA4 for _, b in ranges):
        fail(f"2バイト文字の使用可能コード範囲を読めません（{len(ranges)}件）")
    if "XX7F" not in text or "XXFD~XX3F" not in text or "A0XX~DFXX" not in text:
        fail("2バイト文字の、使えないコード（XX7F・XXFD~XX3F・A0XX~DFXX）の注を読めません")
    return ranges


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_shaho_format.py <仕様書の PDF> <出力の TypeScript>")
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    pages = read_pages(pdf)
    m = search(r"令和 ?(\d+)年(\d+)月\((第[\d.]+版)\) CSV形式届書作成仕様書\(電子申請\)", pages.get(1, ""), "仕様書の版")
    version = f"令和{m.group(1)}年{m.group(2)}月（{m.group(3)}）"
    no = find_page(pages, "3.1.1 年金事務所提出")
    file_name = search(r"\(2\)CSV形式届書ファイルのファイル名 (\S+?\.CSV)", pages[no], "CSV形式届書ファイルの名前").group(1)
    no = find_page(pages, "表3.3-1 ファイルの構成要素(1/2)")
    office_mark = search(r"事業所識別符号 媒体管理レコードと事業所管理 レコードの境を示す符号である 必ず収録する “(\[\w+\])”と設定する", pages[no], "事業所識別符号").group(1)
    data_mark = search(r"データ識別符号 事業所管理レコードとデータレ コードの境を示す符号である 必ず収録する “(\[\w+\])”と設定する", pages[no], "データ識別符号").group(1)
    media_fields, representative_code = read_media_record(pages)
    count_field, office_count = read_office_count(pages)
    office_fields = read_office_record(pages)
    bonus_fields, bonus_code, birth_eras, pay_eras = read_bonus_record(pages)
    prefectures = read_prefectures(pages)
    single = read_single_byte_chars(pages)
    double = read_double_byte_ranges(pages)

    def js(value):
        return json.dumps(value, ensure_ascii=False)

    def fields_ts(fields):
        return "[\n" + "".join(f"  {js(f)},\n" for f in fields) + "]"

    ranges_ts = ", ".join(f"[0x{a:04X}, 0x{b:04X}]" for a, b in double)
    ts = f"""/**
 * 健康保険・厚生年金保険の届書の電子申請用ファイル（CSV形式届書ファイル。年金事務所提出）の形
 *
 * このファイルは scripts/import_shaho_format.py が、厚生労働省・日本年金機構の仕様書の PDF から作ったものです（手で直さない）。
 * 仕様書：「CSV形式届書作成仕様書（電子申請）・電子媒体届書作成仕様書（CD/DVD仕様書）（健康保険・厚生年金保険適用関係届書）」
 * {version}。入手元と SHA-256 は shaho-format/README.md
 */

/** 仕様書の版 */
export const SHAHO_SPEC_VERSION = {js(version)};
/** 年金事務所に出す CSV 形式届書ファイルの名前（3.1.1） */
export const SHAHO_FILE_NAME = {js(file_name)};
/** 事業所識別符号・データ識別符号（表3.3-1） */
export const SHAHO_OFFICE_MARK = {js(office_mark)};
export const SHAHO_DATA_MARK = {js(data_mark)};
/** 代表届書コード（表4.1.1-1） */
export const SHAHO_REPRESENTATIVE_CODE = {js(representative_code)};
/** 事業所情報数（表4.3.1-1。事業所が出すとき） */
export const SHAHO_OFFICE_COUNT = {js(office_count)};
/** 賞与支払届・70歳以上被用者賞与支払届の様式コード（表4.9.1-1） */
export const SHAHO_BONUS_FORM_CODE = {js(bonus_code)};

/**
 * 項目の決まり（第4章の項目説明）
 * kinds：種別（数字・英字・カナ・漢字。「-」は省略する項目）／min・max：文字数（min が 0 なら省略できる）／
 * only：この文字数だけ（「0,12」は 0 文字（省略）か 12 文字）／alt：漢字で書けないときにカナなどで書くときの決まり
 */
export interface ShahoField {{
  name: string;
  kinds: string[];
  min: number;
  max: number;
  only?: number[];
  alt?: ShahoField;
}}

/** 媒体管理レコード（年金事務所提出。図4.1.1-1・表4.1.1-1） */
export const SHAHO_MEDIA_FIELDS: ShahoField[] = {fields_ts(media_fields)};

/** 事業所数情報の事業所情報数（表4.3.1-1） */
export const SHAHO_OFFICE_COUNT_FIELD: ShahoField = {js(count_field)};

/** 事業所情報（年金事務所提出。図4.3.2.1-1・表4.3.2.1-1） */
export const SHAHO_OFFICE_FIELDS: ShahoField[] = {fields_ts(office_fields)};

/** 賞与支払届・70歳以上被用者賞与支払届データレコード（年金事務所提出。図4.9.1-1・表4.9.1-1） */
export const SHAHO_BONUS_FIELDS: ShahoField[] = {fields_ts(bonus_fields)};

/** 元号のコード（生年月日・賞与支払年月日。表4.9.1-1） */
export const SHAHO_BIRTH_ERA_CODES: Record<string, string> = {js(birth_eras)};
export const SHAHO_PAY_ERA_CODES: Record<string, string> = {js(pay_eras)};

/** 都道府県コード（参考資料3。都道府県名 → コード。全国地方公共団体コードとは違う） */
export const SHAHO_PREFECTURE_CODES: Record<string, string> = {js(prefectures)};

/** 1バイト文字で項目に書ける字（表3.4-2。数字・英字・半角カナ・ハイフン・スペース。カンマと括弧は区切り・識別符号だけに使う） */
export const SHAHO_SINGLE_BYTE_CHARS = {js(single)};

/**
 * 2バイト文字で使えるシフトJISのコードの範囲（表3.4-3 の「使用可能コード範囲」）
 * 下2桁が 7F・FD〜3F、上2桁が A0〜DF のコードは使えない（表3.4-3 の注）
 */
export const SHAHO_DOUBLE_BYTE_RANGES: [number, number][] = [{ranges_ts}];
"""
    out.write_text(ts, encoding="utf-8")
    print(f"{out} を作りました（{version}・賞与支払届 {len(bonus_fields)}項目・事業所情報 {len(office_fields)}項目・都道府県 {len(prefectures)}・"
          f"1バイト文字 {len(single)}字・2バイト文字の範囲 {len(double)}）")


if __name__ == "__main__":
    main()
