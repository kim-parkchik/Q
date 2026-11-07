/**
 * 「産休・育休（社会保険料の免除）」：産前産後休業・育児休業等の期間
 * 免除の決まりは utils/leaveExemption.ts
 */
import { Baby, Plus, Trash2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import { validateLeavePeriod, type LeavePeriod, type LeaveType } from '../../../utils/leaveExemption';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
    { value: 'maternity', label: '産前産後休業' },
    { value: 'childcare', label: '育児休業（産後パパ育休を含む）' },
];

export default function LeaveSection({ cm }: Props) {
    const { targetLeavePeriods, setTargetLeavePeriods, targetIsExecutive } = cm;

    const update = (index: number, patch: Partial<LeavePeriod>) =>
        setTargetLeavePeriods(targetLeavePeriods.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    const remove = (index: number) => setTargetLeavePeriods(targetLeavePeriods.filter((_, i) => i !== index));
    const add = () => setTargetLeavePeriods([...targetLeavePeriods, { type: 'childcare', start: '', end: '' }]);

    const hasChildcare = targetLeavePeriods.some(p => p.type === 'childcare');

    return (
        <div style={{ marginTop: "10px" }}>
            <h4 style={{ borderLeft: "4px solid #ec4899", paddingLeft: "10px", margin: "0 0 10px 0", fontSize: "14px" }}>
                <Baby size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                産休・育休（社会保険料の免除）
            </h4>

            {targetLeavePeriods.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "8px" }}>
                    {targetLeavePeriods.map((p, i) => {
                        const error = validateLeavePeriod(p);
                        return (
                            <div key={i}>
                                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                                    <div style={{ flex: 4 }}>
                                        {i === 0 && <label style={labelStyle}>種類</label>}
                                        <select value={p.type} onChange={e => update(i, { type: e.target.value as LeaveType })} style={{ ...inputStyle, fontSize: "12px" }}>
                                            {LEAVE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 3 }}>
                                        {i === 0 && <label style={labelStyle}>開始日</label>}
                                        <input type="date" value={p.start} onChange={e => update(i, { start: e.target.value })} style={{ ...inputStyle, fontSize: "12px" }} />
                                    </div>
                                    <div style={{ flex: 3 }}>
                                        {i === 0 && <label style={labelStyle}>終了日（未定なら空）</label>}
                                        <input type="date" value={p.end} onChange={e => update(i, { end: e.target.value })} style={{ ...inputStyle, fontSize: "12px" }} />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => remove(i)}
                                        title="この期間を消す"
                                        style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "9px", cursor: "pointer", color: "#94a3b8" }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                {error && <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "2px" }}>{error}</div>}
                            </div>
                        );
                    })}
                </div>
            )}

            <button
                type="button"
                onClick={add}
                style={{ display: "flex", alignItems: "center", gap: "4px", background: "none", border: "1px dashed #cbd5e1", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "12px", color: "#475569" }}
            >
                <Plus size={14} /> 期間を追加
            </button>

            <p style={{ fontSize: "11px", color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.6 }}>
                年金事務所（健康保険組合）に申出をした期間を入れてください。開始日がある月の分から、終了日の翌日がある月の前月分まで、
                健康保険・介護保険・子ども・子育て支援金・厚生年金の保険料を引きません（雇用保険料は引きます）。
                休日をはさんで続けて休むときも、1つの期間として入れてください。
            </p>
            {targetIsExecutive === 1 && hasChildcare && (
                <p style={{ fontSize: "11px", color: "#b45309", margin: "4px 0 0 0", lineHeight: 1.6 }}>
                    ※ 役員は、育児休業の保険料免除を受けられないので、育児休業の期間があっても保険料を引いて計算します（産前産後休業の免除は受けられます）。
                    免除を受けられるのは育児・介護休業法の育児休業だけで、役員はふつう労働者に当たらず、この育児休業を取れないためです（日本年金機構）。
                    使用人兼務役員で、労働者として育児休業を取った人は、年金事務所に確かめてください。
                </p>
            )}
        </div>
    );
}
