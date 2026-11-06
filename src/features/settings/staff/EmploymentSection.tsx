/**
 * 「所属・給与」上段：在籍状態・所属支店・給与規定・入退社日・交通費
 * （StaffManager.tsx から分割）
 */
import { XCircle, Car, TrainFront, Banknote } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import { COMMUTE_METHOD_LABELS, describeCommuteLimit, type CommuteMethod, type CommuteSetting } from '../../../utils/commuteAllowance';

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
        targetCommuteSetting,
        setTargetCommuteSetting,
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

            {/* 通勤の方法（通勤手当のうち所得税がかからない額＝非課税限度額に使う。utils/commuteAllowance.ts） */}
            {targetCommuteType !== "none" && (
                <CommuteSettingFields setting={targetCommuteSetting} onChange={setTargetCommuteSetting} />
            )}
        </>
    );
}

/** 円・km の入力欄（空は 0） */
const NumberField = ({ label, value, unit, step, onChange }: { label: string; value: number; unit: string; step?: string; onChange: (v: number) => void }) => (
    <div style={{ flex: 1, minWidth: "110px" }}>
        <label style={{ ...labelStyle, fontSize: "11px" }}>{label}</label>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <input
                type="number" min={0} step={step ?? "1"}
                value={value || ""} placeholder="0"
                onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
                style={{ ...inputStyle, paddingRight: "48px", textAlign: "right" }}
            />
            <span style={{ position: "absolute", right: "10px", fontSize: "11px", color: "#7f8c8d", pointerEvents: "none" }}>{unit}</span>
        </div>
    </div>
);

/** 通勤の方法・片道の距離・定期代・有料道路・駐車場等と、いまの非課税限度額 */
function CommuteSettingFields({ setting, onChange }: { setting: CommuteSetting; onChange: (s: CommuteSetting) => void }) {
    const set = (patch: Partial<CommuteSetting>) => onChange({ ...setting, ...patch });
    const now = new Date();
    const usesVehicle = setting.method !== "transit";
    return (
        <div style={{ marginTop: "8px", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "6px", backgroundColor: "#f8fafc" }}>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ flex: 2, minWidth: "200px" }}>
                    <label style={{ ...labelStyle, fontSize: "11px" }}>通勤の方法（所得税がかからない額に使う）</label>
                    <select value={setting.method} onChange={e => set({ method: e.target.value as CommuteMethod })} style={inputStyle}>
                        {(Object.keys(COMMUTE_METHOD_LABELS) as CommuteMethod[]).map(m => (
                            <option key={m} value={m}>{COMMUTE_METHOD_LABELS[m]}</option>
                        ))}
                    </select>
                </div>
                {usesVehicle && (
                    <NumberField label="マイカーなどの片道の距離" value={setting.distanceKm} unit="km" step="0.1" onChange={v => set({ distanceKm: v })} />
                )}
                {setting.method === "both" && (
                    <NumberField label="電車・バスなどの定期代など" value={setting.transitFare} unit="円/月" onChange={v => set({ transitFare: Math.floor(v) })} />
                )}
                {usesVehicle && (
                    <NumberField label="有料道路の料金" value={setting.toll} unit="円/月" onChange={v => set({ toll: Math.floor(v) })} />
                )}
                {usesVehicle && (
                    <NumberField label="駐車場・駐輪場の料金" value={setting.parking} unit="円/月" onChange={v => set({ parking: Math.floor(v) })} />
                )}
            </div>
            <div style={{ fontSize: "11px", color: "#475569", marginTop: "6px", lineHeight: 1.6 }}>
                所得税がかからない額（{now.getFullYear()}年{now.getMonth() + 1}月に支払う分）：{describeCommuteLimit(setting, now.getFullYear(), now.getMonth() + 1)}
                {usesVehicle && (
                    <div style={{ color: "#64748b" }}>
                        片道の距離は、ふだん通る道で測った距離です（2km未満は全額に所得税がかかります）。
                        駐車場・駐輪場は、勤め先や通勤に使う駅などの近くのものだけで、自宅の近くのものは入れません（令和8年4月に支払う分から、月5,000円まで足せます）。
                        金額は1か月当たりで入れてください（3か月分・1年分の料金は、月数で割った額）。
                    </div>
                )}
                {setting.method === "transit" && (
                    <div style={{ color: "#64748b" }}>マイカー・自転車などで通勤する人は、通勤の方法を選び直してください（電車・バスなどのままだと、月15万円まで所得税がかからない計算になります）。</div>
                )}
            </div>
        </div>
    );
}
