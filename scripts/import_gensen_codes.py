#!/usr/bin/env python3
"""
国税庁「令和N年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」の第2章（給与所得の源泉徴収票）の PDF から、
源泉徴収票の記載に使う区分など（TypeScript）を作る。

使い方:
    python3 -I scripts/import_gensen_codes.py nencho-tables/tebiki-02.pdf 2026 src/constants/nencho/gensen2026.ts

・PDF は国税庁のページ（https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/index.htm）の「第2章」
  （入手元とハッシュは nencho-tables/README.md）。
・PDF の文字は scripts/pdf_to_text.swift（macOS の PDFKit）で取り出す。
・AI や手作業で区分の数字を書き写さないための道具。区分・生年月日の境目・摘要の文はすべて PDF の文字から機械的に読み取る。
・国税庁の様式が変わって読み取れない・数が合わない場合は、エラーで止まる（中途半端なデータは作らない）。
"""
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# 元号の元年の前の年（平成1年 = 1989年）
ERA_BASE = {"昭和": 1925, "平成": 1988, "令和": 2018}


def pdf_lines(pdf):
    """PDF の文字を、全角を半角にした（NFKC。（→( にもなる）行のリストにする。空白は残す"""
    out = subprocess.run(["swift", str(SCRIPT_DIR / "pdf_to_text.swift"), str(pdf)], check=True, capture_output=True, text=True).stdout
    return unicodedata.normalize("NFKC", out).splitlines()


def one(pattern, text, what):
    found = re.findall(pattern, text)
    assert len(found) == 1, f"{what} が1つに決まりません: {found}"
    return found[0]


def same(pattern, text, what):
    """何か所かに同じことが書いてあるもの（すべて同じでなければ止まる）"""
    found = set(re.findall(pattern, text))
    assert len(found) == 1, f"{what} が1つに決まりません: {found}"
    return found.pop()


def born_on_or_after(pattern, joined, what):
    """「平成21年1月3日以後に生まれた方」→ 2009-01-03"""
    era, y, m, d = one(pattern, joined, what)
    return f"{ERA_BASE[era] + int(y):04d}-{int(m):02d}-{int(d):02d}"


def page_text(lines, start_marker, end_marker):
    """start_marker を含む行から end_marker を含む行の前まで（空白を除いて1つの文字列にする）"""
    flat = [re.sub(r"\s+", "", line) for line in lines]
    i = next(k for k, line in enumerate(flat) if start_marker in line)
    j = next(k for k in range(i + 1, len(flat)) if end_marker in flat[k])
    return flat[i:j]


def parse(lines):
    joined = "".join(re.sub(r"\s+", "", line) for line in lines)

    # ⑲ 住宅借入金等特別控除区分：「01 住」「11 住（特）」…（記載方法の表の、税務署提出用の数字と受給者交付用の表示）
    table = page_text(lines, "区分控除申告書", "控除申告書・証明書の区分表示箇所")
    kinds = []
    for line in table:
        for code, label in re.findall(r"(\d{2})([住認震](?:\((?:特|特特|特特特|特家)\))?)(?![\d(])", line):
            kinds.append({"code": code, "label": label.replace("(", "（").replace(")", "）")})
    assert len(kinds) == 14, f"住宅借入金等特別控除区分の数が14ではありません: {kinds}"
    assert len({k["code"] for k in kinds}) == 14, f"住宅借入金等特別控除区分の数字が重なっています: {kinds}"
    # 数字と表示が対応しているか（1の位：1=住・2=認・4=震、10の位：0=なし・1=特・2=特特・3=特特特・4=特家）
    head = {"1": "住", "2": "認", "4": "震"}
    tail = {"0": "", "1": "（特）", "2": "（特特）", "3": "（特特特）", "4": "（特家）"}
    for k in kinds:
        assert k["label"] == head[k["code"][1]] + tail[k["code"][0]], f"住宅借入金等特別控除区分の数字と表示が合いません: {k}"

    # ㉒ 特定親族特別控除の額の区分：「63 万円 10 11 62 万円超（※） 85 万円以下」
    codes = []
    for line in lines:
        m = re.fullmatch(r"\s*(\d+)\s*万円\s+(\d{2})\s+(\d{2})\s+(\d+)\s*万円超\s*(?:\(※\))?\s*(\d+)\s*万円以下\s*", line)
        if m:
            amount, resident, non_resident, over, up_to = m.groups()
            codes.append({
                "amount": int(amount) * 10000, "over": int(over) * 10000, "upTo": int(up_to) * 10000,
                "resident": resident, "nonResident": non_resident,
            })
    assert len(codes) == 9, f"特定親族特別控除の額の区分が9行ではありません: {codes}"
    for a, b in zip(codes, codes[1:]):
        assert a["upTo"] == b["over"] and a["amount"] > b["amount"], f"特定親族特別控除の額の区分の並びがおかしい: {a} {b}"

    # ㉒ 居住者の区分（控除対象配偶者・控除対象扶養親族・16歳未満の扶養親族が、どれも「00」）
    spouse = one(r"配偶者\)が居住者である場合には「(\d{2})」", joined, "控除対象配偶者の居住者の区分")
    dependent = one(r"控除対象扶養親族の分類記載方法居住者(\d{2})", joined, "控除対象扶養親族の居住者の区分")
    young = one(r"16歳未満の扶養親族が国内に住所を有する方である場合には「(\d{2})」", joined, "16歳未満の扶養親族の区分")
    assert spouse == dependent == young, f"居住者の区分が違います: {spouse} {dependent} {young}"

    # 4 用語の説明：年末調整をしない人の源泉徴収票（扶養控除等申告書の記載に応じて書く）に使う線
    # (1) 源泉控除対象配偶者：受給者（合計所得金額が○万円以下）と生計を一にする配偶者で、合計所得の見積額が○万円以下
    recipient, source_spouse = one(
        r"源泉控除対象配偶者とは、受給者\(合計所得金額が([\d,]+)万円以下である方に限ります。\)と生計を一にする配偶者で、合計所得の見積額が([\d,]+)万円以下である方",
        joined, "源泉控除対象配偶者の線")
    # (2) 同一生計配偶者：合計所得金額が○万円以下（令和N年M月D日以前は○万円以下）
    current, until_m, until_d, earlier = one(
        r"同一生計配偶者とは、受給者と生計を一にする配偶者で、合計所得金額が(\d+)万円以下\(令和\d+年(\d+)月(\d+)日以前は(\d+)万円以下\)",
        joined, "同一生計配偶者の線")
    # (4) 特定親族：年齢○歳以上○歳未満、合計所得金額が○万円超（M月D日以前は○万円超）○万円以下
    age_from, age_to, sr_over, sr_earlier, sr_up_to = one(
        r"特定親族とは、受給者と生計を一にする年齢(\d+)歳以上(\d+)歳未満の親族等で合計所得金額が(\d+)万円超\(令和\d+年\d+月\d+日以前は(\d+)万円超\)(\d+)万円以下",
        joined, "特定親族の線")
    # (5) 源泉控除対象親族：控除対象扶養親族又は合計所得の見積額が○万円以下である特定親族
    source_relative = one(r"源泉控除対象親族とは、控除対象扶養親族又は合計所得の見積額が(\d+)万円以下である特定親族", joined, "源泉控除対象親族の線")
    assert sr_over == current and sr_earlier == earlier, f"同一生計配偶者と特定親族の線が合いません: {current} {earlier} {sr_over} {sr_earlier}"
    assert (age_from, age_to) == ("19", "23"), f"特定親族の年齢が19歳以上23歳未満ではありません: {age_from} {age_to}"
    assert int(earlier) < int(current) and int(earlier) < int(source_relative) < int(sr_up_to), "線の大きさの順がおかしい"
    man = lambda v: int(v.replace(",", "")) * 10000

    return {
        "residentCode": spouse,
        "withoutAdjustment": {
            "recipientIncomeLimit": man(recipient),
            "spouseIncomeLimit": man(source_spouse),
            "earlierUntil": f"{until_m.zfill(2)}-{until_d.zfill(2)}",
            "earlierIncomeLimit": man(earlier),
            "currentIncomeLimit": man(current),
            "specificRelativeLimit": man(source_relative),
        },
        "specificRelativeCodes": codes,
        "housingLoanKinds": sorted(kinds, key=lambda k: (k["code"][1], k["code"][0])),
        # ㉖ 未成年者・⑪ 16歳未満の扶養親族
        "minorBornOnOrAfter": born_on_or_after(r"未成年者とは、(平成|令和)(\d+)年(\d+)月(\d+)日以後に生まれた方", joined, "未成年者の生年月日"),
        "youngBornOnOrAfter": born_on_or_after(r"16歳未満の扶養親族とは、(平成|令和)(\d+)年(\d+)月(\d+)日以後に生まれた方", joined, "16歳未満の生年月日"),
        # ⑯・㉚(4) 生命保険料控除の特例を受けたときに摘要欄に書く文
        "lifeInsuranceYoungNote": same(r"「(租税特別措置法第\d+条の\d+の\d+第\d+項適用)」", joined, "生命保険料控除の特例の摘要"),
    }


def to_ts(data, year, pdf_hash):
    body = json.dumps(data, ensure_ascii=False, indent=2)
    # キーの引用符を外す（ほかの生成ファイルと見た目をそろえる）
    body = re.sub(r'^(\s*)"(\w+)":', r"\1\2:", body, flags=re.M)
    return f"""/**
 * 令和{year - 2018}年分の給与所得の源泉徴収票の記載に使う区分など
 *
 * ⚠️ このファイルは自動生成です。手で書き換えないでください。
 * 元データ: 国税庁「令和{year - 2018}年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第2章の PDF
 *           （nencho-tables/tebiki-02.pdf。SHA-256 {pdf_hash}。入手元は nencho-tables/README.md）
 * 出典    : 国税庁ホームページ（https://www.nta.go.jp/publication/pamph/hotei/tebiki{year}/index.htm）の手引を加工して作成
 *           （PDF の記載要領を Q で使える形に変換したもので、国税庁が作成したものではありません）
 * 作り方  : python3 -I scripts/import_gensen_codes.py <PDF> <年> <このファイル>
 */
import type {{ WithholdingSlipMaster }} from './nenchoTypes';

export const GENSEN_{year}: WithholdingSlipMaster = {{
  year: {year},
{body[2:-2]}
}};
"""


def main():
    if len(sys.argv) != 4:
        sys.exit("使い方: python3 -I scripts/import_gensen_codes.py <PDF> <年> <出力の .ts>")
    pdf, year, out = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
    pdf_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
    data = parse(pdf_lines(pdf))
    out.write_text(to_ts(data, year, pdf_hash), encoding="utf-8")
    print(f"{out} を作りました：住宅借入金等特別控除区分 {len(data['housingLoanKinds'])}、特定親族の区分 {len(data['specificRelativeCodes'])}行、"
          f"未成年者 {data['minorBornOnOrAfter']} 以後生、16歳未満 {data['youngBornOnOrAfter']} 以後生、"
          f"年末調整をしない人の線 {data['withoutAdjustment']}")


if __name__ == "__main__":
    main()
