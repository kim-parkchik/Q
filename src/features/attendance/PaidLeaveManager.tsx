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

    // ✨ フィルタ変更によって選択中の人がリストから消えたら、選択をリセットする
    useEffect(() => {
        if (selectedStaffId) {
            // 現在選んでいる人が、フィルタ後のリストにまだ存在するか確認
            const isStillVisible = filteredStaffList.some(s => String(s.id) === String(selectedStaffId));
            
            if (!isStillVisible) {
                setSelectedStaffId(""); // リストから消えたら選択を解除
            }
        }
    }, [filteredStaffList]); // フィルタ結果が変わるたびにチェック

    return (
        <div style={{ padding: "20px", background: "#f8fafc", borderRadius: "8px", minHeight: "100vh" }}>
            
            {/* 🆕 従業員選択・フィルタセクション（モダンな横並びカード） */}
            {/* 🆕 従業員選択・フィルタセクション（AttendanceManager.tsx のスタイルを継承） */}
            <section style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "stretch", 
                gap: "20px", 
                marginBottom: "10px" 
            }}>
                <div style={{ 
                    backgroundColor: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "10px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    width: "780px", // 固定幅
                    flex: "none",
                    padding: "12px 20px"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {/* 左側：セレクトボックス */}
                        <div style={{ width: "500px" }}> 
                            <select 
                                value={selectedStaffId} 
                                onChange={e => setSelectedStaffId(e.target.value)} 
                                style={{ 
                                    width: "100%",
                                    fontSize: "14px",
                                    padding: "4px 10px",
                                    height: "32px",
                                    borderRadius: "6px",
                                    border: "1px solid #cbd5e1",
                                    cursor: "pointer"
                                }}
                            >
                                <option value="">-- 従業員を選択してください --</option>
                                {filteredStaffList.map(s => (
                                    <option key={s.id} value={s.id}>
                                        [{s.id}] {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 右側：フィルタボタン群（AttendanceManager の onClick ロジックを採用） */}
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginLeft: "auto" }}>
                            {[
                                { label: "在籍", value: "active", color: "#2ecc71" },
                                { label: "休職", value: "on_leave", color: "#f1c40f" },
                                { label: "退職", value: "retired", color: "#e74c3c" }
                            ].map(opt => {
                                const isActive = activeFilters.includes(opt.value);
                                return (
                                    <button
                                        key={opt.value}
                                        // ✨ AttendanceManager と同じトグルロジック
                                        onClick={() => {
                                            setActiveFilters(prev => 
                                                prev.includes(opt.value) 
                                                    ? prev.filter(v => v !== opt.value) 
                                                    : [...prev, opt.value]
                                            );
                                        }}
                                        style={{
                                            padding: "4px 12px",
                                            borderRadius: "15px",
                                            border: `1px solid ${opt.color}`,
                                            backgroundColor: isActive ? opt.color : "white",
                                            color: isActive ? "white" : opt.color,
                                            cursor: "pointer",
                                            fontSize: "11px",
                                            fontWeight: "bold",
                                            height: "28px",
                                            transition: "0.2s",
                                            whiteSpace: "nowrap"
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                            <button 
                                onClick={() => setActiveFilters(["active", "on_leave", "retired"])}
                                style={{ 
                                    fontSize: "11px", border: "none", background: "none", 
                                    color: "#3498db", cursor: "pointer", textDecoration: "underline" 
                                }}
                            >
                                全表示
                            </button>
                        </div>
                    </div>
                </div>

                {/* 右側：ステータスカード（あれば便利なので残しました） */}
                <div style={{ flex: "0 0 235px", display: "flex", alignItems: "center" }}>
                    {selectedStaffId && (
                        <div style={{ 
                            backgroundColor: "#34495e", color: "white", padding: "8px 15px", 
                            borderRadius: "10px", width: "100%", textAlign: "center"
                        }}>
                            <span style={{ fontSize: "10px", opacity: 0.8 }}>現在の有効残日数</span>
                            <div style={{ fontSize: "18px", fontWeight: "bold" }}>
                                {grants.reduce((sum, g) => sum + (g.days_granted - g.days_used), 0)} 日
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {selectedStaffId ? (
                <>
                    {/* 付与・消化フォームエリア */}
                    <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
                        {/* 付与フォーム */}
                        <div style={{ flex: 1, backgroundColor: "white", padding: "18px", borderRadius: "10px", border: "1px solid #e2e8f0", borderTop: "4px solid #38a169" }}>
                            <h3 style={{ marginTop: 0, marginBottom: "15px", fontSize: "16px", color: "#2f855a", display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "18px" }}>➕</span> 有給・休暇の付与
                            </h3>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                <div>
                                    <label style={miniLabelStyle}>休暇名称</label>
                                    <input type="text" list="leave-names" value={leaveName} onChange={e => setLeaveName(e.target.value)} style={formInputStyle} />
                                    <datalist id="leave-names">
                                        <option value="法定有給" /><option value="夏季休暇" /><option value="特別休暇" />
                                    </datalist>
                                </div>
                                <div>
                                    <label style={miniLabelStyle}>付与日数</label>
                                    <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} style={formInputStyle} />
                                </div>
                                <div>
                                    <label style={miniLabelStyle}>付与日</label>
                                    <input type="date" value={grantDate} onChange={e => setGrantDate(e.target.value)} style={formInputStyle} />
                                </div>
                                <div>
                                    <label style={miniLabelStyle}>有効期限</label>
                                    <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} style={formInputStyle} />
                                </div>
                            </div>
                            <button onClick={handleAddGrant} style={{ ...actionBtnStyle, backgroundColor: "#38a169", marginTop: "15px" }}>付与を実行する</button>
                        </div>

                        {/* 消化フォーム */}
                        <div style={{ flex: 1, backgroundColor: "white", padding: "18px", borderRadius: "10px", border: "1px solid #e2e8f0", borderTop: "4px solid #e53e3e" }}>
                            <h3 style={{ marginTop: 0, marginBottom: "15px", fontSize: "16px", color: "#c53030", display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "18px" }}>➖</span> 有給の消化記録
                            </h3>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                <div>
                                    <label style={miniLabelStyle}>取得日</label>
                                    <input type="date" value={usageDate} onChange={e => setUsageDate(e.target.value)} style={formInputStyle} />
                                </div>
                                <div>
                                    <label style={miniLabelStyle}>消化区分</label>
                                    <select value={usageDays} onChange={e => setUsageDays(Number(e.target.value))} style={formInputStyle}>
                                        <option value={1.0}>1.0日 (全休)</option>
                                        <option value={0.5}>0.5日 (半休)</option>
                                    </select>
                                </div>
                            </div>
                            <div style={{ height: "58px" }}></div> {/* 高さを揃えるための調整 */}
                            <button onClick={handleUseLeave} style={{ ...actionBtnStyle, backgroundColor: "#e53e3e", marginTop: "15px" }}>消化を記録する</button>
                        </div>
                    </div>

                    {/* テーブルセクション */}
                    <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                        <h3 style={{ marginTop: 0, fontSize: "15px", borderLeft: "4px solid #3498db", paddingLeft: "10px", marginBottom: "15px" }}>休暇保有状況</h3>
                        <table style={tableStyle}>
                            <thead>
                                <tr style={{ backgroundColor: "#f8fafc" }}>
                                    <th style={thStyle}>名称</th>
                                    <th style={thStyle}>付与日</th>
                                    <th style={thStyle}>有効期限</th>
                                    <th style={thStyle}>付与数</th>
                                    <th style={thStyle}>消化数</th>
                                    <th style={thStyle}>残数</th>
                                </tr>
                            </thead>
                            <tbody>
                                {grants.map(g => (
                                    <tr key={g.id} style={{ borderBottom: "1px solid #eee" }}>
                                        <td style={tdStyle}>{g.name}</td>
                                        <td style={tdStyle}>{g.grant_date}</td>
                                        <td style={tdStyle}>{g.expiry_date}</td>
                                        <td style={tdStyle}>{g.days_granted}日</td>
                                        <td style={tdStyle}>{g.days_used}日</td>
                                        <td style={{ ...tdStyle, fontWeight: "bold", color: (g.days_granted - g.days_used) > 0 ? "#2c3e50" : "#cbd5e1" }}>
                                            {g.days_granted - g.days_used}日
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <h3 style={{ marginTop: "30px", fontSize: "15px", borderLeft: "4px solid #94a3b8", paddingLeft: "10px", marginBottom: "15px" }}>取得履歴（直近）</h3>
                        <table style={tableStyle}>
                            <thead>
                                <tr style={{ backgroundColor: "#f8fafc" }}>
                                    <th style={thStyle}>取得日</th>
                                    <th style={thStyle}>消化日数</th>
                                    <th style={thStyle}>備考</th>
                                </tr>
                            </thead>
                            <tbody>
                                {usageHistory.length > 0 ? usageHistory.map(u => (
                                    <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
                                        <td style={tdStyle}>{u.usage_date}</td>
                                        <td style={tdStyle}>{u.days_used === 0.5 ? "0.5日 (半休)" : "1.0日 (全休)"}</td>
                                        <td style={tdStyle}>{u.description || "-"}</td>
                                    </tr>
                                )) : (
                                    <tr><td colSpan={3} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>履歴はありません</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : (
                <div style={{ textAlign: "center", padding: "100px", color: "#94a3b8", backgroundColor: "white", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
                    従業員を選択してください
                </div>
            )}
        </div>
    );
};

// スタイル定数
const miniLabelStyle = { fontSize: "11px", color: "#64748b", fontWeight: "bold", display: "block", marginBottom: "4px" };
const formInputStyle = { width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "14px", boxSizing: "border-box" as const };
const actionBtnStyle = { width: "100%", padding: "10px", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const };
const thStyle = { padding: "12px 10px", textAlign: "left" as const, fontSize: "12px", color: "#64748b", borderBottom: "2px solid #e2e8f0" };
const tdStyle = { padding: "12px 10px", fontSize: "14px", borderBottom: "1px solid #f1f5f9" };

export default PaidLeaveManager;