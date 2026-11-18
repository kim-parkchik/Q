/**
 * 明細書・一覧表、所得税の納付書、住民税の異動届出書の画面で使う見た目（法定三帳簿の画面と同じ形）
 */
import type { CSSProperties } from "react";

export const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
export const controls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 };
export const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
export const label: CSSProperties = { fontSize: 12, color: "#64748b" };
export const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
export const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
export const th: CSSProperties = { textAlign: "left", padding: "5px 6px", border: "1px solid #cbd5e1", backgroundColor: "#f1f5f9", fontSize: 11, whiteSpace: "nowrap" };
export const td: CSSProperties = { padding: "4px 6px", border: "1px solid #e2e8f0", verticalAlign: "top" };
export const tdNum: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
export const small: CSSProperties = { fontSize: 11, color: "#64748b" };
export const note: CSSProperties = { fontSize: 12, color: "#475569", lineHeight: 1.6 };
export const warnBox: CSSProperties = { backgroundColor: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e", borderRadius: 8, padding: "8px 12px", fontSize: 12, lineHeight: 1.6 };
export const errorBox: CSSProperties = { backgroundColor: "#fee2e2", border: "1px solid #ef4444", color: "#991b1b", borderRadius: 8, padding: "8px 12px", fontSize: 12, lineHeight: 1.6 };
export const button = (color: string, disabled = false): CSSProperties => ({
  padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: color, color: "white", fontWeight: "bold", fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
});
export const tabButton = (active: boolean): CSSProperties => ({
  padding: "8px 16px", borderRadius: 6, border: active ? "2px solid #2563eb" : "1px solid #cbd5e1", backgroundColor: active ? "#eff6ff" : "white",
  color: active ? "#1d4ed8" : "#475569", fontWeight: "bold", fontSize: 13, cursor: "pointer",
});

/** 印刷するときは、id の部分だけを出す（2枚以上になるので absolute。表の見出しは紙ごとにくり返す） */
export const printStyle = (id: string, landscape: boolean) => `
.print-only { display: none; }
@media print {
  .print-only { display: inline !important; }
  @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
  body { background: white !important; }
  body * { visibility: hidden !important; }
  #${id}, #${id} * { visibility: visible !important; }
  #${id} { position: absolute; left: 0; top: 0; width: 100%; }
  #${id} thead { display: table-header-group; }
  #${id} tr { break-inside: avoid; }
  #${id} .page { break-after: page; }
  #${id} .page:last-child { break-after: auto; }
  .no-print { display: none !important; }
}
`;

export const yen = (n: number | null | undefined) => (Number(n) || 0).toLocaleString();
