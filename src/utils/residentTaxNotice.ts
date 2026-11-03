/**
 * eLTAX で受け取る特別徴収税額通知（特別徴収義務者用）の CSV を読み、従業員の住民税（年度ごとの12か月）に入れる
 *
 * ■ 形式：地方税共同機構「処分通知等（税額通知）CSVレイアウト仕様書（総務省通知形式）」（23項目。
 *   項目の並びは constants/residentTaxNoticeCsvLayout.ts。仕様書の Excel から自動生成）
 *   ・1行に1人。項目名の行はない。文字コードは、PCdesk で書き出すときに UTF-8 か Shift-JIS を選ぶ（同仕様書「このCSVファイルについて」）
 *   ・項目の設定内容は、団体によって違うことがある（同仕様書）
 *   ・PCdesk（WEB版）の「特徴税通（特徴義務者用）の照会・出力」で書き出すと ZIP にまとめられる
 *     （eLTAX「特別徴収税額通知（特別徴収義務者用）を確認するには」）→ ZIP を開いてから CSV を選ぶ
 * ■ 年度は CSV に書かれていないので、画面で選ぶ。月割額の並び（6月分〜翌年5月分）は utils/residentTax.ts の年度と同じ
 * ■ 従業員との結び付け：受給者番号（給与支払報告書の CSV に書いた従業員ID）。合わなければ、漢字氏名（空白を除く）が同じ人が1人だけのとき
 * ■ 個人番号（項番8）は読まない（保存も表示もしない）
 */
import { RESIDENT_TAX_NOTICE_CSV_FIELDS } from "../constants/residentTaxNoticeCsvLayout";
import type { ResidentTaxYear } from "./residentTax";

const FIELD_COUNT = RESIDENT_TAX_NOTICE_CSV_FIELDS.length;

export interface NoticeRecord {
  /** ファイルの何行目か */
  line: number;
  designationNumber: string;
  atenaNumber: string;
  /** 市町村コード（6桁） */
  code: string;
  /** 受給者番号 */
  staffNumber: string;
  name: string;
  kana: string;
  /** 特別徴収税額（年税額） */
  annual: number;
  /** 月割額（6月分〜翌年5月分の12個） */
  amounts: number[];
  /** 変更月（変更の通知のとき） */
  changeMonth: number | null;
  /** 摘要（変更の理由） */
  remarks: string;
  /** 取り込める が、確かめてほしいこと */
  warnings: string[];
}

/** ファイルの中身を文字にする（UTF-8 でなければ Shift-JIS。先頭の BOM は除く） */
export const decodeNoticeFile = (bytes: Uint8Array): string => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("shift-jis").decode(bytes);
  }
  return text.replace(/^﻿/, "");
};

const amountOf = (s: string): number | null => {
  const v = s.normalize("NFKC").trim();
  if (!v) return 0;
  return /^\d+$/.test(v) ? Number(v) : null;
};

/** CSV を読む（読めない行は errors に、何行目かを付けて入れる） */
export const parseResidentTaxNotice = (text: string): { records: NoticeRecord[]; errors: string[] } => {
  const records: NoticeRecord[] = [];
  const errors: string[] = [];
  text.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const f = raw.split(",").map((x) => x.trim());
    if (f.length !== FIELD_COUNT) {
      errors.push(`${line}行目：項目が${f.length}個あります（特別徴収税額通知の CSV は${FIELD_COUNT}個）`);
      return;
    }
    const at = (no: number) => f[no - 1];
    const annual = amountOf(at(9));
    const amounts = Array.from({ length: 12 }, (_, k) => amountOf(at(10 + k)));
    if (annual === null || amounts.some((a) => a === null)) {
      errors.push(`${line}行目：${RESIDENT_TAX_NOTICE_CSV_FIELDS[8].name}・月割額に、数字でないものがあります`);
      return;
    }
    const code = at(3).normalize("NFKC");
    if (!/^\d{6}$/.test(code)) {
      errors.push(`${line}行目：${RESIDENT_TAX_NOTICE_CSV_FIELDS[2].name}が6桁の数字ではありません（${at(3)}）`);
      return;
    }
    const cm = at(22).normalize("NFKC");
    const changeMonth = /^\d{1,2}$/.test(cm) && Number(cm) >= 1 && Number(cm) <= 12 ? Number(cm) : null;
    const months = amounts as number[];
    const total = months.reduce((s, a) => s + a, 0);
    const warnings: string[] = [];
    if (total !== annual) warnings.push(`年税額（${annual.toLocaleString()}円）と、12か月の合計（${total.toLocaleString()}円）が合いません`);
    records.push({
      line,
      designationNumber: at(1).normalize("NFKC"),
      atenaNumber: at(2).normalize("NFKC"),
      code,
      staffNumber: at(4).normalize("NFKC"),
      name: at(6),
      kana: at(7),
      annual: annual as number,
      amounts: months,
      changeMonth,
      remarks: at(23),
      warnings,
    });
  });
  return { records, errors };
};

const nameKey = (s: unknown) => String(s ?? "").normalize("NFKC").replace(/\s/g, "");

export interface NoticeMatch {
  /** 結び付けた従業員（なければ null） */
  staffId: string | null;
  /** どう結び付けたか */
  how: "number" | "name" | null;
  /** 氏名が同じ人が2人以上いて、決められなかったときの候補 */
  candidates: string[];
}

/** 1行ごとに、従業員を探す */
export const matchNoticeRecord = (r: NoticeRecord, staff: { id: string | number; name?: string | null }[]): NoticeMatch => {
  if (r.staffNumber) {
    const s = staff.find((x) => String(x.id) === r.staffNumber);
    if (s) return { staffId: String(s.id), how: "number", candidates: [] };
  }
  const same = staff.filter((x) => nameKey(x.name) && nameKey(x.name) === nameKey(r.name));
  if (same.length === 1) return { staffId: String(same[0].id), how: "name", candidates: [] };
  return { staffId: null, how: null, candidates: same.map((x) => String(x.id)) };
};

/** その年度の12か月を、通知の額にする（ほかの年度はそのまま） */
export const withNoticeAmounts = (schedule: ResidentTaxYear[], fiscalYear: number, amounts: number[]): ResidentTaxYear[] =>
  [...schedule.filter((e) => e.fiscalYear !== fiscalYear), { fiscalYear, amounts: [...amounts] }].sort((a, b) => a.fiscalYear - b.fiscalYear);

/** いま入っている額と比べる（new：その年度の額がまだない / same：同じ / changed：違う） */
export const compareWithSchedule = (schedule: ResidentTaxYear[], fiscalYear: number, amounts: number[]): "new" | "same" | "changed" => {
  const e = schedule.find((x) => x.fiscalYear === fiscalYear);
  if (!e) return "new";
  return e.amounts.every((a, i) => a === amounts[i]) ? "same" : "changed";
};
