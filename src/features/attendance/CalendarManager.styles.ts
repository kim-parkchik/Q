import { CSSProperties } from "react";

export const S = {
  container: {
    padding: "20px",
    color: "#2c3e50"
  } as CSSProperties,

  // --- ヘッダー関連 ---
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "25px"
  } as CSSProperties,

  yearSelector: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    backgroundColor: "#fff",
    padding: "5px 15px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
  } as CSSProperties,

  navBtn: {
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "1rem",
    color: "#3498db",
    padding: "5px"
  } as CSSProperties,

  fetchBtn: (source: "url" | "file"): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    backgroundColor: source === 'url' ? "#3498db" : "#2ecc71",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    transition: "opacity 0.2s"
  }),

  // ファイルモード時のラベル
  csvHeaderLabel: {
    display: "flex", 
    alignItems: "center", 
    gap: "6px", 
    fontSize: "0.85rem", 
    cursor: "pointer", 
    color: "#64748b",
    userSelect: "none"
  } as CSSProperties,

  // --- パターン管理エリア ---
  patternContainer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    padding: "15px 20px",
    backgroundColor: "#fff",
    borderRadius: "12px",
    borderLeft: "5px solid #3498db",
    boxShadow: "0 2px 10px rgba(0,0,0,0.05)"
  } as CSSProperties,

  patternBtn: (isSelected: boolean, _isError: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    padding: "6px 16px",
    borderRadius: isSelected ? "8px 0 0 8px" : "8px",
    border: "1px solid",
    borderColor: isSelected ? "#3498db" : "#e2e8f0",
    backgroundColor: isSelected ? "#3498db" : "white",
    color: isSelected ? "white" : "#64748b",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: "bold",
    transition: "all 0.2s"
  }),

  actionBtnGroup: {
    display: "flex",
    border: "1px solid #3498db",
    borderLeft: "none",
    borderRadius: "0 8px 8px 0",
    overflow: "hidden",
    backgroundColor: "white"
  } as CSSProperties,

  iconBtn: {
    padding: "6px 10px",
    border: "none",
    background: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    borderRight: "1px solid #f0f0f0"
  } as CSSProperties,

  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 14px",
    borderRadius: "8px",
    border: "1px dashed #cbd5e1",
    backgroundColor: "transparent",
    color: "#64748b",
    cursor: "pointer",
    fontSize: "0.85rem",
    transition: "all 0.2s"
  } as CSSProperties,

  // --- 統計・アラート ---
  lawfulBadge: (isLawful: boolean): CSSProperties => ({
    display: "flex",        // 追加
    alignItems: "center",   // 追加（これで上下中央が揃います）
    justifyContent: "center", // 中央寄せ
    gap: "4px",             // アイコンと文字の間の余白
    fontSize: "0.8rem",
    padding: "4px 10px",
    borderRadius: "4px",
    backgroundColor: isLawful ? "#e8f8f5" : "#fdedec",
    color: isLawful ? "#27ae60" : "#e74c3c",
    fontWeight: "bold",
    border: `1px solid ${isLawful ? "#27ae60" : "#e74c3c"}`,
    lineHeight: 1,          // 行の高さをリセットしてズレを防ぐ
  }),

  statsWrapper: {
    display: "flex",
    gap: "25px",
    paddingLeft: "25px",
    borderLeft: "1px solid #eee",
    alignItems: "center"
  } as CSSProperties,

  statsText: {
    fontSize: "0.85rem",
    color: "#7f8c8d"
  } as CSSProperties,

  statsValue: (isHoliday: boolean = false): CSSProperties => ({
    fontWeight: "bold",
    fontSize: "1.2rem",
    color: isHoliday ? "#e74c3c" : "#2c3e50"
  }),

  // --- カレンダーグリッド ---
  gridContainer: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "12px"
  } as CSSProperties,

  monthCard: {
    backgroundColor: "#fff",
    padding: "8px",
    borderRadius: "8px",
    border: "1px solid #eee"
  } as CSSProperties,

  monthTitle: {
    textAlign: "center" as const,
    fontWeight: "bold",
    marginBottom: "8px",
    borderBottom: "1px solid #f8f9fa"
  },

  daysGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "1px"
  } as CSSProperties,

  dayCell: (
    isFinallyHoliday: boolean,
    textColor: string,
    borderStyle: string,
    isCustomized: boolean,
    isHolidayMaster: boolean
  ): CSSProperties => ({
    textAlign: "center",
    padding: "4px 0",
    borderRadius: "4px",
    fontSize: "0.75rem",
    cursor: "pointer",
    color: textColor,
    backgroundColor: isFinallyHoliday ? "#fadbd8" : "transparent",
    border: borderStyle,
    fontWeight: isHolidayMaster ? "bold" : "normal",
    boxShadow: isCustomized ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
    transition: "all 0.1s ease"
  }),

  // 入力系
  editInputWrapper: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: "4px 10px",
    borderRadius: "8px",
    border: "1px solid #3498db"
  } as CSSProperties,

  editInput: {
    border: "none",
    outline: "none",
    fontSize: "0.85rem",
    width: "100px"
  } as CSSProperties,
};