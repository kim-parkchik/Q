import React from "react";

export const container: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "20px" };

export const header: React.CSSProperties = { marginBottom: 20 };

export const filterPanel: React.CSSProperties = { 
    display: "flex", gap: 10, alignItems: "center", 
    backgroundColor: "#f8f9fa", padding: "10px 15px", 
    borderRadius: 8, border: "1px solid #e9ecef" 
};

export const filterSwitchGroup: React.CSSProperties = { 
    display: "flex", gap: 20, fontSize: 13, color: "#555", 
    backgroundColor: "#fff", padding: "10px 15px", 
    borderRadius: 8, border: "1px solid #eee" 
};

export const tableContainer: React.CSSProperties = { 
    backgroundColor: "#fff", borderRadius: 10, border: "1px solid #eee", 
    overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" 
};

export const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };

export const thead: React.CSSProperties = { backgroundColor: "#fcfcfc", borderBottom: "2px solid #eee", textAlign: "left" };

export const th: React.CSSProperties = { padding: "12px 15px", color: "#666", fontWeight: 600 };

export const td: React.CSSProperties = { padding: "12px 15px", borderBottom: "1px solid #f5f5f5" };

export const tr = (isRetired: boolean, isCalendarInvalid: boolean, isOver60: boolean): React.CSSProperties => ({
    transition: "background 0.2s",
    opacity: isRetired ? 0.6 : 1,
    backgroundColor: isCalendarInvalid ? "#fff0f0" : (isOver60 ? "#fff5f5" : "transparent")
});

export const select: React.CSSProperties = { padding: "5px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 14, cursor: "pointer" };

export const btn = (isDisabled: boolean, hasAtt: boolean, isMonthly: boolean, isOver60: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: "bold",
    transition: "background 0.2s",
    width: "100px",
    cursor: isDisabled ? "not-allowed" : "pointer",
    backgroundColor: isDisabled ? "#ccc" : (!hasAtt && isMonthly ? "#e67e22" : (isOver60 ? "#e74c3c" : "#3498db")),
});

export const retiredBadge: React.CSSProperties = { fontSize: "10px", color: "#fff", backgroundColor: "#e74c3c", padding: "1px 4px", borderRadius: "3px" };