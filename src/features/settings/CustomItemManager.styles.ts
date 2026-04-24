import React from "react";

export const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxWidth: "1200px",
  margin: "0 auto",
  padding: "20px",
};

export const card = (borderColor: string): React.CSSProperties => ({
  width: "100%",
  boxSizing: "border-box",
  background: "white",
  padding: "25px",
  borderRadius: "0 0 12px 12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  borderTop: `4px solid ${borderColor}`,
});

// --- タブ関連 ---
export const tabContainer: React.CSSProperties = {
  display: "flex",
  gap: "10px",
  borderBottom: "1px solid #ddd",
};

export const tab: React.CSSProperties = {
  padding: "12px 24px",
  cursor: "pointer",
  background: "none",
  border: "none",
  borderBottom: "3px solid transparent",
  transition: "0.3s",
  fontSize: "15px",
  color: "#666",
};

export const activeTab: React.CSSProperties = {
  ...tab,
  borderBottom: "3px solid #3498db",
  fontWeight: "bold",
  color: "#3498db",
};

// --- ヘッダー・入力関連 ---
export const header: React.CSSProperties = {
  marginTop: 0,
  borderBottom: "2px solid #eee",
  paddingBottom: "10px",
  marginBottom: "20px",
};

export const input: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "4px",
  border: "1px solid #ddd",
  fontSize: "14px",
};

export const primaryBtn: React.CSSProperties = {
  backgroundColor: "#3498db",
  color: "white",
  border: "none",
  padding: "10px 20px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold",
};

// --- リスト・バッジ関連 ---
export const itemRow = (type: "earning" | "deduction"): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  padding: "12px 15px",
  backgroundColor: "#fff",
  border: "1px solid #eee",
  marginBottom: "8px",
  borderRadius: "6px",
  borderLeft: `5px solid ${type === 'earning' ? '#3498db' : '#e74c3c'}`,
});

export const badge = (type: 'earning' | 'deduction'): React.CSSProperties => ({
  fontSize: "10px",
  padding: "2px 6px",
  borderRadius: "3px",
  backgroundColor: type === 'earning' ? "#ebf5fb" : "#fdedec",
  color: type === 'earning' ? "#3498db" : "#e74c3c",
  fontWeight: "bold",
  border: `1px solid ${type === 'earning' ? '#3498db' : '#e74c3c'}`,
  whiteSpace: "nowrap",
  lineHeight: "1.2",
});

export const delBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "16px",
};

export const orderBtn: React.CSSProperties = {
  background: "#f8f9fa",
  border: "1px solid #ddd",
  borderRadius: "4px",
  cursor: "pointer",
  padding: "4px 8px",
  fontSize: "12px",
  color: "#666",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "0.2s",
  // ホバーした時に少し暗くする
  outline: "none",
};