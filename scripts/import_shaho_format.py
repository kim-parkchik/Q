#!/usr/bin/env python3
"""
健康保険・厚生年金保険の届書の電子申請用ファイル（CSV形式届書ファイル。年金事務所提出の SHFD0006.CSV と健康保険組合提出の KPFD0006.CSV）の形を、
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
・4.7.1 算定基礎届・70歳以上被用者算定基礎届データレコード（年金事務所提出）の項目構成（図4.7.1-1）と
  項目説明（表4.7.1-1。様式コード・元号のコード・適用年月の月・給与支給月）
・4.8.1 月額変更届・70歳以上被用者月額変更届データレコード（年金事務所提出）の項目構成（図4.8.1-1）と
  項目説明（表4.8.1-1。様式コード・元号のコード）
・4.9.1 賞与支払届・70歳以上被用者賞与支払届データレコード（年金事務所提出）の項目構成（図4.9.1-1）と
  項目説明（表4.9.1-1。様式コード・元号のコード）
・参考資料3 都道府県コード一覧（全国地方公共団体コードとは違う。東京都は 21）
・3.1.2 ファイル名（健康保険組合提出の KPFD0006.CSV）、4.1.2 媒体管理レコード・4.3.2.2 事業所情報（健康保険組合提出）
・4.5.1・4.5.2 資格取得届、4.6.1・4.6.2 資格喪失届、4.7.2 算定基礎届・4.8.2 月額変更届・4.9.2 賞与支払届（健康保険組合提出）、
  4.12.1 産前産後休業取得者申出書、4.13.1 育児休業等取得者申出書の項目構成と項目説明（様式コード・元号・種別などのコード）。
  多くの項目は「項番 項目名 種別 文字数」と並んでいるので図の名前で探して読み（generic_field）、字の並びが崩れている項目は項目ごとに読む。
  読んだ項目は、年金事務所提出と健康保険組合提出・賞与支払届の同じ項目と比べ、合わなければ止まる
・4.10.1 被扶養者(異動)届・国民年金第3号被保険者関係届、4.11.1 国民年金第3号被保険者関係届の項目構成と項目説明（様式コード・
  異動の別・続柄・理由・職業・海外特例などのコードと、表4.10.1-2 都道府県コード一覧）。この2つの表は枠がつながっていて
  字の並びでは列がわからないので、字のまとまりの位置（scripts/pdf_to_chars.swift）で項番・種別・文字数の列に分けて読む（layout_table）

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


def loose(caption):
    """見出しの字と字のあいだに空白があってもなくても合う正規表現（「70 歳」と「70歳」が混ざっている表があるため）"""
    return r"\s?".join(re.escape(c) for c in caption.replace(" ", ""))


def table_text_loose(pages, caption):
    """表の見出し（空白を無視して探す）があるページを続けてつなぐ"""
    pattern = re.compile(loose(caption))
    nos = [no for no in sorted(pages) if pattern.search(pages[no]) and "・・・" not in pages[no]]
    if not nos:
        fail(f"「{caption}」の表が見つかりません")
    return " ".join(pages[no] for no in nos)


def figure_names_loose(pages, caption):
    """項目構成の図の項目の名前（図の見出しは空白を無視して探す。図のページの頭から見出しまでの【…】）"""
    pattern = re.compile(loose(caption))
    for no in sorted(pages):
        m = pattern.search(pages[no])
        if m and "・・・" not in pages[no]:
            text = pages[no][:m.start()]
            start = text.rfind("[data]")
            names = re.findall(r"【([^】]+)】", text[start if start >= 0 else 0:])
            if not names:
                fail(f"{caption}の項目の名前を読めません")
            return names
    fail(f"「{caption}」が書いてあるページが見つかりません")


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


KIND_WORDS = ("数字", "英字", "カナ", "漢字", "文字", "-")


def field(name, kinds, length, alt=None):
    """種別（「数字」「数字 英字 カナ」）と文字数（「7」「1~4」「0~6」「0,12」「0,2~5」）から、項目の決まりを作る"""
    ks = kinds.split()
    if not ks or any(k not in KIND_WORDS for k in ks):
        fail(f"{name}の種別「{kinds}」を読めません")
    if re.fullmatch(r"\d+", length):
        n = int(length)
        lengths = {"min": n, "max": n}
    elif re.fullmatch(r"\d+~\d+", length):
        a, b = map(int, length.split("~"))
        lengths = {"min": a, "max": b}
    elif re.fullmatch(r"\d+(?:~\d+)?(?:,\d+(?:~\d+)?)+", length):
        # 「0,12」は 0 文字か 12 文字、「0,2~5」は 0 文字か 2〜5 文字
        only = []
        for part in length.split(","):
            a, _, b = part.partition("~")
            only += list(range(int(a), int(b or a) + 1))
        lengths = {"min": min(only), "max": max(only), "only": only}
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


def flag_fields(fields, names, t, items):
    """「数字 0,1」の項目（備考欄項目など）を、(項目の番号（0から）, 設定内容の書き出しの正規表現) の並びで読む"""
    for no, head in items:
        m = search(rf"{no + 1} {head[0]} (数字) ([\d,~]+) {head[1]}", t, names[no])
        fields.append(field(names[no], m.group(1), m.group(2)))


def remarks_field(name, m):
    """漢字の備考（漢字 0~37。カナなどで書くときは 0~75）"""
    return field(name, m.group(1), m.group(2), field("カナなどで書くとき", m.group(3), m.group(4)))


def read_santei_record(pages):
    """4.7.1 算定基礎届・70歳以上被用者算定基礎届データレコード（年金事務所提出）"""
    names = figure_names_loose(pages, "図4.7.1-1 算定基礎届・70歳以上被用者算定基礎届データレコード(年金事務所提出)の項目構成")
    t = table_text_loose(pages, "表4.7.1-1算定基礎届・70歳以上被用者算定基礎届データレコード(年金事務所提出)の項目説明")
    fields = []
    m = search(r"1 様式コード (数字) (\d+) 「(\d+)」を設定する", t, "算定基礎届の様式コード")
    fields.append(field(names[0], m.group(1), m.group(2)))
    form_code = m.group(3)
    m = search(
        r"2 都道府県 コード (?P<k1>数字) イ 事 業 所 3 郡市区符号 整 理 記 4 事業所記号 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) "
        r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>[\d~]+) エ ", t, "算定基礎届の事業所整理記号")
    fields += office_symbol_fields(m, names[1:4])
    for no, label, pattern in [
        (4, "被保険者整理番号", r"5 被保険者 整理番号 (数字) ([\d~,]+) 「被保険者資格取得確認"),
        (5, "被保険者氏名(カナ)", r"6 被保険者氏名 \(カナ\) (カナ) ([\d~,]+) 被保険者氏名を設定する"),
        (6, "被保険者氏名(漢字)", r"7 被保険者氏名 \(漢字\) (漢字) ([\d~,]+) 被保険者氏名を漢字で"),
    ]:
        m = search(pattern, t, f"算定基礎届の{label}")
        fields.append(field(names[no], m.group(1), m.group(2)))
    m = search(r"8 元号 (数字) 生 年 月 9 年月日 日 (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)ク (数字) (\d+) 生年月日\(和暦\)", t, "算定基礎届の生年月日")
    fields.append(field(names[7], m.group(1), m.group(2)))
    fields.append(field(names[8], m.group(4), m.group(5)))
    birth_eras = eras(m.group(3), "算定基礎届の生年月日")
    m = search(r"10 元号 (数字) (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)コ ", t, "算定基礎届の適用年月の元号")
    fields.append(field(names[9], m.group(1), m.group(2)))
    apply_eras = eras(m.group(3), "算定基礎届の適用年月")
    m = search(r"11 適 用 年 月 年 (数字) (\d+) 当該届\(媒体\)を提出する年\(和暦\)", t, "算定基礎届の適用年月の年")
    fields.append(field(names[10], m.group(1), m.group(2)))
    m = search(r"12 月 (数字) (\d+) 「(\d+)」を設定する シ ", t, "算定基礎届の適用年月の月")
    fields.append(field(names[11], m.group(1), m.group(2)))
    apply_month = m.group(3)
    m = search(r"13 従前の 標準報酬月額 \(健保\) (数字) ([\d,]+) 現在の標準報酬月額\(健保\)", t, "算定基礎届の従前の標準報酬月額(健保)")
    fields.append(field(names[12], m.group(1), m.group(2)))
    m = search(r"14 従前の 標準報酬月額 \(厚年\) (数字) ([\d,]+) 現在の標準報酬月額\(厚年\)", t, "算定基礎届の従前の標準報酬月額(厚年)")
    fields.append(field(names[13], m.group(1), m.group(2)))
    # 表の3ページ目は、従前の改定月（元号・年・月）と昇(降)給月の種別・文字数が離れて並ぶ
    m = search(
        r"15 元号 (?P<k15>数字) (?P<n15>\d+) 以下の元号に対応する数字を設定する (?P<eras>(?:・\S+:「\d」 )+)16 17 従 前 の 改 定 月 年 (?P<k16>数字) "
        r"月 (?P<k17>数字) 18 昇\(降\)給月 (?P<k18>数字) 文字数 (?P<n16>\d+) 現在の標準報酬月額に改定した年\(和暦\).*? "
        r"(?P<n17>\d+) 現在の標準報酬月額に改定した月.*? 昇給または降給分の支払月を設定する .*? 作成例 ソ タ チ (?P<n18>[\d,]+) ツ ",
        t, "算定基礎届の従前の改定月・昇(降)給月")
    fields.append(field(names[14], m.group("k15"), m.group("n15")))
    fields.append(field(names[15], m.group("k16"), m.group("n16")))
    fields.append(field(names[16], m.group("k17"), m.group("n17")))
    fields.append(field(names[17], m.group("k18"), m.group("n18")))
    previous_eras = eras(m.group("eras"), "算定基礎届の従前の改定月")
    for no, label, pattern in [
        (18, "昇(降)給区分", r"19 昇\(降\)給区分 (数字) ([\d,]+) 昇\(降\)給により"),
        (19, "遡及支払月", r"20 遡及支払月 (数字) ([\d,]+) 4月から6月に"),
        (20, "遡及支払額", r"21 遡及支払額 (数字) ([\d~]+) 4月から6月に支払われた"),
    ]:
        m = search(pattern, t, f"算定基礎届の{label}")
        fields.append(field(names[no], m.group(1), m.group(2)))
    m = search(r"23 22 給 与 支 給 月 4月 (数字) (\d+) 「(\d+)」を設定する ニ 5月 (数字) (\d+) 「(\d+)」を設定する ヌ 24 6月 (数字) (\d+) 「(\d+)」を設定する ネ ", t, "算定基礎届の給与支給月")
    pay_months = []
    for i in range(3):
        fields.append(field(names[21 + i], m.group(1 + 3 * i), m.group(2 + 3 * i)))
        pay_months.append(m.group(3 + 3 * i))
    m = search(r"26 25 給 与 計 算 の 基 礎 日 数 4月 (数字) ノ 5月 (数字) 27 6月 (数字) (\d+) 給料や賃金を計算する基礎となる日数.*? (\d+) ハ .*? (\d+) ヒ ", t, "算定基礎届の給与計算の基礎日数")
    for i in range(3):
        fields.append(field(names[24 + i], m.group(1 + i), m.group(4 + i)))
    for first, label, words, marks in [
        (27, "通貨によるものの額", r"29 28 通 貨 に よ る も の の 額", ("フ", "報酬のうち、臨時に受けるもの", "ヘ", "ホ")),
        (30, "現物によるものの額", r"32 31 現 物 に よ る も の の 額", ("マ", "報酬のうち、食事", "ミ", "ム")),
    ]:
        m = search(rf"{words} 4月 (数字) ([\d~]+) {marks[0]} 5月 (数字) {first + 3} 6月 (数字) {marks[1]}.*? ([\d~]+) {marks[2]} .*? ([\d~]+) {marks[3]} ", t, f"算定基礎届の{label}")
        fields.append(field(names[first], m.group(1), m.group(2)))
        fields.append(field(names[first + 1], m.group(3), m.group(5)))
        fields.append(field(names[first + 2], m.group(4), m.group(6)))
    m = search(r"34 4月 (数字) ([\d~]+) メ 35 合 計 5月 (数字) 36 6月 (数字) 各給与支給月における.*? ([\d~]+) モ .*? ([\d~]+) ヤ ", t, "算定基礎届の合計")
    fields.append(field(names[33], m.group(1), m.group(2)))
    fields.append(field(names[34], m.group(3), m.group(5)))
    fields.append(field(names[35], m.group(4), m.group(6)))
    for no, label, pattern in [
        (36, "総計", r"37 総計 (数字) ([\d~]+) 給与計算の基礎日数が17日以上"),
        (37, "平均額", r"38 平均額 (数字) ([\d~]+) 4月、5月、6月のうち"),
        (38, "修正平均額", r"39 修正平均額 (数字) ([\d~]+) 算定が困難なときや"),
        (39, "個人番号", r"40 個人番号 (数字) ([\d,]+) 被保険者が「70歳以上被用者」"),
    ]:
        m = search(pattern, t, f"算定基礎届の{label}")
        fields.append(field(names[no], m.group(1), m.group(2)))
    m = search(r"41 課所符号 (数字) ([\d,]+) ル 42 基 礎 年 金 番 号 一連番号 (数字) 個人番号を入力した場合は.*? ([\d,]+) レ ", t, "算定基礎届の基礎年金番号")
    fields.append(field(names[40], m.group(1), m.group(2)))
    fields.append(field(names[41], m.group(3), m.group(4)))
    flag_fields(fields, names, t, [
        (42, ("備考欄項目1", "70歳以上被用者の場合は「1」")),
    ])
    m = search(r"44 70歳算定基礎月 (数字) ([\d,]+) 算定期間中に70歳に到達した", t, "算定基礎届の70歳算定基礎月")
    fields.append(field(names[43], m.group(1), m.group(2)))
    flag_fields(fields, names, t, [
        (44, ("備考欄項目2", "二以上事業所勤務者の場合は「1」")),
        (45, ("備考欄項目3", "月額変更の予定がある場合は「1」")),
        (46, ("備考欄項目4", "給与支払対象となる期間の途中から資格取得")),
        (47, ("備考欄項目5", "病休・育休・休職に該当する場合")),
        (48, ("備考欄項目6", "特定適用事業所における短時間労働者")),
        (49, ("備考欄項目7", "パートに該当する場合")),
        (50, ("備考欄項目8", "年間平均での算定を申し立てる場合")),
    ])
    m = search(r"52 備考欄 (漢字) ([\d~]+) (数字 英字 カナ) ([\d~]+) 省略する", t, "算定基礎届の備考欄")
    fields.append(remarks_field(names[51], m))
    m = search(r"53 70歳以上被用 者届のみ提出 (数字) ([\d,]+) 70歳以上被用者算定基礎届のみを提出する場合", t, "算定基礎届の70歳以上被用者届のみ提出")
    fields.append(field(names[52], m.group(1), m.group(2)))
    check_names(fields, names, "算定基礎届データレコード")
    if apply_eras != previous_eras:
        fail(f"算定基礎届の適用年月と従前の改定月の元号のコードが違います: {apply_eras} / {previous_eras}")
    return fields, form_code, birth_eras, apply_eras, apply_month, pay_months


def read_geppen_record(pages):
    """4.8.1 月額変更届・70歳以上被用者月額変更届データレコード（年金事務所提出）"""
    names = figure_names_loose(pages, "図4.8.1-1 月額変更届・70歳以上被用者月額変更届データレコード(年金事務所提出)の項目構成")
    t = table_text_loose(pages, "表4.8.1-1月額変更届・70歳以上被用者月額変更届データレコード(年金事務所提出)の項目説明")
    fields = []
    m = search(r"1 様式コード (数字) (\d+) 「(\d+)」を設定する", t, "月額変更届の様式コード")
    fields.append(field(names[0], m.group(1), m.group(2)))
    form_code = m.group(3)
    m = search(
        r"2 都道府県 コード (?P<k1>数字) イ 事 業 3 郡市区符号 所 整 理 4 事業所記号 記 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) 文字数 "
        r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>[\d~]+) エ ", t, "月額変更届の事業所整理記号")
    fields += office_symbol_fields(m, names[1:4])
    for no, label, pattern in [
        (4, "被保険者整理番号", r"5 被保険者 整理番号 (数字) ([\d~,]+) 「被保険者資格取得確認"),
        (5, "被保険者氏名(カナ)", r"6 被保険者氏名 \(カナ\) (カナ) ([\d~,]+) 被保険者氏名をカナで設定する"),
        (6, "被保険者氏名(漢字)", r"7 被保険者氏名 \(漢字\) (漢字) ([\d~,]+) 被保険者氏名を漢字で"),
    ]:
        m = search(pattern, t, f"月額変更届の{label}")
        fields.append(field(names[no], m.group(1), m.group(2)))
    m = search(r"8 元号 (数字) 生 年 月 9 年月日 日 (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)ク (数字) (\d+) 生年月日\(和暦\)", t, "月額変更届の生年月日")
    fields.append(field(names[7], m.group(1), m.group(2)))
    fields.append(field(names[8], m.group(4), m.group(5)))
    birth_eras = eras(m.group(3), "月額変更届の生年月日")
    m = search(r"10 元号 (数字) (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)コ ", t, "月額変更届の改定年月の元号")
    fields.append(field(names[9], m.group(1), m.group(2)))
    revision_eras = eras(m.group(3), "月額変更届の改定年月")
    m = search(r"11 12 改 定 年 月 年 (数字) (\d+) .*? サ 月 (数字) (\d+) 改定後の標準報酬月額が適用される月", t, "月額変更届の改定年月の年・月")
    fields.append(field(names[10], m.group(1), m.group(2)))
    fields.append(field(names[11], m.group(3), m.group(4)))
    m = search(r"13 従 前 の 標 準 報 酬 月 額 従前の標準 報酬月額 \(健保\) (数字) ([\d,]+) 現在の標準報酬月額\(健保\)", t, "月額変更届の従前の標準報酬月額(健保)")
    fields.append(field(names[12], m.group(1), m.group(2)))
    m = search(r"14 従前の標準 報酬月額 \(厚年\) (数字) ([\d,]+) 現在の標準報酬月額\(厚年\)", t, "月額変更届の従前の標準報酬月額(厚年)")
    fields.append(field(names[13], m.group(1), m.group(2)))
    m = search(r"15 元号 (数字) (\d+) 以下の元号に対応する数字を設定する ((?:・\S+:「\d」 )+)ソ ", t, "月額変更届の従前の改定月の元号")
    fields.append(field(names[14], m.group(1), m.group(2)))
    previous_eras = eras(m.group(3), "月額変更届の従前の改定月")
    m = search(r"16 17 従 前 の 改 定 月 年 (数字) (\d+) 現在の標準報酬月額に改定した年.*? タ 月 (数字) (\d+) 現在の標準報酬月額に改定した月", t, "月額変更届の従前の改定月の年・月")
    fields.append(field(names[15], m.group(1), m.group(2)))
    fields.append(field(names[16], m.group(3), m.group(4)))
    for no, label, pattern in [
        (17, "昇(降)給月", r"18 昇\(降\)給月 (数字) ([\d,]+) 昇給または降給のあった月の支払月"),
        (18, "昇(降)給区分", r"19 昇\(降\)給区分 (数字) ([\d,]+) 以下の昇\(降\)給に対応する数字"),
        (19, "遡及支払月", r"20 遡及支払月 (数字) ([\d,]+) 「給与支給月」内に通常給以外"),
        (20, "遡及支払額", r"21 遡及支払額 (数字) ([\d~]+) 「給与支給月」内に支払われた"),
    ]:
        m = search(pattern, t, f"月額変更届の{label}")
        fields.append(field(names[no], m.group(1), m.group(2)))
    # 給与支給月：前三ヶ月の文字数は、前一ヶ月の文字数のあとに並ぶ
    m = search(r"22 前三ヶ月 (数字) 23 24 給 与 支 給 月 前二ヶ月 (数字) (\d+) 前一ヶ月 (数字) (\d+) (\d+) 改定年月の月の前三ヶ月、前二ヶ月、前一ヶ月を順に", t, "月額変更届の給与支給月")
    fields.append(field(names[21], m.group(1), m.group(6)))
    fields.append(field(names[22], m.group(2), m.group(3)))
    fields.append(field(names[23], m.group(4), m.group(5)))
    m = search(r"25 前三ヶ月 (数字) ノ 26 27 給 与 計 算 の 基 礎 日 数 前二ヶ月 (数字) 前一ヶ月 (数字) (\d+) 給料や賃金を計算する基礎となる日数.*? (\d+) ハ .*? (\d+) ヒ ", t, "月額変更届の給与計算の基礎日数")
    for i in range(3):
        fields.append(field(names[24 + i], m.group(1 + i), m.group(4 + i)))
    for first, label, words, marks in [
        (27, "通貨によるものの額", r"通 貨 に よ る も の の 額", ("フ", "報酬のうち、臨時に受けるもの", "ヘ", "ホ")),
        (30, "現物によるものの額", r"現 物 に よ る も の の 額", ("マ", "報酬のうち、食事", "ミ", "ム")),
    ]:
        m = search(rf"{first + 1} 前三ヶ月 (数字) ([\d~]+) {marks[0]} {first + 2} {first + 3} {words} 前二ヶ月 (数字) 前一ヶ月 (数字) {marks[1]}.*? ([\d~]+) {marks[2]} .*? ([\d~]+) {marks[3]} ", t, f"月額変更届の{label}")
        fields.append(field(names[first], m.group(1), m.group(2)))
        fields.append(field(names[first + 1], m.group(3), m.group(5)))
        fields.append(field(names[first + 2], m.group(4), m.group(6)))
    m = search(r"34 前三ヶ月 (数字) ([\d~]+) メ 35 前二ヶ月 (数字) 36 合 計 前一ヶ月 (数字) 各給与支給月における.*? ([\d~]+) モ .*? ([\d~]+) ヤ ", t, "月額変更届の合計")
    fields.append(field(names[33], m.group(1), m.group(2)))
    fields.append(field(names[34], m.group(3), m.group(5)))
    fields.append(field(names[35], m.group(4), m.group(6)))
    for no, label, pattern in [
        (36, "総計", r"37 (数字) ([\d~]+) 各「給与支給月」の「合計」の総計を設定する 総計 ユ"),
        (37, "平均額", r"38 平均額 (数字) ([\d~]+) 総計を3で割った額"),
        (38, "修正平均額", r"39 修正平均額 (数字) ([\d~]+) 算定が困難なときや"),
        (39, "個人番号", r"40 個人番号 (数字) ([\d,]+) 被保険者が「70歳以上被用者」"),
    ]:
        m = search(pattern, t, f"月額変更届の{label}")
        fields.append(field(names[no], m.group(1), m.group(2)))
    m = search(r"41 基 礎 年 金 番 号 課所符号 (数字) ([\d,]+) ル 42 一連番号 (数字) 個人番号を入力した場合は.*? ([\d,]+) レ ", t, "月額変更届の基礎年金番号")
    fields.append(field(names[40], m.group(1), m.group(2)))
    fields.append(field(names[41], m.group(3), m.group(4)))
    flag_fields(fields, names, t, [
        (42, ("備考欄項目1", "70 ?歳以上被用者の場合は「1」")),
        (43, ("備考欄項目2", "二以上事業所勤務者の場合は「1」")),
        (44, ("備考欄項目3", "特定適用事業所における短時間労働者")),
    ])
    m = search(r"46 備考欄項目4 (漢字) ([\d~]+) (数字 英字 カナ) ([\d~]+) ・基本給の変更", t, "月額変更届の備考欄項目4")
    fields.append(remarks_field(names[45], m))
    flag_fields(fields, names, t, [
        (46, ("備考欄項目5", "70 ?歳到達時における")),
    ])
    m = search(r"48 備考欄 (漢字) ([\d~]+) (数字 英字 カナ) ([\d~]+) 省略する", t, "月額変更届の備考欄")
    fields.append(remarks_field(names[47], m))
    m = search(r"49 70歳以上被用者 届のみ提出 (数字) ([\d,]+) 70 ?歳以上被用者月額変更届のみを提出する場合", t, "月額変更届の70歳以上被用者届のみ提出")
    fields.append(field(names[48], m.group(1), m.group(2)))
    check_names(fields, names, "月額変更届データレコード")
    if revision_eras != previous_eras:
        fail(f"月額変更届の改定年月と従前の改定月の元号のコードが違います: {revision_eras} / {previous_eras}")
    return fields, form_code, birth_eras, revision_eras


# ── 資格取得届・資格喪失届・産前産後休業・育児休業等の届書と、健康保険組合提出の届書 ──
# 項目説明の表の多くの項目は「項番 項目名 種別 文字数」と並んでいるので、項目構成の図の名前で探して読む（generic_field）。
# 表の枠がつながっていて字の並びが崩れている項目は、項目ごとに並びを決めて読む（overrides）。
# 読んだ項目は、ほかの届書の同じ項目（年金事務所提出の賞与支払届・健康保険組合提出と年金事務所提出の同じ届書）と比べ、
# 違えば止まる（check_same）。

GKINDS = r"数字 英字 カナ|数字 英字|数字|英字|カナ|漢字|文字|-"
GLEN = r"\d+~\d+|\d+(?:, ?\d+)+|\d+"


def norm_len(s):
    """文字数の書き方をそろえる（PDF の折り返しで入った空白を除く。「0,1, 2」→「0,1,2」・「0~3 7」→「0~37」）"""
    return re.sub(r"\s", "", s)


def norm_kinds(s):
    """種別の書き方をそろえる（「数字英 字カナ」→「数字 英字 カナ」）"""
    s = re.sub(r"[\s,]", "", s)
    words = re.findall(r"数字|英字|カナ|漢字|文字|-", s)
    if "".join(words) != s:
        fail(f"種別「{s}」を読めません")
    return " ".join(words)


def loose_text(s):
    """字と字のあいだに空白があってもなくても合う正規表現"""
    s = re.sub(r"\s", "", s)
    return r"\s?".join(re.escape(c) for c in s)


def name_keys(name):
    """項目説明の表での項目名（図の名前のまま・うしろの「(…)」を除いたもの）"""
    keys = [name]
    for base in (re.sub(r"\([^()]*\)$", "", name), re.sub(r"\(.*$", "", name)):
        if base and base not in keys:
            keys.append(base)
    return keys


def generic_field(t, no, name):
    """「項番 項目名 種別 文字数」と並んでいる項目（漢字の項目は、続けて書いてあるカナなどで書くときの種別・文字数も）"""
    for key in name_keys(name):
        m = re.search(
            rf"(?:^| ){no} (?:\d+ )?(?:[^ \d]{{1,3}} ){{0,30}}?{loose_text(key)} (?P<k>{GKINDS}) (?P<n>{GLEN})"
            rf"(?: (?P<ak>数字 英字 カナ|カナ) (?P<an>{GLEN}))?(?= )", t)
        if m:
            alt = field("カナなどで書くとき", m["ak"], norm_len(m["an"])) if m["k"] == "漢字" and m["ak"] else None
            return field(name, m["k"], norm_len(m["n"]), alt)
    return None


def read_table(pages, figure, table, overrides, what, special=None):
    """
    項目構成の図の名前と並びで、項目説明の表を読む
    overrides：字の並びが崩れている項目を読む (項番の並び, 正規表現)。正規表現の k1・n1（種別・文字数）、ak1・an1（カナなどで
    書くとき）を並びの1つ目の項目に使う（k2… は2つ目）。種別が離れて並ぶときは k1a・k1b・k1c をつなぐ
    special：{項番: 関数(名前, 項目, 表の字)} ほかの項目を読んでから決める項目。それ以外は generic_field で読む
    """
    names = figure_names_loose(pages, figure)
    t = " " + table_text_loose(pages, table) + " "
    fields = [None] * len(names)
    for nos, pattern in overrides:
        m = search(pattern, t, f"{what}の{'・'.join(names[no - 1] for no in nos)}")
        g = m.groupdict()
        for j, no in enumerate(nos, 1):
            kinds = g.get(f"k{j}") or " ".join(g[f"k{j}{x}"] for x in "abc" if g.get(f"k{j}{x}"))
            alt = field("カナなどで書くとき", norm_kinds(g[f"ak{j}"]), norm_len(g[f"an{j}"])) if g.get(f"ak{j}") else None
            fields[no - 1] = field(names[no - 1], norm_kinds(kinds), norm_len(g[f"n{j}"]), alt)
    special = special or {}
    for i, name in enumerate(names):
        if fields[i] is None and (i + 1) not in special:
            fields[i] = generic_field(t, i + 1, name)
            if fields[i] is None:
                fail(f"{what}の項番{i + 1}「{name}」を読めません（仕様書の書き方が変わったかもしれません。中身を読んでから、このスクリプトを直してください）")
    for no, fn in special.items():
        fields[no - 1] = fn(names, fields, t)
    return fields, t


def code_list(text, head, what, tail):
    """「…に対応する数字を設定する ・名前 :「コード」 …」のコードの一覧（名前の空白は除く）"""
    i = text.find(head)
    if i < 0:
        fail(f"{what}を読めません")
    seg = text[i + len(head):]
    j = seg.find(tail)
    if j < 0:
        fail(f"{what}の終わりを読めません")
    seg = "」 " + seg[:j].strip()
    found = re.findall(r"(?<=」 )・(.+?) ?:「(\d+)」", seg)
    if not found:
        fail(f"{what}のコードを読めません")
    return {re.sub(r"\s", "", name): code for name, code in found}


def era_lists(t, what):
    """表の中の元号のコードの一覧（「以下の元号に対応する数字を設定する ・令和:「9」」）を、出てくる順に"""
    out = []
    for m in re.finditer(r"元 ?号に対応す ?る数字を設定する ((?:\S{1,2} ){0,3}(?:・\S+:「\d」 (?:\S{1,2} ){0,3})+)", t):
        out.append({name: code for name, code in re.findall(r"・(\S+?):「(\d)」", m.group(1))})
    if not out:
        fail(f"{what}の元号のコードを読めません")
    return out


def birth_and_event_eras(t, what):
    """生年月日の元号（1つ目）と、それ以外の日付の元号（どれも同じでなければ止まる）"""
    lists = era_lists(t, what)
    birth, events = lists[0], lists[1:]
    if not events or any(e != events[0] for e in events):
        fail(f"{what}の日付の元号のコードがそろっていません: {lists}")
    return birth, events[0]


def rule_of(f):
    """項目の決まり（名前を除く。カナなどで書くときの決まりも名前を除く）"""
    rule = {k: v for k, v in f.items() if k not in ("name", "alt")}
    if f.get("alt"):
        rule["alt"] = rule_of(f["alt"])
    return rule


def check_same(a, b, what):
    """2つの項目の決まり（種別・文字数・カナなどで書くとき）が同じか"""
    if rule_of(a) != rule_of(b):
        fail(f"{what}の決まりが合いません:\n{a}\n{b}")


def check_union(office_fields, union_fields, omitted, what, extra):
    """健康保険組合提出の項目が、年金事務所提出の項目と同じか（omitted の項番は「省略する」）。うしろの extra 項目は健康保険組合の項目"""
    if len(union_fields) != len(office_fields) + extra:
        fail(f"{what}の項目の数が合いません（年金事務所提出 {len(office_fields)}・健康保険組合提出 {len(union_fields)}）")
    for i, (a, b) in enumerate(zip(office_fields, union_fields), 1):
        if a["name"] != b["name"]:
            fail(f"{what}の項番{i}の名前が合いません: {a['name']} / {b['name']}")
        if i in omitted:
            if b["kinds"] != ["-"] or b["max"] != 0:
                fail(f"{what}の項番{i}「{b['name']}」は省略する項目のはずです: {b}")
        else:
            check_same(a, b, f"{what}の項番{i}「{a['name']}」")


def check_kinds(fields, nos, kinds, lengths, what):
    for no in nos:
        f = fields[no - 1]
        if f["kinds"] != kinds or [f["min"], f["max"], f.get("only")] != lengths:
            fail(f"{what}の項番{no}「{f['name']}」の決まりが思ったものと違います: {f}")


def read_shutoku_record(pages, union):
    """4.5.1・4.5.2 資格取得届・70歳以上被用者該当届データレコード（年金事務所提出・健康保険組合提出）"""
    where = "健康保険組合提出" if union else "年金事務所提出"
    what = f"資格取得届({where})"
    no = "4.5.2" if union else "4.5.1"
    office = (r"2 都道府県 コード (?P<k1>数字) イ 事 業 3 郡市区符号 所 整 " + ("4 事業所記号 理 記 号 " if union else "理 4 事業所記号 記 号 ")
              + r"(?P<k2>数字) (?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ 外を事業所記号に分けて設定する (?P<k3>数字 英字 カナ) .*? (?P<n3>\d+~\d+) エ ")
    overrides = [
        ((2, 3, 4), office),
        ((19,), r"19 資 格 取 得 年 月 日 .*? ツ 資格取得 \(該当\) 年月日 (?P<k1>数字) (?P<n1>[\d,]+) 資格取得\(70歳以上被用者該当\)年月日"),
        ((31,), r"31 郵 便 番 号 子番号 (?P<k1>数字) 被保険者の居住する住所の郵便番号を.*? (?P<n1>[\d,]+) マ "),
    ]
    if union:
        overrides += [
            ((15,), r"15 番 号 情 報 備考欄 (?P<k1>漢字) (?P<n1>[\d~]+) 住民票住所を記載できない理由が「その他」の場合に設定 ソ する (?P<ak1>数字 英字 カナ) (?P<an1>[\d~]+) 個人番号を設定した場合は省略する"),
            ((38,), r"健保固有項目 (?P<k1>漢字) (?P<n1>[\d~]+) 健康保険組合固有項目の内容を設定する \S+ 38 (?P<ak1>数字 英字 カナ) (?P<an1>[\d~]+) "),
        ]
    else:
        overrides += [
            ((15,), r"14 15 個 人 番 号 情 報 .*? セ 備考欄 (?P<k1>漢字) (?P<n1>[\d~]+) (?P<ak1>数字 英字 カナ) (?P<an1>[\d~]+) 住民票住所を記載できない理由が「その他」"),
            ((17,), r"17 基 礎 年 金 番 号 一連番号 (?P<k1>数字) 個人番号を設定した場合は.*? (?P<n1>[\d,]+) チ "),
        ]
    fields, t = read_table(pages, f"図{no}-1 資格取得届・70歳以上被用者該当届データレコード({where})の項目構成",
                           f"表{no}-1資格取得届・70歳以上被用者該当届データレコード({where})の項目説明", overrides, what)
    form_code = search(r"1 様式コード 数字 7 「(\d+)」を設定する", t, f"{what}の様式コード").group(1)
    birth, events = birth_and_event_eras(t, what)
    kinds = code_list(t, "当該被保険者の種別(性別)に対応する数字を設定する", f"{what}の種別(性別)", " ※" if not union else " サ ")
    categories = code_list(t, "当該被保険者の取得区分に対応する数字を設定する", f"{what}の取得区分", " ※" if not union else " シ ")
    reasons = code_list(t, "以下の理由に対応する数字を設定する", f"{what}の住民票住所を記載できない理由", " 個人番号を設定した場合")
    return fields, form_code, birth, events, kinds, categories, reasons


def read_soshitsu_record(pages, union):
    """4.6.1・4.6.2 資格喪失届・70歳以上被用者不該当届データレコード（年金事務所提出・健康保険組合提出）"""
    where = "健康保険組合提出" if union else "年金事務所提出"
    what = f"資格喪失届({where})"
    no = "4.6.2" if union else "4.6.1"
    overrides = [
        ((2, 3, 4), r"2 都 道 府 県 コード (?P<k1>数字) イ 事 業 3 郡市区符号 所 整 4 事業所記号 理 記 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) "
                    r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>\d+~\d+) エ "),
        ((17,), r"17 喪 失 退 .*? 元号 (?P<k1>数字) (?P<n1>[\d,]+) 喪失\(不該当\)原因が「退職等」または「死亡」の場合 に、以下の元号"),
        ((22, 23), r"23 22 資 格 確 認 書 回 収 添付 (?P<k1>数字) (?P<n1>[\d~]+) 返不能 (?P<k2>数字) 資格確認書を回収した枚数.*? (?P<n2>[\d~]+) ヌ "),
    ]
    if union:
        overrides += [
            ((25, 26), r"25 26 7 0 歳 不 該 当 情 報 元号 (?P<k1>-) (?P<n1>0) 省略する ノ 不 該 当 年 月 日 年月日 (?P<k2>-) (?P<n2>0) 省略する"),
            ((30,), r"30 健保固有項目 (?P<k1>漢字) (?P<n1>[\d~]+) 健康保険組合固有項目の内容を設定する \S+ (?P<ak1>数字 英字 カナ) (?P<an1>[\d~]+) "),
        ]
    else:
        overrides += [
            ((13,), r"13 基 礎 年 金 番 号 一連番号 (?P<k1>数字) 個人番号を入力した場合は.*? (?P<n1>[\d,]+) ス "),
            ((24,), r"24 70歳 不 該 当 (?P<k1>文字) (?P<n1>[\d,]+) 70歳以上被用者の場合に「1」"),
            ((25, 26), r"25 26 7 0 歳 不 該 当 情 報 元号 (?P<k1>数字) (?P<n1>[\d,]+) 以下の元号.*? 年月日 (?P<k2>数字) (?P<n2>[\d,]+) 不該当年月日\(和暦\)"),
        ]
    fields, t = read_table(pages, f"図{no}-1 資格喪失届・70歳以上被用者不該当届データレコード({where})の項目構成",
                           f"表{no}-1 資格喪失届・70歳以上被用者不該当届データレコード({where})の項目説明", overrides, what)
    form_code = search(r"1 様式コード 数字 7 「(\d+)」を設定する", t, f"{what}の様式コード").group(1)
    birth, events = birth_and_event_eras(t, what)
    reasons = code_list(t, "以下の喪失原因に対応する数字を設定する", f"{what}の喪失(不該当)原因", " タ ")
    return fields, form_code, birth, events, reasons


# 算定基礎届・月額変更届・賞与支払届（健康保険組合提出）
UNION_BIRTH = ((8, 9), r"8 元号 (?P<k1>数字) 生 年 月 9 年月日 日 (?P<n1>\d+) 以下の元号に対応する数字を設定する (?:・\S+:「\d」 )+\S+ (?P<k2>数字) (?P<n2>\d+) 生年月日\(和暦\)")


def union_extra(no):
    """健保固有項目（漢字。カナなどで書くときの決まりは、説明のあとに並ぶ）"""
    return ((no,), rf"{no} 健保固有項目 (?P<k1>漢字) (?P<n1>[\d~]+) 健康保険組合固有項目の内容を設定する \S+ (?P<ak1>数字 英字 カナ) (?P<an1>[\d~]+) ")


def read_santei_union_record(pages):
    """4.7.2 算定基礎届・70歳以上被用者算定基礎届データレコード（健康保険組合提出）"""
    what = "算定基礎届(健康保険組合提出)"

    def money(first, words, marks):
        return ((first, first + 1, first + 2),
                rf"{first + 1} {first} {words} 4月 (?P<k1>数字) (?P<n1>[\d~]+) {marks[0]} 5月 (?P<k2>数字) {first + 2} 6月 (?P<k3>数字) {marks[1]}.*? (?P<n2>[\d~]+) {marks[2]} .*? (?P<n3>[\d~]+) {marks[3]} ")
    overrides = [
        ((2, 3, 4), r"2 都道府県 コード (?P<k1>数字) イ 事 業 所 3 郡市区符号 整 理 記 4 事業所記号 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) "
                    r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>\d+~\d+) エ "),
        UNION_BIRTH,
        ((16, 17, 18), r"16 17 従 前 の 改 定 月 年 (?P<k1>数字) 月 (?P<k2>数字) 18 昇\(降\)給月 (?P<k3>数字) 文字数 (?P<n1>\d+) 現在の標準報酬月額に改定した年.*? "
                       r"(?P<n2>\d+) 現在の標準報酬月額に改定した月.*? 昇給または降給分の支払月を設定する .*? 作成例 ソ タ チ (?P<n3>[\d,]+) ツ "),
        ((22, 23, 24), r"23 22 給 与 支 給 月 4月 (?P<k1>数字) (?P<n1>\d+) 「\d+」を設定する ニ 5月 (?P<k2>数字) (?P<n2>\d+) 「\d+」を設定する ヌ 24 6月 (?P<k3>数字) (?P<n3>\d+) 「\d+」を設定する ネ "),
        ((25, 26, 27), r"26 25 給 与 計 算 の 基 礎 日 数 4月 (?P<k1>数字) ノ 5月 (?P<k2>数字) 27 6月 (?P<k3>数字) (?P<n1>\d+) 給料や賃金を計算する基礎となる日数.*? (?P<n2>\d+) ハ .*? (?P<n3>\d+) ヒ "),
        money(28, "通 貨 に よ る も の の 額", ("フ", "報酬のうち、臨時に受けるもの", "ヘ", "ホ")),
        money(31, "現 物 に よ る も の の 額", ("マ", "報酬のうち、食事", "ミ", "ム")),
        ((34, 35, 36), r"34 4月 (?P<k1>数字) (?P<n1>[\d~]+) メ 35 合 計 5月 (?P<k2>数字) 36 6月 (?P<k3>数字) 各給与支給月における.*? (?P<n2>[\d~]+) モ .*? (?P<n3>[\d~]+) ヤ "),
        union_extra(56),
    ]
    fields, _ = read_table(pages, "図4.7.2-1 算定基礎届・70歳以上被用者算定基礎届データレコード(健康保険組合提出)の項目構成",
                           "表4.7.2-1算定基礎届・70歳以上被用者算定基礎届データレコード(健康保険組合提出)の項目説明", overrides, what)
    return fields


def read_geppen_union_record(pages):
    """4.8.2 月額変更届・70歳以上被用者月額変更届データレコード（健康保険組合提出）"""
    what = "月額変更届(健康保険組合提出)"

    def money(first, words, marks):
        return ((first, first + 1, first + 2),
                rf"{first} 前三ヶ月 (?P<k1>数字) (?P<n1>[\d~]+) {marks[0]} {first + 1} {first + 2} {words} 前二ヶ月 (?P<k2>数字) 前一ヶ月 (?P<k3>数字) {marks[1]}.*? (?P<n2>[\d~]+) {marks[2]} .*? (?P<n3>[\d~]+) {marks[3]} ")
    overrides = [
        ((2, 3, 4), r"2 都道府県 コード (?P<k1>数字) イ 事 業 3 郡市区符号 所 整 理 4 事業所記号 記 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) 文字数 "
                    r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>\d+~\d+) エ "),
        UNION_BIRTH,
        ((11, 12), r"11 12 改 定 年 月 年 (?P<k1>数字) (?P<n1>\d+) .*? サ 月 (?P<k2>数字) (?P<n2>\d+) 改定後の標準報酬月額が適用される月"),
        ((13,), r"13 従 前 の 標 準 報 酬 月 額 従前の標準 報酬月額 \(健保\) (?P<k1>数字) (?P<n1>[\d,]+) 現在の標準報酬月額\(健保\)"),
        ((16, 17), r"16 17 従 前 の 改 定 月 年 (?P<k1>数字) (?P<n1>\d+) 現在の標準報酬月額に改定した年.*? タ 月 (?P<k2>数字) (?P<n2>\d+) 現在の標準報酬月額に改定した月"),
        ((22, 23, 24), r"22 前三ヶ月 (?P<k1>数字) 23 24 給 与 支 給 月 前二ヶ月 (?P<k2>数字) (?P<n2>\d+) 前一ヶ月 (?P<k3>数字) (?P<n3>\d+) (?P<n1>\d+) 改定年月の月の前三ヶ月、前二ヶ月、前一ヶ月を順に"),
        ((25, 26, 27), r"25 前三ヶ月 (?P<k1>数字) ノ 26 27 給 与 計 算 の 基 礎 日 数 前二ヶ月 (?P<k2>数字) 前一ヶ月 (?P<k3>数字) (?P<n1>\d+) 給料や賃金を計算する基礎となる日数.*? (?P<n2>\d+) ハ .*? (?P<n3>\d+) ヒ "),
        money(28, "通 貨 に よ る も の の 額", ("フ", "報酬のうち、臨時に受けるもの", "ヘ", "ホ")),
        money(31, "現 物 に よ る も の の 額", ("マ", "報酬のうち、食事", "ミ", "ム")),
        ((34, 35, 36), r"34 合 計 前三ヶ月 (?P<k1>数字) (?P<n1>[\d~]+) メ 35 前二ヶ月 (?P<k2>数字) 36 前一ヶ月 (?P<k3>数字) 各給与支給月における.*? (?P<n2>[\d~]+) モ .*? (?P<n3>[\d~]+) ヤ "),
        union_extra(52),
    ]
    fields, _ = read_table(pages, "図4.8.2-1 月額変更届・70歳以上被用者月額変更届データレコード(健康保険組合提出)の項目構成",
                           "表4.8.2-1月額変更届・70歳以上被用者月額変更届データレコード(健康保険組合提出)の項目説明", overrides, what)
    return fields


def read_bonus_union_record(pages):
    """4.9.2 賞与支払届・70歳以上被用者賞与支払届データレコード（健康保険組合提出）"""
    what = "賞与支払届(健康保険組合提出)"
    overrides = [
        ((2, 3, 4), r"2 都 道 府 県 コード (?P<k1>数字) イ 事 3 郡市区符号 業 所 4 事業所記号 整 理 記 号 (?P<k2>数字) (?P<k3>数字 英字 カナ) "
                    r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>\d+~\d+) エ "),
        UNION_BIRTH,
        ((16, 17), r"省略する ソ 課所符号 (?P<k1>-) (?P<n1>0) 省略する タ 16 基 礎 年 金 番 号 17 一連番号 (?P<k2>-) (?P<n2>0) チ "),
        union_extra(24),
    ]
    fields, _ = read_table(pages, "図4.9.2-1賞与支払届・70歳以上被用者賞与支払届データレコード(健康保険組合提出)の項目構成",
                           "表4.9.2-1 賞与支払届・70歳以上被用者賞与支払届データレコード(健康保険組合提出)の項目説明", overrides, what)
    return fields


def read_sankyu_record(pages):
    """4.12.1 産前産後休業取得者申出書/変更(終了)届データレコード（年金事務所提出）"""
    what = "産前産後休業取得者申出書"
    overrides = [
        ((1, 2, 3, 4), r"1 様式コード (?P<k1>数字) 都道府県 2 事 コード (?P<k2>数字) 表」のとおり 業 3 郡市区符号 所 (?P<k3>数字) 整 理 の場合、 (?P<k4a>数字) 記 4 事業所記号 "
                       r"(?P<k4b>英字) 号 (?P<k4c>カナ) .*?設定内容 (?P<n1>\d+) 「\d+」を設定する ア (?P<n2>\d+) 都道府県コードは.*? (?P<n3>\d+) ウ .*? (?P<n4>\d+~\d+) エ "),
        ((5,), r"5 被保険者整理番 .*? 号 (?P<k1>数字) (?P<n1>[\d~]+) の被保険者整理番号欄"),
        ((6,), r"6 被保険者氏名 .*? \(カナ\) (?P<k1>カナ) (?P<n1>[\d~]+) \(例\)被保険者氏名が"),
        ((9, 10), r"10 9 被 保 険 者 の 基 礎 年 金 番 号 課所符号 (?P<k1>数字) (?P<n1>[\d,]+) 一連番号 (?P<k2>数字) .*? (?P<n2>[\d,]+) コ "),
        ((18, 19), r"18 19 産 前 産 後 休 業 終 了 予 定 年 月 日 元号 (?P<k1>数字) (?P<n1>\d+) 以下の元号.*? 年月日 (?P<k2>数字) (?P<n2>\d+) 産前産後休業終了予定年月日\(和暦\)"),
        ((24,), r"24 備考 (?P<k1>漢字), (?P<ak1>数字 英字 カナ) (?P<n1>[\d~]+), (?P<an1>[\d~]+) 特記事項がある場合"),
        ((25, 26), r"25 26 変 更 変 更 後 の 出 産 \( 予 定 \) 年 月 日 元 号 (?P<k1>数字) (?P<n1>[\d,]+) 出産\(予定\)日を変更する場合に、以下の元号.*? "
                   r"年 月 日 (?P<k2>数字) (?P<n2>[\d,]+) 出産\(予定\)日を変更する場合に、年月日"),
        ((28, 29), r"28 29 変 更 後 の 産 前 産 後 休 業 開 始 年 月 日 元 号 (?P<k1>数字) (?P<n1>[\d,]+) 産前産後休業開始年月日を変更する場合に、以下の元号.*? "
                   r"年 月 日 (?P<k2>数字) (?P<n2>[\d,]+) 産前産後休業開始年月日を変更する場合に、 ?年月日"),
    ]

    def changed_kind(names, fields, t):
        # 変更後の出産種別は、表に種別が書いていない（文字数だけ）。出産種別（項番15）と同じ「0.単胎」「1.多胎」なので、項番15 の種別にする
        m = search(r"27 変 更 後 の 出産種別 (?P<n>[\d,]+) 出産予定の子の人数が 1 人の場合は「0.単胎」", t, f"{what}の変更後の出産種別")
        if names[14] != "出産種別" or names[26] != "変更後の出産種別":
            fail(f"{what}の出産種別の項番が変わりました: {names[14]} / {names[26]}")
        return field(names[26], " ".join(fields[14]["kinds"]), m["n"])

    fields, t = read_table(pages, "図4.12.1-1 産前産後休業取得者申出書/変更(終了)届データレコードの項目構成", "表4.12.1-1", overrides, what, {27: changed_kind})
    form_code = search(r"「(\d+)」を設定する ア", t, f"{what}の様式コード").group(1)
    birth, events = birth_and_event_eras(t, what)
    m = search(r"出産予定の子の人数が 1 人の場合は「(\d)\.(\S+?)」、 2 人\(双 子\)以上の場合は「(\d)\.(\S+?)」", t, f"{what}の出産種別のコード")
    births = {m.group(2): m.group(1), m.group(4): m.group(3)}
    return fields, form_code, birth, events, births


def read_ikukyu_record(pages):
    """4.13.1 育児休業等取得者申出書(新規・延長)/終了届データレコード（年金事務所提出）"""
    what = "育児休業等取得者申出書"
    days = r"\d+(?:, ?\d+)+"
    overrides = [
        ((2, 3, 4), r"2 都 道 府 県 コ ー ド (?P<k1>数字) イ 3 事 業 所 整 理 記 号 郡 市 区 符 号 (?P<k2>数字) 4 事 業 所 記 号 (?P<k3>数字 英字 カナ) "
                    r"(?P<n1>\d+) 都道府県コードは.*? (?P<n2>\d+) ウ .*? (?P<n3>\d+~\d+) エ "),
        ((10,), r"10 被 保 険 者 の 基 礎 年 金 番 号 一連番 号 (?P<k1>数字) 「年金手帳」.*? (?P<n1>[\d,]+) コ "),
        ((16,), r"元号 (?P<k1>数字) 16 養 育 す る 子 の 生 年 月 日 (?P<n1>\d+) 以下の元号に対応する"),
        ((23, 24), r"23 24 育 児 休 業 等 終 了 \( 予 定 \) 年 月 日 元号 (?P<k1>数字) (?P<n1>\d+) 以下の元号.*? 年月日 (?P<k2>数字) (?P<n2>\d+) 育児休業等終了\(予定\)年月日\(和暦\)"),
        ((28,), r"28 備考 (?P<k1>漢字), (?P<ak1>数字英 ?字カナ) (?P<n1>0~3 ?7),(?P<an1>0~ ?75) 省略する"),
        # 延長欄（元号・年月日・取得日数）：元号の種別と文字数が離れて並ぶ
        ((29, 30, 31), rf"元 29 休 元号に対応する数字を設定する .*? 30 月 月 (?P<k2>数字) (?P<n2>[\d,]+) 日 日 \( 変 更 号 (?P<k1>数字) 延 .*? "
                       rf"31 日 (?P<k3>数字) (?P<n3>{days}) 数 \( 変 更 (?P<n1>[\d,]+) 育児休業等取得者申出書の期間を延長する場合、育児休"),
        # 終了欄
        ((32, 33, 34), rf"元 32 申出していた終了予定日より早く.*? 年 33 月 (?P<k2>数字) (?P<n2>[\d,]+) 日 終 了 号 (?P<k1>数字) (?P<n1>[\d,]+) 申出していた終了予定日より早く.*? "
                       rf"34 日 (?P<k3>数字) (?P<n3>{days}) 数 "),
        # 育休等取得内訳1〜4（開始の元号・年月日、終了の元号・年月日、取得日数、就業予定日数（3・4はなし））
        ((35, 36, 37, 38, 39, 40), rf"35 得する場合、以下の元号に対応する数字を設定する .*? 36 月 (?P<k2>数字) (?P<n2>[\d,]+) 1 日 元 37 .*? 号 (?P<k1>数字) (?P<n1>[\d,]+) 「育児休業等開始年月日」.*? "
                                   rf"38 月 月 (?P<k4>数字) (?P<n4>[\d,]+) 日 設定する 日 1 号 (?P<k3>数字) (?P<n3>[\d,]+) 「育児休業等開始年月日」.*? "
                                   rf"39 (?P<k5>数字) (?P<n5>{days}) 育休等取得内訳1における育児休業等取得日数.*? 40 定 (?P<k6>数字) (?P<n6>{days}) 育休等取得内訳1における就業予定日数"),
        ((41, 42, 43, 44, 45, 46), rf"41 得する場合は、以下の元号に対応する数字を設定する .*? 42 月 (?P<k2>数字) (?P<n2>[\d,]+) 2 日 元 43 .*? 号 (?P<k1>数字) (?P<n1>[\d,]+) 「育児休業等開始年月日」.*? "
                                   rf"44 日 月 (?P<k4>数字) (?P<n4>[\d,]+) 日 設定する 2 号 (?P<k3>数字) (?P<n3>[\d,]+) 「育児休業等開始年月日」.*? "
                                   rf"45 (?P<k5>数字) (?P<n5>{days}) 育休等取得内訳2における育児休業等取得日数.*? 46 定 (?P<k6>数字) (?P<n6>{days}) 育休等取得内訳2における就業予定日数"),
        ((47, 48, 49, 50, 51), rf"得する場合は、以下の元号に対応する数字を設定する 47 .*? 48 月 (?P<k2>数字) (?P<n2>[\d,]+) 日 育 休 元 49 .*? 号 (?P<k1>数字) (?P<n1>[\d,]+) 育休等取得内訳が3回存在しない場合は、省略する .*? "
                               rf"50 月 (?P<k4>数字) (?P<n4>[\d,]+) 3 日 号 (?P<k3>数字) 育休等取得内訳が3回存在しない場合は、省略する .*? "
                               rf"51 (?P<k5>数字) (?P<n5>{days}) 取 得 日 数 3 (?P<n3>[\d,]+) 「育児休業等開始年月日」"),
        ((52, 53, 54, 55, 56), rf"得する場合は、以下の元号に対応する数字を設定する 52 .*? 53 月 (?P<k2>数字) (?P<n2>[\d,]+) 日 育 休 等 取 得 内 訳 4 元 54 .*? 号 (?P<k1>数字) (?P<n1>[\d,]+) 育休等取得内訳が4回存在しない場合は、省略する .*? "
                               rf"55 月 (?P<k4>数字) (?P<n4>[\d,]+) 4 日 号 (?P<k3>数字) 育休等取得内訳が4回存在しない場合は、省略する .*? "
                               rf"56 (?P<k5>数字) (?P<n5>{days}) 取 得 日 数 (?P<n3>\d+(?:, ?\d+)*) 「育児休業等開始年月日」"),
    ]
    fields, t = read_table(pages, "図4.13.1-1 育児休業等取得者申出書(新規・延長)/終了届データレコードの項目構成", "表4.13.1-1", overrides, what)
    # 延長欄・終了欄・育休等取得内訳の項目は、同じ種類の項目（元号・年月日・日数）がどれも同じ決まり（省略できる）
    check_kinds(fields, [29, 32, 35, 37, 41, 43, 47, 49, 52, 54], ["数字"], [0, 1, [0, 1]], what)
    check_kinds(fields, [30, 33, 36, 38, 42, 44, 48, 50, 53, 55], ["数字"], [0, 6, [0, 6]], what)
    check_kinds(fields, [25, 26, 31, 34, 39, 40, 45, 46, 51, 56], ["数字"], [0, 2, [0, 1, 2]], what)
    form_code = search(r"1 様式コード 数字 7 「(\d+)」を設定する", t, f"{what}の様式コード").group(1)
    birth, events = birth_and_event_eras(t, what)
    sexes = code_list(t, "当該被保険者の種別(性別)に対応する数字を設定する", f"{what}の被保険者の性別", " ス ")
    relations = code_list(t, "養育する子の区分を設定する", f"{what}の区分", " ツ ")
    return fields, form_code, birth, events, sexes, relations


def read_union_media_record(pages):
    """4.1.2 媒体管理レコード（健康保険組合提出）"""
    what = "媒体管理レコード(健康保険組合提出)"
    overrides = [((2,), r"2 媒体通番 (?P<k1>数字) 識 別 情 報 (?P<n1>\d+) 媒体通番は")]
    for no in range(4, 9):
        overrides.append(((no,), rf"{no} 健保固有項目名 称\(.*?\) (?P<k1>漢字) (?P<n1>[\d~]+) .*? (?P<ak1>数字 英字 カナ) (?P<an1>[\d~]+) "))
    fields, _ = read_table(pages, "図4.1.2-1 媒体管理レコード(健康保険組合提出)の項目構成", "表4.1.2-1 媒体管理レコード(健康保険組合提出)の項目説明", overrides, what)
    return fields


def read_union_office_record(pages):
    """4.3.2.2 事業所情報（健康保険組合提出）"""
    what = "事業所情報(健康保険組合提出)"
    overrides = [
        ((2, 3), r"2 親番号 (?P<k1>数字) (?P<n1>\d+) 事業所所在地の郵便番号を.*? イ 3 郵 便 番 号 する 子番号 (?P<k2>数字) .*? (?P<n2>\d+) ウ "),
        ((8, 9), r"8 局番2 話 番 号 9 局番3 (?P<k1>数字) (?P<n1>[\d~]+) 事業所の電話番号\(市内局番等\)を設定する ク (?P<k2>数字) (?P<n2>[\d~]+) 事業所の電話番号\(番号\)を設定する ケ "),
    ]
    fields, _ = read_table(pages, "図4.3.2.2-1 事業所情報(健康保険組合提出)の項目構成", "表4.3.2.2-1事業所情報(健康保険組合提出)の項目説明", overrides, what)
    return fields


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


# ── 被扶養者(異動)届・国民年金第3号被保険者関係届（4.10.1）と、国民年金第3号被保険者関係届（4.11.1） ──
# この2つの表は、表の枠がつながっていて、字の並び（pdf_to_text.swift）では項番・種別・文字数の列がわからない。
# そこで、字のまとまり（行）の位置（pdf_to_chars.swift）を読み、表の見出しの「種別」「文字数」の位置で列に分ける。
# ページごとに、項番の列の番号（昇順）と、種別の列のまとまり（上から順。「数字 英字 カナ」は縦に並んで1つ。「漢字」のすぐ下の
# 「数字 英字 カナ」は、カナなどで書くときの種別）と、文字数の列の値（上から順。折り返した「0,2~」「5」はつなぐ）を、
# 上から順に結び付ける（数が合わなければ止まる）。

LEN_HEAD = re.compile(r"^(\d+(?:~\d+)?(?:,\d+(?:~\d+)?)*[,~]?)(?:\s|$)")


def read_positions(pdf, first, last):
    """ページ first〜last の字のまとまりと位置（全角は半角にし（NFKC）、空白を1つにまとめる）"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_chars.swift"), str(pdf), str(first), str(last)],
                         check=True, capture_output=True, text=True).stdout
    pages = {}
    cur = None
    for raw in out.splitlines():
        m = re.match(r"=== page (\d+) ===$", raw)
        if m:
            cur = int(m.group(1))
            pages[cur] = []
            continue
        x, y, w, h, text = raw.split("\t", 4)
        pages[cur].append((float(x), float(y), float(w), float(h), re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()))
    return pages


def layout_rows(lines, last_columns):
    """1ページの表の、項番（昇順）・種別のまとまり（上から順）・文字数（上から順）。見出しのないページは前のページの列で読む"""
    tops = {}
    for x, y, w, h, t in lines:
        if t in ("種別", "文字数") and (t not in tops or y > tops[t][1]):
            tops[t] = (x, y)
    if "種別" in tops and "文字数" in tops:
        kx, top = tops["種別"]
        lx = tops["文字数"][0]
        # 項番の見出し（「項番」。「項」と「番 項目名」に分かれていることもある）の左の位置
        heads = [x for x, y, w, h, t in lines if abs(y - top) < 20 and re.match(r"^(項番|項$|番)", t)]
        if not heads:
            fail(f"表の項番の見出しが見つかりません（{[t for x, y, w, h, t in lines if abs(y - top) < 20]}）")
        nx = min(heads)
    elif last_columns:
        nx, kx, lx = last_columns
        top = float("inf")
    else:
        return None, None
    nums, kinds, lens, singles = [], [], [], []
    for x, y, w, h, t in lines:
        if y >= top - 1:
            continue
        t = t.replace("－", "-")
        words = t.split(" ")
        m = re.match(r"^(\d{1,3})(?:\s|$)", t)
        if abs(x - nx) < 12 and m:
            nums.append(int(m.group(1)))
        if kx - 8 <= x < lx - 2:
            if len(t) == 1:
                singles.append((x, y, t))
            kinds += [(y, wd) for wd in words if wd in KIND_WORDS]
            if words[0] in KIND_WORDS and len(words) > 1:
                m2 = LEN_HEAD.match(" ".join(words[1:]))
                if m2:
                    lens.append((y, m2.group(1)))
        elif x < kx - 8 and x + w > kx + 4 and words[-1] in KIND_WORDS:
            kinds.append((y, words[-1]))  # 項目名と種別がつながった行（「性別(続柄) 数字」）
        if lx - 10 <= x < lx + 30:
            m2 = LEN_HEAD.match(t)
            if m2:
                lens.append((y, m2.group(1)))
    # 縦に並んだ1字（「数」「字」）を1つにする
    singles.sort(key=lambda v: -v[1])
    used = set()
    for i, (x, y, t) in enumerate(singles):
        for j in range(i + 1, len(singles)):
            x2, y2, t2 = singles[j]
            if i not in used and j not in used and abs(x2 - x) < 2 and 5 < y - y2 < 14 and t + t2 in KIND_WORDS:
                kinds.append(((y + y2) / 2, t + t2))
                used.update({i, j})
    kinds.sort(key=lambda v: -v[0])
    lens.sort(key=lambda v: -v[0])
    joined = []
    for y, v in lens:
        if joined and joined[-1][1].endswith(("~", ",")) and 0 < joined[-1][0] - y < 16:
            joined[-1] = (joined[-1][0], joined[-1][1] + v)
        else:
            joined.append((y, v))
    groups = []
    i = 0
    while i < len(kinds):
        y, k = kinds[i]
        g = {"kinds": [k], "alt": None}
        j = i + 1
        nxt = [kd for _, kd in kinds[j:j + 3]]
        if k == "数字" and nxt[:2] == ["英字", "カナ"] and y - kinds[j + 1][0] < 40:
            g["kinds"] = ["数字", "英字", "カナ"]
            j += 2
        elif k == "漢字" and nxt == ["数字", "英字", "カナ"] and kinds[j][0] - kinds[j + 2][0] < 40:
            g["alt"] = ["数字", "英字", "カナ"]
            j += 3
        groups.append(g)
        i = j
    return (nx, kx, lx), (sorted(nums), groups, [v for _, v in joined])


def layout_table(pages, positions, caption, stop, names, what):
    """
    項目説明の表（見出し caption のページから、stop（正規表現。表のあとの見出し）まで）を、字の位置で読む
    names：項目構成の図の名前（並びどおり）
    """
    pattern = re.compile(loose(caption))
    nos = [no for no in sorted(pages) if pattern.search(pages[no]) and "・・・" not in pages[no]]
    if not nos:
        fail(f"「{caption}」の表が見つかりません")
    end = next((no for no in sorted(pages) if no >= nos[0] and re.search(stop, pages[no]) and "・・・" not in pages[no]), None)
    if end is None:
        fail(f"{what}の表の終わり（{stop}）が見つかりません")
    found = {}
    columns = None
    for no in range(nos[0], end + 1):
        lines = positions.get(no, [])
        if no == end:
            stop_y = max((y for x, y, w, h, t in lines if re.search(stop, t)), default=None)
            if stop_y is None:
                fail(f"{what}の表の終わり（{stop}）の位置がわかりません")
            lines = [ln for ln in lines if ln[1] > stop_y + 1]
        columns, rows = layout_rows(lines, columns)
        if not rows:
            continue
        nums, groups, lens = rows
        if not nums and not groups:
            continue
        need = sum(2 if g["alt"] else 1 for g in groups)
        if len(nums) != len(groups) or len(lens) != need:
            fail(f"{what}の表の{no}ページを読めません（項番 {nums} / 種別 {[g['kinds'] + (g['alt'] or []) for g in groups]} / 文字数 {lens}）")
        it = iter(lens)
        for n, g in zip(nums, groups):
            if n in found:
                fail(f"{what}の項番{n}が2回あります")
            length = next(it)
            alt = field("カナなどで書くとき", " ".join(g["alt"]), next(it)) if g["alt"] else None
            found[n] = (" ".join(g["kinds"]), length, alt)
    if sorted(found) != list(range(1, len(names) + 1)):
        fail(f"{what}の項番が、項目構成の図の{len(names)}項目とそろいません（読めた項番 {sorted(found)}）")
    return [field(names[n - 1], *found[n]) for n in range(1, len(names) + 1)]


def check_rules(fields, rules, what):
    """項目の決まりが思ったものと同じか（項番 → (種別, min, max, only)）"""
    for no, (kinds, lo, hi, only) in rules.items():
        f = fields[no - 1]
        if f["kinds"] != kinds.split() or [f["min"], f["max"], f.get("only")] != [lo, hi, only]:
            fail(f"{what}の項番{no}「{f['name']}」の決まりが思ったものと違います: {f}")


def example_line(positions, pages, heading, what):
    """作成例の図（heading の見出しのページ）の CSV の行を、字の位置で読んでつなぐ（「↓」まで）"""
    no = find_page(pages, heading)
    lines = sorted([ln for ln in positions.get(no, []) if "," in ln[4] and ln[0] < 120], key=lambda ln: -ln[1])
    text = "".join(ln[4] for ln in lines)
    if "↓" not in text:
        fail(f"{what}の作成例を読めません")
    return text[:text.index("↓")].split(",")


def check_example(fields, values, what):
    """作成例の値が、読んだ項目の決まり（数字の項目は数字だけ・文字数）に合うか"""
    if len(values) != len(fields):
        fail(f"{what}の作成例の項目の数（{len(values)}）が、項目の数（{len(fields)}）と合いません")
    for f, v in zip(fields, values):
        v = v.strip()
        n = len(v)
        ok_len = (n in f["only"]) if f.get("only") else f["min"] <= n <= f["max"]
        alt = f.get("alt")
        if not ok_len and alt:
            ok_len = alt["min"] <= n <= alt["max"]
        if not ok_len or (f["kinds"] == ["数字"] and v and not v.isdigit()):
            fail(f"{what}の作成例の「{f['name']}」の値「{v}」が、項目の決まりに合いません: {f}")


def read_fuyou_record(pages, positions):
    """4.10.1 被扶養者(異動)届・国民年金第3号被保険者関係届データレコード（年金事務所提出）"""
    what = "被扶養者(異動)届"
    figure = figure_names_loose(pages, "図4.10.1-1 被扶養者(異動)届・国民年金第3号被保険者関係届データレコード(年金事務所提出)の項目構成")
    # 図は「その他の被扶養者1」の項目を1回だけ書き、そのあとに「その他の被扶養者2」が同じ並びで続く（図の「その他の被扶養者1|2」）
    first = figure.index("被扶養者番号(その他の被扶養者1)")
    last = figure.index("届出意思確認済")
    other1 = figure[first:last]
    if any("被扶養者1" not in n and "海外特例要件" not in n for n in other1):
        fail(f"{what}のその他の被扶養者1の項目の名前を読めません: {other1}")
    names = figure[:last] + [n.replace("被扶養者1", "被扶養者2") for n in other1] + figure[last:]
    fields = layout_table(pages, positions, "表4.10.1-1 被扶養者(異動)届・国民年金第3号被保険者関係届データレコードの項目説明",
                          r"表 ?4\.10\.1-2 都道府県コード一覧(?!を参照)", names, what)
    # 収入の項目は、表の文字数が「0,7」だが、説明は「円単位で7文字で設定する」で、作成例は「0」（1文字）、e-Gov の自動チェックも
    # 「7バイト以内」なので、0〜7文字にする（作成例が項目の決まりに合うかは、下の check_example で確かめる）
    for f in fields:
        if "収入" in f["name"] and f.get("only") == [0, 7]:
            del f["only"]
    # その他の被扶養者2は、その他の被扶養者1と同じ決まり（被扶養者番号は、どちらも書かない（0文字））
    for i in range(len(other1)):
        a, b = fields[first + i], fields[last + i]
        if i == 0:
            if a["max"] != 0 or b["max"] != 0:
                fail(f"{what}の被扶養者番号は書かない項目のはずです: {a} / {b}")
            continue
        check_same(a, b, f"{what}の「{b['name']}」と、その他の被扶養者1の同じ項目")
    # 表のページ（見出しのないページも入れる。表4.10.1-2 都道府県コード一覧の前まで）
    first_page = find_page(pages, "表4.10.1-1 被扶養者(異動)届")
    last_page = next(no for no in sorted(pages) if no >= first_page and re.search(r"表 ?4\.10\.1-2 都道府県コード一覧(?!を参照)", pages[no]))
    t_all = " " + " ".join(pages[no] for no in range(first_page, last_page + 1)) + " "
    t = t_all
    form_code = search(r"1 様式コード 数字 7 「(\d+)」を設定する", t, f"{what}の様式コード").group(1)
    def codes_at(pattern, what_code, tail):
        """pattern（正規表現。一覧の頭の「…を設定する」まで）のすぐあとのコードの一覧（同じ頭の一覧があるので、続く名前で見分ける）"""
        m = re.search(pattern, t_all)
        if not m:
            fail(f"{what}の{what_code}を読めません")
        return code_list(t_all[m.start():], t_all[m.start():m.end()], f"{what}の{what_code}", tail)

    reason = r"以下の理由に対応する値を設定する (?=・{})"
    codes = {
        "change": code_list(t_all, "以下の異動の別に対応する数字を設定する", f"{what}の異動の別", " ナ "),
        "spouseRelation": codes_at(r"以下の続柄に対応する数字を設定する (?=・夫)", "配偶者の性別(続柄)", " なお、配偶者である被扶養者"),
        "spouseReason": codes_at(reason.format("配偶者の就職"), "配偶者が被扶養者になった理由", " A "),
        "spouseJob": codes_at(r"以下の職業に対応する値を設定する (?=・無職 :「1」 ・パート :「2」 ・年金受給者 :「3」 ・その他)", "配偶者の職業", " C "),
        "spouseEndReason": codes_at(reason.format("死亡 :「1」 ・離婚"), "配偶者が被扶養者でなくなった理由", " G "),
        "otherRelation": codes_at(r"以下の続柄に対応する数字を設定する (?=・実子)", "その他の被扶養者の続柄コード", " なお、その他の被扶養者1"),
        "otherJob": codes_at(r"以下の職業に対応する値を設定する (?=・無職 :「1」 ・パート :「2」 ・年金受給者 :「3」 ・小)", "その他の被扶養者の職業", " u "),
        "otherReason": codes_at(reason.format("出生"), "その他の被扶養者になった理由", " x "),
        "otherEndReason": codes_at(reason.format("死亡 :「1」 ・就職"), "その他の被扶養者でなくなった理由", " II "),
        "living": code_list(t_all, "被保険者との生活状況について対応する数字を設定する", f"{what}の同居・別居の別", " 「異動の別」"),
        "overseas": code_list(t_all, "以下の海外特例に対応する数字を設定する", f"{what}の海外特例", " なお、"),
        "overseasReason": codes_at(reason.format("留学"), "海外特例要件に該当した理由", " なお、"),
        "overseasEndReason": codes_at(reason.format("国内転入"), "海外特例要件に非該当となった理由", " なお、"),
        "phone": code_list(t_all, "以下の種別に対応する数字を設定する", f"{what}の電話番号の種別", " リ "),
    }
    # 「・その他」の名前のあとの字（「・その他 :「5」 なお…」）は code_list の終わりで切る。種類の数を確かめる
    expect = {"change": 3, "spouseRelation": 4, "spouseReason": 5, "spouseJob": 4, "spouseEndReason": 6, "otherRelation": 10, "otherJob": 6,
              "otherReason": 5, "otherEndReason": 6, "living": 2, "overseas": 2, "overseasReason": 5, "overseasEndReason": 2, "phone": 4}
    for key, n in expect.items():
        if len(codes[key]) != n:
            fail(f"{what}のコード（{key}）を読めません: {codes[key]}")
    eras = era_lists(t_all, what)
    birth = next((e for e in eras if "昭和" in e), None)
    event = next((e for e in eras if "平成" in e and "昭和" not in e), None)
    overseas = next((e for e in eras if list(e) == ["令和"]), None)
    if not birth or not event or not overseas or any(e not in (birth, event, overseas) for e in eras):
        fail(f"{what}の元号のコードを読めません: {eras}")
    # 住所地（後期高齢者医療の被保険者になって被扶養者でなくなったとき）の都道府県コード（表4.10.1-2。全国地方公共団体コードと同じ並び）
    no = find_page(pages, "都道府県コード 漢字都道府県名 01 北海道")
    rows = re.findall(r"(\d{2}) (\S+?[都道府県])(?= |$)", pages[no])
    prefectures = {name: code for code, name in rows}
    if len(rows) != 47 or [int(c) for c, _ in rows] != list(range(1, 48)):
        fail(f"{what}の都道府県コード一覧（表4.10.1-2）を読めません（{len(rows)}件）")
    check_example(fields, example_line(positions, pages, "(3)被扶養者(異動)届・国民年金第3号被保険者関係届データレコードの作成例", what), what)
    return fields, form_code, codes, birth, event, overseas, prefectures


def read_sango_record(pages, positions):
    """4.11.1 国民年金第3号被保険者関係届データレコード（年金事務所提出。健康保険組合などの被保険者の配偶者）"""
    what = "国民年金第3号被保険者関係届"
    names = figure_names_loose(pages, "図4.11.1-1 国民年金第3号被保険者関係届データレコードの項目構成")
    fields = layout_table(pages, positions, "表4.11.1-1 国民年金第3号被保険者関係届データレコードの項目説明",
                          r"\(3\) ?国民年金第3号被保険者関係届データレコードの作成例", names, what)
    first = find_page(pages, "表4.11.1-1 国民年金第3号被保険者関係届データレコードの項目説明")
    last = find_page(pages, "(3)国民年金第3号被保険者関係届データレコードの作成例")
    t = " " + " ".join(pages[no] for no in range(first, last + 1)) + " "
    form_code = search(r"1 様式コード 数字 7 「(\d+)」を設定する", t, f"{what}の様式コード").group(1)
    def codes_at(pattern, what_code, tail):
        m = re.search(pattern, t)
        if not m:
            fail(f"{what}の{what_code}を読めません")
        return code_list(t[m.start():], t[m.start():m.end()], f"{what}の{what_code}", tail)

    codes = {
        "change": code_list(t, "3号該当に対応する数字を設定する", f"{what}の異動の別", " ラ "),
        "relation": code_list(t, "以下の続柄に対応する数字を設定する", f"{what}の性別(続柄)", " ネ "),
        "reason": codes_at(r"以下の理由に対応する値を設定する (?=・配偶者の就職)", "3号被保険者になった理由", " レ "),
        "system": code_list(t, "以下の加入制度に対応する数字を設定する", f"{what}の配偶者の加入制度", " 「異動の別"),
        "endReason": codes_at(r"以下の理由に対応する値を設定する (?=・死亡)", "3号被保険者でなくなった理由", " 海外居住中"),
        "living": codes_at(r"3号被保険者との生活状況について対応する数字を設 ?定する (?=・同居)", "同居区分", " 「異動の別"),
        "phone": code_list(t, "以下の種別に対応する数字を設定する", f"{what}の電話番号の種別", " モ "),
    }
    expect = {"change": 3, "relation": 4, "reason": 5, "system": 1, "endReason": 4, "living": 2, "phone": 4}
    for key, n in expect.items():
        if len(codes[key]) != n:
            fail(f"{what}のコード（{key}）を読めません: {codes[key]}")
    check_example(fields, example_line(positions, pages, "(3)国民年金第3号被保険者関係届データレコードの作成例", what), what)
    return fields, form_code, codes


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
    santei_fields, santei_code, santei_birth_eras, month_eras, santei_apply_month, santei_pay_months = read_santei_record(pages)
    geppen_fields, geppen_code, geppen_birth_eras, geppen_month_eras = read_geppen_record(pages)
    if santei_birth_eras != birth_eras or geppen_birth_eras != birth_eras:
        fail(f"生年月日の元号のコードが届書で違います: {birth_eras} / {santei_birth_eras} / {geppen_birth_eras}")
    if geppen_month_eras != month_eras:
        fail(f"算定基礎届と月額変更届の年月の元号のコードが違います: {month_eras} / {geppen_month_eras}")
    prefectures = read_prefectures(pages)
    single = read_single_byte_chars(pages)
    double = read_double_byte_ranges(pages)

    # 健康保険組合に出すファイルの名前（3.1.2）
    no = find_page(pages, "3.1.2 健康保険組合提出")
    union_file_name = search(r"3\.1\.2 健康保険組合提出 .*?\(2\)CSV形式届書ファイルのファイル名 (\S+?\.CSV)", pages[no], "健康保険組合に出す CSV 形式届書ファイルの名前").group(1)
    # 資格取得届・資格喪失届（年金事務所提出・健康保険組合提出）
    shutoku_fields, shutoku_code, shutoku_birth, event_eras, shutoku_kinds, shutoku_categories, address_reasons = read_shutoku_record(pages, False)
    shutoku_union, shutoku_code_u, shutoku_birth_u, event_eras_u, shutoku_kinds_u, shutoku_categories_u, address_reasons_u = read_shutoku_record(pages, True)
    soshitsu_fields, soshitsu_code, soshitsu_birth, soshitsu_events, loss_reasons = read_soshitsu_record(pages, False)
    soshitsu_union, soshitsu_code_u, soshitsu_birth_u, soshitsu_events_u, loss_reasons_u = read_soshitsu_record(pages, True)
    # 算定基礎届・月額変更届・賞与支払届と、媒体管理レコード・事業所情報（健康保険組合提出）
    santei_union = read_santei_union_record(pages)
    geppen_union = read_geppen_union_record(pages)
    bonus_union = read_bonus_union_record(pages)
    union_media = read_union_media_record(pages)
    union_office = read_union_office_record(pages)
    # 産前産後休業取得者申出書・育児休業等取得者申出書（年金事務所提出）
    sankyu_fields, sankyu_code, leave_birth_eras, leave_eras, birth_kinds = read_sankyu_record(pages)
    ikukyu_fields, ikukyu_code, ikukyu_birth, ikukyu_events, ikukyu_sexes, ikukyu_relations = read_ikukyu_record(pages)
    # 被扶養者(異動)届・国民年金第3号被保険者関係届と、国民年金第3号被保険者関係届（字の位置で読む）
    positions = read_positions(pdf, find_page(pages, "表4.10.1-1 被扶養者(異動)届"), find_page(pages, "(3)国民年金第3号被保険者関係届データレコードの作成例"))
    fuyou_fields, fuyou_code, fuyou_codes, fuyou_birth, fuyou_events, fuyou_overseas, fuyou_prefectures = read_fuyou_record(pages, positions)
    sango_fields, sango_code, sango_codes = read_sango_record(pages, positions)

    # 読んだものを照らし合わせる（合わなければ、読み方か仕様書が変わったので止まる）
    if (shutoku_code_u, soshitsu_code_u) != (shutoku_code, soshitsu_code):
        fail(f"健康保険組合提出の様式コードが年金事務所提出と違います: {shutoku_code_u}・{soshitsu_code_u} / {shutoku_code}・{soshitsu_code}")
    for what, a, b in [
        ("資格取得届の生年月日の元号", shutoku_birth, birth_eras),
        ("資格取得届(健康保険組合提出)の生年月日の元号", shutoku_birth_u, birth_eras),
        ("資格喪失届の生年月日の元号", soshitsu_birth, birth_eras),
        ("資格喪失届(健康保険組合提出)の生年月日の元号", soshitsu_birth_u, birth_eras),
        ("資格取得届と資格喪失届の日付の元号", soshitsu_events, event_eras),
        ("資格取得届(健康保険組合提出)の日付の元号", event_eras_u, event_eras),
        ("資格喪失届(健康保険組合提出)の日付の元号", soshitsu_events_u, event_eras),
        ("産前産後休業取得者申出書と育児休業等取得者申出書の生年月日の元号", ikukyu_birth, leave_birth_eras),
        ("産前産後休業取得者申出書と育児休業等取得者申出書の日付の元号", ikukyu_events, leave_eras),
        ("資格取得届の種別(性別)", shutoku_kinds_u, shutoku_kinds),
        ("資格取得届の取得区分", shutoku_categories_u, shutoku_categories),
        ("資格取得届の住民票住所を記載できない理由", address_reasons_u, address_reasons),
        ("資格喪失届の喪失(不該当)原因", loss_reasons_u, loss_reasons),
    ]:
        if a != b:
            fail(f"{what}が合いません: {a} / {b}")
    check_union(shutoku_fields, shutoku_union, {16, 17, 34}, "資格取得届", 3)
    check_union(soshitsu_fields, soshitsu_union, {12, 13, 24, 25, 26, 27}, "資格喪失届", 3)
    check_union(santei_fields, santei_union, {40, 41, 42, 53}, "算定基礎届", 3)
    check_union(geppen_fields, geppen_union, {40, 41, 42, 49}, "月額変更届", 3)
    check_union(bonus_fields, bonus_union, {15, 16, 17, 21}, "賞与支払届", 3)
    check_same(union_media[1], media_fields[3], "媒体管理レコード(健康保険組合提出)の媒体通番")
    check_same(union_media[2], media_fields[4], "媒体管理レコード(健康保険組合提出)の作成年月日")
    for i in range(8):
        check_same(union_office[1 + i], office_fields[4 + i], f"事業所情報(健康保険組合提出)の{union_office[1 + i]['name']}")
    if union_media[0] != union_office[0] or union_media[0] != santei_union[53]:
        fail("事業所番号(健保組合)の決まりが、媒体管理レコード・事業所情報・データレコードで違います")
    # どの届書でも同じ項目（事業所整理記号・氏名・生年月日・個人番号・基礎年金番号）は、賞与支払届の項目と同じ決まり
    for what, fields, pairs in [
        ("資格取得届", shutoku_fields, {2: 2, 3: 3, 4: 4, 7: 6, 8: 7, 9: 8, 10: 9, 13: 15, 16: 16, 17: 17}),
        ("資格喪失届", soshitsu_fields, {2: 2, 3: 3, 4: 4, 5: None, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 11: 15, 12: 16, 13: 17}),
        ("産前産後休業取得者申出書", sankyu_fields, {2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 15, 9: 16, 10: 17, 11: 8, 12: 9}),
        ("育児休業等取得者申出書", ikukyu_fields, {2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 15, 9: 16, 10: 17, 11: 8, 12: 9}),
    ]:
        for a, b in pairs.items():
            if b is None:
                check_same(fields[a - 1], office_fields[3], f"{what}の項番{a}「{fields[a - 1]['name']}」と事業所情報の事業所番号")
            else:
                check_same(fields[a - 1], bonus_fields[b - 1], f"{what}の項番{a}「{fields[a - 1]['name']}」と賞与支払届の項番{b}")
    check_same(shutoku_fields[4], office_fields[3], "資格取得届の事業所番号と事業所情報の事業所番号")
    # 被扶養者(異動)届・3号関係届：被保険者の項目は賞与支払届と同じ決まり。配偶者の続柄などのコードは2つの届書で同じ
    for what, fields, pairs in [
        ("被扶養者(異動)届", fuyou_fields, {2: 2, 3: 3, 4: 4, 8: 5, 9: 6, 10: 7, 14: 15, 15: 16, 16: 17}),
        ("国民年金第3号被保険者関係届", sango_fields, {2: 2, 3: 3, 4: 4, 12: 15, 13: 16, 14: 17, 25: 15, 26: 16, 27: 17}),
    ]:
        for a, b in pairs.items():
            check_same(fields[a - 1], bonus_fields[b - 1], f"{what}の項番{a}「{fields[a - 1]['name']}」と賞与支払届の項番{b}")
    for key, key3 in [("spouseRelation", "relation"), ("spouseReason", "reason"), ("living", "living"), ("phone", "phone"), ("change", "change")]:
        if fuyou_codes[key] != sango_codes[key3]:
            fail(f"被扶養者(異動)届と3号関係届のコード（{key}）が違います: {fuyou_codes[key]} / {sango_codes[key3]}")
    if fuyou_events != pay_eras:
        fail(f"被扶養者(異動)届の日付の元号のコードが、賞与支払届と違います: {fuyou_events} / {pay_eras}")

    def js(value):
        return json.dumps(value, ensure_ascii=False)

    def fields_ts(fields):
        return "[\n" + "".join(f"  {js(f)},\n" for f in fields) + "]"

    ranges_ts = ", ".join(f"[0x{a:04X}, 0x{b:04X}]" for a, b in double)
    ts = f"""/**
 * 健康保険・厚生年金保険の届書の電子申請用ファイル（CSV形式届書ファイル。年金事務所提出と健康保険組合提出）の形
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

/** 算定基礎届・70歳以上被用者算定基礎届の様式コード（表4.7.1-1） */
export const SHAHO_SANTEI_FORM_CODE = {js(santei_code)};
/** 算定基礎届の適用年月の月（表4.7.1-1。定時決定は9月分から） */
export const SHAHO_SANTEI_APPLY_MONTH = {js(santei_apply_month)};
/** 算定基礎届の給与支給月（表4.7.1-1。4月・5月・6月） */
export const SHAHO_SANTEI_PAY_MONTHS: string[] = {js(santei_pay_months)};
/** 算定基礎届・70歳以上被用者算定基礎届データレコード（年金事務所提出。図4.7.1-1・表4.7.1-1） */
export const SHAHO_SANTEI_FIELDS: ShahoField[] = {fields_ts(santei_fields)};

/** 月額変更届・70歳以上被用者月額変更届の様式コード（表4.8.1-1） */
export const SHAHO_GEPPEN_FORM_CODE = {js(geppen_code)};
/** 月額変更届・70歳以上被用者月額変更届データレコード（年金事務所提出。図4.8.1-1・表4.8.1-1） */
export const SHAHO_GEPPEN_FIELDS: ShahoField[] = {fields_ts(geppen_fields)};

/** 元号のコード（算定基礎届の適用年月・月額変更届の改定年月・従前の改定月。表4.7.1-1・表4.8.1-1） */
export const SHAHO_MONTH_ERA_CODES: Record<string, string> = {js(month_eras)};

/** 資格取得届・70歳以上被用者該当届の様式コード（表4.5.1-1） */
export const SHAHO_SHUTOKU_FORM_CODE = {js(shutoku_code)};
/** 資格取得届・70歳以上被用者該当届データレコード（年金事務所提出。図4.5.1-1・表4.5.1-1） */
export const SHAHO_SHUTOKU_FIELDS: ShahoField[] = {fields_ts(shutoku_fields)};
/** 資格取得届の種別(性別)のコード（表4.5.1-1。名前の空白は除いた） */
export const SHAHO_SHUTOKU_KINDS: Record<string, string> = {js(shutoku_kinds)};
/** 資格取得届の取得区分のコード（表4.5.1-1） */
export const SHAHO_SHUTOKU_CATEGORIES: Record<string, string> = {js(shutoku_categories)};
/** 資格取得届の、個人番号も住民票住所も書けないときの理由のコード（表4.5.1-1） */
export const SHAHO_ADDRESS_REASONS: Record<string, string> = {js(address_reasons)};

/** 資格喪失届・70歳以上被用者不該当届の様式コード（表4.6.1-1） */
export const SHAHO_SOSHITSU_FORM_CODE = {js(soshitsu_code)};
/** 資格喪失届・70歳以上被用者不該当届データレコード（年金事務所提出。図4.6.1-1・表4.6.1-1） */
export const SHAHO_SOSHITSU_FIELDS: ShahoField[] = {fields_ts(soshitsu_fields)};
/** 資格喪失届の喪失(不該当)原因のコード（表4.6.1-1。名前の空白は除いた） */
export const SHAHO_LOSS_REASONS: Record<string, string> = {js(loss_reasons)};

/** 元号のコード（資格取得年月日・資格喪失年月日・退職日死亡日・不該当年月日。表4.5.1-1・表4.6.1-1） */
export const SHAHO_EVENT_ERA_CODES: Record<string, string> = {js(event_eras)};

/** 産前産後休業取得者申出書/変更(終了)届の様式コード（表4.12.1-1） */
export const SHAHO_SANKYU_FORM_CODE = {js(sankyu_code)};
/**
 * 産前産後休業取得者申出書/変更(終了)届データレコード（年金事務所提出。図4.12.1-1・表4.12.1-1）
 * 変更後の出産種別は、表に種別が書いていないので、出産種別と同じ種別にした（どちらも「0.単胎」「1.多胎」）
 */
export const SHAHO_SANKYU_FIELDS: ShahoField[] = {fields_ts(sankyu_fields)};
/** 出産種別のコード（表4.12.1-1） */
export const SHAHO_BIRTH_KINDS: Record<string, string> = {js(birth_kinds)};

/** 育児休業等取得者申出書(新規・延長)/終了届の様式コード（表4.13.1-1） */
export const SHAHO_IKUKYU_FORM_CODE = {js(ikukyu_code)};
/** 育児休業等取得者申出書(新規・延長)/終了届データレコード（年金事務所提出。図4.13.1-1・表4.13.1-1） */
export const SHAHO_IKUKYU_FIELDS: ShahoField[] = {fields_ts(ikukyu_fields)};
/** 育児休業等取得者申出書の被保険者の性別・養育する子の区分のコード（表4.13.1-1） */
export const SHAHO_IKUKYU_SEXES: Record<string, string> = {js(ikukyu_sexes)};
export const SHAHO_CHILD_RELATIONS: Record<string, string> = {js(ikukyu_relations)};

/** 元号のコード（産前産後休業・育児休業等の届書の被保険者の生年月日と、それ以外の日付。表4.12.1-1・表4.13.1-1） */
export const SHAHO_LEAVE_BIRTH_ERA_CODES: Record<string, string> = {js(leave_birth_eras)};
export const SHAHO_LEAVE_ERA_CODES: Record<string, string> = {js(leave_eras)};

/** 被扶養者(異動)届・国民年金第3号被保険者関係届の様式コード（表4.10.1-1） */
export const SHAHO_FUYOU_FORM_CODE = {js(fuyou_code)};
/**
 * 被扶養者(異動)届・国民年金第3号被保険者関係届データレコード（年金事務所提出。協会けんぽの被保険者。図4.10.1-1・表4.10.1-1）
 * 1つのレコードに、配偶者である被扶養者と、その他の被扶養者2人までを書く（その他の被扶養者2は、図ではその他の被扶養者1と同じ並び）
 */
export const SHAHO_FUYOU_FIELDS: ShahoField[] = {fields_ts(fuyou_fields)};
/**
 * 被扶養者(異動)届のコード（表4.10.1-1。名前の空白は除いた）
 * change：異動の別／spouseRelation：配偶者の性別(続柄)／spouseReason・spouseEndReason：配偶者が被扶養者になった・でなくなった理由／
 * spouseJob：配偶者の職業／otherRelation：その他の被扶養者の続柄コード／otherJob・otherReason・otherEndReason：その他の被扶養者の
 * 職業・なった理由・でなくなった理由／living：同居・別居の別／overseas：海外特例（該当・非該当）／overseasReason・overseasEndReason：
 * 海外特例要件に該当した・非該当となった理由／phone：電話番号の種別
 */
export const SHAHO_FUYOU_CODES = {js(fuyou_codes)} as const;
/** 被扶養者(異動)届の元号のコード（生年月日・届出日などの日付・海外特例要件に該当した日など。表4.10.1-1） */
export const SHAHO_FUYOU_BIRTH_ERA_CODES: Record<string, string> = {js(fuyou_birth)};
export const SHAHO_FUYOU_EVENT_ERA_CODES: Record<string, string> = {js(fuyou_events)};
export const SHAHO_FUYOU_OVERSEAS_ERA_CODES: Record<string, string> = {js(fuyou_overseas)};
/** 被扶養者(異動)届の住所地の都道府県コード（表4.10.1-2。後期高齢者医療の被保険者になって被扶養者でなくなるとき。参考資料3 とは違う） */
export const SHAHO_FUYOU_PREFECTURE_CODES: Record<string, string> = {js(fuyou_prefectures)};

/** 国民年金第3号被保険者関係届の様式コード（表4.11.1-1） */
export const SHAHO_SANGO_FORM_CODE = {js(sango_code)};
/** 国民年金第3号被保険者関係届データレコード（年金事務所提出。健康保険組合などの被保険者の配偶者。図4.11.1-1・表4.11.1-1） */
export const SHAHO_SANGO_FIELDS: ShahoField[] = {fields_ts(sango_fields)};
/**
 * 国民年金第3号被保険者関係届のコード（表4.11.1-1）
 * change：異動の別(3号該当)／relation：性別(続柄)／reason・endReason：3号被保険者になった・でなくなった理由／
 * system：配偶者の加入制度／living：同居区分／phone：電話番号の種別
 */
export const SHAHO_SANGO_CODES = {js(sango_codes)} as const;

/** 健康保険組合に出す CSV 形式届書ファイルの名前（3.1.2） */
export const SHAHO_UNION_FILE_NAME = {js(union_file_name)};
/** 媒体管理レコード（健康保険組合提出。図4.1.2-1・表4.1.2-1） */
export const SHAHO_UNION_MEDIA_FIELDS: ShahoField[] = {fields_ts(union_media)};
/** 事業所情報（健康保険組合提出。図4.3.2.2-1・表4.3.2.2-1） */
export const SHAHO_UNION_OFFICE_FIELDS: ShahoField[] = {fields_ts(union_office)};
/** 資格取得届・70歳以上被用者該当届データレコード（健康保険組合提出。図4.5.2-1・表4.5.2-1） */
export const SHAHO_SHUTOKU_UNION_FIELDS: ShahoField[] = {fields_ts(shutoku_union)};
/** 資格喪失届・70歳以上被用者不該当届データレコード（健康保険組合提出。図4.6.2-1・表4.6.2-1） */
export const SHAHO_SOSHITSU_UNION_FIELDS: ShahoField[] = {fields_ts(soshitsu_union)};
/** 算定基礎届・70歳以上被用者算定基礎届データレコード（健康保険組合提出。図4.7.2-1・表4.7.2-1） */
export const SHAHO_SANTEI_UNION_FIELDS: ShahoField[] = {fields_ts(santei_union)};
/** 月額変更届・70歳以上被用者月額変更届データレコード（健康保険組合提出。図4.8.2-1・表4.8.2-1） */
export const SHAHO_GEPPEN_UNION_FIELDS: ShahoField[] = {fields_ts(geppen_union)};
/** 賞与支払届・70歳以上被用者賞与支払届データレコード（健康保険組合提出。図4.9.2-1・表4.9.2-1） */
export const SHAHO_BONUS_UNION_FIELDS: ShahoField[] = {fields_ts(bonus_union)};

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
    print(f"{out} を作りました（{version}・賞与支払届 {len(bonus_fields)}項目・算定基礎届 {len(santei_fields)}項目・月額変更届 {len(geppen_fields)}項目・"
          f"資格取得届 {len(shutoku_fields)}項目・資格喪失届 {len(soshitsu_fields)}項目・産前産後休業取得者申出書 {len(sankyu_fields)}項目・"
          f"育児休業等取得者申出書 {len(ikukyu_fields)}項目・被扶養者(異動)届 {len(fuyou_fields)}項目・3号関係届 {len(sango_fields)}項目・"
          f"事業所情報 {len(office_fields)}項目・"
          f"健康保険組合提出（{union_file_name}）：資格取得届 {len(shutoku_union)}・資格喪失届 {len(soshitsu_union)}・算定基礎届 {len(santei_union)}・"
          f"月額変更届 {len(geppen_union)}・賞与支払届 {len(bonus_union)}・事業所情報 {len(union_office)}項目・都道府県 {len(prefectures)}・"
          f"1バイト文字 {len(single)}字・2バイト文字の範囲 {len(double)}）")


if __name__ == "__main__":
    main()
