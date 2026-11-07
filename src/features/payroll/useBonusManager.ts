import { useState, useEffect, useCallback } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from '../../constants';
import { calcBonusWithholdingTax, toTaxColumn } from '../../utils/incomeTax';
import { staffAsOf } from '../../utils/staffHistory';
import { calcPremium } from '../../utils/socialInsurance';
import { checkEmploymentInsEnrolled, checkInsuredOnBonusDate, checkSocialInsEnrolled, getInsuranceByAge } from '../../utils/calcSalary';
import { checkLeaveExemptBonus, parseLeavePeriods } from '../../utils/leaveExemption';
import { executeBatch } from '../../utils/dbBatch';
import { cappedBonusStandard, earlierBonusTotals, prevSalaryStatusOf, type OtherBonus, type PrevSalaryStatus } from '../../utils/bonusInsurance';
import { getPeriodForPayMonth, type PayrollGroupForPeriod } from '../../utils/payrollPeriod';
import { groupOf } from '../../utils/santei';
import { buildAddBonusSettingStatements, buildFinalizeBonusStatements, buildUnfinalizeBonusStatements } from '../../utils/bonusResults';
import { useMessageDialog } from '../../components/MessageDialog';

/** 前の月（賞与の所得税の「前月の給与」は、賞与を支払う月の前月中に支払った給与） */
const prevMonthOf = (year: number, month: number) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });

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

export const useBonusManager = (db: Database | null, staffList: any[]) => { // 🆕 nullを許容
  const dialog = useMessageDialog();
  const [activeTab, setActiveTab] = useState<'list' | 'items' | 'calc'>('list');
  const [settings, setSettings] = useState<BonusSetting[]>([]);
  const [selectedSettingId, setSelectedSettingId] = useState<number | null>(null);
  const [items, setItems] = useState<BonusItem[]>([]);
  const [activeItemIds, setActiveItemIds] = useState<number[]>([]); // 🆕 選択中の賞与で有効な項目のID
  // const [activeItemIdsMap, setActiveItemIdsMap] = useState<Record<number, number[]>>({});
  const [staffValues, setStaffValues] = useState<Record<string, Record<number, number>>>({});
  /** 同じ年度のほかの賞与（従業員ID → 賞与ごとの標準賞与額） */
  const [otherBonuses, setOtherBonuses] = useState<Record<string, OtherBonus[]>>({});
  /** 前月に支払った給与の、社会保険料等を引いた額（確定した給与がある人だけ。従業員ID → 額） */
  const [prevMonthTaxBases, setPrevMonthTaxBases] = useState<Record<string, number>>({});
  /** 給与規定グループ（前月に支払う給与の計算期間を出すのに使う） */
  const [payrollGroups, setPayrollGroups] = useState<(PayrollGroupForPeriod & { id: number })[]>([]);
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
  // 料率・税額表が登録されていない年月を、近いもので計算しているときの注意
  const rateWarnings = selectedSetting
    ? [
        ...Master.getInsuranceMaster(selectedSetting.target_year, selectedSetting.target_month).WARNINGS,
        ...Master.getTaxMasterWarnings(selectedSetting.target_year),
      ]
    : [];
  // 賞与の一覧に出す人：支給する月より前に退職した人は出さない（その月に退職する人は、月末退職なら保険料がかかるので出す）
  const payMonthStart = selectedSetting
    ? `${selectedSetting.target_year}-${String(selectedSetting.target_month).padStart(2, '0')}-01`
    : '';
  const bonusStaffList = staffList.filter(s => !s.retirement_date || s.retirement_date >= payMonthStart);

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

  // --- 同じ年度のほかの賞与（標準賞与額の上限の累計に使う。utils/bonusInsurance.ts）・前月給与ロード ---
  // 1人ずつ・賞与ごとの標準賞与額（1回ごとに1,000円未満切り捨て）。確定した賞与は確定した額、まだの賞与は、その賞与で有効な支給項目の合計
  // 前に支払ったものだけを累計するかどうかは、計算のとき（calcBonusForStaff）に支給日で決める
  const loadOtherBonuses = useCallback(async (year: number, currentSettingId: number) => {
    if (!db) return;
    const fiscalYearStart = `${year}-04-01`;
    const fiscalYearEnd = `${year + 1}-03-31`;
    const entered = await db.select<{ setting_id: number; payment_date: string; staff_id: string; total: number }[]>(
      `SELECT s.id AS setting_id, s.payment_date, v.staff_id, SUM(v.amount) AS total
         FROM bonus_settings s
         JOIN bonus_staff_values v ON v.bonus_setting_id = s.id
         JOIN bonus_item_master m ON m.id = v.item_id AND m.type = 'earning'
         JOIN bonus_setting_items si ON si.bonus_setting_id = s.id AND si.item_id = v.item_id
        WHERE s.payment_date BETWEEN ? AND ? AND s.id != ?
        GROUP BY s.id, v.staff_id`,
      [fiscalYearStart, fiscalYearEnd, currentSettingId]
    );
    const finalized = await db.select<{ setting_id: number; payment_date: string; staff_id: string; hyojun_bonus: number }[]>(
      `SELECT r.bonus_setting_id AS setting_id, s.payment_date, r.staff_id, r.hyojun_bonus
         FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id
        WHERE s.payment_date BETWEEN ? AND ? AND s.id != ?`,
      [fiscalYearStart, fiscalYearEnd, currentSettingId]
    );
    const byKey = new Map<string, { staffId: string; bonus: OtherBonus }>();
    for (const r of entered) {
      byKey.set(`${r.setting_id}:${r.staff_id}`, {
        staffId: String(r.staff_id),
        bonus: { settingId: Number(r.setting_id), paymentDate: r.payment_date, standard: Math.floor((Number(r.total) || 0) / 1000) * 1000 },
      });
    }
    for (const r of finalized) {
      byKey.set(`${r.setting_id}:${r.staff_id}`, {
        staffId: String(r.staff_id),
        bonus: { settingId: Number(r.setting_id), paymentDate: r.payment_date, standard: Number(r.hyojun_bonus) || 0 },
      });
    }
    const map: Record<string, OtherBonus[]> = {};
    for (const { staffId, bonus } of byKey.values()) (map[staffId] ??= []).push(bonus);
    setOtherBonuses(map);
  }, [db]);

  const loadPrevMonthSalary = useCallback(async (year: number, month: number) => {
    if (!db) return;
    const prev = prevMonthOf(year, month);
    const res = await db.select<any[]>(
      `SELECT staff_id, (taxable_amount - social_ins_total) as tax_base FROM salary_results
        WHERE CAST(target_year AS INTEGER) = ? AND CAST(target_month AS INTEGER) = ?`, [prev.year, prev.month]
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
    db.select<any[]>("SELECT id, closing_day, is_next_month FROM payroll_groups ORDER BY id ASC").then(res => setPayrollGroups(res ?? []));
  }, [db, loadSettings, loadItems]);

  useEffect(() => {
    if (selectedSettingId && selectedSetting) {
      loadActiveItemIds(selectedSettingId); 
      loadStaffValues(selectedSettingId);
      const fiscalYear = selectedSetting.target_month >= 4 ? selectedSetting.target_year : selectedSetting.target_year - 1;
      loadOtherBonuses(fiscalYear, selectedSettingId);
      loadPrevMonthSalary(selectedSetting.target_year, selectedSetting.target_month);
    }else {
      // 何も選択されていないときは空にする
      setActiveItemIds([]);
    }
  }, [selectedSettingId, selectedSetting, loadActiveItemIds, loadStaffValues, loadOtherBonuses, loadPrevMonthSalary]);

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
    // 確定した賞与の支給日は変えない（支給日で、年末調整の年・料率・税額表・社会保険の判定が決まるため）
    const editing = settings.find(s => s.id === editingSettingId);
    if (editing?.is_closed && editing.payment_date !== newPaymentDate) {
      return dialog.warning(`「${editing.name}」は確定済みのため、支給日を変えられません。\n支給日を変えるときは、先に「確定を取り消す」をしてから変え、もう一度確定してください。`);
    }

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
    // 項目を消すと、すべての賞与のその項目の金額も一緒に消える（bonus_staff_values は項目を消すと消える）ので、金額が入っていれば消さない
    const used = await db.select<{ name: string; payment_date: string }[]>(
      `SELECT DISTINCT s.name, s.payment_date FROM bonus_staff_values v JOIN bonus_settings s ON s.id = v.bonus_setting_id
       WHERE v.item_id = ? AND v.amount != 0 ORDER BY s.payment_date`,
      [id]
    );
    if (used.length > 0) {
      return dialog.warning(
        `この項目には、次の賞与で金額が入っているため消せません（消すと、その金額も消えます）。\n` +
        used.map(u => `・${u.name}（支給日 ${u.payment_date}）`).join("\n") +
        `\n\n使わないときは、賞与ごとの項目の切り替えで外してください。`
      );
    }
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
      // 賞与設定と、初めから有効にする項目の紐付けを、1つのトランザクションでまとめて保存する（utils/dbBatch.ts・bonusResults.ts）
      const results = await executeBatch(db, buildAddBonusSettingStatements(settingName, newPaymentDate));
      const newId = Number(results[0].lastInsertId);

      // --- 成功後のUI処理 ---
      await loadSettings();
      setSelectedSettingId(newId);
      setActiveTab('calc');
      // フォームをリセット（お好みで）
      setSettingName('夏季賞与');

    } catch (e) {
      // どこかでエラーが起きたら、設定の保存も含めて取り消されている
      console.error("賞与設定の追加に失敗しました:", e);
      dialog.error(`賞与を追加できませんでした（何も保存していません）。\n${e}`);
    }
  };

  const deleteSetting = async (id: number) => {
    if (!db) return;
    // 確定した賞与は消さない（消すと確定結果 bonus_results も一緒に消え、年末調整・源泉徴収票の1年分の集計から黙って抜けるため）
    const setting = settings.find(s => s.id === id);
    const results = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM bonus_results WHERE bonus_setting_id = ?", [id]);
    if (setting?.is_closed || Number(results?.[0]?.n) > 0) {
      return dialog.warning(
        `「${setting?.name ?? "この賞与"}」は確定済みのため、消せません。\n` +
        `確定した賞与は、年末調整・源泉徴収票・源泉徴収簿の1年分の集計に入っています（支払った記録として残してください）。\n` +
        `間違えて作った賞与を消すときは、先に「確定を取り消す」をしてください。`
      );
    }
    const ok = await ask("賞与設定を削除しますか？\n入れた金額も一緒に消えます。", { title: '削除確認', kind: 'warning' });
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

    // 社会保険・雇用保険に加入していない人からは引かない（給与と同じ判定）
    const isSocialInsEnrolled = checkSocialInsEnrolled(staff, payYear, payMonth);
    const isEmploymentInsEnrolled = checkEmploymentInsEnrolled(staff);
    // 年齢による対象は、賞与を支給する月で決まる（支給日の年齢ではない。給与と同じ判定）
    // 資格を失った月（75歳の誕生月・70歳に達した月）に支払った賞与には、その保険料がかからない
    const byAge = getInsuranceByAge(staff.birthday || '', payYear, payMonth);
    // 入社日より前・資格喪失日（退職日の翌日）がある月に支払った賞与には、どの社会保険料もかからない（支給日で判定する）
    const payDate = selectedSetting.payment_date || `${payYear}-${String(payMonth).padStart(2, '0')}-01`;
    // 産休・育休で免除される月に支払った賞与にもかからない（育休は、期間が1か月を超えるときだけ）
    const isInsured = isSocialInsEnrolled
      && checkInsuredOnBonusDate(staff.join_date, staff.retirement_date, payDate)
      && !checkLeaveExemptBonus(parseLeavePeriods(staff.leave_periods), payDate);
    const isHealthTarget = isInsured && byAge.health;
    const isPensionTarget = isInsured && byAge.pension;
    const isNursing = isHealthTarget && byAge.nursing;

    const sInsType = companySettings.round_social_ins || 'currency_law';
    // この賞与より前に支払った賞与の標準賞与額の累計（後で支払う賞与は入れない。utils/bonusInsurance.ts）
    const earlier = earlierBonusTotals(staff, otherBonuses[String(staff.id)] ?? [], { settingId: selectedSetting.id, paymentDate: payDate });
    // 健康保険・介護保険・子ども・子育て支援金の標準賞与額は、年度（4月〜翌3月）の累計で573万円まで
    const healthHyojun = cappedBonusStandard(hyojunBonus, earlier.health, ins.HEALTH_INS_ANNUAL_LIMIT);

    // 本人負担分 = 標準賞与額 × 料率 ÷ 2（介護保険は「健康保険＋介護保険」でまとめて計算し、健康保険料を引く）
    const healthInsurance = isHealthTarget ? calcPremium(healthHyojun, healthRate, sInsType) : 0;
    const nursingInsurance = isNursing
      ? calcPremium(healthHyojun, healthRate + ins.KENPO_CARE_RATE[1], sInsType) - healthInsurance
      : 0;
    const childSupport = isHealthTarget && Master.isChildSupportMonth(ins, payYear, payMonth) && ins.CHILD_SUPPORT_RATE
      ? calcPremium(healthHyojun, ins.CHILD_SUPPORT_RATE[1], sInsType)
      : 0;

    // 厚生年金の標準賞与額は1か月150万円まで（同じ月に前にも支払っていれば、合わせて150万円まで）
    const pensionHyojun = cappedBonusStandard(hyojunBonus, earlier.pensionSameMonth, ins.PENSION_INS_SINGLE_LIMIT);
    const welfarePension = isPensionTarget ? calcPremium(pensionHyojun, ins.PENSION_RATE[1], sInsType) : 0;

    const empInsType = staff.employment_insurance_type || companySettings.default_emp_ins_type || 'general';
    const empRate = ins.LABOR_INSURANCE_RATES[empInsType as Master.EmpInsType] || ins.LABOR_INSURANCE_RATES.general;
    const empInsurance = isEmploymentInsEnrolled
      ? calcPremium(totalEarnings, empRate[0] * 100, companySettings.round_emp_ins || 'round', 1)
      : 0;

    const socialTotal = healthInsurance + nursingInsurance + childSupport + welfarePension + empInsurance;
    // 源泉所得税：国税庁の算出率の表（前月の給与がない・賞与が前月の給与の10倍を超えるときは月額表）で計算する
    // ※ 前月の給与は、前月支給分として確定した給与（非課税の通勤手当を除いた額 − 社会保険料）を使う
    //   前月に給与を払うはずなのに確定していない人は、前月の給与がないものとして計算してしまうので、画面と確定のときに知らせる
    // 扶養控除等申告書を出していない人は乙欄（丙欄の人の賞与も乙欄。所得税法186条1項2号）
    // 扶養親族等の数は、賞与を支払う月の分の履歴の値（utils/staffHistory.ts）
    const dependents = staffAsOf(staff, payYear, payMonth).dependents;
    const prevMonthTaxBase = prevMonthTaxBases[String(staff.id)] ?? 0;
    const bonusAfterSocial = Math.max(0, totalEarnings - socialTotal);
    const incomeTax = calcBonusWithholdingTax(bonusAfterSocial, prevMonthTaxBase, Number(dependents) || 0, payYear, 6, toTaxColumn(staff.tax_column));
    const prevSalaryStatus = prevSalaryStatusOfStaff(staff);
    // 算出率の表を使わず、月額表を使う方法で計算したか（前月の給与がない・賞与が前月の給与の10倍を超える）
    const taxByMonthlyTable = totalEarnings > 0 && (Math.floor(prevMonthTaxBase) <= 0 || bonusAfterSocial > Math.floor(prevMonthTaxBase) * 10);

    // 🆕 カスタム控除も有効なものだけ合計
    const customDeductions = deductionItems.reduce((s, item) => s + (vals[item.id] ?? 0), 0);
    const totalDeductions = socialTotal + incomeTax + customDeductions;

    return {
      totalEarnings, hyojunBonus, healthInsurance, nursingInsurance, childSupport, welfarePension,
      empInsurance, incomeTax, customDeductions, totalDeductions,
      netPay: totalEarnings - totalDeductions, isNursing, isHealthTarget, isPensionTarget, isEmploymentInsEnrolled,
      /** この賞与より前に支払った賞与の健康保険の標準賞与額の累計と、この賞与の健康保険・厚生年金の標準賞与額（上限で切った額） */
      earlierHealthTotal: earlier.health, healthHyojun, pensionHyojun,
      prevSalaryStatus, taxByMonthlyTable,
    };
  };

  /** 前月（賞与を支払う月の前月）に支払った給与の状況。前月に支払う給与の計算期間に在籍していたのに確定していなければ unconfirmed */
  const prevSalaryStatusOfStaff = (staff: any): PrevSalaryStatus => {
    if (!selectedSetting) return "none";
    const { year, month } = prevMonthOf(selectedSetting.target_year, selectedSetting.target_month);
    const group = groupOf(staff, payrollGroups);
    return prevSalaryStatusOf(staff, String(staff.id) in prevMonthTaxBases, group ? getPeriodForPayMonth(group, year, month) : null, year, month);
  };

  /** 前月（給与を支払った月）。画面の知らせに使う */
  const prevMonth = selectedSetting ? prevMonthOf(selectedSetting.target_year, selectedSetting.target_month) : null;

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

  /**
   * 選んでいる賞与を確定する：1人ずつの計算結果を bonus_results に保存する（年末調整の1年分の集計に使う）
   * 確定し直すと、前の結果を消して保存し直す
   */
  const finalizeBonus = async () => {
    if (!db || !selectedSetting) return;
    const rows = bonusStaffList
      .map(staff => ({ staff, calc: calcBonusForStaff(staff) }))
      .filter((r): r is { staff: any; calc: NonNullable<ReturnType<typeof calcBonusForStaff>> } => !!r.calc && r.calc.totalEarnings > 0);
    // 前月に給与を払うはずなのに確定していない人は、前月の給与がないものとして所得税を計算している
    const unconfirmed = rows.filter(r => r.calc.prevSalaryStatus === 'unconfirmed').map(r => r.staff.name);
    const prev = prevMonthOf(selectedSetting.target_year, selectedSetting.target_month);
    const ok = await ask(
      `「${selectedSetting.name}」を確定します（支給がある${rows.length}人）。\n` +
      `確定した賞与は、年末調整の1年分の集計に入ります。金額を直したときは、もう一度確定してください。` +
      (unconfirmed.length > 0
        ? `\n\n⚠ 次の人は、前月（${prev.year}年${prev.month}月）に支払う給与がまだ確定していないため、前月の給与がないものとして所得税を計算しています：\n` +
          `${unconfirmed.join("・")}\n` +
          `前月の給与を確定してから、この賞与を確定するのをすすめます（休職などで前月に給与を払っていない人は、このままで構いません）。このまま確定しますか？`
        : ""),
      { title: '賞与の確定', kind: unconfirmed.length > 0 ? 'warning' : 'info' }
    );
    if (!ok) return;
    try {
      // 前の結果を消して保存し直すまでを、1つのトランザクションでまとめて行う（途中で失敗したら、前の結果のまま。utils/dbBatch.ts）
      await executeBatch(db, buildFinalizeBonusStatements(selectedSetting.id, rows));
      await loadSettings();
    } catch (e) {
      console.error("賞与の確定に失敗しました:", e);
      dialog.error(`賞与を確定できませんでした（前の確定の状態のままです）。\n${e}`);
    }
  };

  /**
   * 選んでいる賞与の確定を取り消す：確定結果（bonus_results）を消し、計算中に戻す
   * 取り消すと、年末調整・源泉徴収票・源泉徴収簿の1年分の集計から外れる。間違えて作った賞与を消すときや、支給日を直すときに使う
   */
  const unfinalizeBonus = async () => {
    if (!db || !selectedSetting) return;
    const ok = await ask(
      `「${selectedSetting.name}」の確定を取り消します。\n` +
      `取り消すと、この賞与は年末調整・源泉徴収票・源泉徴収簿の1年分の集計から外れます。支払った賞与なら、直したあと必ずもう一度確定してください。\n` +
      `よろしいですか？`,
      { title: '賞与の確定を取り消す', kind: 'warning' }
    );
    if (!ok) return;
    try {
      await executeBatch(db, buildUnfinalizeBonusStatements(selectedSetting.id));
      await loadSettings();
    } catch (e) {
      console.error("賞与の確定の取り消しに失敗しました:", e);
      dialog.error(`確定を取り消せませんでした（確定したままです）。\n${e}`);
    }
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
    bonusStaffList,
    finalizeBonus,
    unfinalizeBonus,
    rateWarnings,
    prevMonth,
  };
};