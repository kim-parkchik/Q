import React, { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";

interface Props {
    db: Database;
    staffList: any[];
}

const PaidLeaveManager: React.FC<Props> = ({ db, staffList }) => {
    const [selectedStaffId, setSelectedStaffId] = useState("");
    const [activeFilters, setActiveFilters] = useState<string[]>(["active"]);
    const [grants, setGrants] = useState<any[]>([]);

    // ✨ 今日の日付を初期値にする (YYYY-MM-DD形式)
    const today = new Date().toISOString().split('T')[0];
    const [grantDate, setGrantDate] = useState(today);
    const [days, setDays] = useState(10);
    
    const [usageDate, setUsageDate] = useState(today);
    const [usageDays, setUsageDays] = useState(1.0); // 1.0 または 0.5

    const [leaveName, setLeaveName] = useState("法定有給");
    const [expiryDate, setExpiryDate] = useState("");

    const [usageHistory, setUsageHistory] = useState<any[]>([]);

    // 選択した社員の付与データを読み込む
    const loadPaidLeaveData = async (staffId: string) => {
        if (!staffId) return;
        const res = await db.select<any[]>(
            "SELECT * FROM paid_leave_grants WHERE staff_id = ? ORDER BY grant_date DESC",
            [staffId]
        );
        setGrants(res);
    };

    // 付与日が変更されたら、自動で「2年後の前日」を計算してセット（あくまでデフォルト値）
    useEffect(() => {
        const d = new Date(grantDate);
        if (!isNaN(d.getTime())) {
            d.setFullYear(d.getFullYear() + 2);
            d.setDate(d.getDate() - 1);
            setExpiryDate(d.toISOString().split('T')[0]);
        }
    }, [grantDate]);



    // 履歴を読み込む関数
    const loadUsageHistory = async (staffId: string) => {
        const res = await db.select<any[]>(
            `SELECT * FROM paid_leave_usage WHERE staff_id = ? ORDER BY usage_date DESC`,
            [staffId]
        );
        setUsageHistory(res);
    };

    // 既存の loadPaidLeaveData の中で履歴も呼ぶように統一して定義
    const loadAllData = async (staffId: string) => {
        if (!staffId) return;

        // 1. 付与枠の読み込み
        const resGrants = await db.select<any[]>(
            "SELECT * FROM paid_leave_grants WHERE staff_id = ? ORDER BY grant_date DESC",
            [staffId]
        );
        setGrants(resGrants);

        // 2. 取得履歴の読み込み
        const resHistory = await db.select<any[]>(
            `SELECT * FROM paid_leave_usage WHERE staff_id = ? ORDER BY usage_date DESC`,
            [staffId]
        );
        setUsageHistory(resHistory);
    };

    // 🌟 ここが重要！初期読み込みを loadAllData に
    useEffect(() => {
        if (selectedStaffId) {
            loadAllData(selectedStaffId);
        }
    }, [selectedStaffId]);

    // 🌟 付与処理の最後
    const handleAddGrant = async () => {
        if (!selectedStaffId) return;
        try {
            await db.execute(
                "INSERT INTO paid_leave_grants (staff_id, name, grant_date, expiry_date, days_granted) VALUES (?, ?, ?, ?, ?)",
                [selectedStaffId, leaveName, grantDate, expiryDate, days]
            );
            await loadAllData(selectedStaffId); // 👈 全データ更新
            alert(`「${leaveName}」を登録しました。`);
        } catch (error) {
            console.error(error);
            alert("登録に失敗しました。");
        }
    };

    // 🌟 消化処理の最後
    const handleUseLeave = async () => {
        if (!selectedStaffId) return;
        try {
            const availableGrants = await db.select<any[]>(
                `SELECT * FROM paid_leave_grants 
                WHERE staff_id = ? AND (days_granted - days_used) > 0 
                AND expiry_date >= ?
                ORDER BY grant_date ASC`, 
                [selectedStaffId, usageDate]
            );

            if (availableGrants.length === 0) {
                alert("有効な残日数がありません。");
                return;
            }

            let remainingToReduce = usageDays;
            for (const grant of availableGrants) {
                if (remainingToReduce <= 0) break;
                const grantRemaining = grant.days_granted - grant.days_used;
                const reduceAmount = Math.min(grantRemaining, remainingToReduce);

                await db.execute(
                    "UPDATE paid_leave_grants SET days_used = days_used + ? WHERE id = ?",
                    [reduceAmount, grant.id]
                );
                remainingToReduce -= reduceAmount;
            }
            
            // 2. 取得履歴テーブルに記録
            await db.execute(
                "INSERT INTO paid_leave_usage (staff_id, usage_date, days_used) VALUES (?, ?, ?)",
                [selectedStaffId, usageDate, usageDays]
            );

            await loadAllData(selectedStaffId); // 👈 ここも全データ更新に変える
            alert(`${usageDate}に ${usageDays}日 分の消化を記録しました。`);
        } catch (error) {
            console.error(error);
            alert("エラーが発生しました。");
        }
    };

    // ✨ フィルタリングされた従業員リストを作成
    const filteredStaffList = staffList.filter(s => activeFilters.includes(s.status));

    return (
        <div style={{ padding: "20px", background: "white", borderRadius: "8px" }}>
            <h2>🏖 有給休暇管理</h2>

            {/* ✨ 絞り込みボタンセクションを追加 */}
            <div style={{ marginBottom: "20px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", backgroundColor: "#f8f9fa", padding: "12px", borderRadius: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: "bold", color: "#7f8c8d" }}>表示対象:</span>
                {[
                    { label: "在籍", value: "active", color: "#2ecc71" },
                    { label: "休職", value: "on_leave", color: "#f1c40f" },
                    { label: "退職", value: "retired", color: "#e74c3c" }
                ].map(opt => {
                    const isActive = activeFilters.includes(opt.value);
                    return (
                        <button
                            key={opt.value}
                            onClick={() => 
                                setActiveFilters(prev => 
                                    prev.includes(opt.value) 
                                        ? prev.filter(v => v !== opt.value) 
                                        : [...prev, opt.value]
                                )
                            }
                            style={{
                                padding: "5px 12px",
                                borderRadius: "15px",
                                border: `1px solid ${opt.color}`,
                                backgroundColor: isActive ? opt.color : "white",
                                color: isActive ? "white" : opt.color,
                                cursor: "pointer",
                                fontSize: "11px",
                                fontWeight: "bold",
                                transition: "0.2s"
                            }}
                        >
                            {opt.label}
                        </button>
                    );
                })}
                <button 
                    onClick={() => setActiveFilters(["active", "on_leave", "retired"])}
                    style={{ fontSize: "11px", border: "none", background: "none", color: "#3498db", cursor: "pointer", textDecoration: "underline", marginLeft: "4px" }}
                >
                    すべて表示
                </button>
            </div>

            <div style={{ marginBottom: "20px" }}>
                <label style={{ fontSize: "14px", fontWeight: "bold" }}>従業員選択: </label>
                <select 
                    value={selectedStaffId} 
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    style={{ padding: "8px", fontSize: "16px", borderRadius: "4px", border: "1px solid #ccc", minWidth: "200px" }}
                >
                    <option value="">-- {activeFilters.length === 0 ? "表示をオンにしてください" : "選択してください"} --</option>
                    {/* ✨ フィルタリング済みのリストを表示 */}
                    {filteredStaffList.map(s => (
                        <option key={s.id} value={s.id}>
                            {s.id}: {s.name} ({s.status === 'active' ? '在籍' : s.status === 'retired' ? '退職' : '休職'})
                        </option>
                    ))}
                </select>
            </div>

            {selectedStaffId && (
                <>
                    <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
                        {/* 付与フォーム */}
                        <div style={{ flex: 1, background: "#f0fff4", padding: "15px", borderRadius: "8px", border: "1px solid #c6f6d5" }}>
                            <h3 style={{ marginTop: 0, color: "#2f855a" }}>➕ 有給・休暇の付与</h3>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end" }}>
                                <div>
                                    <label style={{ fontSize: "12px", display: "block" }}>休暇名称</label>
                                    <input 
                                        type="text" 
                                        list="leave-names" 
                                        value={leaveName} 
                                        onChange={(e) => setLeaveName(e.target.value)} 
                                        style={{ padding: "5px", width: "120px" }} 
                                    />
                                    <datalist id="leave-names">
                                        <option value="法定有給" />
                                        <option value="夏季休暇" />
                                        <option value="特別休暇" />
                                    </datalist>
                                </div>
                                <div>
                                    <label style={{ fontSize: "12px", display: "block" }}>付与日</label>
                                    <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} style={{ padding: "5px" }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: "12px", display: "block" }}>有効期限</label>
                                    <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} style={{ padding: "5px" }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: "12px", display: "block" }}>日数</label>
                                    <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ padding: "5px", width: "50px" }} />
                                </div>
                                <button onClick={handleAddGrant} style={{ padding: "6px 12px", cursor: "pointer", backgroundColor: "#38a169", color: "white", border: "none", borderRadius: "4px", fontWeight: "bold" }}>付与実行</button>
                            </div>
                        </div>

                        {/* 消化フォーム */}
                        <div style={{ flex: 1, background: "#fff5f5", padding: "15px", borderRadius: "8px", border: "1px solid #feb2b2" }}>
                            <h3 style={{ marginTop: 0, color: "#c53030" }}>➖ 有給の消化</h3>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end" }}>
                                <div>
                                    <label style={{ fontSize: "12px", display: "block" }}>取得日</label>
                                    <input type="date" value={usageDate} onChange={(e) => setUsageDate(e.target.value)} style={{ padding: "5px" }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: "12px", display: "block" }}>消化日数</label>
                                    <select value={usageDays} onChange={(e) => setUsageDays(Number(e.target.value))} style={{ padding: "5px" }}>
                                        <option value={1.0}>1.0日 (全休)</option>
                                        <option value={0.5}>0.5日 (半休)</option>
                                    </select>
                                </div>
                                <button onClick={handleUseLeave} style={{ padding: "6px 12px", cursor: "pointer", backgroundColor: "#e53e3e", color: "white", border: "none", borderRadius: "4px" }}>消化実行</button>
                            </div>
                        </div>
                    </div>

                    {/* --- 付与一覧表（現在の表のアップデート） --- */}
                    <h3>保有している休暇（付与枠）</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "30px" }}>
                        <thead>
                            <tr style={{ backgroundColor: "#f8f9fa" }}>
                                <th style={tdStyle}>名称</th>
                                <th style={tdStyle}>付与日</th>
                                <th style={tdStyle}>有効期限</th>
                                <th style={tdStyle}>付与日数</th>
                                <th style={tdStyle}>消化済み</th>
                                <th style={tdStyle}>残数</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grants.map(g => (
                                <tr key={g.id}>
                                    <td style={tdStyle}>{g.name || "法定有給"}</td>
                                    <td style={tdStyle}>{g.grant_date}</td>
                                    <td style={tdStyle}>{g.expiry_date}</td>
                                    <td style={tdStyle}>{g.days_granted}日</td>
                                    <td style={tdStyle}>{g.days_used}日</td>
                                    <td style={{ ...tdStyle, fontWeight: "bold", color: "#2c3e50" }}>
                                        {g.days_granted - g.days_used}日
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* --- 取得履歴表（新しく追加） --- */}
                    <h3>取得履歴</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ backgroundColor: "#f8f9fa" }}>
                                <th style={tdStyle}>取得日</th>
                                <th style={tdStyle}>日数</th>
                                <th style={tdStyle}>備考</th>
                            </tr>
                        </thead>
                        <tbody>
                            {usageHistory.length > 0 ? usageHistory.map(u => (
                                <tr key={u.id}>
                                    <td style={tdStyle}>{u.usage_date}</td>
                                    <td style={tdStyle}>{u.days_used === 0.5 ? "0.5日 (半休)" : "1.0日 (全休)"}</td>
                                    <td style={tdStyle}>{u.description || "-"}</td>
                                </tr>
                            )) : (
                                <tr><td colSpan={3} style={{ ...tdStyle, textAlign: "center", color: "#999" }}>履歴がありません</td></tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
};

const tdStyle = { border: "1px solid #ccc", padding: "10px", textAlign: "left" as const };

export default PaidLeaveManager;