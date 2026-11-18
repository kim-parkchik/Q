/**
 * 退職所得の源泉徴収票・特別徴収票の見た目（1人1枚）
 * 欄の並びは、国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」第3章の見本（①〜⑪の欄）に合わせる。
 * ・受給者交付用：無効区分・マイナンバー・法人番号の欄は書かない
 * ・税務署提出用・市区町村提出用：無効区分「0」、受給者のマイナンバー（事務取扱担当者が選んで鍵を開けたときだけ）、支払者の法人番号を書く
 * ・区分の段：上段（申告書あり・他の退職手当等なし）、中段（申告書あり・他の退職手当等あり）、下段（申告書なし）の1つに書く
 * ・④番号は、確定拠出年金の一時金・譲渡制限付株式などのときだけ書く。⑤支払金額は、作る日に未払の額があれば内書きする
 */
import type { CSSProperties } from "react";
import { deductionLabel, type RetirementResult, type RetirementSection } from "../../utils/retirementIncome";
import { toWareki } from "../../utils/wareki";

export type SlipCopy = "employee" | "tax" | "city";

export const SLIP_COPY_LABELS: Record<SlipCopy, string> = {
  employee: "受給者交付用",
  tax: "税務署提出用",
  city: "市区町村提出用",
};

export interface RetirementSlipData {
  name: string;
  address: string;
  januaryAddress: string;
  position: string;
  amount: number;
  serviceFrom: string;
  serviceTo: string;
  /** 源泉徴収票を作る日に未払の額（内書きする） */
  unpaid: number | null;
  /** ④番号（空なら書かない） */
  slipNumber: string;
  result: RetirementResult;
}

export interface SlipPayer {
  name: string;
  address: string;
  phone: string;
  corporateNumber: string;
}

const line = "1px solid #000";
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: -1 };
const th: CSSProperties = { border: line, fontSize: 8, fontWeight: "normal", padding: "1px 2px", textAlign: "center", lineHeight: 1.2, backgroundColor: "#f5f5f5" };
const td: CSSProperties = { border: line, fontSize: 11, padding: "2px 4px", height: 20, lineHeight: 1.3 };
const num: CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
const ctr: CSSProperties = { ...td, textAlign: "center" };

const n = (v: number) => v.toLocaleString();
const era = (d: string) => {
  const w = toWareki(d);
  return w ? { era: w.era, y: w.year === 1 ? "元" : String(w.year), m: String(w.month), d: String(w.day) } : { era: "", y: "", m: "", d: "" };
};

const SECTIONS: { key: RetirementSection; label: string }[] = [
  { key: "upper", label: "上段：「退職所得の受給に関する申告書」あり（その年に支払済みの他の退職手当等なし）" },
  { key: "middle", label: "中段：申告書あり（その年に支払済みの他の退職手当等あり）" },
  { key: "lower", label: "下段：申告書なし（100分の20.42 で源泉徴収）" },
];

export default function RetirementSlipSheet({ data, payer, copy, myNumber }: { data: RetirementSlipData; payer: SlipPayer; copy: SlipCopy; myNumber: string }) {
  const r = data.result;
  const yearW = toWareki(`${r.year}-01-01`);
  const yearLabel = yearW ? `${yearW.era}${yearW.year === 1 ? "元" : yearW.year}` : String(r.year);
  const forOffice = copy !== "employee";
  const from = era(data.serviceFrom);
  const to = era(data.serviceTo);
  return (
    <div className="page" style={{ width: "100%", maxWidth: 640, margin: "0 auto 16px", fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", color: "#000" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 12 }}>{yearLabel}年分</div>
        <div style={{ fontSize: 16, fontWeight: "bold", letterSpacing: 2 }}>退職所得の源泉徴収票・特別徴収票</div>
        <div style={{ fontSize: 10, border: line, padding: "1px 6px" }}>{SLIP_COPY_LABELS[copy]}</div>
      </div>
      {forOffice && (
        <table style={{ ...table, width: 120, marginTop: 0, marginBottom: 4 }}>
          <tbody><tr><th style={th}>① 無効区分</th><td style={ctr}>0</td></tr></tbody>
        </table>
      )}
      <table style={table}>
        <colgroup><col style={{ width: 90 }} /><col /><col style={{ width: 60 }} /><col style={{ width: 130 }} /></colgroup>
        <tbody>
          <tr><th style={th} colSpan={4}>② 支払を受ける者</th></tr>
          <tr><th style={th}>住所又は居所</th><td style={td} colSpan={3}>{data.address}</td></tr>
          <tr><th style={th}>{yearLabel}年1月1日の住所</th><td style={td} colSpan={3}>{data.januaryAddress}</td></tr>
          <tr><th style={th}>氏名</th><td style={{ ...td, fontSize: 13 }} colSpan={3}>{data.name}</td></tr>
          <tr>
            <th style={th}>個人番号</th><td style={{ ...td, fontFamily: "monospace", letterSpacing: 1 }}>{forOffice ? myNumber : ""}</td>
            <th style={th}>役職名</th><td style={td}>{data.position}</td>
          </tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col /><col style={{ width: 36 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 80 }} /><col style={{ width: 80 }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={2}>③ 区分</th><th style={th} rowSpan={2}>④ 番号</th><th style={th} rowSpan={2}>⑤ 支払金額</th><th style={th} rowSpan={2}>⑥ 源泉徴収税額</th>
            <th style={th} colSpan={2}>⑦ 特別徴収税額</th>
          </tr>
          <tr><th style={th}>市町村民税</th><th style={th}>道府県民税</th></tr>
          {SECTIONS.map((s) => {
            const on = s.key === r.section;
            return (
              <tr key={s.key}>
                <td style={{ ...td, fontSize: 8 }}>{s.label}</td>
                <td style={ctr}>{on ? data.slipNumber : ""}</td>
                <td style={num}>
                  {on && !!data.unpaid && <div style={{ fontSize: 8, textAlign: "left" }}>内 {n(data.unpaid)}</div>}
                  {on ? n(data.amount) : ""}
                </td>
                <td style={num}>{on ? n(r.incomeTax) : ""}</td>
                <td style={num}>{on ? n(r.cityTax) : ""}</td>
                <td style={num}>{on ? n(r.prefTax) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 100 }} /><col style={{ width: 60 }} /><col /><col /></colgroup>
        <tbody>
          <tr><th style={th}>⑧ 退職所得控除額</th><th style={th}>⑨ 勤続年数</th><th style={th}>就職年月日</th><th style={th}>退職年月日</th></tr>
          <tr>
            <td style={num}>{deductionLabel(r.deduction)}</td>
            <td style={num}>{r.years}年</td>
            <td style={ctr}>{from.era} {from.y}年 {from.m}月 {from.d}日</td>
            <td style={ctr}>{to.era} {to.y}年 {to.m}月 {to.d}日</td>
          </tr>
        </tbody>
      </table>
      <table style={table}>
        <tbody>
          <tr><th style={{ ...th, width: 40 }}>⑩ 摘要</th><td style={{ ...td, height: 64, fontSize: 9, verticalAlign: "top", whiteSpace: "pre-wrap" }}>{r.remarks.join("\n")}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 90 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 130 }} /></colgroup>
        <tbody>
          <tr><th style={th} colSpan={4}>⑪ 支払者</th></tr>
          <tr><th style={th}>住所（居所）又は所在地</th><td style={td} colSpan={3}>{payer.address}</td></tr>
          <tr><th style={th}>氏名又は名称</th><td style={td} colSpan={3}>{payer.name}</td></tr>
          <tr>
            <th style={th}>電話番号</th><td style={td}>{payer.phone}</td>
            <th style={th}>個人番号又は法人番号</th><td style={{ ...td, fontFamily: "monospace" }}>{forOffice ? payer.corporateNumber : ""}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
