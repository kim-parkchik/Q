/**
 * 住民税（特別徴収）：年度（6月〜翌年5月）ごとの12か月の額
 * 通知書の「6月分」と「7月以降」の額で12か月を埋め、月ごとに直せる（弥生給与の簡易入力・月別入力と同じ）。
 * 計算のきまりは utils/residentTax.ts
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import {
    RESIDENT_TAX_MONTHS, annualTotal, emptyAmounts, fiscalYearLabel, fiscalYearOf, simpleAmounts, type ResidentTaxYear,
} from '../../../utils/residentTax';

const small = { ...inputStyle, fontFamily: "monospace", fontSize: "12px", padding: "6px", textAlign: "right" as const };
const note = { fontSize: "11px", color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.6 };
const button = {
    display: "flex", alignItems: "center", gap: "4px", background: "#fff", border: "1px solid #cbd5e1",
    borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "12px", color: "#475569", whiteSpace: "nowrap" as const,
};

export default function ResidentTaxEditor({ cm }: { cm: StaffManagerState }) {
    const { targetResidentTaxSchedule: schedule, setTargetResidentTaxSchedule, targetResidentTax, setTargetResidentTax } = cm;
    const today = new Date();
    const currentYear = fiscalYearOf(today.getFullYear(), today.getMonth() + 1);
    const [selected, setSelected] = useState<number | null>(null);
    const [june, setJune] = useState("");
    const [rest, setRest] = useState("");

    // 表示する年度：選んだ年度。なければ今の年度、それもなければいちばん新しい年度
    const shown = schedule.find(e => e.fiscalYear === selected)
        ?? schedule.find(e => e.fiscalYear === currentYear)
        ?? schedule[schedule.length - 1]
        ?? null;
    // 足す年度の初めの値：今の年度がまだなければ今の年度、あればいちばん新しい年度の次
    const suggested = schedule.some(e => e.fiscalYear === currentYear)
        ? Math.max(...schedule.map(e => e.fiscalYear)) + 1
        : currentYear;
    const [newYear, setNewYear] = useState<number | null>(null);
    const yearToAdd = newYear ?? suggested;

    const setAmounts = (fiscalYear: number, amounts: number[]) =>
        setTargetResidentTaxSchedule(schedule.map(e => (e.fiscalYear === fiscalYear ? { ...e, amounts } : e)));
    const addYear = () => {
        if (!schedule.some(e => e.fiscalYear === yearToAdd)) {
            const added: ResidentTaxYear = { fiscalYear: yearToAdd, amounts: emptyAmounts() };
            setTargetResidentTaxSchedule([...schedule, added].sort((a, b) => a.fiscalYear - b.fiscalYear));
        }
        setSelected(yearToAdd);
        setNewYear(null);
        setJune(""); setRest("");
    };
    const removeYear = (fiscalYear: number) => {
        setTargetResidentTaxSchedule(schedule.filter(e => e.fiscalYear !== fiscalYear));
        setSelected(null);
    };
    const fillSimple = () => {
        if (!shown) return;
        setAmounts(shown.fiscalYear, simpleAmounts(Number(june), Number(rest)));
    };

    return (
        <div style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px" }}>
            <label style={labelStyle}>住民税（特別徴収）</label>

            {/* 年度を選ぶ・足す */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                {schedule.length > 0 && (
                    <select
                        value={shown?.fiscalYear ?? ""}
                        onChange={e => { setSelected(Number(e.target.value)); setJune(""); setRest(""); }}
                        style={{ ...inputStyle, width: "auto", fontSize: "12px", padding: "6px" }}
                    >
                        {schedule.map(e => <option key={e.fiscalYear} value={e.fiscalYear}>{fiscalYearLabel(e.fiscalYear)}</option>)}
                    </select>
                )}
                <input
                    type="number" min={2000} max={2100} value={yearToAdd}
                    onChange={e => setNewYear(Number(e.target.value) || null)}
                    style={{ ...small, width: "72px" }}
                />
                <button type="button" onClick={addYear} style={button}><Plus size={13} /> 年度を追加</button>
                {shown && (
                    <button type="button" onClick={() => removeYear(shown.fiscalYear)} style={{ ...button, color: "#94a3b8" }} title="この年度の額を消す">
                        <Trash2 size={13} /> この年度を消す
                    </button>
                )}
            </div>

            {shown ? (
                <>
                    {/* 簡易入力：通知書の6月分と7月以降 */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "8px", backgroundColor: "#f8fafc", padding: "6px 8px", borderRadius: "5px" }}>
                        <span style={{ fontSize: "12px", color: "#475569" }}>通知書の 6月分</span>
                        <input type="number" min={0} value={june} placeholder="0" onChange={e => setJune(e.target.value)} style={{ ...small, width: "90px" }} />
                        <span style={{ fontSize: "12px", color: "#475569" }}>円　7月以降</span>
                        <input type="number" min={0} value={rest} placeholder="0" onChange={e => setRest(e.target.value)} style={{ ...small, width: "90px" }} />
                        <span style={{ fontSize: "12px", color: "#475569" }}>円</span>
                        <button type="button" onClick={fillSimple} disabled={june === "" && rest === ""} style={button}>12か月に入れる</button>
                    </div>

                    {/* 月ごとの額 */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px", marginTop: "8px" }}>
                        {RESIDENT_TAX_MONTHS.map((m, i) => (
                            <div key={m}>
                                <div style={{ fontSize: "11px", color: "#475569", marginBottom: "2px" }}>
                                    {m === 6 ? `${shown.fiscalYear}年6月分` : m === 1 ? `${shown.fiscalYear + 1}年1月分` : `${m}月分`}
                                </div>
                                <input
                                    type="number" min={0} value={shown.amounts[i]}
                                    onChange={e => setAmounts(shown.fiscalYear, shown.amounts.map((v, k) => (k === i ? Number(e.target.value) : v)))}
                                    style={small}
                                />
                            </div>
                        ))}
                    </div>
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "6px", textAlign: "right" }}>
                        年税額（12か月の合計）：{annualTotal(shown.amounts).toLocaleString()}円
                    </div>
                </>
            ) : (
                <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "8px" }}>年度の額はまだありません。「年度を追加」で入れてください。</div>
            )}

            {/* 以前の入れ方の月額（年度の額を入れていない月に使う。入っている人だけ出す） */}
            {targetResidentTax > 0 && (
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" }}>
                    <span style={{ fontSize: "12px", color: "#475569" }}>年度の額を入れていない月の住民税（以前の月額）</span>
                    <input type="number" min={0} value={targetResidentTax} onChange={e => setTargetResidentTax(Number(e.target.value))} style={{ ...small, width: "90px" }} />
                    <span style={{ fontSize: "12px", color: "#475569" }}>円</span>
                </div>
            )}

            <p style={note}>
                市区町村から届く「特別徴収税額の決定通知書」の額を、年度（6月分〜翌年5月分）ごとに入れます。6月分は6月に支給する給与から引きます。
                通知書の6月分と7月以降の額を入れて「12か月に入れる」を押すと、12か月の額がそろいます。月ごとの額も直せます。
                税額の変更の通知が届いたら、通知を受け取った月から後の額を直してください。
                退職する人の残りの額を一括で引くときは、最後の給与明細の住民税の欄で直してください。
                年度の額を入れていない月は、住民税を引きません{targetResidentTax > 0 ? "（以前の月額が入っている人は、その額を引きます）" : ""}。
            </p>
        </div>
    );
}
