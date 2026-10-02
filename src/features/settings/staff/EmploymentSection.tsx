/**
 * 「所属・給与」上段：在籍状態・所属支店・給与規定・入退社日・交通費
 * （StaffManager.tsx から分割）
 */
import { XCircle, Car, TrainFront, Banknote } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function EmploymentSection({ cm }: Props) {
    const {
        targetBranchId,
        setTargetBranchId,
        targetStatus,
        setTargetStatus,
        targetJoinDate,
        setTargetJoinDate,
        targetRetirementDate,
        setTargetRetirementDate,
        targetCommuteType,
        setTargetCommuteType,
        targetCommuteAmount,
        setTargetCommuteAmount,
        branches,
        payrollGroups,
        targetPayrollGroupId,
        setTargetPayrollGroupId,
    } = cm;

    return (
        <>
            <h4 style={{ borderLeft: "4px solid #e67e22", paddingLeft: "10px", margin: "0 0 5px 0", fontSize: "14px" }}>所属・給与</h4>
            {/* 状態と所属を横並び ＆ 両方ともラベル横配置 */}
        
            <div style={{ display: "flex", gap: "15px" }}>
        
            {/* 状態 */}
            <div style={{ flex: 1 }}>
                <label style={labelStyle}>状態</label>
                <select
                value={targetStatus}
                onChange={e => setTargetStatus(e.target.value)}
                style={inputStyle}
                >
                <option value="active">在籍</option>
                <option value="on_leave">休職</option>
                <option value="retired">退職</option>
                </select>
            </div>

            {/* 所属 */}
            <div style={{ flex: 1.5 }}>
                <label style={labelStyle}>所属</label>
                <select
                value={targetBranchId}
                onChange={e => setTargetBranchId(Number(e.target.value))}
                style={inputStyle}
                >
                {branches.map(b => (
                    <option key={b.id} value={b.id}>
                    {b.name} ({b.prefecture})
                    </option>
                ))}
                </select>
            </div>

            {/* 給与規定 */}
            <div style={{ flex: 1.5 }}>
                <label style={labelStyle}>給与規定</label>
                <select
                value={targetPayrollGroupId}
                onChange={e => setTargetPayrollGroupId(Number(e.target.value))}
                style={inputStyle}
                >
                {payrollGroups.map(pg => (
                    <option key={pg.id} value={pg.id}>
                    {pg.name}
                    </option>
                ))}
                </select>
            </div>

            </div>


            {/* 🆕 入社日と退職日も横に並べてスッキリさせる */}
            <div style={{ display: "flex", gap: "10px" }}>
                {/* 入社日 */}
                <div style={{ flex: 1, backgroundColor: "#f0f7ff", padding: "8px", borderRadius: "6px", border: "1px solid #dbeafe" }}>
                    <label style={{ ...labelStyle, fontSize: "11px", color: "#1e40af", marginBottom: "4px" }}>入社日</label>
                    <input type="date" value={targetJoinDate} onChange={e => setTargetJoinDate(e.target.value)} style={inputStyle} />
                </div>
                {/* 退職日 */}
                <div style={{ flex: 1, backgroundColor: targetStatus === 'retired' ? "#fff1f2" : "#f1f5f9", padding: "8px", borderRadius: "6px" }}>
                    <label style={{ ...labelStyle, fontSize: "11px", color: targetStatus === 'retired' ? "#991b1b" : "#64748b", marginBottom: "4px" }}>退職日</label>
                    <input 
                        type="date" 
                        value={targetRetirementDate} 
                        onChange={e => setTargetRetirementDate(e.target.value)} 
                        style={{ ...inputStyle, backgroundColor: targetStatus !== 'retired' ? '#e2e8f0' : '#fff' }} 
                        disabled={targetStatus !== 'retired'}
                    />
                </div>
            </div>
        
            {/* 交通費設定セクション */}
            <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "10px" }}>
                <div style={{ flex: 2 }}>
                    <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                        {/* 選択されている値に応じてアイコンを切り替える */}
                        {targetCommuteType === "none" && <XCircle size={14} color="#94a3b8" />}
                        {targetCommuteType === "daily" && <Car size={14} color="#3498db" />}
                        {targetCommuteType === "monthly" && <TrainFront size={14} color="#27ae60" />}
                        交通費区分
                    </label>
                    <select 
                        value={targetCommuteType} 
                        onChange={e => setTargetCommuteType(e.target.value)} 
                        style={{ 
                            ...inputStyle, 
                            height: "38px",
                            backgroundColor: targetCommuteType === "none" ? "#f8fafc" : "#fff"
                        }}
                    >
                        <option value="none">支給なし</option>
                        <option value="daily">日額支給 (車・バイク等)</option>
                        <option value="monthly">月額固定 (定期代等)</option>
                    </select>
                </div>

                <div style={{ flex: 3 }}>
                    <label style={{ 
                        ...labelStyle, 
                        display: "flex",           // アイコン並列用
                        alignItems: "center",      // アイコン垂直中央
                        gap: "6px",                // アイコンとの間隔
                        color: targetCommuteType === "none" ? "#94a3b8" : "#2c3e50" 
                    }}>
                        <Banknote 
                            size={14} 
                            color={targetCommuteType === "none" ? "#cbd5e1" : "#64748b"} 
                        />
                        交通費単価
                    </label>
                    <div style={{ 
                        position: "relative", 
                        display: "flex", 
                        alignItems: "center",
                        opacity: targetCommuteType === "none" ? 0.6 : 1 
                    }}>
                        <input 
                            type="number" 
                            value={targetCommuteAmount} 
                            onChange={e => setTargetCommuteAmount(Number(e.target.value))}
                            disabled={targetCommuteType === "none"} 
                            style={{ 
                                ...inputStyle, 
                                paddingRight: "60px",
                                textAlign: "right",
                                backgroundColor: targetCommuteType === "none" ? "#f1f5f9" : "#fff",
                                cursor: targetCommuteType === "none" ? "not-allowed" : "auto"
                            }} 
                        />
                        <span style={{ 
                            position: "absolute", 
                            right: "12px", 
                            fontSize: "12px", 
                            color: targetCommuteType === "none" ? "#cbd5e1" : "#7f8c8d",
                            pointerEvents: "none" // 単位をクリックしてもinputが反応するように
                        }}>
                            {targetCommuteType === "daily" ? "円 / 日" : 
                            targetCommuteType === "monthly" ? "円 / 月" : "―"}
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
