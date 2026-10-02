/**
 * 「所属・給与」中段：給与形態と基本給
 * （StaffManager.tsx から分割）
 */
import { Clock, Calendar, Banknote } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function WageSection({ cm }: Props) {
    const {
        targetWageType,
        setTargetWageType,
        targetWage,
        setTargetWage,
    } = cm;

    return (
        <div style={{ display: "flex", gap: "15px", alignItems: "flex-start", width: "100%" }}>
            <div style={{ flex: 2, minWidth: "120px" }}>
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                    {targetWageType === "hourly" ? <Clock size={14} color="#3498db" /> : <Calendar size={14} color="#27ae60" />}
                    給与区分
                </label>
                <select value={targetWageType} onChange={e => setTargetWageType(e.target.value)} style={{ ...inputStyle, height: "38px" }}>
                    <option value="hourly">時給制</option>
                    <option value="daily">日給制</option>
                    <option value="monthly">月給制</option>
                </select>
            </div>

            <div style={{ flex: 3, minWidth: "200px" }}>
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "6px" }}>
                    <Banknote size={14} color="#64748b" />
                    {targetWageType === "hourly" ? "基本時給" : targetWageType === "daily" ? "基本日給" : "基本月給"}
                </label>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input 
                        type="number" 
                        value={targetWage} 
                        onChange={e => setTargetWage(Number(e.target.value))} 
                        style={{ 
                            ...inputStyle, 
                            textAlign: "right",
                            paddingRight: "60px",
                            width: "100%"
                        }} 
                    />
                    <span style={{ position: "absolute", right: "12px", fontSize: "12px", color: "#7f8c8d", pointerEvents: "none" }}>
                        {targetWageType === "hourly" ? "円 / 時" : targetWageType === "daily" ? "円 / 日" : "円 / 月"}
                    </span>
                </div>
            </div>
        </div>
    );
}
