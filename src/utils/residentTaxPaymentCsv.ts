/**
 * eLTAX の納付情報発行依頼（個人住民税（特別徴収））に取り込む CSV
 *
 * ■ 形式：地方税共同機構「個人住民税（特別徴収）CSVレイアウト仕様書（CSVフォーマット）」1.0版
 *   （項目の並びは constants/residentTaxPaymentCsvLayout.ts。仕様書の Excel から自動生成）
 *   ・ヘッダー・レコード（1行）→ データ・レコード（市区町村ごとに1行）→ トレーラー・レコード（合計）→ エンド・レコード の順。
 *     値はカンマで区切る。文字コードは UTF-8（保存は utils/fileSaveUtils.ts で BOM 付き。地方税共同機構「XML構造仕様(詳細)」では、
 *     PCdesk に取り込む納付情報発行依頼の CSV は UTF-8（BOM付））
 *   ・ヘッダーは、仕様書の例と同じく決まった値（データ区分・種別コード）だけを書く（委託者コードなどは書かない）
 *   ・納付月分は和暦の年2桁と月2桁（令和は「01」〜「10」。仕様書「入力方法について」シート）
 *   ・件数は、その月に住民税を引いた人の数。督促手数料・延滞金は 0
 * ■ 額は「住民税の納入」の画面と同じ（utils/residentTaxPayment.ts）。選んだ月の分を、毎月納める市区町村だけ書く。
 *   納期の特例の市区町村は、6か月分をまとめて納めるときの納付月分の書き方が仕様書に書かれていないので、いまは入れない
 */
import { RESIDENT_TAX_PAYMENT_CSV } from "../constants/residentTaxPaymentCsvLayout";
import { localGovLabel } from "./localGov";
import type { PaymentGroup } from "./residentTaxPayment";
import { toWareki } from "./wareki";

export interface PaymentCsvResult {
  /** CSV の中身（BOM は保存するときに付ける）。書く市区町村がなければ空 */
  csv: string;
  /** 書いた市区町村の数・人数・金額の合計 */
  municipalities: number;
  people: number;
  total: number;
  /** 入れなかった市区町村と、その理由 */
  skipped: string[];
  /** CSV を作れない理由（納付月分を和暦で書けないなど） */
  error: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 納付月分（和暦の年2桁・月2桁）。令和1〜10年だけ書ける（仕様書「入力方法について」） */
export const paymentMonthCode = (year: number, month: number): string | null => {
  const w = toWareki(`${year}-${pad2(month)}-01`);
  return w && w.era === "令和" && w.year >= 1 && w.year <= 10 ? `${pad2(w.year)}${pad2(month)}` : null;
};

/** 1行の値の数が仕様書の項目の数と同じか確かめてから、カンマでつなぐ */
const line = (kind: keyof typeof RESIDENT_TAX_PAYMENT_CSV, values: string[]): string => {
  const fields = RESIDENT_TAX_PAYMENT_CSV[kind];
  if (values.length !== fields.length) throw new Error(`${kind} の項目の数が違います（${values.length}／${fields.length}）`);
  values.forEach((v, i) => {
    if (v.length > fields[i].max) throw new Error(`${fields[i].name}が長すぎます（${v}）`);
  });
  return values.join(",");
};

/** 選んだ月の、納付先ごとの額から CSV を作る */
export const buildResidentTaxPaymentCsv = (groups: PaymentGroup[], year: number, month: number): PaymentCsvResult => {
  const result: PaymentCsvResult = { csv: "", municipalities: 0, people: 0, total: 0, skipped: [], error: null };
  const ym = paymentMonthCode(year, month);
  if (!ym) {
    result.error = `${year}年${month}月は、納付月分（令和の年2桁）で書けません`;
    return result;
  }
  const H = RESIDENT_TAX_PAYMENT_CSV;
  const rows: string[] = [];
  for (const g of groups) {
    const name = localGovLabel(g.municipality) || g.code;
    if (!g.code || !g.municipality) {
      result.skipped.push(`${g.code ? `団体コード ${g.code}` : "納付先が未設定"}（${g.people.length}人）：納付先の市区町村を選んでください`);
      continue;
    }
    if (g.setting.specialDue) {
      result.skipped.push(`${name}：納期の特例の市区町村なので入れていません（PCdesk で入れてください）`);
      continue;
    }
    if (g.total <= 0) continue;
    const count = String(g.people.length);
    const amount = String(g.total);
    rows.push(line("data", [H.data[0].fixed!, g.code, ym, g.setting.designation, count, amount, "0", "0", count, amount, "", ""]));
    result.municipalities++;
    result.people += g.people.length;
    result.total += g.total;
  }
  if (rows.length === 0) return result;
  const people = String(result.people);
  const total = String(result.total);
  result.csv = [
    line("header", [H.header[0].fixed!, H.header[1].fixed!, "", "", "", "", "", "", "", ""]),
    ...rows,
    line("trailer", [H.trailer[0].fixed!, people, total, "0", "0", people, total, ""]),
    line("end", [H.end[0].fixed!, ""]),
  ].map((l) => `${l}\r\n`).join("");
  return result;
};
