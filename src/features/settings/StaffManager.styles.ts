/**
 * 従業員管理画面（StaffManager）のスタイル
 */

export const cardStyle = { backgroundColor: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)", marginBottom: "20px" };
export const inputStyle = { padding: "10px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "14px", width: "100%", boxSizing: "border-box" as const };
export const labelStyle = { fontSize: "12px", color: "#7f8c8d", marginBottom: "2px", display: "block" };
export const thGroupStyle = { textAlign: "left" as const, borderBottom: "2px solid #eee", backgroundColor: "#fcfcfc" };
export const thStyle = { padding: "12px", fontSize: "14px", color: "#7f8c8d" };
export const tdStyle = { 
    padding: "12px", 
    fontSize: "14px",
    whiteSpace: "nowrap" as const, // 折り返さない
    overflow: "hidden" as const,    // はみ出しを隠す
    textOverflow: "ellipsis" as const // はみ出したら ... にする
};
export const btnStyle = { color: "white", border: "none", padding: "12px", borderRadius: "8px", cursor: "pointer", fontSize: "16px", fontWeight: "bold" as const };
