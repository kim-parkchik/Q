#!/usr/bin/env python3
"""
国税庁の通勤手当の非課税限度額の資料から、給与計算に使うデータファイル（TypeScript）を作る。

使い方:
    python3 -I scripts/import_commute_limits.py commute-tables src/constants/tax/commuteLimits.ts

・commute-tables/ には、国税庁の次の3つを置いておく（入手元とハッシュは commute-tables/README.md）
  - 通勤手当の非課税限度額の改正_令和7年11月.pdf（改正前と、令和7年4月1日以後適用の表）
  - 通勤手当の非課税限度額の改正QA_令和8年4月.pdf（令和8年4月1日以後適用の表と、駐車場等の料金相当額の加算）
  - タックスアンサー2585_マイカー・自転車通勤者の通勤手当.htm（いまの表と、駐車場等・有料道路の決まり）
・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。
・AI や手作業で数字を書き写さないための道具。距離の区分・金額・上限・適用が始まる日は、すべて資料の文字から機械的に読み取る。
・令和8年の表は、Q&A の PDF と タックスアンサーの両方から読み、一つ残らず同じでなければ止まる。
  令和7年の表は、令和7年11月の PDF の「改正後」と、Q&A の「改正前」（同左の行）が同じでなければ止まる。
・様式が変わって読み取れない・数字が合わない場合は、エラーで止まる（中途半端なデータは作らない）。
"""
import html
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

R7_PDF = "通勤手当の非課税限度額の改正_令和7年11月.pdf"
R8_PDF = "通勤手当の非課税限度額の改正QA_令和8年4月.pdf"
TA_HTML = "タックスアンサー2585_マイカー・自転車通勤者の通勤手当.htm"

R7_URL = "https://www.nta.go.jp/users/gensen/2025tsukin/pdf/01.pdf"
R8_URL = "https://www.nta.go.jp/users/gensen/2026tsukin/pdf/01.pdf"
TA_URL = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2585.htm"


def pdf_text(path):
    """PDF の文字を、全角を半角にし（NFKC）、空白をすべて除いて1つの文字列にする"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(path)], check=True, capture_output=True, text=True).stdout
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", out))


def html_text(path):
    """HTML のタグを除き、全角を半角にし（NFKC）、空白をすべて除いて1つの文字列にする"""
    raw = Path(path).read_text(encoding="utf-8")
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))


def yen(s):
    """「38,700円」→ 38700、「(全額課税)」→ 0"""
    return 0 if s == "(全額課税)" else int(s.replace(",", "").replace("円", ""))


def one(pattern, text, what):
    found = re.findall(pattern, text)
    assert len(set(found)) == 1, f"{what} が1つに決まりません: {found}"
    return found[0]


def reiwa_date(text, what):
    """「令和8年4月1日」→ "2026-04-01"（令和元年は2019年）"""
    m = re.fullmatch(r"令和(\d+|元)年(\d+)月(\d+)日", text)
    assert m, f"{what} の日付を読めません: {text}"
    y = 2018 + (1 if m.group(1) == "元" else int(m.group(1)))
    return f"{y}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def band(from_km, to_km, limit):
    return {"fromKm": from_km, "toKm": to_km, "limit": limit}


def check_bands(bands, what):
    """0km から切れ目なく並び、最後は上限なし、2km未満は全額課税で、金額は距離とともに増える"""
    assert bands, f"{what} の表がありません"
    bands.sort(key=lambda b: b["fromKm"])
    assert bands[0]["fromKm"] == 0 and bands[0]["limit"] == 0, f"{what}：2km未満の行（全額課税）がありません: {bands[0]}"
    for a, b in zip(bands, bands[1:]):
        assert a["toKm"] == b["fromKm"], f"{what}：距離の区分が切れ目なく並んでいません: {a} → {b}"
        assert a["limit"] < b["limit"], f"{what}：金額が距離とともに増えていません: {a} → {b}"
    assert bands[-1]["toKm"] is None, f"{what}：最後の行が「以上」になっていません: {bands[-1]}"
    return bands


# ─────────────────────────────────────────────────────────────
# 令和7年11月の PDF：改正前と、令和7年4月1日以後適用の表
# 「通勤距離が片道45km以上55km未満である場合32,300円28,000円」「…2km以上10km未満である場合4,200円同左」
# ─────────────────────────────────────────────────────────────
def parse_r7(text):
    rows = re.findall(r"通勤距離が片道(\d+)km(以上|未満)(?:(\d+)km未満)?である場合(\(全額課税\)|[\d,]+円)(同左|[\d,]+円)", text)
    assert len(rows) >= 3, f"令和7年11月の PDF の表を読めません: {rows}"
    after, before = [], []
    for frm, kind, to, new, old in rows:
        if kind == "未満":  # 「片道2km未満」
            f, t = 0, int(frm)
        else:
            f, t = int(frm), (int(to) if to else None)
        after.append(band(f, t, yen(new)))
        before.append(band(f, t, yen(new) if old == "同左" else yen(old)))
    date = reiwa_date(one(r"改正後の非課税限度額は、(令和\d+年\d+月\d+日)以後に支払われるべき通勤手当について適用されます", text, "令和7年の改正の適用日"), "令和7年の改正の適用日")
    max_fare = yen(one(r"最高限度([\d,]+円)", text, "令和7年11月の PDF の最高限度"))
    return check_bands(before, "令和7年の改正前"), check_bands(after, "令和7年の改正後"), date, max_fare


# ─────────────────────────────────────────────────────────────
# 令和8年4月の Q&A：令和8年4月1日以後適用の表（改正前の列は、55km以上がひとまとめの欄）
# 「片道45km以上55km未満32,300円同左」「片道55km以上65km未満38,700円片道65km以上…」
# ─────────────────────────────────────────────────────────────
def parse_r8(text):
    # 表の部分だけを読む（「≪改正後の１か月当たりの非課税限度額≫」から、駐車場等の行（③）の前まで）
    start = text.index("≪改正後の1か月当たりの非課税限度額≫")
    end = text.index("3自動車や自転車などの交通用具を使用している人で一定の要", start)
    table = text[start:end]
    labels = list(re.finditer(r"片道(\d+)km(以上|未満)(?:(\d+)km未満)?", table))
    assert len(labels) >= 3, f"令和8年4月の Q&A の表を読めません: {table}"
    after, unchanged = [], []
    for i, m in enumerate(labels):
        frm, kind, to = m.groups()
        f, t = (0, int(frm)) if kind == "未満" else (int(frm), int(to) if to else None)
        # その行の文字（次の行の見出しまで）の最初の金額が改正後。「同左」があれば改正前も同じ
        rest = table[m.end(): labels[i + 1].start() if i + 1 < len(labels) else len(table)]
        v = re.match(r"(\(全額課税\)|[\d,]+円)(同左)?", rest)
        assert v, f"令和8年4月の Q&A の「{m.group(0)}」の金額を読めません: {rest}"
        after.append(band(f, t, yen(v.group(1))))
        if v.group(2):
            unchanged.append(band(f, t, yen(v.group(1))))
    date = reiwa_date(one(r"改正後の通勤手当の非課税限度額は、(令和\d+年\d+月\d+日)以後に支払われるべき通勤手当", text, "令和8年の改正の適用日"), "令和8年の改正の適用日")
    parking = yen(one(r"駐車場等の料金相当額\(上限([\d,]+円)\)", text, "駐車場等の料金相当額の上限"))
    max_fare = yen(one(r"最高限度([\d,]+円)", text, "令和8年4月の Q&A の最高限度"))
    return check_bands(after, "令和8年の改正後"), unchanged, date, parking, max_fare


# ─────────────────────────────────────────────────────────────
# タックスアンサー No.2585：いまの表（「45キロメートル以上55キロメートル未満32,300円」）と駐車場等・有料道路の決まり
# ─────────────────────────────────────────────────────────────
def parse_ta(text):
    start = text.index("片道の通勤距離1か月当たりの限度額")
    end = text.index("2マイカーなどで通勤している人で一定の要件を満たす駐車場等", start)
    table = text[start:end]
    rows = re.findall(r"(\d+)キロメートル(以上|未満)(?:(\d+)キロメートル未満)?(\(全額課税\)|[\d,]+円)", table)
    bands = []
    for frm, kind, to, v in rows:
        f, t = (0, int(frm)) if kind == "未満" else (int(frm), int(to) if to else None)
        bands.append(band(f, t, yen(v)))
    parking = yen(one(r"駐車場等の料金相当額\(上限([\d,]+円)\)", text, "タックスアンサーの駐車場等の上限"))
    max_toll = yen(one(r"最高限度([\d,]+円)", text, "タックスアンサーの最高限度"))
    return check_bands(bands, "タックスアンサー No.2585 の表"), parking, max_toll


def main():
    src_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    r7_before, r7_after, r7_date, r7_max = parse_r7(pdf_text(src_dir / R7_PDF))
    r8_after, r8_unchanged, r8_date, r8_parking, r8_max = parse_r8(pdf_text(src_dir / R8_PDF))
    ta_bands, ta_parking, ta_max = parse_ta(html_text(src_dir / TA_HTML))

    # 2つの資料が同じことを言っているか確かめる
    assert r8_after == ta_bands, f"令和8年の表が、Q&A とタックスアンサーで違います:\n{r8_after}\n{ta_bands}"
    assert r8_parking == ta_parking, f"駐車場等の上限が、Q&A とタックスアンサーで違います: {r8_parking} / {ta_parking}"
    assert r7_max == r8_max == ta_max, f"最高限度が資料で違います: {r7_max} / {r8_max} / {ta_max}"
    # Q&A の「同左」の行（令和8年の改正で変わらなかった行）は、令和7年の改正後の表と同じ
    for b in r8_unchanged:
        assert b in r7_after, f"Q&A で「同左」の行が、令和7年の改正後の表にありません: {b}"
    assert len(r8_unchanged) >= 3, f"Q&A の「同左」の行が少なすぎます: {r8_unchanged}"
    # 適用が始まる日は月の初めの日（給与を支払う月で選べるように）
    for d in (r7_date, r8_date):
        assert d.endswith("-01"), f"適用が始まる日が月の初めの日ではありません: {d}"

    periods = [
        {"from": "", "maxPerMonth": r7_max, "parkingAdditionMax": None, "distanceBands": r7_before,
         "source": f"{R7_URL}（改正前の列）"},
        {"from": r7_date, "maxPerMonth": r7_max, "parkingAdditionMax": None, "distanceBands": r7_after,
         "source": f"{R7_URL}（改正後の列）"},
        {"from": r8_date, "maxPerMonth": r8_max, "parkingAdditionMax": r8_parking, "distanceBands": r8_after,
         "source": f"{R8_URL}（Q1-1 の表。{TA_URL} と一致することを確認）"},
    ]
    body = json.dumps(periods, ensure_ascii=False, indent=2).replace('"toKm": null', '"toKm": null')
    out.write_text(f"""/**
 * 通勤手当の非課税限度額（1か月当たり）
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 国税庁の資料（commute-tables/ フォルダ。入手元とハッシュは commute-tables/README.md）
 *   - 「通勤手当の非課税限度額の引上げについて」（令和7年11月）{R7_URL}
 *   - 「通勤手当の非課税限度額の改正に関するＱ＆Ａ」（令和8年4月）{R8_URL}
 *   - タックスアンサー No.2585「マイカー・自転車通勤者の通勤手当」{TA_URL}
 *   （資料を加工して作成したもので、国税庁が作成したものではありません）
 * 作り方  : python3 -I scripts/import_commute_limits.py commute-tables src/constants/tax/commuteLimits.ts
 * 確認    : 令和8年の表は Q&A とタックスアンサーで一致し、令和7年の表は令和7年11月の資料と Q&A の「同左」の行で一致する
 *
 * from は「この日以後に支払われるべき通勤手当」に使う日（空は、それより前のすべて）。
 * maxPerMonth は交通機関・有料道路を使う人の最高限度（合理的な運賃等の額まで）、distanceBands は交通用具（マイカー・自転車など）の
 * 片道の通勤距離の区分（fromKm 以上 toKm 未満。toKm が null は上限なし。limit 0 は全額課税）、
 * parkingAdditionMax は駐車場等の料金相当額を足せる上限（その制度がない期間は null）。
 * 根拠：所得税法9条、所得税法施行令20条の2
 */

export interface CommuteDistanceBand {{
  fromKm: number;
  toKm: number | null;
  limit: number;
}}

export interface CommuteLimitPeriod {{
  from: string;
  maxPerMonth: number;
  parkingAdditionMax: number | null;
  distanceBands: CommuteDistanceBand[];
  source: string;
}}

export const COMMUTE_LIMIT_PERIODS: CommuteLimitPeriod[] = {body};
""", encoding="utf-8")
    print(f"{out} を作りました（{len(periods)} 期間：改正前・{r7_date}〜・{r8_date}〜）")


if __name__ == "__main__":
    main()
