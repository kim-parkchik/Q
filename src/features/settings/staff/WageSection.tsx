/**
 * 「所属・給与」中段：給与形態と基本給
 * （StaffManager.tsx から分割）
 */
import { Clock, Calendar, Banknote } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import * as Master from '../../../constants';
import { checkMinimumWage, describeMinimumWage, describeMinimumWagePay, minimumWagePayOf, nextApplicableMinimumWage, parseSpecificMinimumWage } from '../../../utils/minimumWage';
import { WageHistoryEditor } from './WageDependentsHistory';

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
        dailyAverageHours,
        annualWorkDays,
        monthlyAverageHours,
        branches,
        targetBranchId,
        payItems,
        targetSpecificMinWageExempt,
        setTargetSpecificMinWageExempt,
    } = cm;

    // 最低賃金のチェック：基本給と、給与項目で「最低賃金に入れる」にした固定の支給項目を時間あたりにして、
    // 所属する拠点の都道府県の今日の最低賃金（拠点に特定最低賃金を入れていれば、高いほう）と比べる（見直しの P12。詳しくは utils/minimumWage.ts）
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const branch = branches.find(b => b.id === targetBranchId);
    const prefecture = Master.toKenpoPrefName(branch?.prefecture);
    const specificOfBranch = parseSpecificMinimumWage(branch?.specific_minimum_wage);
    const specific = targetSpecificMinWageExempt ? null : specificOfBranch;
    // 日給は 1日の所定労働時間（曜日で違う人は1週間の1日平均）で、月給と手当は1年間における1月平均所定労働時間で割る（最低賃金法施行規則2条）
    const pay = minimumWagePayOf({
        wageType: targetWageType, baseWage: targetWage, dailyHours: dailyAverageHours || targetDailyHours,
        monthlyAverageHours: annualWorkDays > 0 ? monthlyAverageHours : null, items: payItems,
    });
    const perHour = pay?.perHour ?? null;
    const minimumCheck = checkMinimumWage(prefecture, today, perHour, specific);
    const next = nextApplicableMinimumWage(prefecture, today, specific);
    const belowNext = perHour !== null && next !== null && perHour < next.amount;
    const payLabel = pay && (pay.monthly > 0 || pay.piece > 0) ? "最低賃金の対象になる賃金（基本給と手当）" : "基本給";
    const payDetail = pay ? describeMinimumWagePay(pay) : "";

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
                ⚠ {payLabel}を時間あたりにすると約{Math.floor(minimumCheck.perHour).toLocaleString()}円{payDetail && `（${payDetail}）`}で、{describeMinimumWage(prefecture, minimumCheck.minimum)}を下回っています
            </p>
        )}
        {prefecture && next && belowNext && (!minimumCheck || minimumCheck.ok) && (
            <p style={{ fontSize: "11px", color: "#b45309", margin: "6px 0 0 0" }}>
                ※ {payLabel}を時間あたりにすると約{Math.floor(perHour!).toLocaleString()}円{payDetail && `（${payDetail}）`}で、{describeMinimumWage(prefecture, next)}を下回ります
            </p>
        )}
        {prefecture && (minimumCheck || next) && (
            <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.5 }} data-note="minimum-wage-basis">
                ※ 最低賃金は、基本給と、給与項目設定で「最低賃金に入れる」にした固定の手当（この人に金額を入れたもの）で比べます。変動（毎月入力）の手当（歩合給など）は、給与明細でその月の額を足して比べます。通勤手当・固定残業代・残業代は入れません。
                {pay && pay.skipped.length > 0 && `${pay.skipped.join("・")}は、1か月平均の所定労働時間がわからないので入れていません。`}
            </p>
        )}
        {specificOfBranch && (
            <label style={{ fontSize: "11px", color: "#475569", margin: "4px 0 0 0", display: "flex", alignItems: "center", gap: "4px" }}>
                <input type="checkbox" data-field="specific-min-wage-exempt" checked={targetSpecificMinWageExempt} onChange={e => setTargetSpecificMinWageExempt(e.target.checked)} />
                特定最低賃金{specificOfBranch.name && `「${specificOfBranch.name}」`}から除く（18歳未満・65歳以上・雇入れ後の一定期間の人など、決定で除かれる人。地域別最低賃金とは比べます）
            </label>
        )}
        {/* 昇給・給与区分の変更の履歴（何年何月分から） */}
        <WageHistoryEditor cm={cm} />
        </div>
    );
}
