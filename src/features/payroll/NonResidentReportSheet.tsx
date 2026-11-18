/**
 * 非居住者等に支払われる給与、報酬、年金及び賞金の支払調書の見た目（非居住者に払った退職手当等の1枚）
 * 欄の並びは、国税庁の様式（様式ID NTAOHSZ521010040）と記載要領（taishoku-tables/source/kisai_chousho27.pdf）に合わせる。
 * ・無効区分は「0」（新規・追加・訂正）。年分と年月日の元号は、記載要領の「元号」欄の数字（constants/taishoku.ts）
 * ・支払金額は国内源泉所得（まだ払っていない額は内書き）、区分は「退職手当等」。支払内容の欄は4行あり、退職手当等は1行目に書く
 * ・個人番号は、事務取扱担当者が選んで鍵を開けたときだけ書く
 */
import type { CSSProperties } from "react";
import { TAISHOKU_NONRESIDENT_REPORT } from "../../constants/taishoku";
import type { NonResidentReport } from "../../utils/retirementReports";
import { toWareki } from "../../utils/wareki";
import type { SlipPayer } from "./RetirementSlipSheet";

const line = "1px solid #000";
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: -1 };
const th: CSSProperties = { border: line, fontSize: 8, fontWeight: "normal", padding: "1px 2px", textAlign: "center", lineHeight: 1.2, backgroundColor: "#f5f5f5" };
const td: CSSProperties = { border: line, fontSize: 11, padding: "2px 4px", height: 22, lineHeight: 1.3 };
const num: CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
const ctr: CSSProperties = { ...td, textAlign: "center" };

const eraCode = (era: string) => TAISHOKU_NONRESIDENT_REPORT.eraCodes[era];

/** 「5（令和） 8年 9月 30日」 */
const dateCell = (d: string) => {
  const w = toWareki(d);
  if (!w) return "";
  const code = eraCode(w.era);
  return `${code ? `${code}（${w.era}）` : w.era} ${w.year === 1 ? "元" : w.year}年 ${w.month}月 ${w.day}日`;
};

export default function NonResidentReportSheet({ data, payer, myNumber }: { data: NonResidentReport; payer: SlipPayer; myNumber: string }) {
  const w = toWareki(`${data.year}-12-31`);
  const yearLabel = w ? `${eraCode(w.era) ? `${eraCode(w.era)}（${w.era}）` : w.era} ${w.year === 1 ? "元" : w.year}` : String(data.year);
  return (
    <div className="page" style={{ width: "100%", maxWidth: 680, margin: "0 auto 16px", fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", color: "#000" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
        <table style={{ ...table, width: 110, marginTop: 0 }}>
          <tbody><tr><th style={th}>無効区分</th><td style={ctr}>0</td></tr></tbody>
        </table>
        <div style={{ fontSize: 14, fontWeight: "bold", textAlign: "center" }}>
          {yearLabel}年分　非居住者等に支払われる給与、報酬、年金及び賞金の支払調書
        </div>
        <div style={{ width: 40 }} />
      </div>
      <table style={table}>
        <colgroup><col style={{ width: 56 }} /><col style={{ width: 92 }} /><col /></colgroup>
        <tbody>
          <tr><th style={th} rowSpan={3}>支払を<br />受ける者</th><th style={th}>居所又は所在地</th><td style={td}>{data.address}</td></tr>
          <tr><th style={th}>氏名又は名称</th><td style={{ ...td, fontSize: 13 }}>{data.name}</td></tr>
          <tr><th style={th}>個人番号又は法人番号</th><td style={{ ...td, fontFamily: "monospace", letterSpacing: 1 }}>{myNumber}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 110 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 130 }} /></colgroup>
        <tbody>
          <tr><th style={th}>区分</th><th style={th}>計算の基礎</th><th style={th}>支払金額</th><th style={th}>源泉徴収税額</th></tr>
          <tr>
            <td style={td}>{data.kubun}</td>
            <td style={{ ...td, fontSize: 9 }}>{data.basis}</td>
            <td style={num}>{data.unpaid > 0 && <div style={{ fontSize: 9 }}>内 {data.unpaid.toLocaleString()} 円</div>}{data.amount.toLocaleString()} 円</td>
            <td style={num}>{data.tax.toLocaleString()} 円</td>
          </tr>
          {[1, 2, 3].map((i) => <tr key={i}><td style={td} /><td style={td} /><td style={num} /><td style={num} /></tr>)}
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 56 }} /><col style={{ width: 92 }} /><col /></colgroup>
        <tbody>
          <tr><th style={th} rowSpan={2}>納税管理人</th><th style={th}>住所又は居所</th><td style={td}>{data.taxAgent.address}</td></tr>
          <tr><th style={th}>氏名</th><td style={td}>{data.taxAgent.name}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 110 }} /><col style={{ width: 80 }} /><col /><col /></colgroup>
        <tbody>
          <tr><th style={th}>退職所得控除額</th><th style={th}>勤続年数</th><th style={th}>就職年月日</th><th style={th}>退職年月日</th></tr>
          <tr>
            <td style={num}>{data.deductionMan.toLocaleString()} 万円</td>
            <td style={num}>{data.years} 年</td>
            <td style={ctr}>{dateCell(data.serviceFrom)}</td>
            <td style={ctr}>{dateCell(data.serviceTo)}</td>
          </tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 56 }} /><col /></colgroup>
        <tbody>
          <tr><th style={th}>摘要</th><td style={{ ...td, fontSize: 9, height: 44, verticalAlign: "top", whiteSpace: "pre-wrap" }}>{data.remarks}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 56 }} /><col style={{ width: 120 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 130 }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={2}>支払者</th><th style={th}>住所（居所）又は所在地</th><td style={td}>{payer.address}</td>
            <th style={th}>電話番号</th><td style={td}>{payer.phone}</td>
          </tr>
          <tr>
            <th style={th}>氏名又は名称</th><td style={td}>{payer.name}</td>
            <th style={th}>個人番号又は法人番号</th><td style={{ ...td, fontFamily: "monospace" }}>{payer.corporateNumber}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
