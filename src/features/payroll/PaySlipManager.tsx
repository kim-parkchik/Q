import * as S from "./PaySlipManager.styles";
import { usePaySlipManager } from "./usePaySlipManager";
import PayStubModal from "./PayStubModal";

interface Props {
    db: any;
    staffList: any[];
    targetYear: number;
    targetMonth: number;
}

export default function PaySlipManager({ db, staffList, targetYear: initialYear, targetMonth: initialMonth }: Props) {
    const {
        year, setYear,
        month, setMonth,
        showModal, setShowModal,
        selectedStaff,
        attendanceData,
        branches,
        companySettings,
        allAttendance,
        showRetired, setShowRetired,
        onlyHasAttendance, setOnlyHasAttendance,
        filteredStaff,
        loadStaffData
    } = usePaySlipManager(db, staffList, initialYear, initialMonth);

    return (
        <div style={S.container}>
            {/* 上部ヘッダー & フィルタ */}
            <div style={S.header}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                
                    <div style={S.filterPanel}>
                        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={S.select}>
                            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}年</option>)}
                        </select>
                        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={S.select}>
                            {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{m}月</option>)}
                        </select>
                    </div>
                </div>

                {/* 手動フィルタスイッチ */}
                <div style={S.filterSwitchGroup}>
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

            <div style={S.tableContainer}>
                <table style={S.table}>
                    <thead>
                        <tr style={S.thead}>
                            <th style={{ ...S.th, width: '30%' }}>氏名</th>
                            <th style={{ ...S.th, width: '20%' }}>給与条件</th>
                            <th style={{ ...S.th, width: '25%' }}>所属</th>
                            <th style={{ ...S.th, width: '10%' }}>勤怠</th>
                            <th style={{ ...S.th, width: '15%', textAlign: "center" }}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredStaff.map(s => {
                            const branch = branches.find(b => b.id === s.branch_id);
                            const attSummary = allAttendance.find(a => a.staff_id === s.id);
                            
                            const isRetired = !!s.retirement_date;
                            const hasAtt = !!attSummary;
                            const totalH = attSummary?.total_h || 0;
                            const isOver60 = totalH >= 220;
                            const isCalendarInvalid = attSummary?.calendar_invalid === 1;
                            const isMonthly = s.wage_type === "monthly";

                            // --- 🆕 修正：isDisabled は法違反のときだけ！ ---
                            // 月給制で勤怠なしでも、作成自体はできるようにします。
                            const isDisabled = isCalendarInvalid; 

                            return (
                                <tr key={s.id} style={S.tr(isRetired, isCalendarInvalid, isOver60)}>
                                    {/* 1. 氏名 */}
                                    <td style={S.td}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                            <span style={{ fontSize: "10px", color: "#999", fontFamily: "monospace" }}>ID: {s.id}</span>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                <div style={{ fontWeight: "bold", fontSize: "15px" }}>{s.name}</div>
                                                {isRetired && <span style={S.retiredBadge}>退職</span>}
                                            </div>
                                        </div>
                                    </td>

                                    {/* 2. 給与条件 */}
                                    <td style={S.td}>
                                        <div style={{ fontSize: "12px", color: "#666" }}>{s.wage_type === "monthly" ? "月給制" : "時給制"}</div>
                                        <div style={{ fontWeight: "600" }}>¥{Number(s.base_wage).toLocaleString()}</div>
                                    </td>

                                    {/* 3. 所属 */}
                                    <td style={S.td}>
                                        <div style={{ fontSize: "13px" }}>{branch?.name || "未設定"}</div>
                                    </td>

                                    {/* 4. 勤怠（表示をより柔軟に） */}
                                    <td style={S.td}>
                                        {isCalendarInvalid ? (
                                            <span style={{ color: "#e74c3c", fontSize: "11px", fontWeight: "bold" }}>⚠️カレンダー法違反</span>
                                        ) : hasAtt ? (
                                            <div style={{ display: "flex", flexDirection: "column" }}>
                                                <span style={{ fontWeight: "bold", color: isOver60 ? "#e74c3c" : "#2c3e50" }}>
                                                    {totalH.toFixed(1)}h
                                                </span>
                                                {isOver60 && <span style={{ fontSize: "10px", color: "#e74c3c" }}>⚠️60h超注意</span>}
                                            </div>
                                        ) : (
                                            // 勤怠がない場合。月給制ならオレンジで注意を促す
                                            <span style={{ color: isMonthly ? "#e67e22" : "#ccc", fontSize: "12px" }}>
                                                {isMonthly ? "⚠️勤怠データなし" : "勤怠なし"}
                                            </span>
                                        )}
                                    </td>

                                    {/* 5. 操作（ボタンを常に活性化） */}
                                    <td style={{ ...S.td, textAlign: "center" }}>
                                        <button 
                                            disabled={isDisabled}
                                            onClick={() => loadStaffData(s)} 
                                            style={S.btn(isDisabled, hasAtt, isMonthly, isOver60)}
                                        >
                                            {isCalendarInvalid ? "要修正" : (!hasAtt && isMonthly ? "確認して作成" : "作成")}
                                        </button>
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