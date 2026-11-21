/**
 * 「休業・休職」：産前産後休業・育児休業等・介護休業・業務上の負傷や疾病による休業・その他の休職の期間
 * 社会保険料の免除（産休・育休だけ）の決まりは utils/leaveExemption.ts、給与・勤怠・年休の出勤率での扱いは utils/leaveOfAbsence.ts
 */
import { useEffect, useState } from 'react';
import { Baby, Plus, Trash2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import {
    papaLeaveWorkDays, parsePlannedWorkHoursText, plannedWorkHoursOf, validateLeavePeriod, type LeavePeriod, type LeaveType,
} from '../../../utils/leaveExemption';
import { hoursText } from '../../../utils/scheduledHours';
import type { StaffManagerState } from '../useStaffManager';

/** 産後パパ育休で働かせる時間の合計（"12"・"12:30"。空なら働かせない） */
function PlannedWorkHoursInput({ value, onChange }: { value: number; onChange: (hours: number | undefined) => void }) {
    const [text, setText] = useState(value > 0 ? hoursText(value) : '');
    const [bad, setBad] = useState(false);
    useEffect(() => { setText(value > 0 ? hoursText(value) : ''); setBad(false); }, [value]);
    const commit = () => {
        const parsed = parsePlannedWorkHoursText(text);
        if (parsed === undefined) { setBad(true); return; }
        setBad(false);
        setText(parsed === null ? '' : hoursText(parsed));
        onChange(parsed ?? undefined);
    };
    return (
        <input
            type="text"
            inputMode="numeric"
            value={text}
            placeholder="例 12:00"
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            data-leave="planned-work-hours"
            style={{ ...inputStyle, fontSize: "12px", width: "80px", textAlign: "right", borderColor: bad ? "#dc2626" : undefined }}
        />
    );
}

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
    const { targetLeavePeriods, setTargetLeavePeriods, targetIsExecutive, targetDailyHours } = cm;
    // 産後パパ育休の就業予定日数を数える1日の所定労働時間（画面の「1日の所定労働時間」。入れていなければ null）
    const dailyHours = Number(targetDailyHours) > 0 ? Number(targetDailyHours) : null;

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
                                {p.type === 'maternity' && (
                                    // 産前産後休業取得者申出書に書く（utils/leaveReport.ts）
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "4px", fontSize: "11px", color: "#475569" }}>
                                        <span>出産予定日</span>
                                        <input type="date" value={p.dueDate ?? ''} onChange={e => update(i, { dueDate: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "150px" }} />
                                        <span>出産した日</span>
                                        <input type="date" value={p.birthDate ?? ''} onChange={e => update(i, { birthDate: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "150px" }} />
                                        <label style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                                            <input type="checkbox" checked={p.multiple === true} onChange={e => update(i, { multiple: e.target.checked })} />多胎（2人以上）
                                        </label>
                                    </div>
                                )}
                                {p.type === 'childcare' && (
                                    // 育児休業等取得者申出書に書く（utils/leaveReport.ts）
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "4px", fontSize: "11px", color: "#475569" }}>
                                        <span>養育する子</span>
                                        <input placeholder="氏名（年金　正明）" value={p.childName ?? ''} onChange={e => update(i, { childName: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "130px" }} />
                                        <input placeholder="フリガナ（ネンキン マサアキ）" value={p.childKana ?? ''} onChange={e => update(i, { childKana: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "170px" }} />
                                        <span>生年月日</span>
                                        <input type="date" value={p.childBirthday ?? ''} onChange={e => update(i, { childBirthday: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "150px" }} />
                                        <label style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                                            <input type="checkbox" checked={p.adopted === true} onChange={e => update(i, { adopted: e.target.checked })} />実子でない（養子など）
                                        </label>
                                        {p.adopted === true && (
                                            <>
                                                <span>養育を始めた日</span>
                                                <input type="date" value={p.custodyStart ?? ''} onChange={e => update(i, { custodyStart: e.target.value })} style={{ ...inputStyle, fontSize: "12px", width: "150px" }} />
                                            </>
                                        )}
                                        <label style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                                            <input type="checkbox" checked={p.papaMama === true} onChange={e => update(i, { papaMama: e.target.checked })} />パパママ育休プラス
                                        </label>
                                    </div>
                                )}
                                {p.type === 'childcare' && (
                                    // 産後パパ育休（出生時育児休業）で働かせる時間：就業予定日数（14日の数え方・申出書。utils/leaveExemption.ts）
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "4px", fontSize: "11px", color: "#475569" }}>
                                        <label style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                                            <input
                                                type="checkbox"
                                                checked={p.papaLeave === true}
                                                onChange={e => update(i, e.target.checked ? { papaLeave: true } : { papaLeave: undefined, plannedWorkHours: undefined })}
                                                data-leave="papa-leave"
                                            />産後パパ育休（出生時育児休業）
                                        </label>
                                        {p.papaLeave === true && (() => {
                                            const hours = plannedWorkHoursOf(p);
                                            const days = papaLeaveWorkDays(p, dailyHours);
                                            return (
                                                <>
                                                    <span>労使協定で働かせる時間の合計</span>
                                                    <PlannedWorkHoursInput value={hours} onChange={h => update(i, { plannedWorkHours: h })} />
                                                    {hours <= 0 ? (
                                                        <span style={{ color: "#64748b" }}>働かせる日がなければ空のまま（就業予定日数 0日）</span>
                                                    ) : days === null ? (
                                                        <span style={{ color: "#dc2626" }}>1日の所定労働時間を入れると、就業予定日数を出します（入れるまでは8時間で数えます）</span>
                                                    ) : (
                                                        <span data-leave="planned-work-days">
                                                            → 就業予定日数 <b>{days}日</b>（{hoursText(hours)} ÷ 1日の所定労働時間 {hoursText(dailyHours)}。1日未満は切り捨て）
                                                        </span>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}
                                {(p.type === 'maternity' || p.type === 'childcare') && p.reported && (
                                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                                        届け出た内容：{p.reported.on}に{({ apply: "申出", change: "変更", extend: "延長", end: "終了" } as Record<string, string>)[p.reported.kind]}（{p.reported.start}〜{p.reported.end}）。
                                        期間を直したら、「産休・育休の申出書」の画面で、変更・延長・終了の届書を作ります
                                    </div>
                                )}
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
                産前産後休業の出産予定日・出産した日、育児休業の養育する子の氏名・生年月日は、「産休・育休の申出書」の画面で作る申出書に書きます。
            </p>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.6 }}>
                産前産後休業・育児休業は、年金事務所（健康保険組合）に申出をした期間を入れてください。開始日がある月の分から、終了日の翌日がある月の前月分まで、
                健康保険・介護保険・子ども・子育て支援金・厚生年金の保険料を引きません（雇用保険料は引きます）。休日をはさんで続けて休むときも、1つの期間として入れてください。
                同じ月のうちに始まって終わる育児休業は、その月に合わせて14日以上（休日も数える）なら、その月の分を引きません。
                産後パパ育休で、労使協定に基づいて休業中に働かせる日があるときは、働かせる時間の合計を入れてください。1日の所定労働時間で割った日数
                （1日未満は切り捨て）を就業予定日数にし、14日から除いて数え、申出書にも書きます（健康保険法施行規則135条4項）。
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
