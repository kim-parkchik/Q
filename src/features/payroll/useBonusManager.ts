import { useState, useEffect, useCallback } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from '../../constants';
import { calcWithholdingTax } from '../../utils/incomeTax';
import { calcPremium } from '../../utils/socialInsurance';

// --- Types ---
interface BonusSetting {
  id: number;
  name: string;
  target_month: number;
  target_year: number;
  payment_date: string;
  is_closed: number;
}

interface BonusItem {
  id: number;
  name: string;
  type: 'earning' | 'deduction';
  is_default_active: number; // 🆕 追加
}

// 所得税計算ロジックは変更なし（そのまま維持）
const calcBonusIncomeTax = (bonusAfterSocial: number, prevMonthTaxBase: number, dependents: number, payYear: number): number => {
  if (prevMonthTaxBase > 0) {
    const depIndex = Math.min(dependents, 3) + 2;
    let rate = 0;
    for (const row of Master.TAX_2026.BONUS_TAX_RATE_TABLE) {
      if (prevMonthTaxBase >= row[0] && prevMonthTaxBase < row[1]) {
        rate = row[depIndex];
        break;
      }
    }
    return Math.floor(bonusAfterSocial * rate);
  }
  // 前月の給与がない場合：賞与の6分の1を月額とみなして月額の税額を求め、その6倍にする
  const monthlyAmount = Math.floor(bonusAfterSocial / 6);
  const monthlyTax = calcWithholdingTax(monthlyAmount, dependents, payYear, "table");
  return Math.floor(monthlyTax * 6);
};

export const useBonusManager = (db: Database | null, _staffList: any[]) => { // 🆕 nullを許容
  const [activeTab, setActiveTab] = useState<'list' | 'items' | 'calc'>('list');
  const [settings, setSettings] = useState<BonusSetting[]>([]);
  const [selectedSettingId, setSelectedSettingId] = useState<number | null>(null);
  const [items, setItems] = useState<BonusItem[]>([]);
  const [activeItemIds, setActiveItemIds] = useState<number[]>([]); // 🆕 選択中の賞与で有効な項目のID
  // const [activeItemIdsMap, setActiveItemIdsMap] = useState<Record<number, number[]>>({});
  const [staffValues, setStaffValues] = useState<Record<string, Record<number, number>>>({});
  const [annualBonusTotals, setAnnualBonusTotals] = useState<Record<string, number>>({});
  const [prevMonthTaxBases, setPrevMonthTaxBases] = useState<Record<string, number>>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [companySettings, setCompanySettings] = useState<any>({});

  const [settingName, setSettingName] = useState('夏季賞与');
  const [newPaymentDate, setNewPaymentDate] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-10`);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'earning' | 'deduction'>('earning');
  const [newItemIsDefault, setNewItemIsDefault] = useState(true);
  const [editingSettingId, setEditingSettingId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);

  const selectedSetting = settings.find(s => s.id === selectedSettingId) ?? null;

  // --- Data Fetching ---
  const loadSettings = useCallback(async () => {
    if (!db) return;
    const res = await db.select<BonusSetting[]>("SELECT * FROM bonus_settings ORDER BY target_year DESC, target_month DESC");
    setSettings(res);
  }, [db]);

  const loadItems = useCallback(async () => {
    if (!db) return;
    const res = await db.select<BonusItem[]>("SELECT * FROM bonus_item_master ORDER BY type DESC, id ASC");
    setItems(res);
  }, [db]);

  // 🆕 選択中の賞与設定に紐付く項目IDをロード
  const loadActiveItemIds = useCallback(async (settingId: number) => {
    if (!db) return;
    const res = await db.select<{item_id: number}[]>(
      "SELECT item_id FROM bonus_setting_items WHERE bonus_setting_id = ?",
      [settingId]
    );
    setActiveItemIds(res.map(r => r.item_id));
  }, [db]);

  const loadStaffValues = useCallback(async (settingId: number) => {
    if (!db) return;
    const res = await db.select<any[]>("SELECT staff_id, item_id, amount FROM bonus_staff_values WHERE bonus_setting_id = ?", [settingId]);
    const map: Record<string, Record<number, number>> = {};
    res.forEach(r => {
      if (!map[r.staff_id]) map[r.staff_id] = {};
      map[r.staff_id][r.item_id] = r.amount;
    });
    setStaffValues(map);
  }, [db]);

  // --- 年度累計・前月給与ロード (既存ママ) ---
  const loadAnnualBonusTotals = useCallback(async (year: number, currentSettingId: number) => {
    if (!db) return;
    const fiscalYearStart = `${year}-04-01`;
    const fiscalYearEnd = `${year + 1}-03-31`;
    const res = await db.select<any[]>(
      `SELECT staff_id, SUM(amount) as raw_total FROM bonus_staff_values 
        JOIN bonus_item_master ON bonus_staff_values.item_id = bonus_item_master.id
        JOIN bonus_settings ON bonus_staff_values.bonus_setting_id = bonus_settings.id
        WHERE bonus_settings.payment_date BETWEEN ? AND ? AND bonus_item_master.type = 'earning' AND bonus_settings.id != ?
        GROUP BY staff_id`, [fiscalYearStart, fiscalYearEnd, currentSettingId]
    );
    const map: Record<string, number> = {};
    res.forEach(r => { map[r.staff_id] = Math.floor((r.raw_total || 0) / 1000) * 1000; });
    setAnnualBonusTotals(map);
  }, [db]);

  const loadPrevMonthSalary = useCallback(async (year: number, month: number) => {
    if (!db) return;
    let prevY = year; let prevM = month - 1;
    if (prevM === 0) { prevY--; prevM = 12; }
    const res = await db.select<any[]>(
      `SELECT staff_id, (taxable_amount - social_ins_total) as tax_base FROM salary_results 
        WHERE CAST(target_year AS INTEGER) = ? AND CAST(target_month AS INTEGER) = ?`, [prevY, prevM]
    );
    const map: Record<string, number> = {};
    res.forEach(r => { map[r.staff_id] = r.tax_base || 0; });
    setPrevMonthTaxBases(map);
  }, [db]);

  // --- Effects ---
  useEffect(() => {
    if (!db) return;
    loadSettings();
    loadItems();
    db.select<any[]>("SELECT * FROM branches ORDER BY id ASC").then(setBranches);
    db.select<any[]>("SELECT * FROM company WHERE id = 1").then(res => { if (res?.[0]) setCompanySettings(res[0]); });
  }, [db, loadSettings, loadItems]);

  useEffect(() => {
    if (selectedSettingId && selectedSetting) {
      loadActiveItemIds(selectedSettingId); 
      loadStaffValues(selectedSettingId);
      const fiscalYear = selectedSetting.target_month >= 4 ? selectedSetting.target_year : selectedSetting.target_year - 1;
      loadAnnualBonusTotals(fiscalYear, selectedSettingId);
      loadPrevMonthSalary(selectedSetting.target_year, selectedSetting.target_month);
    }else {
      // 何も選択されていないときは空にする
      setActiveItemIds([]);
    }
  }, [selectedSettingId, selectedSetting, loadActiveItemIds, loadStaffValues, loadAnnualBonusTotals, loadPrevMonthSalary]);

  // --- Actions ---
  // 🆕 賞与設定の編集を開始する
  const startSettingEdit = (setting: BonusSetting) => {
    setEditingSettingId(setting.id);
    setSettingName(setting.name);
    // payment_date を input[type="date"] に合う形式に調整
    setNewPaymentDate(setting.payment_date);
  };

  // 🆕 賞与設定の編集をキャンセルする
  const cancelSettingEdit = () => {
    setEditingSettingId(null);
    setSettingName('夏季賞与');
    // 今日、または元のデフォルト日付に戻す
    setNewPaymentDate(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-10`);
  };

  // 🆕 賞与設定の編集を保存する
  const saveSettingEdit = async () => {
    if (!db || !editingSettingId) return;
    if (!settingName.trim() || !newPaymentDate) return;

    const dateObj = new Date(newPaymentDate);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;

    await db.execute(
      "UPDATE bonus_settings SET name = ?, target_year = ?, target_month = ?, payment_date = ? WHERE id = ?",
      [settingName, year, month, newPaymentDate, editingSettingId]
    );

    setEditingSettingId(null);
    setSettingName('夏季賞与'); // 初期値に戻す
    await loadSettings();
  };

  // 🆕 項目の有効/無効を切り替える（選択中の賞与に対してのみ）
  const toggleItemActive = async (itemId: number) => {
    if (!db || !selectedSettingId) return;

    // すでに有効なら削除、なければ追加
    if (activeItemIds.includes(itemId)) {
      await db.execute(
        "DELETE FROM bonus_setting_items WHERE bonus_setting_id = ? AND item_id = ?", 
        [selectedSettingId, itemId]
      );
    } else {
      await db.execute(
        "INSERT INTO bonus_setting_items (bonus_setting_id, item_id) VALUES (?, ?)", 
        [selectedSettingId, itemId]
      );
    }

    // ⚠️ 修正ポイント: DB更新後、この賞与の有効項目リストだけを再ロードする
    await loadActiveItemIds(selectedSettingId);
  };

  const addItem = async () => {
    if (!db) return;
    if (!newItemName.trim()) return;

    // 🆕 newItemIsDefault を使って保存
    await db.execute(
      "INSERT INTO bonus_item_master (name, type, is_default_active) VALUES (?, ?, ?)", 
      [newItemName, newItemType, newItemIsDefault ? 1 : 0]
    );

    setNewItemName('');
    setNewItemIsDefault(true); // 追加後にデフォルトをONに戻しておく（お好みで）
    await loadItems();
  };

  const deleteItem = async (id: number) => {
    if (!db) return;
    const ok = await ask("項目を削除しますか？", { title: '警告', kind: 'warning' });
    if (ok) {
      await db.execute("DELETE FROM bonus_item_master WHERE id = ?", [id]);
      await loadItems();
    }
  };

  // 🆕 項目名をデータベースで更新する
  const updateItemName = async (id: number, updatedName: string) => {
    if (!db) return;
    
    // DBを更新
    await db.execute("UPDATE bonus_item_master SET name = ? WHERE id = ?", [updatedName, id]);
    
    // 画面上のState（items）も即座に更新して、再ロードなしで反映させる
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, name: updatedName } : item
    ));
  };

  const addSetting = async () => {
    if (!db) return;
    if (!settingName.trim() || !newPaymentDate) return;

    try {
      // 0. トランザクション開始
      await db.execute("BEGIN");

      const dateObj = new Date(newPaymentDate);
      
      // 1. 賞与設定を保存
      const res = await db.execute(
        "INSERT INTO bonus_settings (name, target_year, target_month, payment_date) VALUES (?, ?, ?, ?)", 
        [settingName, dateObj.getFullYear(), dateObj.getMonth() + 1, newPaymentDate]
      );

      // 2. 新しく作った賞与のIDを取得
      const newId = Number(res.lastInsertId);

      // 3. デフォルト有効な項目を取得
      const defaultItems = await db.select<{id: number}[]>(
        "SELECT id FROM bonus_item_master WHERE is_default_active = 1"
      );

      // 4. ループで紐付けデータを挿入
      for (const item of defaultItems) {
        await db.execute(
          "INSERT INTO bonus_setting_items (bonus_setting_id, item_id) VALUES (?, ?)",
          [newId, item.id]
        );
      }

      // 5. すべて成功したら確定
      await db.execute("COMMIT");

      // --- 成功後のUI処理 ---
      await loadSettings();
      setSelectedSettingId(newId);
      setActiveTab('calc');
      // フォームをリセット（お好みで）
      setSettingName('夏季賞与'); 

    } catch (e) {
      // 6. どこかでエラーが起きたら、今回の全処理（設定保存含む）を取り消す
      await db.execute("ROLLBACK");
      console.error("賞与設定の追加に失敗しました:", e);
      // ユーザーに通知（askなどを流用しても良いでしょう）
      alert("エラーが発生したため、保存を中断しました。");
    }
  };

  const deleteSetting = async (id: number) => {
    if (!db) return;
    const ok = await ask("賞与設定を削除しますか？", { title: '削除確認', kind: 'warning' });
    if (ok) {
      await db.execute("DELETE FROM bonus_settings WHERE id = ?", [id]);
      if (selectedSettingId === id) setSelectedSettingId(null);
      await loadSettings();
    }
  };

  const saveStaffValue = async (staffId: string, itemId: number, amount: number) => {
    if (!db) return;
    if (!selectedSettingId) return;
    await db.execute(`INSERT OR REPLACE INTO bonus_staff_values (bonus_setting_id, staff_id, item_id, amount) VALUES (?, ?, ?, ?)`, 
      [selectedSettingId, staffId, itemId, amount]);
    setStaffValues(prev => ({ ...prev, [staffId]: { ...(prev[staffId] ?? {}), [itemId]: amount } }));
  };

  // --- Calculation Logic (🆕 有効な項目のみで計算するように修正) ---
  const calcBonusForStaff = (staff: any) => {
    if (!selectedSetting) return null;
    
    const vals = staffValues[staff.id] ?? {};

    // 🆕 全アイテムではなく、activeItemIdsに含まれるものだけを対象にする
    const currentActiveItems = items.filter(i => activeItemIds.includes(i.id));
    const earningItems = currentActiveItems.filter(i => i.type === 'earning');
    const deductionItems = currentActiveItems.filter(i => i.type === 'deduction');

    const totalEarnings = earningItems.reduce((s, item) => s + (vals[item.id] ?? 0), 0);
    const hyojunBonus = Math.floor(totalEarnings / 1000) * 1000;

    const branch = branches.find(b => b.id === staff.branch_id);
    const pref = Master.toKenpoPrefName(branch?.prefecture) ?? "京都";
    if (!Master.toKenpoPrefName(branch?.prefecture)) {
      console.warn(`拠点の都道府県が未設定または不明です（${branch?.prefecture}）。京都の料率で仮計算します。`);
    }
    // 賞与を支給する月の料率を使う（健康保険は3月分から、雇用保険は4月から新年度）
    const payYear = selectedSetting.target_year;
    const payMonth = selectedSetting.target_month;
    const ins = Master.getInsuranceMaster(payYear, payMonth);
    const healthRate = (ins.KENPO_RATES[pref] ?? ins.KENPO_RATES["京都"])[1]; // 合計の料率(%)

    const isNursing = (() => {
      if (!staff.birthday || !selectedSetting.payment_date) return false;
      const b = new Date(staff.birthday);
      const base = new Date(selectedSetting.payment_date);
      let age = base.getFullYear() - b.getFullYear();
      if (base.getMonth() < b.getMonth() || (base.getMonth() === b.getMonth() && base.getDate() < b.getDate())) age--;
      return age >= 40 && age < 65;
    })();

    const sInsType = companySettings.round_social_ins || 'floor';
    const currentYearTotal = annualBonusTotals[staff.id] ?? 0;
    // 健康保険・介護保険・子ども・子育て支援金の標準賞与額は、年度（4月〜翌3月）の累計で573万円まで
    const healthHyojun = Math.min(hyojunBonus, Math.max(0, ins.HEALTH_INS_ANNUAL_LIMIT - currentYearTotal));

    // 本人負担分 = 標準賞与額 × 料率 ÷ 2（介護保険は「健康保険＋介護保険」でまとめて計算し、健康保険料を引く）
    const healthInsurance = calcPremium(healthHyojun, healthRate, sInsType);
    const nursingInsurance = isNursing
      ? calcPremium(healthHyojun, healthRate + ins.KENPO_CARE_RATE[1], sInsType) - healthInsurance
      : 0;
    const childSupport = Master.isChildSupportMonth(ins, payYear, payMonth) && ins.CHILD_SUPPORT_RATE
      ? calcPremium(healthHyojun, ins.CHILD_SUPPORT_RATE[1], sInsType)
      : 0;

    // 厚生年金の標準賞与額は1回150万円まで
    const pensionHyojun = Math.min(hyojunBonus, ins.PENSION_INS_SINGLE_LIMIT);
    const welfarePension = calcPremium(pensionHyojun, ins.PENSION_RATE[1], sInsType);

    const empInsType = staff.employment_insurance_type || companySettings.default_emp_ins_type || 'general';
    const empRate = ins.LABOR_INSURANCE_RATES[empInsType as Master.EmpInsType] || ins.LABOR_INSURANCE_RATES.general;
    const empInsurance = calcPremium(totalEarnings, empRate[0] * 100, companySettings.round_emp_ins || 'round', 1);

    const socialTotal = healthInsurance + nursingInsurance + childSupport + welfarePension + empInsurance;
    const incomeTax = calcBonusIncomeTax(Math.max(0, totalEarnings - socialTotal), prevMonthTaxBases[staff.id] || 0, Number(staff.dependents) || 0, selectedSetting?.target_year ?? new Date().getFullYear());
      
    // 🆕 カスタム控除も有効なものだけ合計
    const customDeductions = deductionItems.reduce((s, item) => s + (vals[item.id] ?? 0), 0);
    const totalDeductions = socialTotal + incomeTax + customDeductions;

    return {
      totalEarnings, hyojunBonus, healthInsurance, nursingInsurance, childSupport, welfarePension, 
      empInsurance, incomeTax, customDeductions, totalDeductions,
      netPay: totalEarnings - totalDeductions, isNursing
    };
  };

  // 編集ボタンを押した時
  const startEdit = (item: any) => {
    setEditingItemId(item.id);
    setNewItemName(item.name);
    setNewItemType(item.type);
    setNewItemIsDefault(item.is_default_active === 1);
  };

  // キャンセル時
  const cancelEdit = () => {
    setEditingItemId(null);
    setNewItemName("");
    setNewItemType("earning");
    setNewItemIsDefault(true);
  };

  // 編集内容を保存（名前・種別・標準フラグを全て更新）
  const saveEdit = async () => {
    if (!db || !editingItemId) return;
    if (!newItemName.trim()) return;

    await db.execute(
      "UPDATE bonus_item_master SET name = ?, type = ?, is_default_active = ? WHERE id = ?",
      [newItemName, newItemType, newItemIsDefault ? 1 : 0, editingItemId]
    );

    // 編集モードをリセット
    setEditingItemId(null);
    setNewItemName("");
    setNewItemType("earning");
    setNewItemIsDefault(true);
    
    // データを再読み込み
    await loadItems();
  };

  return {
    // ── 全体・表示制御 ──
    activeTab, setActiveTab,

    // ── 賞与設定 (Tab 1: list) ──
    settings,
    selectedSettingId, setSelectedSettingId, selectedSetting,
    settingName, setSettingName, 
    newPaymentDate, setNewPaymentDate,
    editingSettingId, startSettingEdit, cancelSettingEdit, saveSettingEdit,
    addSetting, deleteSetting,

    // ── 項目マスター (Tab 2: items) ──
    items,
    newItemName, setNewItemName,
    newItemType, setNewItemType,
    newItemIsDefault, setNewItemIsDefault,
    editingItemId, startEdit, cancelEdit, saveEdit,
    addItem, deleteItem, updateItemName, loadItems,

    // ── 計算・値保持 (Tab 3: calc) ──
    activeItemIds, toggleItemActive,
    staffValues, saveStaffValue, calcBonusForStaff,
  };
};