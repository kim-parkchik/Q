/**
 * 年末調整：年税額の計算の結果（年末調整のしかたの「年税額の計算」の順に並べる）
 */
import type { NenchoResult } from "../../utils/nencho";

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" };
const sub: React.CSSProperties = { ...row, fontSize: 12, color: "#64748b", paddingLeft: 12 };
const total: React.CSSProperties = { ...row, fontWeight: "bold", borderTop: "1px solid #e2e8f0", marginTop: 4, paddingTop: 6 };
const yen = (n: number) => `${n.toLocaleString()}円`;

export default function NenchoResultPanel({ r }: { r: NenchoResult }) {
  const d = r.deductions;
  const refund = r.difference > 0;
  return (
    <div>
      {!r.eligible && (
        <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: "bold", marginBottom: 8 }}>⚠ {r.ineligibleReason}</div>
      )}
      <div style={{
        textAlign: "center", padding: "12px 8px", borderRadius: 8, marginBottom: 12,
        backgroundColor: r.difference === 0 ? "#f8fafc" : refund ? "#eff6ff" : "#fef2f2",
        color: r.difference === 0 ? "#334155" : refund ? "#1d4ed8" : "#b91c1c",
      }}>
        <div style={{ fontSize: 12 }}>{r.difference === 0 ? "過不足なし" : refund ? "超過額（本人に還付）" : "不足額（本人から徴収）"}</div>
        <div style={{ fontSize: 24, fontWeight: "bold" }}>{yen(Math.abs(r.difference))}</div>
      </div>

      <div style={row}><span>給与・賞与の総額（年調給与額）</span><span>{yen(r.roundedSalary)}</span></div>
      <div style={row}><span>給与所得控除後の給与等の金額</span><span>{yen(r.employmentIncome)}</span></div>
      {r.incomeAdjustment > 0 && <div style={sub}><span>所得金額調整控除額</span><span>−{yen(r.incomeAdjustment)}</span></div>}
      <div style={row}><span>（調整控除後）</span><span>{yen(r.employmentIncomeAdjusted)}</span></div>

      <div style={{ ...row, marginTop: 6 }}><span>所得控除</span><span></span></div>
      <div style={sub}><span>社会保険料控除</span><span>{yen(d.socialInsurance)}</span></div>
      {d.smallBusinessMutualAid > 0 && <div style={sub}><span>小規模企業共済等掛金控除</span><span>{yen(d.smallBusinessMutualAid)}</span></div>}
      <div style={sub}><span>生命保険料控除</span><span>{yen(d.lifeInsurance)}</span></div>
      <div style={sub}><span>地震保険料控除</span><span>{yen(d.earthquake)}</span></div>
      <div style={sub}><span>配偶者控除</span><span>{yen(d.spouse)}</span></div>
      <div style={sub}><span>配偶者特別控除</span><span>{yen(d.spouseSpecial)}</span></div>
      <div style={sub}><span>特定親族特別控除</span><span>{yen(d.specificRelative)}</span></div>
      <div style={sub}><span>扶養控除・障害者控除など</span><span>{yen(d.dependentsAndOthers)}</span></div>
      <div style={sub}><span>基礎控除（合計所得金額 {yen(r.totalIncome)}）</span><span>{yen(d.basic)}</span></div>
      <div style={total}><span>所得控除の合計</span><span>{yen(d.total)}</span></div>

      <div style={{ ...row, marginTop: 6 }}><span>課税給与所得金額（1,000円未満切り捨て）</span><span>{yen(r.taxableIncome)}</span></div>
      <div style={row}><span>算出所得税額</span><span>{yen(r.calculatedTax)}</span></div>
      {r.housingLoanCredit > 0 && <div style={sub}><span>住宅借入金等特別控除</span><span>−{yen(r.housingLoanCredit)}</span></div>}
      <div style={row}><span>年調所得税額</span><span>{yen(r.annualIncomeTax)}</span></div>
      <div style={total}><span>年調年税額（×102.1%、100円未満切り捨て）</span><span>{yen(r.annualTax)}</span></div>
      <div style={row}><span>源泉徴収した税額</span><span>{yen(r.withheldTax)}</span></div>
    </div>
  );
}
