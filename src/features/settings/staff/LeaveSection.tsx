/**
 * 「休業・休職」：産前産後休業・育児休業等・介護休業・業務上の負傷や疾病による休業・その他の休職の期間
 * 社会保険料の免除（産休・育休だけ）の決まりは utils/leaveExemption.ts、給与・勤怠・年休の出勤率での扱いは utils/leaveOfAbsence.ts
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
    { value: 'family_care', label: '介護休業' },
    { value: 'injury', label: '業務上の負傷・疾病による休業（労災）' },
    { value: 'other', label: 'その他の休職（私傷病の休職など）' },
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
                休業・休職（産休・育休・介護休業など）
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
                                {p.type === 'injury' && (
                                    // 業務上の負傷・疾病：最初の3日（待期）の休業補償の平均賃金を数える日（utils/averageWage.ts）
                                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px", fontSize: "11px", color: "#475569" }}>
                                        <span>事故の日（病気は診断で決まった日。空なら開始日）</span>
                                        <input type="date" value={p.accident ?? ''} onChange={e => update(i, { accident: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "160px" }} />
                                    </div>
                                )}
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
                休業・休職の日は働いていないので、その日の分の給与を払いません。計算期間がまるごと休業の月は、月給・固定の支給項目・固定残業代・通勤手当（月額）を払わず、
                途中で始まる・終わる月は、月給と固定の支給項目を、給与規定グループの「休業の月の日割り」で日割りします（時給制・日給制は、働いた分だけ払います）。
                勤怠の画面と出勤簿には、休業の日を「育休」などと出します。
            </p>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.6 }}>
                産前産後休業・育児休業は、年金事務所（健康保険組合）に申出をした期間を入れてください。開始日がある月の分から、終了日の翌日がある月の前月分まで、
                健康保険・介護保険・子ども・子育て支援金・厚生年金の保険料を引きません（雇用保険料は引きます）。休日をはさんで続けて休むときも、1つの期間として入れてください。
                介護休業・業務上の負傷や疾病による休業・その他の休職には保険料の免除がないので、給与がない月も社会保険料・住民税を引きます（差引支給額がマイナスになることがあります）。
            </p>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.6 }}>
                年次有給休暇の出勤率では、産前産後休業・育児休業・介護休業・業務上の負傷や疾病による休業の期間は出勤したものとみなします（労働基準法39条10項）。
                その他の休職は、会社設定の「休暇の種類」で決めた数え方（全労働日から除く・欠勤と同じに数える）で数えます。
            </p>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.6 }}>
                業務上の負傷・疾病による休業の最初の3日（休日も数える）は、労災保険の休業補償給付が出ないので、会社が平均賃金の60%の休業補償を払います（労働基準法76条）。
                給与明細に「休業補償(労災の待期)」として入れます（非課税で、社会保険料・雇用保険料もかかりません）。平均賃金は事故の日（病気は診断で決まった日）で数えます。
                同じ事故で休業を分けて入れるときは、事故の日を同じにしてください（3日を通算します）。通勤中のけが（通勤災害）は、会社に補償の義務がないので、「その他の休職」で入れてください。
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
