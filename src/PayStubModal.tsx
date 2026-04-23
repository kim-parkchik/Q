import React, { useState, useMemo, useEffect } from 'react';
import * as Master from './constants/salaryMaster2026';
import { calculateSalary, saveSalaryResult, PREFECTURES, type SalaryExtras } from './calcSalary';

const fmtH = (num: number) => {
    const h = Math.floor(num);
    const m = Math.round((num - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
};

const padRows = (current: number, target: number) =>
    Array.from({ length: Math.max(0, target - current) }, (_, i) => (
        <tr key={`pad-${i}`} style={{ height: 34 }}>
            <td style={tdS} /><td style={tdS} />
        </tr>
    ));

interface Props {
    db: any;
    staff: any;
    attendanceData: any[];
    year: number;
    month: number;
    companySettings: any; // これを追加
    onClose: () => void;
}

export default function PayStubModal({ db, staff, attendanceData, year, month, companySettings, onClose }: Props) {
    const [isSaved, setIsSaved] = useState(false); // salary_resultsへの確定保存フラグ
    const [extras, setExtras] = useState<SalaryExtras>({
        allowanceName:   "役職手当",
        allowanceAmount: 0,
        residentTax:     Number(staff.resident_tax)     || 0,
        prefecture:      staff.prefecture               || "東京",
        dependents:      Number(staff.dependents) || 0,
        customItems:     [],
    });

    useEffect(() => {
        const loadCustomItems = async () => {
            if (!db) return;
            try {
                // SQLの戻り値の型を定義
                interface SalaryItemRow {
                    name: string;
                    type: 'earning' | 'deduction';
                    amount: number;
                }

                // selectの後ろに <...> を付けず、結果をキャストする
                const rows = await db.select(
                    `SELECT m.name, m.type, COALESCE(v.amount, 0) as amount
                    FROM salary_item_master m
                    LEFT JOIN staff_salary_values v ON m.id = v.item_id AND v.staff_id = ?
                    WHERE m.category != 'formula'
                    ORDER BY m.type DESC, m.id ASC`,
                    [staff.id]
                ) as SalaryItemRow[]; // 👈 ここで型を確定させる

                const items = rows
                    .filter(r => r.amount > 0)
                    .map(r => ({ 
                        name: r.name, 
                        amount: Number(r.amount), 
                        type: r.type 
                    }));

                setExtras(p => ({ ...p, customItems: items }));
            } catch (e) {
                console.error("customItems 読み込みエラー:", e);
            }
        };
        loadCustomItems();
    }, [db, staff.id]);

    const salary = useMemo(
    () => calculateSalary(staff, attendanceData, extras, year, month, companySettings), // ★ {} から変更
        [staff, attendanceData, extras, year, month, companySettings] // ★ 依存配列にも追加
    );

    const wageLabel = staff.wage_type === "monthly" ? "月給制" : "時給制";
    const customEarningItems   = extras.customItems.filter(i => i.type === 'earning');
    const customDeductionItems = extras.customItems.filter(i => i.type === 'deduction');
  
    // ── 行数計算（左右を完全に同期させる） ──
    // 支給基本: 基本給(1) + 残業(1) + 深夜(1) + 通勤(1) + 任意手当(1) = 5行
    // 控除基本: 健保(1) + 介護(1) + 厚生(1) + 雇用(1) + 所得税(1) + 住民税(1) = 6行
    const earningItemsCount = 
        1 // 基本給
        + (salary.absenceDeduction > 0 ? 1 : 0)
        + (salary.statutoryOvertimePay > 0 ? 1 : 0)
        + (salary.standardOvertimePay > 0 ? 1 : 0)
        + (salary.highOvertimePay > 0 ? 1 : 0)
        + 1 // 深夜手当
        + 1 // 通勤手当
        + 1 // 任意手当
        + customEarningItems.length;
    const deductionItemsCount = 6 + customDeductionItems.length;
  
    // 左右で多い方に合わせる（最低でも合計10行程度あると見栄えが良い）
    const targetRows = Math.max(earningItemsCount, deductionItemsCount, 10);

    const handleSaveResult = async () => {
        if (!db || !staff) return;
        const result = await saveSalaryResult(db, staff.id, year, month, salary, staff);
        if (result.success) {
            setIsSaved(true);
            alert(`${staff.name}さん ${year}年${month}月分の給与を確定しました。\n（賞与の所得税計算で前月給与として参照されます）`);
        } else {
            alert("保存に失敗しました: " + result.error);
        }
    };

    return (
        <div style={overlayS}>
            <div style={containerS}>
                <button onClick={onClose} className="no-print" style={closeBtnS}>✕</button>

                {/* ─── 操作パネル ─── */}
                <div className="no-print" style={panelS}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: 15 }}>給与明細 設定</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div>
                            <label style={labelS}>都道府県</label>
                            <select value={extras.prefecture} onChange={e => setExtras(p => ({ ...p, prefecture: e.target.value }))} style={inputS}>
                                {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelS}>扶養人数</label>
                            <input type="number" min={0} max={7} value={extras.dependents} onChange={e => setExtras(p => ({ ...p, dependents: Number(e.target.value) }))} style={inputS} />
                        </div>
                        <div>
                            <label style={labelS}>住民税</label>
                            <input type="number" min={0} value={extras.residentTax} onChange={e => setExtras(p => ({ ...p, residentTax: Number(e.target.value) }))} style={inputS} />
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => window.print()} style={{ ...printBtnS, flex: 1 }}>🖨 印刷・PDF保存</button>
                        <button 
                            onClick={handleSaveResult} 
                            style={{ ...printBtnS, flex: 1, backgroundColor: isSaved ? "#27ae60" : "#8e44ad" }}
                        >
                            {isSaved ? "✅ 確定済み" : "💾 給与確定"}
                        </button>
                    </div>
                </div>

                {/* ─── 明細書本体 ─── */}
                <div id="print-area" style={{ padding: 16, backgroundColor: "white" }}>
                    <h1 style={titleS}>給　与　明　細　書</h1>
          
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "flex-end" }}>
                        <div>
                            <div style={{ fontSize: 18, borderBottom: "1.5px solid #000", paddingBottom: 2, paddingRight: 40 }}>{staff.name} 様</div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: 13 }}>
                            <div>{year} 年 {month} 月分</div>
                            <div style={{ fontSize: 11, color: "#888" }}>{wageLabel}</div>
                        </div>
                    </div>

                    <table style={tableS}>
                        <thead>
                            <tr style={theadS}>
                                <th style={thS}>出勤日数</th>
                                <th style={thS}>総労働時間</th>
                                <th style={thS}>法定内残業</th>
                                <th style={thS}>残業(割増対象)</th>
                                <th style={thS}>深夜時間</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={tdCtrS}>{salary.workDays} 日</td>
                                <td style={tdCtrS}>{fmtH(salary.totalWorkHours)}</td>
                                
                                {/* 1.0倍分 */}
                                <td style={tdCtrS}>{fmtH(salary.totalStatutoryOvertimeHours)}</td>
                                
                                {/* 割増対象 (25%〜) */}
                                <td style={tdCtrS}>
                                    <div>{fmtH(salary.standardPremiumHours + salary.highPremiumHours)}</div>
                                    
                                    {/* 60時間を超えた分がある場合のみ、内訳を表示 */}
                                    {salary.highPremiumHours > 0 && (
                                        <div style={{ 
                                            fontSize: '10px', 
                                            color: '#d35400', 
                                            marginTop: 2,
                                            borderTop: '1px dotted #ccc' 
                                        }}>
                                            {Master.OVERTIME_PREMIUM_LIMIT_HOURS}h超: {fmtH(salary.highPremiumHours)}
                                        </div>
                                    )}
                                </td>
                                
                                <td style={tdCtrS}>{fmtH(salary.totalNightHours)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
                        {/* 支給項目 */}
                        <div style={{ flex: 1 }}>
                            <table style={tableS}>
                                <thead><tr style={theadS}><th colSpan={2} style={thS}>支給項目</th></tr></thead>
                                <tbody>
                                    <tr><td style={tdS}>基本給/時給分</td><td style={rtdS}>¥{salary.basePay.toLocaleString()}</td></tr>
                                    
                                    {/* 欠勤控除 */}
                                    {salary.absenceDeduction > 0 && (
                                        <tr><td style={{...tdS, color: "#c0392b"}}>欠勤控除</td><td style={{...rtdS, color: "#c0392b"}}>－¥{salary.absenceDeduction.toLocaleString()}</td></tr>
                                    )}

                                    {/* 残業手当の内訳分け */}
                                    {salary.statutoryOvertimePay > 0 && (
                                        <tr><td style={tdS}>時間外手当(法定内)</td><td style={rtdS}>¥{salary.statutoryOvertimePay.toLocaleString()}</td></tr>
                                    )}
                                    {salary.standardOvertimePay > 0 && (
                                        <tr><td style={tdS}>時間外手当({Math.round((Master.OVERTIME_RATE - 1) * 100)}%割増)</td><td style={rtdS}>¥{salary.standardOvertimePay.toLocaleString()}</td></tr>
                                    )}
                                    {salary.highOvertimePay > 0 && (
                                        <tr><td style={tdS}>時間外手当({Math.round((Master.OVERTIME_PREMIUM_RATE - 1) * 100)}%割増)</td><td style={rtdS}>¥{salary.highOvertimePay.toLocaleString()}</td></tr>
                                    )}

                                    <tr><td style={tdS}>深夜手当</td><td style={rtdS}>¥{salary.nightPay.toLocaleString()}</td></tr>
                                    <tr><td style={tdS}>通勤手当</td><td style={rtdS}>¥{salary.commutePay.toLocaleString()}</td></tr>
                                    <tr><td style={tdS}>{extras.allowanceName || "任意手当"}</td><td style={rtdS}>¥{salary.allowanceAmount.toLocaleString()}</td></tr>
                                    
                                    {customEarningItems.map((item, i) => (
                                        <tr key={i}><td style={tdS}>{item.name}</td><td style={rtdS}>¥{item.amount.toLocaleString()}</td></tr>
                                    ))}

                                    {padRows(earningItemsCount, targetRows)}
                                    <tr style={totalRowS}><td style={tdS}>支給合計</td><td style={rtdS}>¥{salary.totalEarnings.toLocaleString()}</td></tr>
                                </tbody>
                            </table>
                        </div>

                        {/* 控除項目 */}
                        <div style={{ flex: 1 }}>
                            <table style={tableS}>
                                <thead><tr style={theadS}><th colSpan={2} style={thS}>控除項目</th></tr></thead>
                                <tbody>
                                <tr><td style={tdS}>健康保険料</td><td style={rtdS}>¥{salary.healthInsurance.toLocaleString()}</td></tr>
                                <tr><td style={tdS}>介護保険料</td><td style={rtdS}>¥{salary.nursingInsurance.toLocaleString()}</td></tr>
                                <tr><td style={tdS}>厚生年金保険料</td><td style={rtdS}>¥{salary.welfarePension.toLocaleString()}</td></tr>
                                <tr><td style={tdS}>雇用保険料</td><td style={rtdS}>¥{salary.empInsurance.toLocaleString()}</td></tr>
                                <tr><td style={tdS}>所得税</td><td style={rtdS}>¥{salary.incomeTax.toLocaleString()}</td></tr>
                                <tr><td style={tdS}>住民税</td><td style={rtdS}>¥{salary.residentTax.toLocaleString()}</td></tr>
                                {customDeductionItems.map((item, i) => (
                                    <tr key={i}><td style={tdS}>{item.name}</td><td style={rtdS}>¥{item.amount.toLocaleString()}</td></tr>
                                ))}
                                {padRows(deductionItemsCount, targetRows)}
                                <tr style={totalRowS}><td style={tdS}>控除合計</td><td style={rtdS}>¥{salary.totalDeductions.toLocaleString()}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style={{ marginTop: 24, textAlign: "right" }}>
                        <div style={{ display: "inline-block", border: "2px solid #000", padding: "12px 28px" }}>
                            <span>差引支払額：</span>
                            <span style={{ fontSize: 30, fontWeight: "bold" }}>¥{salary.netPay.toLocaleString()}</span>
                        </div>
                    </div>

                    <div style={{ marginTop: 18, fontSize: 10, color: "#999", borderTop: "1px solid #ddd", paddingTop: 8 }}>
                        ※ 健康保険料は協会けんぽ{extras.prefecture}支部料率（2026年度見込）を適用。
                        厚生年金 18.3%（折半）。雇用保険 0.7%（本人負担分）。
                        所得税は2026年版源泉徴収税額表（甲欄）を適用。住民税は手入力値。
                    </div>
                </div>
            </div>
            <style>{`@media print {.no-print { display: none !important; } #print-area { width: 100% !important; }}`}</style>
        </div>
    );
}

const overlayS:    React.CSSProperties = { position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0,0,0,0.78)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 };
const containerS:  React.CSSProperties = { position: "relative", backgroundColor: "white", padding: 28, borderRadius: 12, width: 940, maxHeight: "95vh", overflowY: "auto", color: "#000" };
const closeBtnS:   React.CSSProperties = { position: "absolute", top: 12, right: 12, width: 32, height: 32, border: "none", borderRadius: "50%", backgroundColor: "#eee", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" };
const panelS:      React.CSSProperties = { marginBottom: 20, padding: 16, backgroundColor: "#f5f7fa", borderRadius: 8, border: "1px solid #e2e8f0" };
const summaryS:    React.CSSProperties = { fontSize: 11, color: "#555", backgroundColor: "#eef2f7", borderRadius: 4, padding: "6px 10px", marginBottom: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 };
const previewBoxS: React.CSSProperties = { backgroundColor: "white", border: "1px solid #e0e0e0", borderRadius: 6, padding: "6px 10px", textAlign: "center" };
const printBtnS:   React.CSSProperties = { width: "100%", padding: 10, cursor: "pointer", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: 6, fontWeight: "bold", fontSize: 14 };
const labelS:      React.CSSProperties = { fontSize: 11, display: "block", marginBottom: 3, color: "#555" };
const inputS:      React.CSSProperties = { width: "100%", padding: "5px 8px", boxSizing: "border-box", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 };
const titleS:      React.CSSProperties = { textAlign: "center", letterSpacing: 12, margin: "0 0 16px 0", fontSize: 20, fontWeight: "bold" };
const tableS:      React.CSSProperties = { width: "100%", borderCollapse: "collapse", border: "1px solid #000", fontSize: 12 };
const theadS:      React.CSSProperties = { backgroundColor: "#f2f2f2" };
const thS:         React.CSSProperties = { border: "1px solid #000", padding: "7px 8px", textAlign: "left" };
const tdS:         React.CSSProperties = { border: "1px solid #000", padding: "6px 8px" };
const tdCtrS:      React.CSSProperties = { ...tdS, textAlign: "center" };
const rtdS:        React.CSSProperties = { ...tdS, textAlign: "right" };
const totalRowS:   React.CSSProperties = { fontWeight: "bold", backgroundColor: "#f9f9f9" };