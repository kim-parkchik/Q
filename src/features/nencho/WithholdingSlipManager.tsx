/**
 * 給与所得の源泉徴収票（受給者交付用。令和8年分から）
 * 左：従業員の一覧（年末調整・精算の状況）、右：源泉徴収票の見た目と印刷
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { SLIP_YEARS, useWithholdingSlipManager } from "./useWithholdingSlipManager";
import WithholdingSlipView from "./WithholdingSlipView";

interface Props {
  db: Database;
  staffList: any[];
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };

// 印刷するときは、源泉徴収票だけを出す
const printStyle = `
  @media print {
    @page { size: A4 portrait; margin: 12mm; }
    body * { visibility: hidden !important; }
    #withholding-slip-print, #withholding-slip-print * { visibility: visible !important; }
    #withholding-slip-print { position: fixed; left: 0; top: 0; width: 100%; }
  }
`;

export default function WithholdingSlipManager({ db, staffList }: Props) {
  const z = useWithholdingSlipManager(db, staffList);

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <style>{printStyle}</style>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select value={z.year} onChange={(e) => z.setYear(Number(e.target.value))} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {SLIP_YEARS.map((y) => <option key={y} value={y}>{y}年分（令和{y - 2018}年分）</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 }}>
          従業員に渡す「給与所得の源泉徴収票（受給者交付用）」を作ります。書き方は国税庁「令和8年分 給与所得の源泉徴収票等の法定調書の作成と提出の手引」によります。
          年末調整をした人は「年末調整」の画面で保存した内容から、年の途中で退職した人・乙欄の人は確定した給与・賞与の合計から作ります。
          受給者に渡す源泉徴収票なので、マイナンバーは書きません。市区町村に出す給与支払報告書は「給与支払報告書」の画面で準備します（eLTAX に出すファイルは、まだ作れません）。
          令和9年1月からは、給与支払報告書を出せば、税務署に源泉徴収票を出したことになります。
          <br />渡す期限：翌年1月31日まで（年の途中で退職した人は、退職の日から1か月以内）。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
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

        {/* 選んだ人の源泉徴収票 */}
        {!z.selected || !z.slip ? (
          <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>左の一覧から従業員を選んでください。</div>
        ) : (
          <div style={card}>
            {!z.selected.paid && (
              <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 10px 0" }}>※ {z.year}年に確定した給与・賞与がありません。</p>
            )}
            {z.slip.warnings.map((w) => (
              <p key={w} style={{ fontSize: 12, color: "#b45309", margin: "0 0 6px 0", lineHeight: 1.6 }}>⚠ {w}</p>
            ))}
            <button
              onClick={() => window.print()}
              style={{ margin: "6px 0 14px 0", padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white", cursor: "pointer", backgroundColor: "#27ae60" }}
            >
              🖨 印刷・PDF保存
            </button>
            <div id="withholding-slip-print" style={{ maxWidth: 760, border: "1px solid #e2e8f0", padding: 12 }}>
              <WithholdingSlipView slip={z.slip} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
