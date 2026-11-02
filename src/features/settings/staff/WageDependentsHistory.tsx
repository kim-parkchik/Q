/**
 * 基本給・扶養人数の履歴：何年何月分から・いくら（何人）
 * 入力欄（給与区分・基本給、扶養人数）は、いちばん新しい履歴の値。昇給・変更を足すと、それまでの値はこの一覧に移る。
 * 計算のきまりは utils/staffHistory.ts
 */
import { Plus, Trash2 } from 'lucide-react';
import { inputStyle } from '../StaffManager.styles';
import { WAGE_TYPE_LABELS, type WageType } from '../../../utils/staffHistory';
import type { StaffManagerState } from '../useStaffManager';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const small = { ...inputStyle, fontFamily: "monospace", fontSize: "12px", padding: "6px" };
const note = { fontSize: "11px", color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.6 };
const addButton = {
    display: "flex", alignItems: "center", gap: "4px", marginTop: "6px", background: "none", border: "1px dashed #cbd5e1",
    borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "12px", color: "#475569",
};
const removeButton = {
    width: "30px", flexShrink: 0, background: "none", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "5px", cursor: "pointer", color: "#94a3b8",
};

/** 「何年何月分から」の入力（first なら「入社したときから」） */
function FromInput({ value, first, onChange }: { value: string; first: boolean; onChange: (v: string) => void }) {
    if (first) return <span style={{ width: "150px", flexShrink: 0, fontSize: "12px", color: "#475569" }}>入社したときから</span>;
    const [y, m] = value ? value.split('-').map(Number) : [0, 0];
    const set = (year: number, month: number) => onChange(`${year}-${String(month).padStart(2, '0')}`);
    return (
        <div style={{ width: "150px", flexShrink: 0, display: "flex", gap: "4px", alignItems: "center", fontSize: "12px" }}>
            <input type="number" min={2000} max={2100} value={y || ''} onChange={e => set(Number(e.target.value), m || 1)} style={{ ...small, width: "64px" }} />
            <select value={m || 1} onChange={e => set(y || new Date().getFullYear(), Number(e.target.value))} style={{ ...small, width: "50px" }}>
                {MONTHS.map(mo => <option key={mo} value={mo}>{mo}</option>)}
            </select>
            <span style={{ whiteSpace: "nowrap" }}>月分〜</span>
        </div>
    );
}

export function WageHistoryEditor({ cm }: { cm: StaffManagerState }) {
    const { targetWageHistoryPast: past, setTargetWageHistoryPast, targetWageFrom, setTargetWageFrom, wageHistoryError, addWageChange, removeWagePast } = cm;
    const update = (i: number, patch: Partial<(typeof past)[number]>) =>
        setTargetWageHistoryPast(past.map((e, k) => (k === i ? { ...e, ...patch } : e)));

    return (
        <div style={{ marginTop: "8px" }}>
            {past.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ fontSize: "11px", color: "#475569", fontWeight: "bold" }}>基本給の履歴（古い順）</div>
                    {past.map((e, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <FromInput value={e.from} first={i === 0} onChange={v => update(i, { from: v })} />
                            <select value={e.wageType} onChange={ev => update(i, { wageType: ev.target.value as WageType })} style={{ ...small, width: "80px", fontFamily: "inherit" }}>
                                {(Object.keys(WAGE_TYPE_LABELS) as WageType[]).map(t => <option key={t} value={t}>{WAGE_TYPE_LABELS[t]}</option>)}
                            </select>
                            <input type="number" min={0} value={e.amount} onChange={ev => update(i, { amount: Number(ev.target.value) })} style={{ ...small, flex: 1, minWidth: 0, textAlign: "right" }} />
                            <span style={{ fontSize: "11px", color: "#7f8c8d", width: "16px" }}>円</span>
                            <button type="button" onClick={() => removeWagePast(i)} title="この行を消す" style={removeButton}><Trash2 size={13} /></button>
                        </div>
                    ))}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <FromInput value={targetWageFrom} first={false} onChange={setTargetWageFrom} />
                        <span style={{ fontSize: "12px", color: "#475569" }}>上の給与区分・基本給（いまの値）</span>
                    </div>
                </div>
            )}
            {wageHistoryError && <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "4px" }}>{wageHistoryError}</div>}
            <button type="button" onClick={addWageChange} style={addButton}>
                <Plus size={13} /> 昇給・給与区分の変更を追加（いまの値を履歴に残す）
            </button>
            <p style={note}>
                給与は、その月の分（支給する月）に当たる行の給与区分・金額で計算します。過去の月を計算し直しても、その月の金額で計算します。
                時給制・日給制の人は、勤怠を確定した日の時給・日給で計算するので、勤怠を確定した後に変えたときは、その日の勤怠を確定し直してください。
            </p>
        </div>
    );
}

export function DependentsHistoryEditor({ cm }: { cm: StaffManagerState }) {
    const {
        targetDependentsHistoryPast: past, setTargetDependentsHistoryPast, targetDependentsFrom, setTargetDependentsFrom,
        dependentsHistoryError, addDependentsChange, removeDependentsPast,
    } = cm;
    const update = (i: number, patch: Partial<(typeof past)[number]>) =>
        setTargetDependentsHistoryPast(past.map((e, k) => (k === i ? { ...e, ...patch } : e)));

    return (
        <div style={{ gridColumn: "1 / -1" }}>
            {past.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ fontSize: "11px", color: "#475569", fontWeight: "bold" }}>扶養人数の履歴（古い順）</div>
                    {past.map((e, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <FromInput value={e.from} first={i === 0} onChange={v => update(i, { from: v })} />
                            <input type="number" min={0} value={e.count} onChange={ev => update(i, { count: Number(ev.target.value) })} style={{ ...small, width: "80px", textAlign: "right" }} />
                            <span style={{ fontSize: "11px", color: "#7f8c8d" }}>人</span>
                            <button type="button" onClick={() => removeDependentsPast(i)} title="この行を消す" style={removeButton}><Trash2 size={13} /></button>
                        </div>
                    ))}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <FromInput value={targetDependentsFrom} first={false} onChange={setTargetDependentsFrom} />
                        <span style={{ fontSize: "12px", color: "#475569" }}>上の扶養人数（いまの値）</span>
                    </div>
                </div>
            )}
            {dependentsHistoryError && <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "4px" }}>{dependentsHistoryError}</div>}
            <button type="button" onClick={addDependentsChange} style={addButton}>
                <Plus size={13} /> 扶養人数の変更を追加（いまの値を履歴に残す）
            </button>
            <p style={note}>
                扶養控除等（異動）申告書が出て人数が変わったら、変わった月の分からの行を足してください。給与・賞与の源泉所得税は、その月の分に当たる行の人数で計算します。
            </p>
        </div>
    );
}
