/**
 * 会社設定画面（CompanyManager）のスタイル
 */

export const subTabStyle = (isActive: boolean) => ({
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "bold" as const,
    border: "none",
    borderBottom: isActive ? "3px solid #3498db" : "3px solid transparent",
    backgroundColor: "transparent",
    color: isActive ? "#3498db" : "#7f8c8d",
    transition: "all 0.2s"
});

export const tabContentStyle = {
    animation: "fadeIn 0.3s ease-in-out"
};

export const roundingRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "15px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0"
};
export const welcomeBannerStyle = { backgroundColor: "#ebf5fb", padding: "20px", borderRadius: "12px", border: "1px solid #3498db", color: "#2980b9" };
export const cardStyle = { backgroundColor: "white", padding: "30px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
export const inputStyle = { 
    padding: "10px", 
    border: "1px solid #ddd", 
    borderRadius: "6px", 
    fontSize: "14px", 
    width: "100%", 
    boxSizing: "border-box" as const, 
    outline: "none", 
    transition: "all 0.2s ease-in-out", // アニメーション
};
export const labelStyle = { fontSize: "13px", color: "#7f8c8d", marginBottom: "5px", display: "block", fontWeight: "bold" as const };
export const btnStyle = { color: "white", border: "none", padding: "12px 20px", borderRadius: "8px", cursor: "pointer", fontSize: "16px", fontWeight: "bold" as const, transition: "all 0.2s" };
export const branchCardStyle = { display: "flex", alignItems: "center", padding: "15px 20px", borderRadius: "8px", border: "1px solid #eee", gap: "15px", backgroundColor: "white" };
export const headBadgeStyle = { backgroundColor: "#3498db", color: "white", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" };
export const branchBadgeStyle = { backgroundColor: "#94a3b8", color: "white", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" };
export const deleteBtnStyle = { 
    background: "none", 
    border: "none", 
    color: "#e74c3c", 
    cursor: "pointer", 
    fontSize: "12px",
    minWidth: "60px" // 文字数が変わってもレイアウトがガタつかない
};
export const editBtnStyle = { background: "none", border: "none", color: "#3498db", cursor: "pointer", fontSize: "12px", fontWeight: "bold" as const };
export const subBtnStyle = { padding: "0 15px", borderRadius: "6px", border: "1px solid #ddd", cursor: "pointer", backgroundColor: "white", whiteSpace: "nowrap" as const };
export const addBoxStyle = { backgroundColor: "#f8fafc", padding: "20px", borderRadius: "12px", alignSelf: "start" as const };
// ラベルの余白を最小限にする
export const miniLabelStyle = { 
    fontSize: "11px", 
    fontWeight: "bold" as const, 
    color: "#94a3b8", 
    marginBottom: "1px", // 👈 4pxから1pxへ。ほぼ密着させます
    display: "block" 
};

// 入力欄の下に余白を作り、次のラベルとの距離を離す
export const inputBottomSpace = {
    marginBottom: "12px" // 👈 これで「セット間」の距離を作ります
};
export const addBtnStyle = { flex: 1, backgroundColor: "#2ecc71", color: "white", border: "none", padding: "12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" as const };
export const zipInputStyle = { ...inputStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none", position: "relative" as const, transition: "all 0.2s" };
export const zipBtnStyle = { ...subBtnStyle, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, backgroundColor: "#f8fafc", transition: "all 0.2s" };
export const editingBadgeStyle = {
  fontSize: "12px",
  color: "#f39c12",
  fontWeight: "bold" as const,
  padding: "6px 12px",
  backgroundColor: "#fff9db",
  borderRadius: "4px",
  border: "1px solid #f1c40f"
};

// 削除確認中の背景用スタイル
export const deletingRowStyle = {
  backgroundColor: "#fff5f5",
  borderLeft: "5px solid #e74c3c", // 削除中は赤色に変更
};
