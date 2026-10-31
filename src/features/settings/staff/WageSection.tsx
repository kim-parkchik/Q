/**
 * 「所属・給与」中段：給与形態と基本給
 * （StaffManager.tsx から分割）
 */
import { Clock, Calendar, Banknote } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import * as Master from '../../../constants';
import { baseWagePerHour, checkMinimumWage, describeMinimumWage, nextMinimumWage } from '../../../utils/minimumWage';

interface Props {
    cm: StaffManagerState;
}

export default function WageSection({ cm }: Props) {
    const {
        targetWageType,
        setTargetWageType,
        targetWage,
        setTargetWage,
        targetDailyHours,
        annualWorkDays,
        monthlyAverageHours,
        branches,
        targetBranchId,
    } = cm;

    // 最低賃金のチェック：基本給を時間あたりにして、所属する拠点の都道府県の今日の最低賃金と比べる（詳しくは utils/minimumWage.ts）
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const prefecture = Master.toKenpoPrefName(branches.find(b => b.id === targetBranchId)?.prefecture);
    const perHour = baseWagePerHour(targetWageType, targetWage, targetDailyHours, annualWorkDays > 0 ? monthlyAverageHours : null);
    const minimumCheck = checkMinimumWage(prefecture, today, perHour);
    const next = nextMinimumWage(prefecture, today);
    const belowNext = perHour !== null && next !== null && perHour < next.amount;

    return (
        <div style={{ width: "100%" }}>
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
        {prefecture && minimumCheck && !minimumCheck.ok && (
            <p style={{ fontSize: "11px", color: "#dc2626", margin: "6px 0 0 0", fontWeight: "bold" }}>
                ⚠ 基本給を時間あたりにすると約{Math.floor(minimumCheck.perHour).toLocaleString()}円で、{describeMinimumWage(prefecture, minimumCheck.minimum)}を下回っています
            </p>
        )}
        {prefecture && next && belowNext && (!minimumCheck || minimumCheck.ok) && (
            <p style={{ fontSize: "11px", color: "#b45309", margin: "6px 0 0 0" }}>
                ※ 基本給を時間あたりにすると約{Math.floor(perHour!).toLocaleString()}円で、{describeMinimumWage(prefecture, next)}を下回ります
            </p>
        )}
        </div>
    );
}
