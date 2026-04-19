import { useState, useEffect, useMemo } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import PayStubModal from "./PayStubModal";

interface Props {
    db: Database;
    staffList: any[];
    targetYear: number;
    targetMonth: number;
}

export default function PaySlipManager({ db, staffList, targetYear: initialYear, targetMonth: initialMonth }: Props) {
    const [year, setYear] = useState(initialYear);
    const [month, setMonth] = useState(initialMonth);
    const [showModal, setShowModal] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<any | null>(null);
    const [attendanceData, setAttendanceData] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);

    // フィルタ状態
    const [showRetired, setShowRetired] = useState(false);
    const [onlyHasAttendance, setOnlyHasAttendance] = useState(false);
    const [allAttendance, setAllAttendance] = useState<any[]>([]);
    const [companySettings, setCompanySettings] = useState<any>(null);

    // 全勤怠データをこの月の分だけ一括取得（「勤怠あり」の判定用）
    useEffect(() => {
        const monthStr = String(month).padStart(2, '0');
        db.select<any[]>("SELECT staff_id FROM attendance WHERE work_date LIKE ?", [`${year}-${monthStr}-%`])
            .then(setAllAttendance);
        db.select<any[]>("SELECT * FROM branches ORDER BY id ASC").then(setBranches);
        db.select<any[]>("SELECT * FROM company WHERE id = 1").then(res => {
            if (res && res.length > 0) setCompanySettings(res[0]);
        });
    }, [db, year, month]);

    const filteredStaff = useMemo(() => {
        return staffList.filter(s => {
            const hasAtt = allAttendance.some(a => a.staff_id === s.id);
            const isRetired = !!s.retirement_date; // 退職日が入っていれば退職者とみなす

            // フィルタ条件
            if (!showRetired && isRetired) return false;
            if (onlyHasAttendance && !hasAtt) return false;
            
            return true;
        });
    }, [staffList, allAttendance, showRetired, onlyHasAttendance]);

    const getPrefecture = (branchId: number): string => {
        const branch = branches.find(b => b.id === branchId);
        if (!branch?.prefecture) return "東京";
        return branch.prefecture.replace(/[都道府県]$/, "");
    };

    const loadStaffData = async (staff: any) => {
        const monthStr = String(month).padStart(2, '0');
        const res = await db.select<any[]>(
            "SELECT * FROM attendance WHERE staff_id = ? AND work_date LIKE ?",
            [staff.id, `${year}-${monthStr}-%`]
        );
        setAttendanceData(res || []);
        setSelectedStaff({ ...staff, prefecture: getPrefecture(staff.branch_id || 1) });
        setShowModal(true);
    };

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px" }}>
            {/* 上部ヘッダー & フィルタ */}
            <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                    <h2 style={{ color: "#2c3e50", margin: 0 }}>📄 給与明細の発行</h2>
                
                    <div style={filterPanelS}>
                        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selectS}>
                            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}年</option>)}
                        </select>
                        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={selectS}>
                            {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}月</option>)}
                        </select>
                    </div>
                </div>

                {/* 手動フィルタスイッチ */}
                <div style={{ display: "flex", gap: 20, fontSize: 13, color: "#555", backgroundColor: "#fff", padding: "10px 15px", borderRadius: 8, border: "1px solid #eee" }}>
                    <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                        <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} style={{ marginRight: 6 }} />
                        退職者を含める
                    </label>
                    <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                        <input type="checkbox" checked={onlyHasAttendance} onChange={e => setOnlyHasAttendance(e.target.checked)} style={{ marginRight: 6 }} />
                        勤怠データありのみ
                    </label>
                    <div style={{ marginLeft: "auto", color: "#999" }}>
                        該当者: {filteredStaff.length} 名
                    </div>
                </div>
            </div>

            <div style={tableContainerS}>
                <table style={tableS}>
                    <thead>
                        <tr style={theadS}>
                            <th style={{ ...thS, width: '30%' }}>氏名</th>
                            <th style={{ ...thS, width: '20%' }}>給与条件</th>
                            <th style={{ ...thS, width: '25%' }}>所属</th>
                            <th style={{ ...thS, width: '10%' }}>勤怠</th>
                            <th style={{ ...thS, width: '15%', textAlign: "center" }}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredStaff.map(s => {
                            const branch = branches.find(b => b.id === s.branch_id);
                            const hasAtt = allAttendance.some(a => a.staff_id === s.id);
                            const isRetired = !!s.retirement_date;

                            return (
                                <tr key={s.id} style={{ ...trS, opacity: isRetired ? 0.6 : 1 }}>
                                    <td style={tdS}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <span style={idBadgeS}>#{s.id}</span>
                                            <div style={{ fontWeight: "bold", fontSize: "15px" }}>{s.name}</div>
                                            {isRetired && <span style={retiredBadgeS}>退職</span>}
                                        </div>
                                    </td>
                    
                                    <td style={tdS}>
                                        <div style={{ fontSize: "12px", color: "#666" }}>{s.wage_type === "monthly" ? "月給" : "時給"}</div>
                                        <div style={{ fontWeight: "600" }}>¥{Number(s.base_wage).toLocaleString()}</div>
                                    </td>

                                    <td style={tdS}>
                                        <div style={{ fontSize: "13px" }}>{branch?.name || "未設定"}</div>
                                    </td>

                                    <td style={tdS}>
                                        {hasAtt ? 
                                            <span style={{ color: "#27ae60", fontSize: "18px" }}>●</span> : 
                                            <span style={{ color: "#ccc", fontSize: "18px" }}>○</span>
                                        }
                                    </td>

                                    <td style={{ ...tdS, textAlign: "center" }}>
                                        <button onClick={() => loadStaffData(s)} style={btnS}>作成</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {showModal && selectedStaff && (
                <PayStubModal 
                    db={db} 
                    staff={selectedStaff} 
                    attendanceData={attendanceData} 
                    year={year} 
                    month={month} 
                    companySettings={companySettings} // 🆕 ここを追加！
                    onClose={() => setShowModal(false)} 
                />
            )}
        </div>
    );
}

// 追加スタイル
const idBadgeS: React.CSSProperties = { fontSize: "10px", color: "#999", backgroundColor: "#f0f0f0", padding: "2px 4px", borderRadius: "3px", fontFamily: "monospace" };
const retiredBadgeS: React.CSSProperties = { fontSize: "10px", color: "#fff", backgroundColor: "#e74c3c", padding: "1px 4px", borderRadius: "3px" };
// スタイル定数
const tableContainerS: React.CSSProperties = { backgroundColor: "#fff", borderRadius: 10, border: "1px solid #eee", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" };
const tableS: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const theadS: React.CSSProperties = { backgroundColor: "#fcfcfc", borderBottom: "2px solid #eee", textAlign: "left" };
const thS: React.CSSProperties = { padding: "12px 15px", color: "#666", fontWeight: 600 };
const tdS: React.CSSProperties = { padding: "12px 15px", borderBottom: "1px solid #f5f5f5" };
const trS: React.CSSProperties = { transition: "background 0.2s" };
const selectS: React.CSSProperties = { padding: "5px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 14, cursor: "pointer" };
const filterPanelS: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", backgroundColor: "#f8f9fa", padding: "10px 15px", borderRadius: 8, border: "1px solid #e9ecef" };
const btnS: React.CSSProperties = {
    padding: "6px 16px", backgroundColor: "#3498db", color: "#fff", border: "none", borderRadius: 4,
    fontSize: 12, cursor: "pointer", fontWeight: "bold", transition: "background 0.2s"
};