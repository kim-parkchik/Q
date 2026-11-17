#!/usr/bin/env python3
"""
雇用保険の届書の電子申請用ファイル（ハローワークに出す CSV形式届書ファイル。10101-shutoku.csv など）の形を、
厚生労働省の仕様書の PDF から読み取って、Q で使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_koyo_format.py koyo-format/source/specs02.pdf koyo-format/source/001738607.pdf src/constants/koyoTodoke.ts

読むもの（厚生労働省 職業安定局「磁気媒体届書作成仕様書（光ディスク等仕様書）／ＣＳＶ形式届書作成仕様書（電子申請）
（雇用保険適用関係届書）」令和５年１１月（第14.00版））:
・表紙の版
・3.1 ファイル名の (2) ＣＳＶ形式届書ファイルのファイル名（5つの届書）
・表3.3.1-1 電子申請用ファイルの構成要素（事業所識別符号 [kanri]・データ識別符号 [data]・収録件数 1,000件以下）
・表3.4 使用可能文字一覧（1バイト文字）・使用可能コード範囲（2バイト文字）
・4.1.1 ＦＤ管理レコード（代表届書コードと、届書ごとの連記式項目バージョン）・4.1.3.1 事業所数情報・4.1.3.2 事業所情報
・4.1.5 資格取得届・4.1.6 資格喪失届（離職票交付なし）・4.1.7 資格喪失届（離職票交付あり。離職証明書）・4.1.8 転勤届・
  4.1.9 個人番号登録届の、データレコードの項目構成（図）と項目説明（表。種別・文字数・元号・区分のコード）と作成例
・参考資料３ 国籍・地域一覧、参考資料４ 在留資格一覧、参考資料５ 被保険者氏名（ローマ字）使用可能文字種一覧

あわせて、厚生労働省「雇用保険事務手続きの手引き【第２編】被保険者資格の取得・喪失編」の「離職理由欄（⑦欄）の各項目の内容について」
から、離職理由の区分の名前（1(1)「倒産手続開始、手形取引停止による離職」など）を読む。

・字と位置は scripts/pdf_to_chars.swift（macOS の PDFKit）で取り出す。
・このファイルは、ファイルの1行目などに「項目行」（項目の名前を並べた行）を書くので、項目の名前は図の字のまま（全角・半角も）にする。
・項目説明の表は枠がつながっていて、字の並びでは列がわからないので、表の見出しの「項番」「種別」「文字数」の位置で列に分け、
  項番と同じ高さの種別・文字数を結び付ける（「漢字」の下に離れて並ぶ「数字 英字 カナ」は、カナなどで書くときの決まり。
  「漢字 数字 英字 カナ」が続けて並ぶものは、全角・半角どちらでも書ける項目）。
・区分のコード（“1” など）は、設定内容の「・新規 ：」と同じ高さの “1” を結び付けて読む。
・資格喪失届（離職票交付あり）の賃金の欄（02〜25）は、表では「XX」として1回だけ書いてあるので、図の名前と同じ並びで24回くり返し、
  図の名前が「XX」を 02〜25 にしたものと同じことを確かめる。
・どれか1つでも読めないとき、図の項目の数と表の項番がそろわないとき、仕様書の作成例の行が読んだ決まりに合わないときは、
  ファイルを作らずに止まる（AI や手作業で書き写さないための道具）。
・仕様書（約5MB）と手引き（約6MB）はリポジトリに入れない（koyo-format/README.md の入手元から取ってくる）。
"""
import json
import re
import subprocess
import sys
import unicodedata
from collections import namedtuple
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
Line = namedtuple("Line", "x y w h t")


def fail(message):
    print(f"止まりました: {message}", file=sys.stderr)
    sys.exit(1)


def nfkc(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def soft(s):
    """NFKC で半角にするが、丸数字（①など）は残す（NFKC は「①」を「1」にする）"""
    return re.sub(r"\s+", " ", "".join(ch if "①" <= ch <= "⑳" else unicodedata.normalize("NFKC", ch) for ch in s)).strip()


def squash(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def read_lines(pdf):
    """ページごとの字のまとまり（行）と位置。字は PDF のまま（NFKC にしない）"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_chars.swift"), str(pdf)], check=True, capture_output=True, text=True).stdout
    pages, cur = {}, None
    for raw in out.splitlines():
        m = re.match(r"=== page (\d+) ===$", raw)
        if m:
            cur = int(m.group(1))
            pages[cur] = []
            continue
        x, y, w, h, text = raw.split("\t", 4)
        pages[cur].append(Line(float(x), float(y), float(w), float(h), text))
    if not pages:
        fail(f"{pdf} から字を取り出せません")
    return pages


def page_text(lines):
    return " ".join(nfkc(l.t) for l in sorted(lines, key=lambda l: (-l.y, l.x)))


def find_page(pages, caption, start=1, what=None):
    """caption のあるページ。「図 …」「表 …」の見出しは、行の初めにあるもの（本文の「図 …のとおり」は除く）"""
    key = squash(caption)
    head = re.match(r"^[図表]", key) is not None
    for no in sorted(pages):
        if no < start:
            continue
        if any((squash(l.t).startswith(key) if head else key in squash(l.t)) for l in pages[no]):
            return no
    fail(f"「{what or caption}」が見つかりません")


# ── 項目構成の図 ──

def figure_text(pages, caption, what):
    """項目構成の図（図の見出し caption の最初のページから）の、図の字（8pt）を上から順につなぐ。「次ページへ」は次のページにつなぐ"""
    no = find_page(pages, caption, what=what)
    text = ""
    while True:
        lines = [l for l in pages[no] if 7.5 <= l.h <= 8.5 and "," in l.t or (7.5 <= l.h <= 8.5 and re.search(r"[↓\]]", l.t))]
        lines.sort(key=lambda l: (-l.y, l.x))
        text += "".join(l.t for l in lines)
        if any("次ページへ" in l.t for l in pages[no]):
            no += 1
            continue
        return text


def split_figure(text, what):
    """図の字を「↓」で区切って、ＦＤ管理レコード・事業所数情報・事業所情報・データレコードの項目行と例の行に分ける"""
    parts = [p for p in text.split("↓")]
    try:
        k = parts.index("[kanri]")
        d = parts.index("[data]")
    except ValueError:
        fail(f"{what}の項目構成の図に [kanri] と [data] がありません")
    if k != 2 or d != 7:
        fail(f"{what}の項目構成の図の並びが思ったものと違います（[kanri] {k}・[data] {d}）")
    return {
        "media": (parts[0].split(","), parts[1].split(",")),
        "count": (parts[3].split(","), parts[4].split(",")),
        "office": (parts[5].split(","), parts[6].split(",")),
        # 図の名前の前後の空白は取る（離職票交付ありの図に「, 被保険者期間算定対象期間開始（月）11」と空白が入っている）
        "data": [name.strip() for name in parts[8].split(",")],
    }


def example_values(pages, caption, header, what):
    """作成例の図（見出し caption のページ）の、項目行（header）のあとの例の行（「,」のある行）をつなぐ"""
    no = find_page(pages, caption, what=what)
    lines = sorted([l for l in pages[no] if 8.5 <= l.h <= 9.5], key=lambda l: (-l.y, l.x))
    text = "".join(l.t for l in lines if "," in l.t or "↓" in l.t)
    head = ",".join(header) + "↓"
    if head not in text:
        fail(f"{what}の作成例の項目行が、項目構成の図と合いません")
    body = text.split(head, 1)[1]
    return body.split("↓", 1)[0].split(",")


# ── 項目説明の表 ──

KINDS = ("数字", "英字", "カナ", "漢字", "-")
LEN_HEAD = re.compile(r"^(\d+(?:~\d+)?(?:,\d+(?:~\d+)?)*)(?:\s|$)")


def field(name, kinds, length, alt=None):
    """種別（["数字"] や ["漢字","数字","英字","カナ"]）と文字数（「7」「1~4」「0~6」「0,12」「0,2~5」）から、項目の決まりを作る"""
    if not kinds or any(k not in KINDS for k in kinds):
        fail(f"{name}の種別「{kinds}」を読めません")
    if re.fullmatch(r"\d+", length):
        lengths = {"min": int(length), "max": int(length)}
    elif re.fullmatch(r"\d+~\d+", length):
        a, b = map(int, length.split("~"))
        lengths = {"min": a, "max": b}
    elif re.fullmatch(r"\d+(?:~\d+)?(?:,\d+(?:~\d+)?)+", length):
        only = []
        for part in length.split(","):
            a, _, b = part.partition("~")
            only += list(range(int(a), int(b or a) + 1))
        lengths = {"min": min(only), "max": max(only), "only": only}
    else:
        fail(f"{name}の文字数「{length}」を読めません")
    f = {"name": name, "kinds": kinds, **lengths}
    if alt:
        f["alt"] = alt
    return f


def table_columns(lines):
    """表の見出し（いちばん上の「項番」「種別」「文字数」）の位置"""
    heads = {}
    for l in lines:
        t = squash(l.t)
        for key in ("項番", "種別", "文字数", "設定内容", "作成例"):
            if t == key or (key == "項番" and t.startswith("項番")):
                if key not in heads or l.y > heads[key].y:
                    heads[key] = l
    if not all(k in heads for k in ("項番", "種別", "文字数")):
        return None
    top = heads["種別"].y
    if abs(heads["項番"].y - top) > 15 or abs(heads["文字数"].y - top) > 15:
        return None
    return {"no": heads["項番"].x, "kind": heads["種別"].x, "len": heads["文字数"].x, "top": max(heads["項番"].y, top, heads["文字数"].y),
            "example": heads["作成例"].x if "作成例" in heads else None}


def table_page(lines, cols):
    """1ページの表の、項番（高さと番号）・種別の縦のまとまり・文字数（高さと値）"""
    nx, kx, lx, top = cols["no"], cols["kind"], cols["len"], cols["top"]
    nums, kinds, lens = [], [], []
    for l in lines:
        if l.y >= top - 1 or l.y < 45:
            continue
        t = nfkc(l.t).replace("―", "-").replace("─", "-")
        if nx - 6 <= l.x <= nx + 12:
            m = re.match(r"^(\d{1,3})(?:\s|$)", t)
            if m:
                nums.append((l.y, int(m.group(1))))
        if kx - 10 <= l.x < lx - 3:
            words = t.split(" ")
            ks = [w for w in words if w in KINDS]
            if ks and len(ks) == len([w for w in words if not LEN_HEAD.match(w)]):
                for i, k in enumerate(ks):
                    kinds.append((l.y - i * 11.7, k))
                rest = " ".join(w for w in words if w not in KINDS)
                m = LEN_HEAD.match(rest)
                if rest and m:
                    lens.append((l.y, m.group(1)))
        if lx - 12 <= l.x < lx + 15:
            m = LEN_HEAD.match(t)
            if m:
                lens.append((l.y, m.group(1)))
    return sorted(nums, reverse=True), sorted(kinds, reverse=True), sorted(lens, reverse=True)


def stacks_of(kinds, num_ys):
    """種別の字を、縦に続けて並ぶまとまり（行の間が 13pt 以下）に分ける。項番の高さで、まとまりを切る"""
    out = []
    for y, k in kinds:
        new_row = any(abs(y - ny) <= 3 for ny in num_ys)
        if out and not new_row and 0 < out[-1]["bottom"] - y <= 13.5:
            out[-1]["kinds"].append(k)
            out[-1]["bottom"] = y
        else:
            out.append({"top": y, "bottom": y, "kinds": [k]})
    return out


def read_table(pages, caption, stop, what, debug=False):
    """
    項目説明の表（見出し caption のページから、stop（表のあとの見出し）のページまで）を、字の位置で読む
    戻り値: {項番: (種別, 文字数, カナなどで書くときの (種別, 文字数) か None)} と、項目ごとの設定内容の行
    """
    first = find_page(pages, caption, what=what)
    last = find_page(pages, stop, first, what=f"{what}の表の終わり")
    found, cells = {}, {}
    cols = None
    prev_no = None
    for no in range(first, last + 1):
        lines = pages[no]
        if no == last:
            stop_y = max((l.y for l in lines if squash(stop) in squash(l.t)), default=None)
            lines = [l for l in lines if l.y > stop_y + 1]
        c = table_columns(lines)
        if c:
            cols = c
        elif cols is None:
            continue
        else:
            cols = {**cols, "top": 800}
        nums, kinds, lens = table_page(lines, cols)
        if not nums and not kinds:
            continue
        num_ys = [y for y, _ in nums]
        stacks = stacks_of(kinds, num_ys)
        if debug:
            print(f"[{what} p{no}] 項番 {nums}\n  種別 {[(round(s['top']), s['kinds']) for s in stacks]}\n  文字数 {lens}", file=sys.stderr)
        # 文字数を、同じ高さの種別のまとまりに結び付ける
        free = list(lens)
        for s in stacks:
            hit = [v for v in free if abs(v[0] - s["top"]) <= 3]
            if len(hit) != 1:
                fail(f"{what}の表の{no}ページの、高さ {s['top']:.1f} の種別 {s['kinds']} の文字数を読めません（{hit}）")
            s["len"] = hit[0][1]
            free.remove(hit[0])
        if free:
            fail(f"{what}の表の{no}ページに、種別と結び付かない文字数があります（{free}）")
        # 項番と同じ高さのまとまりはその項目の決まり、項番のないまとまりは、すぐ上の項目の「カナなどで書くとき」の決まり
        prev = None
        for s in stacks:
            hit = [n for y, n in nums if abs(y - s["top"]) <= 3]
            if hit:
                n = hit[0]
                if n in found:
                    fail(f"{what}の項番{n}が2回あります")
                found[n] = [s["kinds"], s["len"], None]
                prev = n
            else:
                if prev is None or found[prev][0] != ["漢字"] or found[prev][2] is not None:
                    fail(f"{what}の表の{no}ページの、高さ {s['top']:.1f} の種別 {s['kinds']} を、どの項目のものか決められません")
                found[prev][2] = (s["kinds"], s["len"])
        missing = [n for _, n in nums if n not in found]
        if missing:
            fail(f"{what}の表の{no}ページの項番 {missing} の種別を読めません")
        # 設定内容の行（区分のコードを読むのに使う）
        tops = sorted(nums, reverse=True)
        # 作成例の列の印（「ス」「４１３」など）は除く
        ex = cols.get("example")
        body = [l for l in lines if l.x >= cols["len"] + 15 and 45 < l.y < cols["top"] - 1
                and not (ex is not None and l.x >= ex - 5 and len(nfkc(l.t)) <= 4)]
        # 文字数とつながった設定内容（「５ “22223”を設定する オ」）は、文字数のあとを設定内容にする
        for l in lines:
            if cols["len"] - 12 <= l.x < cols["len"] + 15 and 45 < l.y < cols["top"] - 1:
                m = LEN_HEAD.match(nfkc(l.t))
                if m and nfkc(l.t)[m.end():].strip():
                    body.append(Line(cols["len"] + 15, l.y, l.w, l.h, nfkc(l.t)[m.end():].strip()))
        if tops and prev_no is not None and body:
            cells.setdefault(prev_no, []).extend(l for l in body if l.y > tops[0][0] + 3)
        for i, (y, n) in enumerate(tops):
            below = tops[i + 1][0] if i + 1 < len(tops) else 0
            cells.setdefault(n, []).extend(l for l in body if below + 3 < l.y <= y + 3)
        if tops:
            prev_no = tops[-1][1]
    return found, cells


def fields_from(found, names, what, numbers=None):
    numbers = numbers or list(range(1, len(names) + 1))
    if sorted(found) != sorted(numbers):
        fail(f"{what}の表の項番が、項目構成の図の{len(names)}項目とそろいません（足りない {sorted(set(numbers) - set(found))} / 多い {sorted(set(found) - set(numbers))}）")
    out = {}
    for n in numbers:
        kinds, length, alt = found[n]
        out[n] = field(names[n - 1], kinds, length, field("カナなどで書くとき", *alt) if alt else None)
    return out


def check_example(fields, values, what):
    """作成例の値が、読んだ項目の決まり（数字の項目は数字だけ・文字数）に合うか"""
    if len(values) != len(fields):
        fail(f"{what}の作成例の項目の数（{len(values)}）が、項目の数（{len(fields)}）と合いません")
    for f, v in zip(fields, values):
        n = len(v)
        ok = (n in f["only"]) if f.get("only") else f["min"] <= n <= f["max"]
        if not ok and f.get("alt"):
            ok = f["alt"]["min"] <= n <= f["alt"]["max"]
        if not ok or (f["kinds"] == ["数字"] and v and not v.isdigit()) or (f["kinds"] == ["-"] and v):
            fail(f"{what}の作成例の「{f['name']}」の値「{v}」が、項目の決まりに合いません: {f}")


# ── 区分のコードと元号 ──

def codes_in(cell, what, item):
    """設定内容の行の「・新規 ：」と、同じ高さの “1” を結び付ける（ラベルが2行以上にわたるものは、「：」で終わる行の高さで結ぶ）"""
    lines = sorted(cell, key=lambda l: (-l.y, l.x))
    code_lines = []
    labels = []
    cur = None
    for l in lines:
        t = soft(l.t)
        cm = re.fullmatch(r"[“\"](\d+)[”\"]\s*[、,]?", t)
        if cm:
            code_lines.append((l.y, cm.group(1)))
            continue
        if t.startswith("・") and not re.match(r"^・\s*\S+?が「", t):
            cur = {"text": t[1:].strip(), "y": l.y}
        elif cur is not None:
            cur["text"] += t
            cur["y"] = l.y
        else:
            continue
        m = re.match(r"^(.*?)\s*[:：]\s*(?:[“\"](\d+)[”\"])?\s*[、,]?$", cur["text"])
        if m:
            labels.append({"label": m.group(1).strip(), "y": cur["y"], "code": m.group(2)})
            cur = None
    out = {}
    for lab in labels:
        code = lab["code"]
        if code is None:
            hit = [c for y, c in code_lines if abs(y - lab["y"]) <= 3]
            if len(hit) != 1:
                fail(f"{what}の「{item}」の区分「{lab['label']}」のコードを読めません（{hit}）")
            code = hit[0]
        if lab["label"] in out:
            fail(f"{what}の「{item}」の区分「{lab['label']}」が2回あります")
        out[lab["label"]] = code
    if not out:
        fail(f"{what}の「{item}」の区分を読めません")
    return out


def eras_in(cell, what, item):
    text = "".join(nfkc(l.t) for l in sorted(cell, key=lambda l: (-l.y, l.x)))
    eras = re.findall(r"“(明治|大正|昭和|平成|令和)”", text)
    if not eras or len(set(eras)) != len(eras):
        fail(f"{what}の「{item}」の元号を読めません（{text[:80]}）")
    order = ["明治", "大正", "昭和", "平成", "令和"]
    return sorted(eras, key=order.index)


def fixed_value(cell, what, item):
    text = "".join(nfkc(l.t) for l in sorted(cell, key=lambda l: (-l.y, l.x)))
    m = re.search(r"“(\d+)”\s*を設定する", text) or re.search(r"[“\"](\d+)[”\"]\s*「[有無]」を設定する", text)
    if not m:
        fail(f"{what}の「{item}」に設定する値を読めません（{text[:80]}）")
    return m.group(1)


# ── 参考資料・文字 ──

def find_heading(pages, text):
    """大きな字（15pt 以上）の見出しのあるページ（変更履歴などの小さな字は除く）"""
    key = squash(text)
    for no in sorted(pages):
        if any(squash(l.t) == key and l.h >= 15 for l in pages[no]):
            return no
    fail(f"「{text}」の見出しが見つかりません")


def read_nationalities(pages):
    """参考資料３ 国籍・地域一覧。コードと同じ高さの名前（2行にわたる名前は、すぐ上のコードのない行とつなぐ）"""
    first = find_heading(pages, "参考資料３")
    rows = []
    for no in range(first, first + 5):
        lines = pages.get(no, [])
        if no > first and not any("国籍地域コード" in nfkc(l.t) for l in lines):
            break
        codes = [l for l in lines if re.fullmatch(r"\d{3}", nfkc(l.t))]
        names = [l for l in lines if not re.fullmatch(r"\d{3}", nfkc(l.t)) and nfkc(l.t) not in ("国籍・地域", "国籍地域コード", "国籍・地域一覧")
                 and not nfkc(l.t).startswith("-") and "参考資料" not in nfkc(l.t)]
        for c in codes:
            cand = [l for l in names if abs(l.y - c.y) <= 2 and l.x < c.x]
            if not cand:
                fail(f"国籍・地域一覧の{no}ページの、コード {c.t} の国籍・地域を読めません")
            name = max(cand, key=lambda l: l.x)
            text = name.t.strip()
            above = [l for l in names if abs(l.x - name.x) <= 2 and 0 < l.y - c.y <= 14
                     and not any(abs(o.y - l.y) <= 2 and abs(o.x - c.x) <= 2 for o in codes)]
            if above:
                text = max(above, key=lambda l: -l.y).t.strip() + text
            rows.append((text, c.t.strip()))
    names = [n for n, _ in rows]
    if len(rows) < 150 or len(set(names)) != len(names):
        fail(f"国籍・地域一覧を読めません（{len(rows)}件・重なり {len(names) - len(set(names))}）")
    if dict(rows).get("アメリカ合衆国") != "840" or dict(rows).get("フランス") != "250" or dict(rows).get("アフガニスタン") != "004":
        fail("国籍・地域一覧のコードが、仕様書の作成例（アメリカ合衆国 840・フランス 250・アフガニスタン 004）と合いません")
    return rows


def read_statuses(pages):
    """参考資料４ 在留資格一覧（在留資格・CSV に書く値・コード）。2行にわたる名前はつなぐ"""
    first = find_heading(pages, "参考資料４")
    out = []
    for no in (first, first + 1):
        lines = pages[no]
        codes = sorted([l for l in lines if re.fullmatch(r"\d{2}", nfkc(l.t))], key=lambda l: (l.x, -l.y))
        heads = sorted([l for l in lines if nfkc(l.t) == "在留資格" or nfkc(l.t).startswith("(CSV設定値)")], key=lambda l: l.x)
        csv_xs = sorted({round(l.x) for l in lines if nfkc(l.t).startswith("(CSV設定値)")})
        if not csv_xs:
            fail(f"在留資格一覧の{no}ページの「CSV設定値」の列が見つかりません")
        for c in codes:
            # このコードの左にある CSV 設定値の列と、その左の在留資格の列
            cx = max(x for x in csv_xs if x < c.x)
            dx = max((round(l.x) for l in heads if round(l.x) < cx), default=None)
            def cell(x, y):
                parts = [l for l in lines if abs(l.x - x) <= 2 and abs(l.y - y) <= 2]
                if not parts:
                    return None
                text = parts[0].t.strip()
                # 下の行が、次のコードの高さに来るまで続く（2行にわたる名前）
                below = sorted([l for l in lines if abs(l.x - x) <= 2 and 0 < y - l.y <= 13.5], key=lambda l: -l.y)
                for b in below:
                    if any(abs(b.y - o.y) <= 2 for o in codes if abs(o.x - c.x) <= 2):
                        break
                    text += b.t.strip()
                return text
            csv = cell(cx, c.y)
            disp = cell(dx, c.y) if dx is not None else None
            if not csv:
                fail(f"在留資格一覧の{no}ページの、コード {c.t} の値を読めません")
            out.append({"name": (disp or csv), "csv": csv, "code": c.t.strip()})
    if len(out) < 60:
        fail(f"在留資格一覧を読めません（{len(out)}件）")
    by = {o["code"]: o for o in out}
    if by.get("26", {}).get("csv") != "永住者" or by.get("29", {}).get("csv") != "定住者":
        fail("在留資格一覧のコードが、仕様書の作成例（永住者 26・定住者 29）と合いません")
    for o in out:
        abolished = "廃止済" in o["name"]
        for k in ("name", "csv"):
            v = re.sub(r"\s*※\s*\d\s*$", "", o[k]).strip()
            # 「特定技能 1号」の空白は、PDF の字の間の空きなので取る（在留カードは「特定技能1号」。CSV は20字で切った値と合う）
            o[k] = re.sub(r"\s+(?=[0-9０-９]号)", "", v)
        o["abolished"] = abolished
        if abolished:
            # ※1 資格喪失届の場合、「（※廃止済）」は入力しない
            o["name"] = re.sub(r"\s*[（(]\s*※\s*廃止済\s*[）)]?", "", o["name"]).strip()
            o["csv"] = o["name"]
        o["free"] = o["code"] == "30"
        if o["free"]:
            # 「30」不明：在留資格（又は不明理由）を20字以内で書く
            o["csv"] = ""
        elif o["csv"] != o["name"][:20]:
            fail(f"在留資格一覧の「{o['name']}」の CSV に書く値「{o['csv']}」が、在留資格の初めの20字と合いません")
    return out


def read_single_byte(pages, caption, heading=None):
    no = find_heading(pages, heading) if heading else find_page(pages, caption)
    text = page_text(pages[no])
    half = {unicodedata.normalize("NFKC", chr(c)): chr(c) for c in range(0xFF61, 0xFFA0)}
    chars = set()
    body = text[text.index(nfkc(caption)) if nfkc(caption) in text else 0:]
    body = body.split("◎", 1)[0]
    for token in body.split(" "):
        if len(token) != 1:
            continue
        if re.fullmatch(r"[0-9A-Za-z]", token):
            chars.add(token)
        elif token in half and half[token] not in "｡｢｣､･":
            chars.add(half[token])
    if "(長音)" in body:
        chars.add("ｰ")
    if "(ハイフン)" in body or "(ﾊｲﾌﾝ)" in body:
        chars.add("-")
    if "SP" in body:
        chars.add(" ")
    digits = [c for c in chars if c.isdigit()]
    upper = [c for c in chars if "A" <= c <= "Z"]
    lower = [c for c in chars if "a" <= c <= "z"]
    kana = [c for c in chars if "｡" <= c <= "ﾟ"]
    return "".join(sorted(chars, key=ord)), (len(digits), len(upper), len(lower), len(kana))


def read_double_byte_ranges(pages):
    """表3.4 使用可能コード範囲（2バイト文字）の「使用可能コード範囲」の列（いちばん右の列。字の位置で読む）"""
    no = find_page(pages, "使用可能コード範囲（２バイト文字）")
    lines = pages[no]
    head = [l for l in lines if squash(l.t) == "使用可能コード範囲"]
    if not head:
        fail("表3.4 の「使用可能コード範囲」の列が見つかりません")
    hx = head[0].x
    ranges = []
    for l in sorted(lines, key=lambda l: -l.y):
        if l.x < hx - 15 or l.y >= head[0].y:
            continue
        t = nfkc(l.t)
        m = re.fullmatch(r"([0-9A-F]{4})(?:~([0-9A-F]{4}))?(?:※\d)?", t)
        if m:
            ranges.append([int(m.group(1), 16), int(m.group(2) or m.group(1), 16)])
        elif t != "無し":
            fail(f"表3.4 の「使用可能コード範囲」の「{t}」を読めません")
    text = page_text(lines)
    if len(ranges) < 10 or not any(a == 0x889F for a, _ in ranges) or not any(b == 0xEAA4 for _, b in ranges):
        fail(f"2バイト文字の使用可能コード範囲を読めません（{len(ranges)}件）")
    if "XX7F" not in text or "XXFD~XX3F" not in text or "A0XX~DFXX" not in text:
        fail("2バイト文字の、使えないコード（XX7F・XXFD~XX3F・A0XX~DFXX）の注を読めません")
    return ranges


def read_reasons(tebiki):
    """手引きの「離職理由欄（⑦欄）の各項目の内容について」から、離職理由の区分の名前（字は手引きのまま。行の区切りはつなぐ）"""
    first = find_page(tebiki, "離職理由欄（⑦欄）の各項目の内容について")
    text = ""
    for no in range(first, first + 3):
        text += "".join(l.t.strip() for l in sorted(tebiki[no], key=lambda l: (-l.y, l.x)))
    d = r"[0-9０-９]"
    lp, rp = r"[(（]", r"[)）]"
    def half(s):
        return unicodedata.normalize("NFKC", s)
    out = {}
    for m in re.finditer(rf"(?<![0-9０-９(（])({d}){lp}({d}){rp}([①-⑦])?の?「(.+?)」", text):
        key = f"{half(m.group(1))}({half(m.group(2))})" + (m.group(3) or "")
        out.setdefault(key, m.group(4))
    for m in re.finditer(rf"(?<![0-9０-９(（])({d})「(.+?)」", text):
        out.setdefault(half(m.group(1)), m.group(2))
    m = re.search(rf"及び{lp}2{rp}の「(.+?)」", text) or re.search(rf"及び{lp}２{rp}の「(.+?)」", text)
    if m:
        out.setdefault("4(2)", m.group(1))
    m5 = re.search(rf"[5５]\s*の「労働者の判断によるもの」の{lp}[2２]{rp}の「(.+?)」", text)
    m6 = re.search(rf"[6６]\s*の「(その他.+?)」", text)
    if not m5 or not m6:
        fail("手引きの離職理由の区分 5(2)・6 を読めません")
    out["5(2)"] = m5.group(1)
    out["6"] = m6.group(1)
    need = ["1(1)", "1(2)", "2", "3(1)", "3(2)", "3(3)", "3(4)", "4(1)", "4(2)", "4(3)", "5(1)①", "5(1)②", "5(1)③", "5(1)④", "5(1)⑤", "5(1)⑥", "5(2)", "6"]
    missing = [k for k in need if k not in out]
    if missing:
        fail(f"手引きの離職理由の区分 {missing} を読めません")
    return {k: out[k] for k in need}


def ts(v):
    return json.dumps(v, ensure_ascii=False)


def fields_ts(fields):
    rows = []
    for f in fields:
        rows.append("  " + ts(f))
    return "[\n" + ",\n".join(rows) + ",\n]"


def main():
    if len(sys.argv) != 4:
        fail("使い方: python3 -I scripts/import_koyo_format.py <仕様書 specs02.pdf> <手引き 第2編 PDF> <出力 koyoTodoke.ts>")
    pdf, tebiki_pdf, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    debug = "--debug" in sys.argv
    pages = read_lines(pdf)
    tebiki = read_lines(tebiki_pdf)

    cover = nfkc(" ".join(l.t for l in pages[1]))
    m = re.search(r"(令和\d+年\d+月)\s*\(第\s*([\d.]+)\s*版\)", cover)
    if not m or "雇用保険適用関係届書" not in squash(cover):
        fail(f"表紙の版を読めません（{cover[:80]}）")
    version = f"{m.group(1)}（第{m.group(2)}版）"

    # 3.1 ファイル名
    no = find_page(pages, "ＣＳＶ形式届書ファイルのファイル名")
    text = page_text(pages[no])
    names_part = text.split("CSV形式届書ファイルのファイル名", 1)[1]
    files = {}
    for key, title in (("shutoku", "雇用保険被保険者資格取得届(連記式)"), ("soshitsu", "雇用保険被保険者資格喪失届(連記式)(離職票交付なし)"),
                       ("rishoku", "雇用保険被保険者資格喪失届(連記式)(離職票交付あり)"), ("tenkin", "雇用保険被保険者転勤届(連記式)"),
                       ("bango", "雇用保険個人番号登録届(連記式)")):
        m = re.search(re.escape(title) + r"\s*(\d{5})-\s*([a-z]+)\.csv", names_part)
        if not m:
            fail(f"{title}のファイル名を読めません")
        files[key] = f"{m.group(1)}-{m.group(2)}.csv"

    # 表3.3.1-1 構成要素
    no = find_page(pages, "表 ３.３.１－１ 電子申請用ファイルの構成要素")
    text = page_text(pages[no])
    if "“[kanri]”と設定する" not in text or "“[data]”と設定する" not in text:
        fail("表3.3.1-1 の事業所識別符号・データ識別符号を読めません")
    if "収録件数は1,000" not in text or "件以下に設定する" not in text:
        fail("表3.3.1-1 の収録件数を読めません")
    max_records = 1000

    # 文字
    single, counts = read_single_byte(pages, "表 ３.４ 使用可能文字一覧（１バイト文字）")
    if counts != (10, 26, 26, 56) and counts != (10, 26, 26, 57) and counts != (10, 26, 26, 58):
        fail(f"1バイト文字の一覧を読めません（数字・英大・英小・カナ {counts}）")
    if "-" not in single or " " not in single:
        fail("1バイト文字のハイフン・スペースを読めません")
    double = read_double_byte_ranges(pages)
    romaji, rcounts = read_single_byte(pages, "被保険者氏名（ローマ字）使用可能文字種一覧", "参考資料５")

    # ── ＦＤ管理レコード・事業所 ──
    common = None
    records = {}
    specs = [
        ("shutoku", "資格取得届", "図 ４.１.５－１", "表 ４.１.５－１", "（３） データレコード（資格取得届）の作成例", "図 ４.１.５－３"),
        ("soshitsu", "資格喪失届（離職票交付なし）", "図 ４.１.６－１", "表 ４.１.６－１", "（３） データレコード（資格喪失届（離職票交付なし））の作成例", "図 ４.１.６－３"),
        ("rishoku", "資格喪失届（離職票交付あり）", "図 ４.１.７－１", "表 ４.１.７－１", "（３） データレコード（資格喪失届（離職票交付あり））の作成例", None),
        ("tenkin", "転勤届", "図 ４.１.８－１", "表 ４.１.８－１", "（３） データレコード（転勤届）の作成例", "図 ４.１.８－３"),
        ("bango", "個人番号登録届", "図 ４.１.９－１", "表 ４.１.９－１", "（３） データレコード（個人番号登録届）の作成例", None),
    ]
    for key, what, fig, table, stop, example in specs:
        parts = split_figure(figure_text(pages, fig, what), what)
        if common is None:
            common = parts
        for part in ("media", "count", "office"):
            if parts[part][0] != common[part][0]:
                fail(f"{what}の図の{part}の項目行が、資格取得届の図と違います")
        names = parts["data"]
        if key == "rishoku":
            numbers = list(range(1, 109)) + list(range(454, len(names) + 1))
        else:
            numbers = None
        found, cells = read_table(pages, table, stop, what, debug)
        fields = fields_from(found, names, what, numbers)
        if key == "rishoku":
            # 賃金の欄 02〜25（表は XX として 94〜108 に1回だけ）
            if len(names) != 524:
                fail(f"{what}の図の項目が 524 ではありません（{len(names)}）")
            for n in range(109, 454):
                base = 94 + (n - 94) % 15
                row = 2 + (n - 94) // 15
                tmpl = fields[base]
                want = names[base - 1].replace("02", f"{row:02d}")
                if not names[base - 1].endswith("02") or names[n - 1] != want:
                    fail(f"{what}の図の{n}番目の項目「{names[n - 1]}」が、くり返しの「{want}」と違います")
                fields[n] = {**tmpl, "name": names[n - 1]}
            # 表の名前（XX）と図の名前（02）
        records[key] = {"what": what, "names": names, "fields": [fields[n] for n in range(1, len(names) + 1)], "cells": cells,
                        "media_example": parts["media"][1], "data_example_fig": None}
        if example:
            vals = example_values(pages, example, names, what)
            check_example(records[key]["fields"], vals, what)
            records[key]["example"] = vals
        # 連記式項目バージョンは、表の説明と図の例の両方から
        records[key]["version"] = parts["media"][1][5]

    # ＦＤ管理レコード（表 4.1.1-1）
    media_found, media_cells = read_table(pages, "表 ４.１.１－１ ＦＤ管理レコードの項目説明", "（３） ＦＤ管理レコードの作成例", "ＦＤ管理レコード", debug)
    media_names = common["media"][0]
    media = [fields_from(media_found, media_names, "ＦＤ管理レコード")[n] for n in range(1, len(media_names) + 1)]
    text = "".join(nfkc(l.t) for n in sorted(media_cells) for l in sorted(media_cells[n], key=lambda l: (-l.y, l.x)))
    m = re.search(r"“(\d{5})”を設定する", text)
    if not m:
        fail("代表届書コードを読めません")
    representative = m.group(1)
    vers = {}
    for key, label in (("shutoku", "雇用保険被保険者資格取得届の場合"), ("soshitsu", "雇用保険被保険者資格喪失届(離職票交付なし)の場合"),
                       ("rishoku", "雇用保険被保険者資格喪失届(離職票交付あり)の場合"), ("tenkin", "雇用保険被保険者転勤届の場合"),
                       ("bango", "雇用保険個人番号登録届の場合")):
        m = re.search(re.escape(label) + r".*?“(\d{2})”\s*固定", text)
        if not m:
            fail(f"連記式項目バージョン（{label}）を読めません")
        vers[key] = m.group(1)
        if records[key]["version"] != vers[key]:
            fail(f"連記式項目バージョン（{label}）が、図の例（{records[key]['version']}）と表（{vers[key]}）で違います")
    check_example(media, common["media"][1], "ＦＤ管理レコード")

    count_found, count_cells = read_table(pages, "表 ４.１.３.１－１ 事業所数情報の項目説明", "（３） 事業所数情報の作成例", "事業所数情報", debug)
    count_names = common["count"][0]
    count = [fields_from(count_found, count_names, "事業所数情報")[n] for n in range(1, len(count_names) + 1)]
    check_example(count, common["count"][1], "事業所数情報")
    office_found, _ = read_table(pages, "表 ４.１.３.２－１ 事業所情報の項目説明", "（３） 事業所情報の作成例", "事業所情報", debug)
    office_names = common["office"][0]
    office = [fields_from(office_found, office_names, "事業所情報")[n] for n in range(1, len(office_names) + 1)]
    check_example(office, common["office"][1], "事業所情報")

    # ── 帳票種別・元号・区分のコード ──
    def cell(key, name):
        names = records[key]["names"]
        if name not in names:
            fail(f"{records[key]['what']}に「{name}」がありません")
        return records[key]["cells"].get(names.index(name) + 1, [])

    form_codes = {key: fixed_value(cell(key, "帳票種別"), records[key]["what"], "帳票種別") for key in records}
    if form_codes["soshitsu"] != form_codes["rishoku"]:
        fail("資格喪失届の帳票種別が、離職票交付のあり・なしで違います")
    for key in records:
        if not files[key].startswith(form_codes[key] + "-"):
            fail(f"{records[key]['what']}の帳票種別 {form_codes[key]} が、ファイル名 {files[key]} と合いません")
    wish = {"soshitsu": fixed_value(cell("soshitsu", "離職票交付希望"), "資格喪失届（離職票交付なし）", "離職票交付希望"),
            "rishoku": fixed_value(cell("rishoku", "離職票交付希望"), "資格喪失届（離職票交付あり）", "離職票交付希望")}

    # 元号（項目ごとに書ける元号）
    for key, rec in records.items():
        for i, f in enumerate(rec["fields"]):
            if f["name"].endswith("（元号）") and f["kinds"] != ["-"]:
                c = rec["cells"].get(i + 1, [])
                if not c and key == "rishoku" and i + 1 > 108:
                    continue
                f["eras"] = eras_in(c, rec["what"], f["name"])

    codes = {}
    def take(key, name, label=None):
        c = codes_in(cell(key, name), records[key]["what"], name)
        codes[label or name] = c
        return c
    take("shutoku", "取得区分")
    take("shutoku", "性別")
    take("shutoku", "被保険者となったことの原因")
    take("shutoku", "賃金（支払の態様）", "支払の態様")
    take("shutoku", "雇用形態")
    take("shutoku", "職種")
    take("shutoku", "就職経路")
    take("shutoku", "資格外活動許可の有無")
    take("shutoku", "派遣・請負就労区分")
    loss = take("soshitsu", "喪失原因")
    if codes_in(cell("rishoku", "喪失原因"), "資格喪失届（離職票交付あり）", "喪失原因") != loss:
        fail("喪失原因のコードが、離職票交付のあり・なしで違います")
    for key in ("soshitsu", "rishoku", "tenkin", "bango"):
        if key in ("soshitsu", "rishoku"):
            for name in ("性別", "派遣・請負就労区分"):
                if codes_in(cell(key, name), records[key]["what"], name) != codes[name]:
                    fail(f"{records[key]['what']}の{name}のコードが、資格取得届と違います")
    if codes_in(cell("bango", "性別"), "個人番号登録届", "性別") != codes["性別"]:
        fail("個人番号登録届の性別のコードが、資格取得届と違います")
    # 離職理由の選択（選択１－１ など）とその下の項目
    reason = {}
    for i, name in enumerate(records["rishoku"]["names"]):
        if name.startswith("選択") or name in ("異議の有無",):
            f = records["rishoku"]["fields"][i]
            if f["kinds"] == ["数字"] and f["max"] <= 1:
                reason[name] = codes_in(records["rishoku"]["cells"].get(i + 1, []), "資格喪失届（離職票交付あり）", name)
    flag = {"選択しない": "0", "選択する": "1"}
    flags = [n for n, c in reason.items() if c == flag]
    if len(flags) != 20:
        fail(f"離職理由の選択（「選択しない」0・「選択する」1）が20個ではありません（{flags}）")
    reasons = read_reasons(tebiki)

    # 作成例（離職票交付ありは、項目構成の図の例の行で確かめる）
    rishoku_fig = figure_text(pages, "図 ４.１.７－１", "資格喪失届（離職票交付あり）").split("↓")
    vals = rishoku_fig[9].split(",")
    check_example(records["rishoku"]["fields"], vals, "資格喪失届（離職票交付あり）")
    records["rishoku"]["example"] = vals
    bango_fig = figure_text(pages, "図 ４.１.９－１", "個人番号登録届").split("↓")
    vals = bango_fig[9].split(",")
    check_example(records["bango"]["fields"], vals, "個人番号登録届")
    records["bango"]["example"] = vals

    nationalities = read_nationalities(pages)
    statuses = read_statuses(pages)

    total = {k: len(r["fields"]) for k, r in records.items()}
    if total != {"shutoku": 63, "soshitsu": 56, "rishoku": 524, "tenkin": 41, "bango": 20}:
        fail(f"届書の項目の数が思ったものと違います（{total}）")

    lines = []
    w = lines.append
    w("/**")
    w(" * 雇用保険の届書の電子申請用ファイル（ハローワークに出す CSV形式届書ファイル）の形")
    w(" *")
    w(f" * 厚生労働省 職業安定局「磁気媒体届書作成仕様書（光ディスク等仕様書）／ＣＳＶ形式届書作成仕様書（電子申請）（雇用保険適用関係届書）」{version}")
    w(" * と「雇用保険事務手続きの手引き【第２編】」から、scripts/import_koyo_format.py で作ったファイルです。手で直さないでください。")
    w(" * 作り方と入手元は koyo-format/README.md")
    w(" */")
    w("")
    w("/** 項目の決まり（種別・文字数。only は書ける文字数を並べたもの。alt はカナなどで書くときの決まり。eras は書ける元号） */")
    w("export interface KoyoField {")
    w("  name: string;")
    w("  kinds: string[];")
    w("  min: number;")
    w("  max: number;")
    w("  only?: number[];")
    w("  alt?: { name: string; kinds: string[]; min: number; max: number; only?: number[] };")
    w("  eras?: string[];")
    w("}")
    w("")
    w("export type KoyoForm = \"shutoku\" | \"soshitsu\" | \"rishoku\" | \"tenkin\" | \"bango\";")
    w("")
    w(f"/** 仕様書の版 */\nexport const KOYO_SPEC_VERSION = {ts(version)};")
    w(f"/** ファイル名（3.1 (2)） */\nexport const KOYO_FILE_NAMES: Record<KoyoForm, string> = {ts(files)};")
    w(f"/** 帳票種別（データレコードの項番1） */\nexport const KOYO_FORM_CODES: Record<KoyoForm, string> = {ts(form_codes)};")
    w(f"/** 代表届書コード（ＦＤ管理レコード） */\nexport const KOYO_REPRESENTATIVE_CODE = {ts(representative)};")
    w(f"/** 連記式項目バージョン（ＦＤ管理レコード） */\nexport const KOYO_FORM_VERSIONS: Record<KoyoForm, string> = {ts(vers)};")
    w(f"/** 離職票交付希望に書く値（離職票交付なしの届書は「無」、ありの届書は「有」） */\nexport const KOYO_RISHOKUHYO_WISH = {ts(wish)};")
    w(f"/** 1つのファイルに書ける届書の数（表3.3.1-1） */\nexport const KOYO_MAX_RECORDS = {max_records};")
    w("/** 事業所識別符号・データ識別符号（表3.3.1-1） */\nexport const KOYO_OFFICE_MARK = \"[kanri]\";\nexport const KOYO_DATA_MARK = \"[data]\";")
    w(f"/** ＦＤ管理レコード（図4.1.1-1・表4.1.1-1） */\nexport const KOYO_MEDIA_FIELDS: KoyoField[] = {fields_ts(media)};")
    w(f"/** 事業所数情報（表4.1.3.1-1） */\nexport const KOYO_OFFICE_COUNT_FIELDS: KoyoField[] = {fields_ts(count)};")
    w(f"/** 事業所情報（表4.1.3.2-1） */\nexport const KOYO_OFFICE_FIELDS: KoyoField[] = {fields_ts(office)};")
    titles = {"shutoku": "資格取得届（4.1.5）", "soshitsu": "資格喪失届（離職票交付なし。4.1.6）", "rishoku": "資格喪失届（離職票交付あり。離職証明書。4.1.7）",
              "tenkin": "転勤届（4.1.8）", "bango": "個人番号登録届（4.1.9）"}
    consts = {"shutoku": "KOYO_SHUTOKU_FIELDS", "soshitsu": "KOYO_SOSHITSU_FIELDS", "rishoku": "KOYO_RISHOKU_FIELDS", "tenkin": "KOYO_TENKIN_FIELDS", "bango": "KOYO_BANGO_FIELDS"}
    for key in ("shutoku", "soshitsu", "rishoku", "tenkin", "bango"):
        w(f"/** データレコード：{titles[key]} */\nexport const {consts[key]}: KoyoField[] = {fields_ts(records[key]['fields'])};")
    w(f"/** 仕様書の作成例の行（テストで使う） */\nexport const KOYO_EXAMPLES: Record<KoyoForm, string[]> = {ts({k: r['example'] for k, r in records.items()})};")
    w(f"/** 区分のコード（項目説明の設定内容） */\nexport const KOYO_CODES: Record<string, Record<string, string>> = {ts(codes)};")
    w(f"/** 離職理由の選択などのコード（資格喪失届（離職票交付あり）） */\nexport const KOYO_REASON_CODES: Record<string, Record<string, string>> = {ts(reason)};")
    w(f"/** 離職理由の区分の名前（手引き「離職理由欄（⑦欄）の各項目の内容について」） */\nexport const KOYO_REASON_TITLES: Record<string, string> = {ts(reasons)};")
    w(f"/** 国籍・地域一覧（参考資料３。[国籍・地域, 国籍地域コード]） */\nexport const KOYO_NATIONALITIES: [string, string][] = {ts(nationalities)};")
    w(f"/** 在留資格一覧（参考資料４。name は在留カードの在留資格、csv はファイルに書く値（20字まで）、abolished は廃止済（喪失届だけ）、free は「不明」（在留資格を20字以内で書く）） */\nexport const KOYO_RESIDENCE_STATUSES: {{ name: string; csv: string; code: string; abolished: boolean; free: boolean }}[] = {ts(statuses)};")
    w(f"/** 1バイト文字で項目に書ける字（表3.4） */\nexport const KOYO_SINGLE_BYTE_CHARS = {ts(single)};")
    w(f"/** 被保険者氏名（ローマ字）に書ける字（参考資料５） */\nexport const KOYO_ROMAJI_CHARS = {ts(romaji)};")
    w("/**\n * 2バイト文字で使えるシフトJISのコードの範囲（表3.4 使用可能コード範囲）\n * 下2桁が 7F・FD〜3F、上2桁が A0〜DF のコードは使えない（表3.4 の注）\n */")
    w("export const KOYO_DOUBLE_BYTE_RANGES: [number, number][] = [" + ", ".join(f"[0x{a:04X}, 0x{b:04X}]" for a, b in double) + "];")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{out} を作りました（{version}・資格取得届 {total['shutoku']}・資格喪失届 {total['soshitsu']}・離職票交付あり {total['rishoku']}・"
          f"転勤届 {total['tenkin']}・個人番号登録届 {total['bango']}項目・国籍・地域 {len(nationalities)}・在留資格 {len(statuses)}・"
          f"1バイト文字 {len(single)}字・ローマ字 {len(romaji)}字・2バイト文字の範囲 {len(double)}）")


if __name__ == "__main__":
    main()
