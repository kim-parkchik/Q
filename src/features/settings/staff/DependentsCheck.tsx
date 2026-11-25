/**
 * 扶養人数（扶養親族等の数）の数え方と、年末調整の画面に保存した扶養控除等申告書から数えた人数（見直しの P9）
 * 数えた人数が入力欄の扶養人数と違えば知らせ、「○人にする」で入力欄をその人数にする（保存は、いつもどおり「保存」で）。
 * 数え方は utils/withholdingDependents.ts
 */
import type { StaffManagerState } from '../useStaffManager';
import { monthDayLabel } from '../../../utils/withholdingDependents';

const note = { fontSize: "11px", color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.6 };
const reiwa = (year: number) => `令和${year - 2018}年分`;

export function DependentsCheck({ cm }: { cm: StaffManagerState }) {
    const { dependentsSuggestion: s, dependentsRule: rule, targetDependents, setTargetDependents, targetTaxColumn } = cm;
    if (targetTaxColumn === "hei") return null;
    const entered = Number(targetDependents) || 0;
    const differs = !!s && s.total !== entered;

    return (
        <div style={{ gridColumn: "1 / -1" }}>
            {s ? (
                <div style={{
                    border: `1px solid ${differs ? "#fdba74" : "#bbf7d0"}`, backgroundColor: differs ? "#fff7ed" : "#f0fdf4",
                    borderRadius: "8px", padding: "8px 10px",
                }}>
                    <div style={{ fontSize: "12px", fontWeight: "bold", color: differs ? "#b45309" : "#166534" }}>
                        {differs ? "⚠ " : "✓ "}
                        扶養控除等申告書から数えると {s.total}人{s.sourceYear !== s.year ? "（見込み）" : ""}
                        {differs ? `：上の扶養人数（${entered}人）と違います` : "：上の扶養人数と同じです"}
                    </div>
                    <p style={note}>
                        {s.sourceYear === s.year
                            ? `年末調整の画面に保存した${reiwa(s.year)}の申告書から、${s.year}年に支払う給与の数え方で数えました。`
                            : `${reiwa(s.year)}の申告書がまだ年末調整の画面にないので、${reiwa(s.sourceYear)}の申告書から、年齢を${s.year}年12月31日で数え直した見込みです`
                              + `（所得の見積額は${s.sourceYear}年のまま）。${reiwa(s.year)}の扶養控除等申告書で確かめてください。`}
                    </p>
                    {s.details.length > 0 && (
                        <ul style={{ ...note, paddingLeft: "18px", color: "#334155" }}>
                            {s.details.map((d) => <li key={d}>{d}</li>)}
                        </ul>
                    )}
                    {s.later && (
                        <p style={{ ...note, color: "#b45309" }}>
                            {s.year}年{monthDayLabel(s.later.from)}以後に支払う給与からは、所得の見積額の線が変わるので{s.later.total}人です。
                            {Number(s.later.from.slice(5, 7))}月分の給与から変えるときは、「扶養人数の変更を追加」で{s.year}年{Number(s.later.from.slice(5, 7))}月分からの行を足し、
                            {s.later.total}人にしてください。
                        </p>
                    )}
                    {s.notes.map((n) => <p key={n} style={note}>※ {n}</p>)}
                    {differs && (
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginTop: "6px" }}>
                            <button
                                type="button"
                                onClick={() => setTargetDependents(s.total)}
                                style={{
                                    flexShrink: 0, padding: "5px 12px", border: "1px solid #f59e0b", borderRadius: "6px",
                                    backgroundColor: "white", color: "#b45309", fontSize: "12px", fontWeight: "bold", cursor: "pointer",
                                }}
                            >
                                {s.total}人にする
                            </button>
                            <span style={{ ...note, margin: 0 }}>
                                上の扶養人数の欄が{s.total}人になります（保存は、いつもどおり「保存」で）。年の途中で人数が変わったときは、
                                先に「扶養人数の変更を追加」で変わる前の人数を履歴に残し、「何年何月分から」を変わった月にしてから押してください。
                            </span>
                        </div>
                    )}
                </div>
            ) : (
                <p style={note}>年末調整の画面に扶養控除等申告書の内容を入れると、ここに申告書から数えた人数が出ます。</p>
            )}
            {rule && (
                <details style={{ marginTop: "6px" }}>
                    <summary style={{ fontSize: "11px", color: "#475569", cursor: "pointer" }}>扶養人数（扶養親族等の数）の数え方</summary>
                    <p style={note}>{rule.intro}</p>
                    <ul style={{ ...note, paddingLeft: "18px" }}>
                        {rule.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    {rule.note && <p style={note}>{rule.note}</p>}
                </details>
            )}
        </div>
    );
}
