#!/usr/bin/env python3
"""
郵便番号から住所を引くためのデータを、日本郵便の郵便番号データから作る（手で書き写さない）。
Q の「住所検索」は、このデータを Q の中で引く（郵便番号を外のサイトに送らない）。

使い方:
  python3 -I scripts/import_zipcode.py zipcode/source/utf_ken_all.zip public/zipcode

読むもの（入手元と SHA-256 は zipcode/README.md）:
  日本郵便「住所の郵便番号（1レコード1行、UTF-8形式）」の utf_ken_all.zip（中の utf_ken_all.csv）
    1行の項目：全国地方公共団体コード・（旧）郵便番号・郵便番号・都道府県名（カナ）・市区町村名（カナ）・町域名（カナ）・
              都道府県名・市区町村名・町域名・ほかに6つの印（全部で15）

作るもの:
  public/zipcode/zip0.tsv 〜 zip9.tsv（郵便番号の1けためごと。Q はいる分だけ読む）
    C<TAB>全国地方公共団体コード<TAB>都道府県<TAB>市区町村<TAB>都道府県のカナ<TAB>市区町村のカナ
    郵便番号<TAB>全国地方公共団体コード<TAB>町域<TAB>町域のカナ
  町域は、住所に書く形にする（日本郵便の「郵便番号データの説明」の書き方による）:
    ・「以下に掲載がない場合」は町域なし
    ・「○○の次に番地がくる場合」は、○○が市区町村なら町域なし、ほかの名前（西海市の「大島町」など）ならその名前
    ・「○○一円」は、○○が市区町村なら町域なし（多賀町の「一円」は町域の名前なので、そのまま）
    ・かっこ書き（「大通西（１〜１９丁目）」の丁目・番地の範囲、「（次のビルを除く）」、ビルの「（１階）」など）は除く
  同じ郵便番号で、市区町村・町域・カナが同じになったものは1つにする（町域がいくつもある郵便番号は、Q で選ぶ）。

次のときは作らずに止まる:
  ・zip の中に utf_ken_all.csv が1つだけない・UTF-8 で読めない・BOM がある・行の項目が15でない
  ・郵便番号が7けた、全国地方公共団体コードが5けたの数字でない・都道府県のコードが01〜47でない
  ・同じ全国地方公共団体コードで、都道府県・市区町村の名前やカナが違う行がある
  ・かっこ書きの後ろに字がある・閉じかっこだけある
  ・「以下に掲載がない場合」「○○の次に番地がくる場合」「○○一円」のカナが合わない・「○○一円」の○○が市区町村でない
  ・除いたあとの町域に、かっこ・「、」「〜」が残る・カナにカタカナ以外の字が残る・町域とカナの片方だけが空
  ・郵便番号の1けためのファイルがない（0〜9のどれかが空）
"""
import csv
import hashlib
import io
import os
import re
import sys
import zipfile
from collections import OrderedDict

SOURCE_URL = "https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html"
CSV_NAME = "utf_ken_all.csv"

IGAI = "以下に掲載がない場合"
IGAI_KANA = "イカニケイサイガナイバアイ"
TSUGI = "の次に番地がくる場合"
TSUGI_KANA = "ノツギニバンチガクルバアイ"
ICHIEN = "一円"
ICHIEN_KANA = "イチエン"

# カタカナ（ァ〜ヺ）と「・」「ー」。町域のカナには、地名の数字・英字（「キタ１ジョウヒガシ」）と番地の「−」が全角で入る
KANA = re.compile(r"^[ァ-ヺ・ー]*$")
TOWN_KANA = re.compile(r"^[ァ-ヺ・ー０-９Ａ-Ｚａ-ｚ−]*$")


def fail(message):
    sys.stderr.write(f"止まりました: {message}\n")
    sys.exit(1)


def strip_paren(s, what, row):
    """かっこ書きを除く（「大通西（１〜１９丁目）」→「大通西」。かっこの後ろに字があれば止まる）"""
    if "（" not in s:
        if "）" in s:
            fail(f"{what}「{s}」に閉じかっこだけがあります（{row[2]}）")
        return s
    if not s.endswith("）"):
        fail(f"{what}「{s}」のかっこ書きの後ろに字があります（{row[2]}）")
    return s[: s.index("（")]


FW_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")
TO_FW = str.maketrans("0123456789", "０１２３４５６７８９")
# 「越中畑６４地割〜越中畑６６地割」「種市第１５地割〜第２１地割」（岩手県の地割の範囲）
CHIWARI = re.compile(r"(?P<base>.+?)(?P<dai>第?)(?P<a>[０-９]+)地割〜(?:(?P=base))?(?P=dai)(?P<b>[０-９]+)地割")
CHIWARI_KANA = re.compile(r"(?P<base>.+?)(?P<dai>(?:ダイ)?)(?P<a>[０-９]+)チワリ−(?:(?P=base))?(?P=dai)(?P<b>[０-９]+)チワリ")


def clean_town(row):
    """町域と町域のカナを、住所に書く形にする。1つの行に町域がいくつもあれば、いくつも返す（[(町域, カナ)]）"""
    city = row[7]
    town = strip_paren(row[8], "町域", row)
    kana = strip_paren(row[5], "町域のカナ", row)
    if town == IGAI:
        if kana != IGAI_KANA:
            fail(f"「{IGAI}」のカナが「{kana}」です（{row[2]}）")
        return "igai", [("", "")]
    m = re.fullmatch(r"(.+)の次に(.*)番地がくる場合", town)
    if m:
        mk = re.fullmatch(r"(.+)ノツギニ(.*)バンチガクルバアイ", kana)
        if not mk:
            fail(f"「{town}」のカナ「{kana}」が「…ノツギニ…バンチガクルバアイ」ではありません（{row[2]}）")
        head, head_kana = m.group(1), mk.group(1)
        # 「境町の次に番地がくる場合」（猿島郡境町）は町域なし。「大島町の次に番地がくる場合」（西海市）は大島町
        return "tsugi", [("", "")] if city.endswith(head) else [(head, head_kana)]
    if town.endswith(ICHIEN) and len(town) > len(ICHIEN):
        head = town[: -len(ICHIEN)]
        if not city.endswith(head):
            fail(f"町域「{town}」は「{ICHIEN}」で終わりますが、市区町村「{city}」の一円ではありません（{row[2]}）")
        if not kana.endswith(ICHIEN_KANA):
            fail(f"「{town}」のカナ「{kana}」が「{ICHIEN_KANA}」で終わりません（{row[2]}）")
        return "ichien", [("", "")]
    if "〜" in town:
        m, mk = CHIWARI.fullmatch(town), CHIWARI_KANA.fullmatch(kana)
        if not m or not mk:
            fail(f"町域「{town}」（カナ「{kana}」）の「〜」を読めません（{row[2]}）")
        a, b = int(m.group("a").translate(FW_DIGITS)), int(m.group("b").translate(FW_DIGITS))
        if (a, b) != (int(mk.group("a").translate(FW_DIGITS)), int(mk.group("b").translate(FW_DIGITS))) or a >= b:
            fail(f"町域「{town}」とカナ「{kana}」の地割の範囲が合いません（{row[2]}）")
        return "range", [
            (f"{m.group('base')}{m.group('dai')}{str(n).translate(TO_FW)}地割",
             f"{mk.group('base')}{mk.group('dai')}{str(n).translate(TO_FW)}チワリ")
            for n in range(a, b + 1)
        ]
    if "、" in town or "、" in kana:
        towns, kanas = town.split("、"), kana.split("、")
        if len(towns) != len(kanas) or not all(towns) or not all(kanas):
            fail(f"町域「{town}」とカナ「{kana}」の「、」で分けた数が合いません（{row[2]}）")
        return "list", list(zip(towns, kanas))
    return ("paren" if "（" in row[8] else "plain"), [(town, kana)]


def main():
    if len(sys.argv) != 3:
        fail("使い方: python3 -I scripts/import_zipcode.py zipcode/source/utf_ken_all.zip public/zipcode")
    src, out_dir = sys.argv[1], sys.argv[2]

    with open(src, "rb") as f:
        raw_zip = f.read()
    digest = hashlib.sha256(raw_zip).hexdigest()
    zf = zipfile.ZipFile(io.BytesIO(raw_zip))
    names = zf.namelist()
    if names != [CSV_NAME]:
        fail(f"zip の中が {names} です（{CSV_NAME} が1つだけのはず）")
    raw = zf.read(CSV_NAME)
    if raw.startswith(b"\xef\xbb\xbf"):
        fail("CSV に BOM があります（日本郵便の説明では BOM なし）")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        fail(f"CSV を UTF-8 で読めません: {e}")
    rows = list(csv.reader(io.StringIO(text, newline="")))

    cities = {}            # 全国地方公共団体コード → (都道府県, 市区町村, 都道府県のカナ, 市区町村のカナ)
    prefs = {}             # 都道府県のコード → (都道府県, 都道府県のカナ)
    by_zip = OrderedDict()  # 郵便番号 → [(全国地方公共団体コード, 町域, 町域のカナ)]
    counts = {}
    for row in rows:
        if len(row) != 15:
            fail(f"項目が {len(row)} の行があります: {row}")
        code, zip7 = row[0], row[2]
        if not re.fullmatch(r"\d{5}", code):
            fail(f"全国地方公共団体コード「{code}」が5けたの数字ではありません")
        if not re.fullmatch(r"\d{7}", zip7):
            fail(f"郵便番号「{zip7}」が7けたの数字ではありません")
        pref_code = int(code[:2])
        if not 1 <= pref_code <= 47:
            fail(f"都道府県のコード「{code[:2]}」が 01〜47 ではありません（{zip7}）")
        pref, city, pref_kana, city_kana = row[6], row[7], row[3], row[4]
        if not pref or not city:
            fail(f"都道府県・市区町村の名前が空の行があります（{zip7}）")
        for k, what in ((pref_kana, "都道府県のカナ"), (city_kana, "市区町村のカナ")):
            if not k or not KANA.match(k):
                fail(f"{what}「{k}」にカタカナ以外の字があります（{zip7}）")
        c = (pref, city, pref_kana, city_kana)
        if cities.setdefault(code, c) != c:
            fail(f"全国地方公共団体コード {code} の名前が行によって違います: {cities[code]} と {c}")
        p = (pref, pref_kana)
        if prefs.setdefault(pref_code, p) != p:
            fail(f"都道府県のコード {pref_code:02d} の名前が行によって違います: {prefs[pref_code]} と {p}")

        kind, towns = clean_town(row)
        counts[kind] = counts.get(kind, 0) + 1
        lst = by_zip.setdefault(zip7, [])
        for town, kana in towns:
            if re.search(r"[（）「」〔〕、〜]", town):
                fail(f"除いたあとの町域「{town}」に、かっこや「、」「〜」が残ります（{zip7}。元は「{row[8]}」）")
            if not TOWN_KANA.match(kana):
                fail(f"除いたあとの町域のカナ「{kana}」に、カタカナ・数字・英字のほかの字があります（{zip7}。元は「{row[5]}」）")
            if bool(town) != bool(kana):
                fail(f"町域「{town}」とカナ「{kana}」の片方だけが空です（{zip7}）")
            entry = (code, town, kana)
            if entry not in lst:
                lst.append(entry)

    if len(prefs) != 47:
        fail(f"都道府県が {len(prefs)} しかありません（47のはず）")

    header = [
        "# 郵便番号から住所を引くためのデータ（郵便番号の1けためが {d} のもの）。scripts/import_zipcode.py が作る。手で書き換えない",
        f"# 出典: 日本郵便株式会社「住所の郵便番号（1レコード1行、UTF-8形式）」（{SOURCE_URL}）の"
        f" utf_ken_all.zip（SHA-256 {digest}）を加工して作成",
        "# 行の形: C<TAB>全国地方公共団体コード<TAB>都道府県<TAB>市区町村<TAB>都道府県のカナ<TAB>市区町村のカナ",
        "#         郵便番号<TAB>全国地方公共団体コード<TAB>町域<TAB>町域のカナ"
        "（かっこ書き・「以下に掲載がない場合」などを除いた、住所に書く形。町域がないときは空）",
    ]
    os.makedirs(out_dir, exist_ok=True)
    sizes = {}
    for d in "0123456789":
        zips = [z for z in sorted(by_zip) if z[0] == d]
        if not zips:
            fail(f"郵便番号の1けためが {d} のものがありません")
        used = sorted({e[0] for z in zips for e in by_zip[z]})
        lines = [h.format(d=d) for h in header]
        lines += ["\t".join(("C", code) + cities[code]) for code in used]
        lines += ["\t".join((z,) + e) for z in zips for e in by_zip[z]]
        path = os.path.join(out_dir, f"zip{d}.tsv")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")
        sizes[path] = os.path.getsize(path)

    multi = sum(1 for v in by_zip.values() if len(v) > 1)
    print(f"元データ: {src}（{len(raw_zip):,} バイト、SHA-256 {digest}）")
    print(f"行 {len(rows):,}・郵便番号 {len(by_zip):,}・町域がいくつもある郵便番号 {multi:,}・市区町村 {len(cities):,}")
    print(f"以下に掲載がない場合 {counts.get('igai', 0):,}・次に番地がくる場合 {counts.get('tsugi', 0)}・一円 {counts.get('ichien', 0)}"
          f"・地割の範囲 {counts.get('range', 0)}・「、」で並べた町域 {counts.get('list', 0)}"
          f"・かっこ書きを除いたもの {counts.get('paren', 0):,}・そのまま {counts.get('plain', 0):,}")
    for path, size in sizes.items():
        print(f"  {path}: {size:,} バイト")
    print(f"合計 {sum(sizes.values()):,} バイト")


if __name__ == "__main__":
    main()
