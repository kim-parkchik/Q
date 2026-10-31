/**
 * 標準報酬月額の履歴：何年何月分から・いくら・理由
 * 最初の1件は「入社したときから」。決定通知書が届いたら、その月の分からの行を足す。
 * 計算のきまりは utils/standardRemuneration.ts
 */
import { Banknote, Plus, Trash2 } from 'lucide-react';
import { HYOJUN_OPTIONS } from './staffOptions';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import {
    REMUNERATION_REASON_LABELS, latestStandardRemuneration, type RemunerationEntry, type RemunerationReason,
} from '../../../utils/standardRemuneration';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function RemunerationHistory({ cm }: Props) {
    const { targetRemunerationHistory, setTargetRemunerationHistory, remunerationHistoryError } = cm;

    const update = (index: number, patch: Partial<RemunerationEntry>) =>
        setTargetRemunerationHistory(targetRemunerationHistory.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    const remove = (index: number) => setTargetRemunerationHistory(targetRemunerationHistory.filter((_, i) => i !== index));
    const add = () => {
        const now = new Date();
        const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        setTargetRemunerationHistory([
            ...targetRemunerationHistory,
            { from, amount: latestStandardRemuneration(targetRemunerationHistory), reason: 'teiji' },
        ]);
    };
    const setFrom = (index: number, year: number, month: number) =>
        update(index, { from: `${year}-${String(month).padStart(2, '0')}` });

    const selectStyle = { ...inputStyle, fontFamily: "monospace", fontSize: "12px", padding: "8px" };

    return (
        <div>
            <label style={labelStyle}>
                <Banknote size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                標準報酬月額（社会保険計算用）
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {targetRemunerationHistory.map((e, i) => {
                    const [y, m] = e.from ? e.from.split('-').map(Number) : [0, 0];
                    return (
                        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <div style={{ width: "150px", flexShrink: 0, display: "flex", gap: "4px", alignItems: "center", fontSize: "12px" }}>
                                {i === 0 ? (
                                    <span style={{ color: "#475569" }}>入社したときから</span>
                                ) : (
                                    <>
                                        <input
                                            type="number" min={2000} max={2100} value={y || ''}
                                            onChange={ev => setFrom(i, Number(ev.target.value), m || 1)}
                                            style={{ ...selectStyle, width: "70px" }}
                                        />
                                        <select value={m || 1} onChange={ev => setFrom(i, y || new Date().getFullYear(), Number(ev.target.value))} style={{ ...selectStyle, width: "56px" }}>
                                            {MONTHS.map(mo => <option key={mo} value={mo}>{mo}</option>)}
                                        </select>
                                        <span style={{ whiteSpace: "nowrap" }}>月分〜</span>
                                    </>
                                )}
                            </div>
                            <select value={e.amount} onChange={ev => update(i, { amount: Number(ev.target.value) })} style={{ ...selectStyle, flex: 1, minWidth: 0 }}>
                                <option value={0}>0: 未加入・対象外</option>
                                {HYOJUN_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                            <select value={e.reason} onChange={ev => update(i, { reason: ev.target.value as RemunerationReason })} style={{ ...selectStyle, width: "130px", flexShrink: 0, fontFamily: "inherit" }}>
                                {(Object.keys(REMUNERATION_REASON_LABELS) as RemunerationReason[]).map(r => (
                                    <option key={r} value={r}>{REMUNERATION_REASON_LABELS[r]}</option>
                                ))}
                            </select>
                            {i === 0 ? (
                                <span style={{ width: "34px", flexShrink: 0 }} />
                            ) : (
                                <button
                                    type="button" onClick={() => remove(i)} title="この行を消す"
                                    style={{ width: "34px", flexShrink: 0, background: "none", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "7px", cursor: "pointer", color: "#94a3b8" }}
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            {remunerationHistoryError && <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "4px" }}>{remunerationHistoryError}</div>}
            <button
                type="button" onClick={add}
                style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "6px", background: "none", border: "1px dashed #cbd5e1", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "12px", color: "#475569" }}
            >
                <Plus size={14} /> 改定を追加（決定通知書が届いたとき）
            </button>
            <p style={{ fontSize: "11px", color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.6 }}>
                決定通知書に書かれた等級の金額を選んでください。給与は、その月の分に当たる行の金額で計算します
                （定時決定は9月分から、随時改定は変わった月から4か月目の分から）。過去の月を計算し直しても、その月の金額で計算します。
            </p>
        </div>
    );
}
