/**
 * 拠点の特定最低賃金（産業別の最低賃金）を入れる欄（見直しの P12。utils/minimumWage.ts）
 *
 * 当たる特定最低賃金の名前と、時間額・発効日の行（改正のたびに行を足す）を入れる。
 * 給与明細と従業員の画面では、地域別最低賃金と高いほうで比べる（最低賃金法6条1項）。
 * 決定で除かれる人（18歳未満・65歳以上など）は、従業員の画面の「特定最低賃金から除く」で外す。
 */
import { useEffect, useState } from 'react';
import { parseSpecificMinimumWage, type SpecificMinimumWage } from '../../../utils/minimumWage';

interface Props {
    branchId: number;
    /** branches.specific_minimum_wage（JSON） */
    value: unknown;
    onSave: (id: number, value: SpecificMinimumWage | null) => Promise<boolean>;
}

interface Row { from: string; amount: string }

const toRows = (v: SpecificMinimumWage | null): Row[] => (v?.wages ?? []).map(w => ({ from: w.from, amount: String(w.amount) }));

export default function SpecificMinimumWageEditor({ branchId, value, onSave }: Props) {
    const saved = parseSpecificMinimumWage(value);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(saved?.name ?? "");
    const [rows, setRows] = useState<Row[]>(toRows(saved));
    const savedKey = JSON.stringify(saved);
    useEffect(() => {
        setName(saved?.name ?? "");
        setRows(toRows(saved));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savedKey]);

    // 入れかけの行（発効日か金額の片方だけ・0円以下）
    const badRows = rows.filter(r => (r.from || r.amount) && !(/^\d{4}-\d{2}-\d{2}$/.test(r.from) && Number(r.amount) > 0));
    const edited: SpecificMinimumWage = { name: name.trim(), wages: rows.filter(r => r.from && Number(r.amount) > 0).map(r => ({ from: r.from, amount: Math.floor(Number(r.amount)) })) };
    const dirty = JSON.stringify(parseSpecificMinimumWage(edited)) !== savedKey;
    const latest = saved?.wages[saved.wages.length - 1];

    const save = async () => {
        if (badRows.length > 0) return;
        await onSave(branchId, parseSpecificMinimumWage(edited));
    };

    return (
        <div style={{ marginTop: "6px", fontSize: "12px" }} data-branch-specific-minimum-wage={branchId}>
            <button type="button" onClick={() => setOpen(o => !o)}
                style={{ fontSize: "12px", padding: 0, border: "none", background: "none", color: "#475569", cursor: "pointer", textAlign: "left" }}>
                {open ? "▾" : "▸"} 特定最低賃金：{saved ? `${saved.name || "名前なし"}（${latest!.amount.toLocaleString()}円。${latest!.from}から）` : "入れていない（地域別最低賃金だけで比べます）"}
            </button>
            {open && (
                <div style={{ marginTop: "6px", padding: "8px 10px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.6 }}>
                        この拠点の事業に特定（産業別）最低賃金が当たるときに入れます。地域別最低賃金と高いほうで比べます（最低賃金法6条1項）。
                        名前・時間額・発効日は、厚生労働省や都道府県労働局の特定最低賃金の一覧で確かめて入れてください（改正のたびに行を足します）。
                        決定で除かれる人（18歳未満・65歳以上・雇入れ後の一定期間の人・決められた業務の人など）は、従業員の画面の「特定最低賃金から除く」にチェックします。
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        名前
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="例：○○県 ○○製造業最低賃金" style={{ flex: 1, fontSize: "12px", padding: "2px 4px" }} />
                    </label>
                    {rows.map((r, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <input type="date" value={r.from} aria-label="発効日" onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, from: e.target.value } : x))} style={{ fontSize: "12px" }} />
                            から 時間額
                            <input type="number" min={1} value={r.amount} aria-label="時間額" onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} style={{ width: "80px", fontSize: "12px", textAlign: "right" }} />
                            円
                            <button type="button" onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} style={{ fontSize: "11px" }}>行を消す</button>
                        </div>
                    ))}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => setRows(prev => [...prev, { from: "", amount: "" }])} style={{ fontSize: "11px" }}>＋ 発効日と時間額の行を足す</button>
                        <button type="button" onClick={save} disabled={!dirty || badRows.length > 0} style={{ fontSize: "11px", fontWeight: "bold" }}>保存</button>
                        {badRows.length > 0 && <span style={{ color: "#b45309", fontSize: "11px" }}>発効日と時間額（1円以上）を両方入れてください</span>}
                        {!badRows.length && edited.wages.length === 0 && saved && <span style={{ color: "#64748b", fontSize: "11px" }}>行がないまま保存すると、特定最低賃金を消します</span>}
                    </div>
                </div>
            )}
        </div>
    );
}
