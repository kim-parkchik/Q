export const container = {
    padding: "20px"
};

export const title = {
    marginBottom: "10px"
};

export const description = {
    color: "#666",
    fontSize: "14px"
};

export const table = {
    width: "100%",
    borderCollapse: "collapse" as const,
    marginTop: "20px",
    backgroundColor: "white"
};

export const th = {
    borderBottom: "2px solid #eee",
    textAlign: "left" as const,
    padding: "12px"
};

export const tr = {
    borderBottom: "1px solid #eee"
};

export const td = {
    padding: "12px"
};

export const roleBadge = (role: string) => ({
    padding: "2px 8px",
    borderRadius: "4px",
    backgroundColor: role === 'admin' ? "#e74c3c" : "#3498db",
    color: "white",
    fontSize: "12px"
});

export const lastLogin = {
    fontSize: "13px",
    color: "#7f8c8d"
};

export const addBtn = {
    marginTop: "20px",
    padding: "10px 20px",
    cursor: "pointer"
};

export const tabContainer = {
    display: "flex",
    gap: "10px",
    borderBottom: "1px solid #ddd",
    marginBottom: "20px",
};

export const tabItem = (isActive: boolean) => ({
    padding: "10px 20px",
    cursor: "pointer",
    borderBottom: isActive ? "3px solid #3498db" : "3px solid transparent",
    color: isActive ? "#3498db" : "#666",
    fontWeight: isActive ? ("bold" as const) : ("normal" as const),
    transition: "all 0.2s",
});

export const maintenanceSection = {
    backgroundColor: "white",
    padding: "20px",
    borderRadius: "8px",
    border: "1px solid #eee",
};

export const settingGroup = {
    marginBottom: "30px",
    paddingBottom: "20px",
    borderBottom: "1px solid #f0f0f0",
};

export const label = {
    display: "block",
    marginBottom: "10px",
    fontWeight: "bold" as const,
    fontSize: "14px",
};

export const infoText = {
    fontSize: "12px",
    color: "#7f8c8d",
    marginTop: "8px",
    lineHeight: "1.6",
};

export const inlineGroup = {
    display: "flex",
    alignItems: "center", // 垂直方向を真ん中に
    gap: "15px",         // 項目間のスキマ
    marginBottom: "10px"
};

export const subInfo = {
    fontSize: "12px",
    color: "#e67e22", // 少し色を変えて注意を引く（オレンジ系など）
    margin: 0
};