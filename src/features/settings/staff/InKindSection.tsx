/**
 * 「現物で払う報酬」：社宅・寮（住宅）、食事、自社製品など（その他）を、期間ごとに入れる（staff.in_kind。utils/genbutsu.ts）
 * 価額は、厚生労働大臣が定める現物給与の価額（勤務地の都道府県・月ごと）で Q が出し、社会保険の報酬（標準報酬月額の決め方と届書の「現物」）に入れる。
 * 給与明細の支給合計・差引支払額には入れない。所得税は、食事・住宅は入れた額、その他は時価にかかる。雇用保険は、その他だけ入れる
 */
import { Home, Plus, Trash2 } from 'lucide-react';
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';
import { branchPrefectureOf } from '../../../utils/branchPrefecture';
import {
    IN_KIND_KIND_LABELS, MEAL_PATTERN_LABELS, emptyInKindEntry, inKindEntryWarnings, inKindOfMonth, validateInKindEntry,
    type InKindEntry, type InKindKind, type MealPattern,
} from '../../../utils/genbutsu';

interface Props {
    cm: StaffManagerState;
}

/** 数の入力欄（空は 0） */
const NumberField = ({ label, value, unit, step, onChange, title }: { label: string; value: number; unit: string; step?: string; onChange: (v: number) => void; title?: string }) => (
    <div style={{ flex: 1, minWidth: "110px" }} title={title}>
        <label style={{ ...labelStyle, fontSize: "11px" }}>{label}</label>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <input
                type="number" min={0} step={step ?? "1"}
                value={value || ""} placeholder="0"
                onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
                style={{ ...inputStyle, fontSize: "12px", paddingRight: "44px", textAlign: "right" }}
            />
            <span style={{ position: "absolute", right: "8px", fontSize: "11px", color: "#7f8c8d", pointerEvents: "none" }}>{unit}</span>
        </div>
    </div>
);

const NAME_PLACEHOLDERS: Record<InKindKind, string> = { housing: "社宅・寮など", meal: "寮の食事・昼食など", other: "自社製品など" };

export default function InKindSection({ cm }: Props) {
    const { targetInKind, setTargetInKind, branches, targetBranchId } = cm;
    const update = (index: number, patch: Partial<InKindEntry>) =>
        setTargetInKind(targetInKind.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    const remove = (index: number) => setTargetInKind(targetInKind.filter((_, i) => i !== index));
    const add = () => setTargetInKind([...targetInKind, emptyInKindEntry("housing")]);

    // いまの月の価額（勤務地＝拠点の都道府県の表で）。出勤した日ごとの食事は1日の額
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const { prefecture } = branchPrefectureOf(branches ?? [], targetBranchId);
    const preview = (e: InKindEntry): string | null => {
        if (validateInKindEntry(e)) return null;
        const workday = e.kind === "meal" && e.mealPattern === "workday";
        const m = inKindOfMonth([{ ...e, start: `${ym}-01`, end: "" }], ym, prefecture, workday ? [`${ym}-01`] : []);
        if (m.problems.length > 0) return `いまの価額を出せません（${m.problems.join("。")}）`;
        const line = m.lines[0];
        return line ? `${now.getFullYear()}年${now.getMonth() + 1}月分の${workday ? "1日" : "1か月"}の額：${line.amount.toLocaleString()}円（${line.detail}）` : null;
    };

    return (
        <div style={{ marginTop: "4px", width: "100%" }}>
            <h4 style={{ borderLeft: "4px solid #7c3aed", paddingLeft: "10px", margin: "0 0 8px 0", fontSize: "14px" }}>
                <Home size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                現物で払う報酬（社宅・寮・食事・自社製品など）
            </h4>

            {targetInKind.map((e, i) => {
                const error = validateInKindEntry(e);
                const warnings = error ? [] : inKindEntryWarnings(e);
                const workday = e.kind === "meal" && e.mealPattern === "workday";
                const per = workday ? "円/日" : "円/月";
                const p = preview(e);
                return (
                    <div key={i} style={{ marginBottom: "8px", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "6px", backgroundColor: "#faf5ff" }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                            <div style={{ flex: 3 }}>
                                <label style={{ ...labelStyle, fontSize: "11px" }}>種類</label>
                                <select value={e.kind} onChange={ev => update(i, { kind: ev.target.value as InKindKind })} style={{ ...inputStyle, fontSize: "12px" }}>
                                    {(Object.keys(IN_KIND_KIND_LABELS) as InKindKind[]).map(k => <option key={k} value={k}>{IN_KIND_KIND_LABELS[k]}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 3 }}>
                                <label style={{ ...labelStyle, fontSize: "11px" }}>名前（明細に出す）</label>
                                <input type="text" value={e.name} placeholder={NAME_PLACEHOLDERS[e.kind]} onChange={ev => update(i, { name: ev.target.value })} style={{ ...inputStyle, fontSize: "12px" }} />
                            </div>
                            <div style={{ flex: 3 }}>
                                <label style={{ ...labelStyle, fontSize: "11px" }}>始めた日（入居日など）</label>
                                <input type="date" value={e.start} onChange={ev => update(i, { start: ev.target.value })} style={{ ...inputStyle, fontSize: "12px" }} />
                            </div>
                            <div style={{ flex: 3 }}>
                                <label style={{ ...labelStyle, fontSize: "11px" }}>やめた日（いまもなら空）</label>
                                <input type="date" value={e.end} onChange={ev => update(i, { end: ev.target.value })} style={{ ...inputStyle, fontSize: "12px" }} />
                            </div>
                            <button onClick={() => remove(i)} title="この行を消す" style={{ border: "none", background: "none", cursor: "pointer", padding: "6px" }}>
                                <Trash2 size={16} color="#e74c3c" />
                            </button>
                        </div>

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                            {e.kind === "housing" && (
                                <>
                                    <NumberField label="居住用の室の畳数（〜令和8年9月分）" value={e.tatami} unit="畳" step="0.5" onChange={v => update(i, { tatami: v })}
                                        title="居間・寝室など居住用の室の畳数（玄関・台所・トイレ・浴室・廊下は入れない）。令和8年9月分までの価額に使います" />
                                    <NumberField label="畳でない居住用の室（洋室など）" value={e.roomSqm} unit="㎡" step="0.01" onChange={v => update(i, { roomSqm: v })}
                                        title="洋室など畳を敷いていない居住用の室の広さ。1.65平方メートルを1畳にします（令和8年9月分まで）" />
                                    <NumberField label="住宅の総面積（令和8年10月分〜）" value={e.area} unit="㎡" step="0.01" onChange={v => update(i, { area: v })}
                                        title="玄関・台所・トイレ・浴室・廊下・押し入れも含めた床面積の合計（別棟の物置・車庫と、共同住宅の共用部分は除く）" />
                                    <NumberField label="一緒に住む被保険者の数（本人も）" value={e.sharers} unit="人" onChange={v => update(i, { sharers: Math.max(1, Math.floor(v)) })}
                                        title="同じ住宅に住む被保険者の数。令和8年10月分からは、総面積をこの数で割ります" />
                                </>
                            )}
                            {e.kind === "meal" && (
                                <div style={{ flex: 2, minWidth: "200px" }}>
                                    <label style={{ ...labelStyle, fontSize: "11px" }}>食事の出し方</label>
                                    <select value={e.mealPattern} onChange={ev => update(i, { mealPattern: ev.target.value as MealPattern })} style={{ ...inputStyle, fontSize: "12px" }}>
                                        {(Object.keys(MEAL_PATTERN_LABELS) as MealPattern[]).map(k => <option key={k} value={k}>{MEAL_PATTERN_LABELS[k]}</option>)}
                                    </select>
                                    {workday && (
                                        <div style={{ display: "flex", gap: "10px", fontSize: "12px", marginTop: "4px" }}>
                                            {([["breakfast", "朝食"], ["lunch", "昼食"], ["dinner", "夕食"]] as const).map(([key, text]) => (
                                                <label key={key} style={{ display: "flex", alignItems: "center", gap: "2px", cursor: "pointer" }}>
                                                    <input type="checkbox" checked={e[key]} onChange={ev => update(i, { [key]: ev.target.checked })} />{text}
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {e.kind === "other" && (
                                <NumberField label="時価（1か月）" value={e.value} unit="円/月" onChange={v => update(i, { value: Math.floor(v) })}
                                    title="自社製品などの時価（労働協約に決めがあればその価額。消費税を含めた額）" />
                            )}
                            <NumberField label={e.kind === "housing" ? "本人が払う家賃" : workday ? "本人が払う額（1日）" : "本人が払う額（1か月）"} value={e.selfPay} unit={per}
                                onChange={v => update(i, { selfPay: Math.floor(v) })}
                                title={e.kind === "meal" ? "食費として給与から引く額など。価額の3分の2以上を払っていれば0円になります" : "家賃などとして給与から引く額など。価額から引きます"} />
                            {e.kind !== "other" ? (
                                <NumberField label={workday ? "所得税がかかる額（1日）" : "所得税がかかる額（1か月）"} value={e.taxable} unit={per}
                                    onChange={v => update(i, { taxable: Math.floor(v) })}
                                    title={e.kind === "meal"
                                        ? "食事は、本人が半分以上を払い、会社の負担が月7,500円以下（令和8年3月までは3,500円。消費税を除く）なら所得税はかかりません（0円）。かかるときは会社の負担額を入れます"
                                        : "社宅は、本人が賃貸料相当額（固定資産税の課税標準額などから計算）の50%以上を払っていれば所得税はかかりません（0円）。かかるときは、その差額を入れます"} />
                            ) : (
                                <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", marginTop: "18px", cursor: "pointer" }}>
                                    <input type="checkbox" checked={e.taxFree} onChange={ev => update(i, { taxFree: ev.target.checked })} />
                                    所得税がかからない
                                </label>
                            )}
                        </div>

                        {p && <div style={{ fontSize: "11px", color: "#5b21b6", marginTop: "6px" }}>{p}</div>}
                        {error && <div style={{ fontSize: "11px", color: "#b91c1c", marginTop: "4px" }}>⚠ {error}</div>}
                        {warnings.map(w => <div key={w} style={{ fontSize: "11px", color: "#b45309", marginTop: "4px" }}>⚠ {w}</div>)}
                    </div>
                );
            })}

            <button onClick={add} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", border: "1px dashed #a78bfa", background: "white", color: "#6d28d9", borderRadius: "6px", padding: "4px 10px", cursor: "pointer" }}>
                <Plus size={14} /> 現物で払う報酬を足す
            </button>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "6px", lineHeight: 1.6 }}>
                社宅・寮・食事の価額は、厚生労働大臣が定める現物給与の価額（勤務地の都道府県・月ごと）で計算し、社会保険の報酬（標準報酬月額の決め方と届書の「現物」）に入れます。
                給与明細の支給合計・差引支払額には入れません。月の途中から・までの月は日割りします。家賃・広さなどが変わったときは、前の行にやめた日を入れ、新しい行を足してください。
                雇用保険料には、その他（自社製品など）だけを入れます（食事・住宅は、労働保険では福利厚生として賃金にしないことが多いため）。
                健康保険組合が規約で別の価額を決めているときは、組合に確かめてください。定期券などを現物で渡す人は、通勤手当の欄で印を付けます。
            </div>
        </div>
    );
}
