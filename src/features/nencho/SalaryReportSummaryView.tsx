/**
 * 給与支払報告書（総括表）の見た目（地方税法施行規則 第十七号様式。用紙 A5）
 * 欄の並びと書き方は、同様式と「第17号様式記載要領」による（e-Gov 法令検索 地方税法施行規則 第十条関係の様式）。
 * 提出日は、出す日に手で書く（空けておく）。
 */
export interface SummarySheet {
  year: number;
  /** 提出先（様式の外に、どの市区町村の分か分かるように書く） */
  municipalityLabel: string;
  designation: string;
  /** 給与の支払期間（月。記載要領4） */
  period: { from: number; to: number } | null;
  /** 給与支払者の個人番号又は法人番号（記載要領5） */
  payerNumber: string;
  payerKana: string;
  payerName: string;
  /** 所得税の源泉徴収をしている事務所又は事業の名称 */
  officeName: string;
  addressKana: string;
  zip: string;
  address: string;
  /** 給与支払者が法人である場合の代表者の氏名（記載要領6：経理責任者の職氏名） */
  representative: string;
  contact: { dept: string; section: string; name: string; phone: string };
  accountant: { name: string; phone: string };
  businessType: string;
  /** 受給者総人員（記載要領9） */
  staffTotal: number;
  /** 報告人員（記載要領10〜13） */
  counts: { special: number; ordinaryRetired: number; ordinaryOther: number; total: number };
  taxOffice: string;
  /** 給与の支払方法及びその期日（記載要領14） */
  paymentMethod: string;
  /** 納入書の送付（必要・不要。選んでいなければ両方を書いて、手で丸を付ける） */
  paymentSlip: "need" | "no" | "";
}

const line = "1px solid #000";
const thick = "2px solid #000";
const th: React.CSSProperties = { border: line, fontSize: 9, fontWeight: "normal", padding: "3px 4px", letterSpacing: 1, textAlign: "left", verticalAlign: "middle", lineHeight: 1.4 };
const td: React.CSSProperties = { border: line, fontSize: 11, padding: "3px 6px", verticalAlign: "middle", lineHeight: 1.4 };
const right: React.CSSProperties = { ...td, textAlign: "right" };

function Boxes({ value, digits }: { value: string; digits: number }) {
  const v = value.slice(-digits).padStart(digits, " ");
  return (
    <div style={{ display: "flex", height: "100%" }}>
      {[...v].map((c, i) => (
        <span key={i} style={{ flex: 1, borderLeft: i === 0 ? "none" : line, textAlign: "center", fontFamily: "monospace", fontSize: 11, lineHeight: "22px" }}>{c.trim()}</span>
      ))}
    </div>
  );
}

export default function SalaryReportSummaryView({ sheet: s }: { sheet: SummarySheet }) {
  const reiwa = s.year - 2018;
  const slip = s.paymentSlip === "need" ? "必要" : s.paymentSlip === "no" ? "不要" : "必要 ・ 不要";
  return (
    <div style={{ color: "#000", backgroundColor: "white", fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 10, paddingTop: 4 }}>提出先：{s.municipalityLabel}</div>
        <table style={{ borderCollapse: "collapse", width: "40%" }}>
          <tbody>
            <tr><th style={{ ...th, border: thick, textAlign: "center", letterSpacing: 8 }}>指定番号</th></tr>
            <tr><td style={{ ...td, border: thick, height: 26, textAlign: "center", fontFamily: "monospace" }}>{s.designation}</td></tr>
          </tbody>
        </table>
      </div>
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: "bold", letterSpacing: 4, margin: "6px 0" }}>給与支払報告書（総括表）</div>
      <div style={{ fontSize: 11, marginBottom: 4 }}>令和　　年　　月　　日提出</div>

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", border: thick }}>
        <colgroup><col style={{ width: "20%" }} /><col style={{ width: "34%" }} /><col style={{ width: "5%" }} /><col style={{ width: "17%" }} /><col style={{ width: "24%" }} /></colgroup>
        <tbody>
          <tr>
            <th style={th}>給与の支払期間</th>
            <td style={{ ...td, fontSize: 10, whiteSpace: "nowrap" }}>令和 {reiwa} 年 {s.period?.from ?? "　"} 月分から {s.period?.to ?? "　"} 月分まで</td>
            <td style={{ ...td, background: "linear-gradient(to top right, transparent calc(50% - 0.5px), #000, transparent calc(50% + 0.5px))" }} colSpan={3}></td>
          </tr>
          <tr>
            <th style={th}>給与支払者の<br />個人番号又は法人番号</th>
            <td style={{ ...td, padding: 0, height: 24 }} colSpan={4}><div style={{ width: "72%", height: "100%" }}><Boxes value={s.payerNumber} digits={13} /></div></td>
          </tr>
          <tr>
            <th style={th}>フリガナ</th>
            <td style={{ ...td, fontSize: 9 }}>{s.payerKana}</td>
            <th style={th} colSpan={2} rowSpan={2}>事業種目</th>
            <td style={td} rowSpan={2}>{s.businessType}</td>
          </tr>
          <tr>
            <th style={th}>給与支払者の<br />氏名又は名称</th>
            <td style={td}>{s.payerName}</td>
          </tr>
          <tr>
            <th style={th} rowSpan={2}>所得税の源泉徴収<br />をしている事務所<br />又は事業の名称</th>
            <td style={td} rowSpan={2}>{s.officeName}</td>
            <th style={th} colSpan={2}>受給者総人員</th>
            <td style={right}>{s.staffTotal} 人</td>
          </tr>
          <tr>
            <th style={{ ...th, textAlign: "center", letterSpacing: 0, padding: "2px 0" }} rowSpan={4}>報<br />告<br />人<br />員</th>
            <th style={th}>特別徴収対象者</th>
            <td style={right}>{s.counts.special} 人</td>
          </tr>
          <tr>
            <th style={th}>フリガナ</th>
            <td style={{ ...td, fontSize: 9 }}>{s.addressKana}</td>
            <th style={{ ...th, letterSpacing: 0 }}>普通徴収対象者<br />（退職者）</th>
            <td style={right}>{s.counts.ordinaryRetired} 人</td>
          </tr>
          <tr>
            <th style={th}>同上の所在地</th>
            <td style={td}>〒{s.zip}<br />{s.address}</td>
            <th style={{ ...th, letterSpacing: 0 }}>普通徴収対象者<br />（退職者を除く）</th>
            <td style={right}>{s.counts.ordinaryOther} 人</td>
          </tr>
          <tr>
            <th style={th}>給与支払者が<br />法人である場合<br />の代表者の氏名</th>
            <td style={td}>{s.representative}</td>
            <th style={{ ...th, letterSpacing: 0 }}>報告人員の合計</th>
            <td style={right}>{s.counts.total} 人</td>
          </tr>
          <tr>
            <th style={th} rowSpan={2}>連絡者の氏名、<br />所属課、係名<br />及び電話番号</th>
            <td style={{ ...td, fontSize: 10 }} rowSpan={2}>
              {s.contact.dept || "　　　"} 課　{s.contact.section || "　　　"} 係<br />
              氏名 {s.contact.name}<br />
              （電話 {s.contact.phone}）
            </td>
            <th style={th} colSpan={2}>所轄税務署名</th>
            <td style={right}>{s.taxOffice} 税務署</td>
          </tr>
          <tr>
            <th style={th} colSpan={2}>給与の支払方法<br />及びその期日</th>
            <td style={td}>{s.paymentMethod}</td>
          </tr>
          <tr>
            <th style={th}>関与税理士等の氏名<br />及び電話番号</th>
            <td style={{ ...td, fontSize: 10 }}>
              氏名 {s.accountant.name}<br />
              （電話 {s.accountant.phone}）
            </td>
            <th style={th} colSpan={2}>納入書の送付</th>
            <td style={{ ...td, textAlign: "center" }}>{slip}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
