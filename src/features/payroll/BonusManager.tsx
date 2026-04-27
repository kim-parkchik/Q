/**
 * BonusManager.tsx — 賞与計算・管理
 *
 * 賞与の法的ポイント:
 *  - 標準賞与額 = 賞与支給額（1,000円未満切り捨て）
 *  - 健康保険料 = 標準賞与額 × 料率（年度累計573万円上限）
 *  - 厚生年金保険料 = 標準賞与額 × 料率（1回あたり150万円上限）
 *  - 雇用保険料 = 賞与支給額 × 料率（標準賞与額でなく実額にかける）
 *  - 所得税 = 前月の社会保険料控除後給与 × 係数（賞与用の税率）
 */
import React, { useState, useEffect, useMemo } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from '../../constants/salaryMaster2026';
import { applyRounding } from '../../utils/payrollUtils';

interface Props {
    db: Database;
    staffList: any[];
}

interface BonusSetting {
    id: number;
    name: string;
    target_month: number;
    target_year: number;
    is_closed: number;
}

interface BonusItem {
    id: number;
    name: string;
    type: 'earning' | 'deduction';
}

/**
 * 賞与所得税の計算（前月給与0円ケース対応版）
 * @param bonusAfterSocial 社会保険料控除後の賞与額
 * @param prevMonthTaxBase 前月の社保控除後給与（ない場合は0）
 * @param dependents 扶養人数
 */
const calcBonusIncomeTax = (bonusAfterSocial: number, prevMonthTaxBase: number, dependents: number): number => {
    // --- パターンA: 前月の給与がある場合（通常の計算） ---
    if (prevMonthTaxBase > 0) {
        const depIndex = Math.min(dependents, 3) + 2;
        let rate = 0;
        for (const row of Master.BONUS_TAX_RATE_TABLE) {
            if (prevMonthTaxBase >= row[0] && prevMonthTaxBase < row[1]) {
                rate = row[depIndex];
                break;
            }
        }
        return Math.floor(bonusAfterSocial * rate);
    }

    // --- パターンB: 前月の給与がない場合（例外的な計算） ---
    // 6ヶ月分として按分して月額表(甲欄)を適用する簡便法
    const monthlyAmount = Math.floor(bonusAfterSocial / 6);
    
    // 月額表（GENSEN_TAX_TABLE）から税額を探す
    let monthlyTax = 0;
    const depIndex = Math.min(dependents, 3) + 2; // 扶養人数に応じた列
    
    for (const row of Master.GENSEN_TAX_TABLE) {
        if (monthlyAmount >= row[0] && monthlyAmount < row[1]) {
            monthlyTax = row[depIndex];
            break;
        }
    }

    // 6倍して賞与の税額とする
    return Math.floor(monthlyTax * 6);
};

export default function BonusManager({ db, staffList }: Props) {
    // ── State ─────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<'list' | 'items' | 'calc'>('list');

    // 賞与設定一覧
    const [settings, setSettings] = useState<BonusSetting[]>([]);
    const [selectedSettingId, setSelectedSettingId] = useState<number | null>(null);

    // 新規賞与設定フォーム
    const [newName, setNewName] = useState('夏季賞与');
    const [newYear, setNewYear] = useState(new Date().getFullYear());
    const [newMonth, setNewMonth] = useState(6);
    const [newPaymentDate, setNewPaymentDate] = useState(
        `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-10`
    );

    // 賞与項目マスター
    const [items, setItems] = useState<BonusItem[]>([]);
    const [newItemName, setNewItemName] = useState('');
    const [newItemType, setNewItemType] = useState<'earning' | 'deduction'>('earning');

    // 社員別金額
    const [staffValues, setStaffValues] = useState<Record<string, Record<number, number>>>({});
    const [annualBonusTotals, setAnnualBonusTotals] = useState<Record<string, number>>({});

    // 計算結果プレビュー
    const [branches, setBranches] = useState<any[]>([]);
    const [companySettings, setCompanySettings] = useState<any>({});

    const selectedSetting = settings.find(s => s.id === selectedSettingId) ?? null;

    const [prevMonthTaxBases, setPrevMonthTaxBases] = useState<Record<string, number>>({});
    

    // ── 初期ロード・データ取得 ─────────────────────────────────────
    
    // ① 画面を開いた時だけ実行（マスター情報の取得）
    useEffect(() => {
        loadSettings();
        loadItems();
        db.select<any[]>("SELECT * FROM branches ORDER BY id ASC").then(setBranches);
        db.select<any[]>("SELECT * FROM company WHERE id = 1").then(res => {
            if (res?.[0]) setCompanySettings(res[0]);
        });
    }, [db]);

    // ② 賞与の選択（selectedSettingId）が切り替わった時に実行
    useEffect(() => {
        if (selectedSettingId && selectedSetting) {
            loadStaffValues(selectedSettingId);

            const fiscalYear = selectedSetting.target_month >= 4 
                ? selectedSetting.target_year 
                : selectedSetting.target_year - 1;

            // ★第2引数に現在のIDを渡す
            loadAnnualBonusTotals(fiscalYear, selectedSettingId);

            loadPrevMonthSalary(selectedSetting.target_year, selectedSetting.target_month);
        }
    }, [selectedSettingId, items, selectedSetting]);

    // ── データ読み込み関数群 ──────────────────────────────────────

    const loadSettings = async () => {
        const res = await db.select<BonusSetting[]>(
            "SELECT * FROM bonus_settings ORDER BY target_year DESC, target_month DESC"
        );
        setSettings(res);
    };

    const loadItems = async () => {
        const res = await db.select<BonusItem[]>(
            "SELECT * FROM bonus_item_master ORDER BY type DESC, id ASC"
        );
        setItems(res);
    };

    // 【修正】第2引数 currentSettingId を追加して、自分自身を累計から除外できるようにする
    const loadAnnualBonusTotals = async (year: number, currentSettingId: number) => {
        const fiscalYearStart = `${year}-04-01`;
        const fiscalYearEnd = `${year + 1}-03-31`;

        const res = await db.select<any[]>(
            `SELECT staff_id, SUM(amount) as raw_total 
            FROM bonus_staff_values 
            JOIN bonus_item_master ON bonus_staff_values.item_id = bonus_item_master.id
            JOIN bonus_settings ON bonus_staff_values.bonus_setting_id = bonus_settings.id
            WHERE bonus_settings.payment_date BETWEEN ? AND ?
            AND bonus_item_master.type = 'earning'
            AND bonus_settings.id != ? -- 自分自身の額は「これまでの累計」に含めない
            GROUP BY staff_id`,
            [fiscalYearStart, fiscalYearEnd, currentSettingId]
        );

        const map: Record<string, number> = {};
        res.forEach(r => {
            // 健康保険の上限判定に使うため、1,000円未満切り捨てで保持
            map[r.staff_id] = Math.floor((r.raw_total || 0) / 1000) * 1000;
        });
        setAnnualBonusTotals(map);
    };

    const loadStaffValues = async (settingId: number) => {
        const res = await db.select<any[]>(
            "SELECT staff_id, item_id, amount FROM bonus_staff_values WHERE bonus_setting_id = ?",
            [settingId]
        );
        const map: Record<string, Record<number, number>> = {};
        res.forEach(r => {
            if (!map[r.staff_id]) map[r.staff_id] = {};
            map[r.staff_id][r.item_id] = r.amount;
        });
        setStaffValues(map);
    };

    // 前月の給与実績（社保控除後の課税対象額）を取得する
    const loadPrevMonthSalary = async (year: number, month: number) => {
        // 指摘の通り、ここでの year/month は bonus_settings に保存されたもの
        let prevY = year;
        let prevM = month - 1;
        if (prevM === 0) { prevY--; prevM = 12; }

        console.log(`Searching for salary record: ${prevY}年${prevM}月`); // デバッグ用

        const res = await db.select<any[]>(
            `SELECT staff_id, (taxable_amount - social_ins_total) as tax_base 
            FROM salary_results 
            WHERE CAST(target_year AS INTEGER) = ? AND CAST(target_month AS INTEGER) = ?`,
            [prevY, prevM]
        );

        const map: Record<string, number> = {};
        res.forEach(r => {
            map[r.staff_id] = r.tax_base || 0;
        });
        setPrevMonthTaxBases(map);
    };

    // ── CRUD ──────────────────────────────────────────────────
    const addSetting = async () => {
        if (!newName.trim() || !newPaymentDate) return;

        // 支給日から年と月を抽出
        const dateObj = new Date(newPaymentDate);
        const targetYear = dateObj.getFullYear();
        const targetMonth = dateObj.getMonth() + 1;

        await db.execute(
            "INSERT INTO bonus_settings (name, target_year, target_month, payment_date) VALUES (?, ?, ?, ?)",
            [newName, targetYear, targetMonth, newPaymentDate]
        );
        await loadSettings();
    };

    const deleteSetting = async (id: number) => {
        // ✨ window.confirm を ask に置き換え
        const ok = await ask(
            "この賞与設定と関連データをすべて削除しますか？\n（入力済みの社員別金額もすべて削除されます）",
            { title: '賞与設定の削除', kind: 'warning', okLabel: '削除', cancelLabel: 'キャンセル' }
        );
        if (!ok) return;

        await db.execute("DELETE FROM bonus_settings WHERE id = ?", [id]);
        if (selectedSettingId === id) setSelectedSettingId(null);
        await loadSettings();
    };

    const addItem = async () => {
        if (!newItemName.trim()) return;
        await db.execute(
            "INSERT INTO bonus_item_master (name, type) VALUES (?, ?)",
            [newItemName, newItemType]
        );
        setNewItemName('');
        await loadItems();
    };

    const deleteItem = async (id: number) => {
        // ✨ window.confirm を ask に置き換え
        const ok = await ask(
            "この賞与項目を削除しますか？",
            { title: '項目の削除', kind: 'warning', okLabel: '削除', cancelLabel: 'キャンセル' }
        );
        if (!ok) return;
        
        await db.execute("DELETE FROM bonus_item_master WHERE id = ?", [id]);
        await loadItems();
    };

    const saveStaffValue = async (staffId: string, itemId: number, amount: number) => {
        if (!selectedSettingId) return;
        await db.execute(
            `INSERT OR REPLACE INTO bonus_staff_values 
             (bonus_setting_id, staff_id, item_id, amount) VALUES (?, ?, ?, ?)`,
            [selectedSettingId, staffId, itemId, amount]
        );
        setStaffValues(prev => ({
            ...prev,
            [staffId]: { ...(prev[staffId] ?? {}), [itemId]: amount }
        }));
    };

    // ── 賞与計算 ──────────────────────────────────────────────
    const getPrefecture = (branchId: number): string => {
        const b = branches.find(b => b.id === branchId);
        return (b?.prefecture ?? "東京都").replace(/[都道府県]$/, "");
    };

    const calcBonusForStaff = (staff: any, settingId: number) => {
        const vals = staffValues[staff.id] ?? {};
        const earningItems = items.filter(i => i.type === 'earning');
        const deductionItems = items.filter(i => i.type === 'deduction');

        // 支給合計
        const totalEarnings = earningItems.reduce((s, item) => s + (vals[item.id] ?? 0), 0);

        // 社会保険料計算（標準賞与額 = 1,000円未満切り捨て）
        const hyojunBonus = Math.floor(totalEarnings / 1000) * 1000;

        // 健康保険・介護保険（上限573万円チェックは別途必要）
        const pref = getPrefecture(staff.branch_id || 1);
        const rates = Master.KENPO_RATES[pref] ?? Master.KENPO_RATES["東京"];
        const isNursing = staff.birthday ? (() => {
            const b = new Date(staff.birthday);
            const now = new Date();
            const age = now.getFullYear() - b.getFullYear() -
                ((now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) ? 1 : 0);
            return age >= 40 && age < 65;
        })() : false;

        const healthRate   = isNursing ? rates[1] : rates[0];
        const nursingRate  = isNursing ? (rates[1] - rates[0]) : 0;
        const sInsType     = companySettings.round_social_ins || 'floor';

        // 健康保険・介護保険（年度累計上限チェック）
        // TODO: 本来はDBから current_year_total（4月〜現在までの累計）を取得
        const currentYearTotal = annualBonusTotals[staff.id] ?? 0;
        const remainingLimit = Math.max(0, Master.HEALTH_INS_ANNUAL_LIMIT - currentYearTotal);

        // 今回の標準賞与額のうち、保険料対象となる額
        const healthHyojun = Math.min(hyojunBonus, remainingLimit);

        const healthTotal = applyRounding(healthHyojun * healthRate / 100, sInsType);
        const nursingInsurance = applyRounding(healthHyojun * nursingRate / 100, sInsType);
        const healthInsurance = healthTotal - nursingInsurance;

        // 厚生年金（1回あたり上限）
        const pensionHyojun = Math.min(hyojunBonus, Master.PENSION_INS_SINGLE_LIMIT);
        const welfarePension = applyRounding(pensionHyojun * Master.PENSION_RATE / 100, sInsType);

        // 雇用保険（実際の支給額にかける）
        const empInsurance    = applyRounding(totalEarnings * Master.EMP_INS_RATE,
                                    companySettings.round_emp_ins || 'round');

        const socialTotal     = healthInsurance + nursingInsurance + welfarePension + empInsurance;

        // TODO: 本来はここで前月の確定給与データをDBから取得する
        // 現状は staff オブジェクトに prev_month_base があれば使い、なければ 0 とする
        const prevMonthTaxBase = prevMonthTaxBases[staff.id] || 0; 

        const incomeTax = calcBonusIncomeTax(
            Math.max(0, totalEarnings - socialTotal),
            prevMonthTaxBase, 
            Number(staff.dependents) || 0
        );

        // カスタム控除
        const customDeductions = deductionItems.reduce((s, item) => s + (vals[item.id] ?? 0), 0);

        const totalDeductions = healthInsurance + nursingInsurance + welfarePension +
                                empInsurance + incomeTax + customDeductions;

        return {
            totalEarnings, hyojunBonus,
            healthInsurance, nursingInsurance, welfarePension, empInsurance, incomeTax,
            customDeductions, totalDeductions,
            netPay: totalEarnings - totalDeductions,
            isNursing
        };
    };

    const earningItems   = items.filter(i => i.type === 'earning');
    const deductionItems = items.filter(i => i.type === 'deduction');

    // ── レンダリング ────────────────────────────────────────────
    return (
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

            {/* ── タブナビゲーション ── */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #eee" }}>
                {([['list', '① 賞与設定'], ['items', '② 支給・控除項目'], ['calc', '③ 社員別金額・計算']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setActiveTab(key)}
                        style={{ padding: "10px 20px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: 13,
                            borderBottom: activeTab === key ? "3px solid #3498db" : "3px solid transparent",
                            color: activeTab === key ? "#3498db" : "#7f8c8d",
                            backgroundColor: "transparent" }}>
                        {label}
                    </button>
                ))}
            </div>

            {/* ══════════════════════════════════════════════════════
                タブ①: 賞与設定一覧
            ══════════════════════════════════════════════════════ */}
            {activeTab === 'list' && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 20 }}>
                    {/* 新規作成フォーム */}
                    <div style={cardS}>
                        <h3 style={sectionTitleS}>➕ 新しい賞与を追加</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div>
                                <label style={labelS}>賞与名称</label>
                                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                                    placeholder="夏季賞与・冬季賞与 など" style={inputS} />
                            </div>
                            <div>
                                <label style={labelS}>支給日</label>
                                <input type="date" value={newPaymentDate} onChange={e => setNewPaymentDate(e.target.value)} style={inputS} />
                            </div>
                            <button onClick={addSetting} style={btnS}>追加</button>
                        </div>
                    </div>

                    {/* 賞与設定一覧 */}
                    <div style={cardS}>
                        <h3 style={sectionTitleS}>📋 賞与設定一覧</h3>
                        {settings.length === 0 ? (
                            <p style={{ color: "#bdc3c7", textAlign: "center" }}>まだ賞与設定がありません</p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {settings.map(s => (
                                    <div key={s.id} onClick={() => { setSelectedSettingId(s.id); setActiveTab('calc'); }}
                                        style={{ ...itemRowS, cursor: "pointer",
                                            borderLeft: `4px solid ${s.is_closed ? "#bdc3c7" : "#f39c12"}`,
                                            backgroundColor: selectedSettingId === s.id ? "#fef9eb" : "white" }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: "bold" }}>{s.name}</div>
                                            <div style={{ fontSize: 11, color: "#999" }}>{s.target_year}年{s.target_month}月支給</div>
                                        </div>
                                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10,
                                            backgroundColor: s.is_closed ? "#f0f0f0" : "#fef3cd",
                                            color: s.is_closed ? "#999" : "#e67e22" }}>
                                            {s.is_closed ? "確定済" : "計算中"}
                                        </span>
                                        <button onClick={e => { e.stopPropagation(); deleteSetting(s.id); }} style={delBtnS}>🗑️</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════
                タブ②: 支給・控除項目マスター
            ══════════════════════════════════════════════════════ */}
            {activeTab === 'items' && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 20 }}>
                    {/* 項目追加フォーム */}
                    <div style={cardS}>
                        <h3 style={sectionTitleS}>➕ 項目を追加</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div>
                                <label style={labelS}>項目名</label>
                                <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)}
                                    placeholder="基本賞与・特別手当 など" style={inputS} />
                            </div>
                            <div>
                                <label style={labelS}>種別</label>
                                <select value={newItemType} onChange={e => setNewItemType(e.target.value as any)} style={inputS}>
                                    <option value="earning">支給</option>
                                    <option value="deduction">控除（カスタム）</option>
                                </select>
                            </div>
                            <button onClick={addItem} style={btnS}>追加</button>
                        </div>
                        <div style={{ marginTop: 16, padding: "10px 12px", backgroundColor: "#f8f9fa", borderRadius: 6, fontSize: 11, color: "#7f8c8d", lineHeight: 1.8 }}>
                            <strong>自動計算される控除項目（入力不要）</strong><br />
                            ✓ 健康保険料（協会けんぽ）<br />
                            ✓ 介護保険料（40〜64歳）<br />
                            ✓ 厚生年金保険料<br />
                            ✓ 雇用保険料<br />
                            ✓ 所得税（賞与用税率）
                        </div>
                    </div>

                    {/* 項目一覧 */}
                    <div style={cardS}>
                        <h3 style={sectionTitleS}>📋 登録済み項目</h3>

                        {earningItems.length > 0 && (
                            <>
                                <div style={{ fontSize: 11, fontWeight: "bold", color: "#3498db", marginBottom: 6 }}>【支給項目】</div>
                                {earningItems.map(item => (
                                    <div key={item.id} style={{ ...itemRowS, borderLeft: "4px solid #3498db" }}>
                                        <div style={{ flex: 1, fontWeight: "bold" }}>{item.name}</div>
                                        <button onClick={() => deleteItem(item.id)} style={delBtnS}>🗑️</button>
                                    </div>
                                ))}
                            </>
                        )}

                        {deductionItems.length > 0 && (
                            <>
                                <div style={{ fontSize: 11, fontWeight: "bold", color: "#e74c3c", marginBottom: 6, marginTop: 12 }}>【カスタム控除項目】</div>
                                {deductionItems.map(item => (
                                    <div key={item.id} style={{ ...itemRowS, borderLeft: "4px solid #e74c3c" }}>
                                        <div style={{ flex: 1, fontWeight: "bold" }}>{item.name}</div>
                                        <button onClick={() => deleteItem(item.id)} style={delBtnS}>🗑️</button>
                                    </div>
                                ))}
                            </>
                        )}

                        {items.length === 0 && (
                            <p style={{ color: "#bdc3c7", textAlign: "center" }}>項目がありません</p>
                        )}
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════
                タブ③: 社員別金額入力・計算プレビュー
            ══════════════════════════════════════════════════════ */}
            {activeTab === 'calc' && (
                <>
                    {/* 賞与選択 */}
                    <div style={{ ...cardS, marginBottom: 16 }}>
                        <label style={labelS}>対象の賞与を選択</label>
                        <select value={selectedSettingId ?? ""} onChange={e => setSelectedSettingId(Number(e.target.value))}
                            style={{ ...inputS, maxWidth: 400 }}>
                            <option value="">-- 選択してください --</option>
                            {settings.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name}（{s.target_year}年{s.target_month}月）
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedSettingId && items.length === 0 && (
                        <div style={{ ...cardS, color: "#e67e22", textAlign: "center" }}>
                            ⚠️ 先に「② 支給・控除項目」タブで項目を追加してください
                        </div>
                    )}

                    {selectedSettingId && items.length > 0 && (
                        <div style={{ overflowX: "auto" }}>
                            <table style={tableS}>
                                <thead>
                                    <tr style={theadS}>
                                        <th style={{ ...thS, minWidth: 120 }}>氏名</th>
                                        {/* 支給項目 */}
                                        {earningItems.map(item => (
                                            <th key={item.id} style={{ ...thS, color: "#2980b9", minWidth: 110 }}>{item.name}</th>
                                        ))}
                                        <th style={{ ...thS, backgroundColor: "#ebf5fb", minWidth: 90 }}>支給合計</th>
                                        {/* 自動計算控除 */}
                                        <th style={{ ...thS, color: "#c0392b", minWidth: 90 }}>健保</th>
                                        <th style={{ ...thS, color: "#c0392b", minWidth: 80 }}>介護</th>
                                        <th style={{ ...thS, color: "#c0392b", minWidth: 90 }}>厚生年金</th>
                                        <th style={{ ...thS, color: "#c0392b", minWidth: 80 }}>雇用保険</th>
                                        <th style={{ ...thS, color: "#c0392b", minWidth: 80 }}>所得税</th>
                                        {/* カスタム控除 */}
                                        {deductionItems.map(item => (
                                            <th key={item.id} style={{ ...thS, color: "#c0392b", minWidth: 110 }}>{item.name}</th>
                                        ))}
                                        <th style={{ ...thS, backgroundColor: "#fdf2f8", minWidth: 90 }}>控除合計</th>
                                        <th style={{ ...thS, backgroundColor: "#f0fdf4", minWidth: 100, fontWeight: "bold" }}>差引支給額</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {staffList.filter(s => !s.retirement_date).map(staff => {
                                        const calc = calcBonusForStaff(staff, selectedSettingId!);
                                        const vals = staffValues[staff.id] ?? {};
                                        return (
                                            <tr key={staff.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                                <td style={tdS}>
                                                    <div style={{ fontWeight: "bold", fontSize: 13 }}>{staff.name}</div>
                                                    {staff.furigana && <div style={{ fontSize: 10, color: "#999" }}>{staff.furigana}</div>}
                                                </td>
                                                {/* 支給項目入力欄 */}
                                                {earningItems.map(item => (
                                                    <td key={item.id} style={tdS}>
                                                        <input type="number" min={0}
                                                            value={vals[item.id] ?? ""}
                                                            placeholder="0"
                                                            onChange={e => saveStaffValue(staff.id, item.id, Number(e.target.value))}
                                                            style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, textAlign: "right" }} />
                                                    </td>
                                                ))}
                                                {/* 支給合計 */}
                                                <td style={{ ...tdS, textAlign: "right", fontWeight: "bold", backgroundColor: "#ebf5fb" }}>
                                                    ¥{calc.totalEarnings.toLocaleString()}
                                                </td>
                                                {/* 自動計算控除 */}
                                                <td style={{ ...tdS, textAlign: "right", fontSize: 12, color: "#666" }}>¥{calc.healthInsurance.toLocaleString()}</td>
                                                <td style={{ ...tdS, textAlign: "right", fontSize: 12, color: calc.isNursing ? "#c0392b" : "#bbb" }}>¥{calc.nursingInsurance.toLocaleString()}</td>
                                                <td style={{ ...tdS, textAlign: "right", fontSize: 12, color: "#666" }}>¥{calc.welfarePension.toLocaleString()}</td>
                                                <td style={{ ...tdS, textAlign: "right", fontSize: 12, color: "#666" }}>¥{calc.empInsurance.toLocaleString()}</td>
                                                <td style={{ ...tdS, textAlign: "right", fontSize: 12, color: "#666" }}>¥{calc.incomeTax.toLocaleString()}</td>
                                                {/* カスタム控除入力欄 */}
                                                {deductionItems.map(item => (
                                                    <td key={item.id} style={tdS}>
                                                        <input type="number" min={0}
                                                            value={vals[item.id] ?? ""}
                                                            placeholder="0"
                                                            onChange={e => saveStaffValue(staff.id, item.id, Number(e.target.value))}
                                                            style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, textAlign: "right" }} />
                                                    </td>
                                                ))}
                                                {/* 控除合計 */}
                                                <td style={{ ...tdS, textAlign: "right", fontWeight: "bold", backgroundColor: "#fdf2f8" }}>
                                                    ¥{calc.totalDeductions.toLocaleString()}
                                                </td>
                                                {/* 差引支給額 */}
                                                <td style={{ ...tdS, textAlign: "right", fontWeight: "bold", fontSize: 14,
                                                    backgroundColor: "#f0fdf4", color: calc.netPay > 0 ? "#27ae60" : "#e74c3c" }}>
                                                    ¥{calc.netPay.toLocaleString()}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {selectedSettingId && items.length > 0 && (
                        <div style={{ marginTop: 12, fontSize: 11, color: "#bdc3c7", lineHeight: 1.8 }}>
                            ※ 標準賞与額 = 支給合計の1,000円未満切り捨て。健保上限573万円、厚生年金上限150万円（1回あたり）。
                            所得税は前月課税給与が不明な場合、簡便的に0円ベースで計算（過少になる場合があります）。
                            確定後は「賞与支払届」を年金事務所・健康保険組合に提出してください。
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ── スタイル ─────────────────────────────────────────────────────
const cardS: React.CSSProperties        = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const sectionTitleS: React.CSSProperties = { margin: "0 0 14px 0", fontSize: 14, fontWeight: "bold", color: "#2c3e50", borderBottom: "2px solid #ecf0f1", paddingBottom: 8 };
const itemRowS: React.CSSProperties     = { display: "flex", alignItems: "center", padding: "8px 12px", border: "1px solid #eee", borderRadius: 6, marginBottom: 6, gap: 10 };
const labelS: React.CSSProperties       = { fontSize: 11, display: "block", marginBottom: 4, color: "#7f8c8d" };
const inputS: React.CSSProperties       = { width: "100%", padding: "7px 10px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" };
const btnS: React.CSSProperties         = { padding: "8px 16px", backgroundColor: "#3498db", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold", fontSize: 13 };
const delBtnS: React.CSSProperties      = { background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "0 4px" };
const tableS: React.CSSProperties       = { width: "100%", borderCollapse: "collapse", fontSize: 12, backgroundColor: "white", borderRadius: 10, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" };
const theadS: React.CSSProperties       = { backgroundColor: "#f8f9fa", borderBottom: "2px solid #eee" };
const thS: React.CSSProperties          = { padding: "10px 8px", textAlign: "left", color: "#7f8c8d", fontWeight: 600, whiteSpace: "nowrap" };
const tdS: React.CSSProperties          = { padding: "10px 8px", borderBottom: "1px solid #f5f5f5" };
