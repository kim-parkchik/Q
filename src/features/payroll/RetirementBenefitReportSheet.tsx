/**
 * 退職手当金等受給者別支払調書の見た目（受給者1人に1枚。死亡退職で払う退職手当等）
 * 欄の並びは、国税庁の様式（様式ID NTAOHSZ421010040）と記載要領（taishoku-tables/source/chousho46.pdf・kisai_chousho46.pdf）に合わせる。
 * ・無効区分は「0」（新規・追加・訂正）
 * ・受給者の個人番号は、相続人などから受け取って手で書く（Q には残さない）。退職者の個人番号は、事務取扱担当者が選んで鍵を開けたときだけ書く
 * ・退職手当金等の種類は、退職金・功労金・確定給付企業年金規約などに基づく一時金などの名称。摘要と死亡年月日の欄に退職者の死亡年月日を書く
 */
import type { CSSProperties } from "react";
import { TAISHOKU_REPORT_ERA_CODES } from "../../constants/taishoku";
import type { RetirementHeir } from "../../utils/retirementIncome";
import { toWareki } from "../../utils/wareki";
import type { SlipPayer } from "./RetirementSlipSheet";

export interface BenefitReportData {
  heir: RetirementHeir;
  retireeName: string;
  retireeAddress: string;
  benefitKind: string;
  position: string;
  retireDate: string;
  payDate: string;
  deathDate: string;
  /** 提出年月日（空なら書かない） */
  submitDate: string;
  remarks: string;
}

const line = "1px solid #000";
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: -1 };
const th: CSSProperties = { border: line, fontSize: 8, fontWeight: "normal", padding: "1px 2px", textAlign: "center", lineHeight: 1.2, backgroundColor: "#f5f5f5" };
const td: CSSProperties = { border: line, fontSize: 11, padding: "2px 4px", height: 22, lineHeight: 1.3 };
const num: CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
const ctr: CSSProperties = { ...td, textAlign: "center" };

/** 「5（令和） 8年 9月 30日」（元号の数字は記載要領の「元号」欄。constants/taishoku.ts） */
const dateCell = (d: string) => {
  const w = toWareki(d);
  if (!w) return "";
  const code = TAISHOKU_REPORT_ERA_CODES[w.era];
  return `${code ? `${code}（${w.era}）` : w.era} ${w.year === 1 ? "元" : w.year}年 ${w.month}月 ${w.day}日`;
};

export default function RetirementBenefitReportSheet({ data, payer, retireeNumber }: { data: BenefitReportData; payer: SlipPayer; retireeNumber: string }) {
  return (
    <div className="page" style={{ width: "100%", maxWidth: 640, margin: "0 auto 16px", fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", color: "#000" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
        <table style={{ ...table, width: 110, marginTop: 0 }}>
          <tbody><tr><th style={th}>無効区分</th><td style={ctr}>0</td></tr></tbody>
        </table>
        <div style={{ fontSize: 16, fontWeight: "bold", letterSpacing: 2 }}>退職手当金等受給者別支払調書</div>
        <div style={{ width: 110 }} />
      </div>
      <table style={table}>
        <colgroup><col style={{ width: 56 }} /><col style={{ width: 70 }} /><col /></colgroup>
        <tbody>
          <tr><th style={th} rowSpan={3}>受給者</th><th style={th}>住所又は居所</th><td style={td}>{data.heir.address}</td></tr>
          <tr><th style={th}>氏名</th><td style={{ ...td, fontSize: 13 }}>{data.heir.name}</td></tr>
          <tr><th style={th}>個人番号</th><td style={td} /></tr>
          <tr><th style={th} rowSpan={3}>退職者</th><th style={th}>住所又は居所</th><td style={td}>{data.retireeAddress}</td></tr>
          <tr><th style={th}>氏名</th><td style={{ ...td, fontSize: 13 }}>{data.retireeName}</td></tr>
          <tr><th style={th}>個人番号</th><td style={{ ...td, fontFamily: "monospace", letterSpacing: 1 }}>{retireeNumber}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col /><col style={{ width: 150 }} /><col style={{ width: 210 }} /></colgroup>
        <tbody>
          <tr><th style={th}>退職手当金等の種類</th><th style={th}>退職手当金等の給与金額</th><th style={th}>退職年月日</th></tr>
          <tr><td style={td}>{data.benefitKind}</td><td style={num}>{data.heir.amount.toLocaleString()} 円</td><td style={ctr}>{dateCell(data.retireDate)}</td></tr>
          <tr><th style={th}>退職時の地位職務</th><th style={th}>受給者と退職者との続柄</th><th style={th}>支払年月日</th></tr>
          <tr><td style={td}>{data.position}</td><td style={ctr}>{data.heir.relation}</td><td style={ctr}>{dateCell(data.payDate)}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 40 }} /><col /><col style={{ width: 210 }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={4}>摘要</th>
            <td style={{ ...td, fontSize: 9, verticalAlign: "top", whiteSpace: "pre-wrap" }} rowSpan={4}>{data.remarks}</td>
            <th style={th}>退職者の死亡年月日</th>
          </tr>
          <tr><td style={ctr}>{dateCell(data.deathDate)}</td></tr>
          <tr><th style={th}>提出年月日</th></tr>
          <tr><td style={ctr}>{dateCell(data.submitDate)}</td></tr>
        </tbody>
      </table>
      <table style={table}>
        <colgroup><col style={{ width: 56 }} /><col style={{ width: 120 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 130 }} /></colgroup>
        <tbody>
          <tr>
            <th style={th} rowSpan={2}>支払者</th><th style={th}>営業所又は事務所等の所在地</th><td style={td}>{payer.address}</td>
            <th style={th}>電話番号</th><td style={td}>{payer.phone}</td>
          </tr>
          <tr>
            <th style={th}>営業所又は事務所等の名称又は氏名</th><td style={td}>{payer.name}</td>
            <th style={th}>個人番号又は法人番号</th><td style={{ ...td, fontFamily: "monospace" }}>{payer.corporateNumber}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
