import React from 'react';

export const overlayS: React.CSSProperties = { position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0,0,0,0.78)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 };
export const containerS: React.CSSProperties = { position: "relative", backgroundColor: "white", padding: 28, borderRadius: 12, width: 940, maxHeight: "95vh", overflowY: "auto", color: "#000" };
export const closeBtnS: React.CSSProperties = { position: "absolute", top: 12, right: 12, width: 32, height: 32, border: "none", borderRadius: "50%", backgroundColor: "#eee", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" };
export const panelS: React.CSSProperties = { marginBottom: 20, padding: 16, backgroundColor: "#f5f7fa", borderRadius: 8, border: "1px solid #e2e8f0" };
export const summaryS: React.CSSProperties = { fontSize: 11, color: "#555", backgroundColor: "#eef2f7", borderRadius: 4, padding: "6px 10px", marginBottom: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 };
export const previewBoxS: React.CSSProperties = { backgroundColor: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "6px 10px", textAlign: "center" };
export const printBtnS: React.CSSProperties = { width: "100%", padding: 10, cursor: "pointer", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: 6, fontWeight: "bold", fontSize: 14 };
export const labelS: React.CSSProperties = { fontSize: 11, display: "block", marginBottom: 3, color: "#555" };
export const inputS: React.CSSProperties = { width: "100%", padding: "5px 8px", boxSizing: "border-box", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 };
export const titleS: React.CSSProperties = { textAlign: "center", letterSpacing: 12, margin: "0 0 16px 0", fontSize: 20, fontWeight: "bold" };
export const tableS: React.CSSProperties = { width: "100%", borderCollapse: "collapse", border: "1px solid #000", fontSize: 12 };
export const theadS: React.CSSProperties = { backgroundColor: "#f2f2f2" };
export const thS: React.CSSProperties = { border: "1px solid #000", padding: "7px 8px", textAlign: "left" };
export const tdS: React.CSSProperties = { border: "1px solid #000", padding: "6px 8px" };
export const tdCtrS: React.CSSProperties = { ...tdS, textAlign: "center" };
export const rtdS: React.CSSProperties = { ...tdS, textAlign: "right" };
export const totalRowS: React.CSSProperties = { fontWeight: "bold", backgroundColor: "#f9f9f9" };

// 🆕 印刷用CSSも文字列として書き出しておくと管理が楽です
export const printStyle = `
  @media print {
    .no-print { display: none !important; }
    #print-area { width: 100% !important; margin: 0 !important; padding: 0 !important; }
    body { background: white !important; }
  }
`;