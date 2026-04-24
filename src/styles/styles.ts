export const modernIconBtnStyle = (color: string) => ({
  backgroundColor: "transparent",
  border: `1.5px solid ${color}`,
  color: color,
  padding: "4px 12px",
  margin: "0 4px",
  borderRadius: "20px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "bold" as const,
  transition: "all 0.2s ease",
  display: "inline-flex" as const,
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
});

export const smallBtnStyle = (color: string) => ({
    ...modernIconBtnStyle(color),
    padding: "4px 8px", // 上下4px、左右8pxに縮小
    fontSize: "12px",   // 文字を少し小さく
    lineHeight: "1",
    minWidth: "40px"    // 最小幅を固定
});