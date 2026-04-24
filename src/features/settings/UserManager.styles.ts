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