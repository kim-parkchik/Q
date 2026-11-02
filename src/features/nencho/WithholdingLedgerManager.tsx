/**
 * 給与所得に対する源泉徴収簿
 * 左：従業員の一覧（年末調整・精算の状況）、右：源泉徴収簿の見た目と印刷
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useWithholdingLedgerManager } from "./useWithholdingLedgerManager";
import WithholdingLedgerView from "./WithholdingLedgerView";

interface Props {
  db: Database;
  staffList: any[];
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };

// 印刷するときは、源泉徴収簿だけを出す（国税庁の様式と同じく横長）
const printStyle = `
  @media print {
    @page { size: A4 landscape; margin: 8mm; }
    body * { visibility: hidden !important; }
    #withholding-ledger-print, #withholding-ledger-print * { visibility: visible !important; }
    #withholding-ledger-print { position: fixed; left: 0; top: 0; width: 100%; border: none !important; padding: 0 !important; }
  }
`;

export default function WithholdingLedgerManager({ db, staffList }: Props) {
  const z = useWithholdingLedgerManager(db, staffList);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <style>{printStyle}</style>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select value={z.year} onChange={(e) => z.setYear(Number(e.target.value))} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {z.years.map((y) => <option key={y} value={y}>{y}年分{y >= 2019 ? `（令和${y - 2018 === 1 ? "元" : y - 2018}年分）` : ""}</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 }}>
          従業員ごとに、1年間に支払った給与・賞与と源泉徴収した税額、年末調整の計算をまとめた「給与所得に対する源泉徴収簿」を作ります。
          欄の並びは国税庁の様式（令和8年分 年末調整のしかた）に合わせています。確定した給与・賞与と、「年末調整」の画面で保存した内容から作ります。
          <br />源泉徴収簿は法令で決まった帳簿ではなく、毎月の源泉徴収の記録がわかり年末調整に使えるものなら、自社の給与台帳などでもよいとされています（国税庁「A2-2 給与所得・退職所得に対する源泉徴収簿の作成」）。
          総支給金額は所得税がかかる額です（非課税の通勤手当は入れません）。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, alignItems: "start" }}>
        {/* 従業員の一覧 */}
        <div style={{ ...card, padding: 8 }}>
          {z.rows.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", padding: 8 }}>{z.year}年に在籍した人がいません</div>}
          {z.rows.map((r) => {
            const active = z.selected && String(z.selected.staff.id) === String(r.staff.id);
            return (
              <button
                key={r.staff.id}
                onClick={() => z.select(String(r.staff.id))}
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 6, padding: "8px 10px", marginBottom: 2,
                  cursor: "pointer", backgroundColor: active ? "#eff6ff" : "transparent",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: "bold", color: r.paid ? "#1e293b" : "#94a3b8" }}>{r.staff.name}</div>
                <div style={{ fontSize: 11, color: r.attention ? "#b45309" : r.paid ? "#64748b" : "#94a3b8" }}>{r.status}</div>
              </button>
            );
          })}
        </div>

        {/* 選んだ人の源泉徴収簿 */}
        {!z.selected || !z.ledger ? (
          <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>左の一覧から従業員を選んでください。</div>
        ) : (
          <div style={card}>
            {!z.selected.paid && (
              <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 10px 0" }}>※ {z.year}年に確定した給与・賞与がありません。</p>
            )}
            {z.ledger.warnings.map((w) => (
              <p key={w} style={{ fontSize: 12, color: "#b45309", margin: "0 0 6px 0", lineHeight: 1.6 }}>⚠ {w}</p>
            ))}
            <button
              onClick={() => window.print()}
              style={{ margin: "6px 0 14px 0", padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white", cursor: "pointer", backgroundColor: "#27ae60" }}
            >
              🖨 印刷・PDF保存
            </button>
            <div id="withholding-ledger-print" style={{ border: "1px solid #e2e8f0", padding: 12, overflowX: "auto" }}>
              <div style={{ minWidth: 980 }}>
                <WithholdingLedgerView ledger={z.ledger} staff={z.selected.staff} branchName={z.ledger.branchName} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
