/**
 * 従業員一覧の表（並べ替え・編集・削除ボタン）
 * （StaffManager.tsx から分割）
 */
import { modernIconBtnStyle } from "../../../styles/styles";
import { cardStyle, thGroupStyle, thStyle, tdStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function StaffTable({ cm }: Props) {
    const {
        editingId,
        deletingId,
        setDeletingId,
        sortKey,
        sortOrder,
        sortedAndFilteredList,
        handleSort,
        startEdit,
        deleteStaff,
        branchMap,
    } = cm;

    return (
        <section style={cardStyle}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead>
                    <tr style={thGroupStyle}>
                        <th style={{ ...thStyle, width: "15%", cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("id")}>
                            <div style={{ display: "flex", alignItems: "center" }}>
                                ID
                                {sortKey === "id" && (
                                    <span style={{
                                        marginLeft: "6px",
                                        display: "inline-block",
                                        width: 0,
                                        height: 0,
                                        borderLeft: "4px solid transparent",
                                        borderRight: "4px solid transparent",
                                        // 昇順(asc)なら上向き、降順(desc)なら下向きの三角を作る
                                        borderBottom: sortOrder === "asc" ? "5px solid #3498db" : "none",
                                        borderTop: sortOrder === "desc" ? "5px solid #3498db" : "none",
                                    }} />
                                )}
                            </div>
                        </th>
                        <th style={{ ...thStyle, width: "30%" }}>氏名</th>
                        <th style={{ ...thStyle, width: "20%", cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("branch_id")}>
                            <div style={{ display: "flex", alignItems: "center" }}>
                                所属
                                {sortKey === "branch_id" && (
                                    <span style={{
                                        marginLeft: "6px",
                                        display: "inline-block",
                                        width: 0,
                                        height: 0,
                                        borderLeft: "4px solid transparent",
                                        borderRight: "4px solid transparent",
                                        borderBottom: sortOrder === "asc" ? "5px solid #3498db" : "none",
                                        borderTop: sortOrder === "desc" ? "5px solid #3498db" : "none",
                                    }} />
                                )}
                            </div>
                        </th>
                        <th style={{ ...thStyle, width: "20%" }}>給与形態</th>
                        <th style={{ ...thStyle, width: "15%", textAlign: "center" }}>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedAndFilteredList.map(s => {
                        const branchName = branchMap[s.branch_id] || "---";
                        // 🆕 退職者の場合にスタイルを変えるためのフラグ
                        const isRetired = s.status === 'retired';

                        return (
                            <tr key={s.id} style={{ 
                                borderBottom: "1px solid #eee",
                                backgroundColor: isRetired ? "#f9f9f9" : "transparent", // 退職者は背景をグレーに
                                opacity: isRetired ? 0.7 : 1                  // 退職者は少し薄くする
                            }}>
                                <td style={tdStyle}>{s.id}</td>
                                <td style={tdStyle}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                        <div style={{ fontWeight: "bold" }}>{s.name}</div>
                                        {/* 🆕 状態バッジを表示 */}
                                        {isRetired && <span style={{ fontSize: "10px", backgroundColor: "#e74c3c", color: "white", padding: "1px 4px", borderRadius: "4px" }}>退職</span>}
                                        {s.status === 'on_leave' && <span style={{ fontSize: "10px", backgroundColor: "#f39c12", color: "white", padding: "1px 4px", borderRadius: "4px" }}>休職</span>}
                                    </div>
                                    <div style={{ fontSize: "11px", color: "#7f8c8d" }}>{s.furigana}</div>
                                </td>
                                {/* 💡 店舗名を表示（少しバッジ風のデザインにしています） */}
                                <td style={tdStyle}>
                                    <div style={{ 
                                        display: "inline-block",
                                        fontSize: "12px", 
                                        backgroundColor: "#ebf5fb", 
                                        color: "#2980b9", 
                                        padding: "2px 8px", 
                                        borderRadius: "12px",
                                        border: "1px solid #d6eaf8"
                                    }}>
                                        {branchName}
                                    </div>
                                </td>
                                <td style={tdStyle}>{s.wage_type === "monthly" ? "月給" : "時給"} {s.base_wage.toLocaleString()}円</td>
                                <td style={{ ...tdStyle, textAlign: "center" }}>
                                    {deletingId === s.id ? (
                                        /* --- 削除確認モード --- */
                                        <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                            <button 
                                                className="dangerous-btn" 
                                                onClick={() => deleteStaff(s.id)} 
                                                style={modernIconBtnStyle("#ff0000")}
                                            >
                                                実行
                                            </button>
                                            <button 
                                                onClick={() => setDeletingId(null)} 
                                                style={modernIconBtnStyle("#34495e")}
                                            >
                                                戻る
                                            </button>
                                        </div>
                                    ) : editingId === s.id ? (
                                        /* --- 🆕 編集実行中モード --- */
                                        <div style={{ color: "#f1c40f", fontWeight: "bold", fontSize: "12px" }}>
                                            ⚡ 編集作業中
                                        </div>
                                    ) : (
                                        /* --- 通常モード --- */
                                        <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                            <button 
                                                onClick={() => startEdit(s)} 
                                                style={modernIconBtnStyle("#3498db")}
                                            >
                                                編集
                                            </button>
                                            <button 
                                                onClick={() => setDeletingId(s.id)} 
                                                style={modernIconBtnStyle("#e74c3c")}
                                            >
                                                削除
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </section>
    );
}
