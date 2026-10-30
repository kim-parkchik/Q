import { useState, useMemo, useEffect } from 'react';
import * as Master from '../../constants';
import { calculateSalary, saveSalaryResult, type SalaryExtras } from '../../utils/calcSalary';
import { flatTaxReductionTotal } from '../../utils/incomeTax';

// 型定義
interface UsePayStubProps {
  db: any;
  staff: any;
  attendanceData: any[];
  year: number;
  month: number;
  companySettings: any;
}

export function usePayStubModal({ db, staff, attendanceData, year, month, companySettings }: UsePayStubProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [extras, setExtras] = useState<SalaryExtras>({
    allowanceName: "役職手当",
    allowanceAmount: 0,
    residentTax: Number(staff.resident_tax) || 0,
    prefecture: Master.toKenpoPrefName(staff.prefecture) ?? "京都",
    dependents: Number(staff.dependents) || 0,
    customItems: [],
  });

  // ヘルパー関数: 時間のフォーマット
  const fmtH = (num: number) => {
    const h = Math.floor(num);
    const m = Math.round((num - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  // カスタム項目の読み込み
  useEffect(() => {
    const loadCustomItems = async () => {
      if (!db) return;
      try {
        interface SalaryItemRow {
          name: string;
          type: 'earning' | 'deduction';
          amount: number;
        }
        const rows = await db.select(
          `SELECT m.name, m.type, COALESCE(v.amount, 0) as amount
          FROM salary_item_master m
          LEFT JOIN staff_salary_values v ON m.id = v.item_id AND v.staff_id = ?
          WHERE m.category != 'formula'
          ORDER BY m.type DESC, m.id ASC`,
          [staff.id]
        ) as SalaryItemRow[];

        const items = rows
          .filter(r => r.amount > 0)
          .map(r => ({ name: r.name, amount: Number(r.amount), type: r.type }));

        setExtras(p => ({ ...p, customItems: items }));
      } catch (e) {
        console.error("customItems 読み込みエラー:", e);
      }
    };
    loadCustomItems();
  }, [db, staff.id]);

  // 源泉所得税の計算方法（給与規定グループの設定）を読み込む
  useEffect(() => {
    const loadTaxMethod = async () => {
      if (!db) return;
      try {
        const rows = await db.select(
          "SELECT tax_calc_method FROM payroll_groups WHERE id = ?",
          [staff.payroll_group_id || 1]
        ) as { tax_calc_method?: string }[];
        const method = rows?.[0]?.tax_calc_method === "densanki" ? "densanki" : "table";
        setExtras(p => ({ ...p, taxMethod: method }));
      } catch (e) {
        console.error("税額計算方法の読み込みエラー:", e);
      }
    };
    loadTaxMethod();
  }, [db, staff.payroll_group_id]);

  // 定額減税（令和6年6月〜）：その人の減税額の合計から、前の月までの確定済みの給与で差し引いた額を引いた残り
  // ※ 前の月の給与を確定してから次の月を確定すること（確定した額をもとに繰り越すため）
  const flatTaxTotal = flatTaxReductionTotal(staff.flat_tax_reduction_persons, staff.join_date, year, month);
  useEffect(() => {
    const loadFlatTaxReduction = async () => {
      if (!db || flatTaxTotal === 0) {
        setExtras(p => ({ ...p, flatTaxReductionRemaining: 0 }));
        return;
      }
      try {
        const rows = await db.select(
          "SELECT COALESCE(SUM(flat_tax_reduction), 0) AS used FROM salary_results WHERE staff_id = ? AND target_year = ? AND target_month < ?",
          [staff.id, year, month]
        ) as { used: number }[];
        const used = Number(rows?.[0]?.used) || 0;
        setExtras(p => ({ ...p, flatTaxReductionRemaining: Math.max(0, flatTaxTotal - used) }));
      } catch (e) {
        console.error("定額減税の読み込みエラー:", e);
      }
    };
    loadFlatTaxReduction();
  }, [db, staff.id, year, month, flatTaxTotal]);

  // 給与計算
  const salary = useMemo(
    () => calculateSalary(staff, attendanceData, extras, year, month, companySettings),
    [staff, attendanceData, extras, year, month, companySettings]
  );

  const wageLabel = staff.wage_type === "monthly" ? "月給制" : "時給制";
  const customEarningItems = extras.customItems.filter(i => i.type === 'earning');
  const customDeductionItems = extras.customItems.filter(i => i.type === 'deduction');
  // 明細の注記に出す料率の年度（その月の保険料に使ったもの）
  const insMaster = Master.getInsuranceMaster(year, month);

  // 行数計算ロジック
  const earningItemsCount = 1
    + (salary.absenceDeduction > 0 ? 1 : 0)
    + (salary.statutoryOvertimePay > 0 ? 1 : 0)
    + (salary.standardOvertimePay > 0 ? 1 : 0)
    + (salary.highOvertimePay > 0 ? 1 : 0)
    + (salary.holidayWorkPay > 0 ? 1 : 0)
    + (salary.paidLeavePay > 0 ? 1 : 0)
    + 1 + 1 + 1 + customEarningItems.length;
  const deductionItemsCount = 6 + (salary.childSupport > 0 ? 1 : 0) + customDeductionItems.length;
  const targetRows = Math.max(earningItemsCount, deductionItemsCount, 10);

  // 保存処理
  const handleSaveResult = async () => {
    if (!db || !staff) return;
    const result = await saveSalaryResult(db, staff.id, year, month, salary, staff);
    if (result.success) {
      setIsSaved(true);
      alert(`${staff.name}さん ${year}年${month}月分の給与を確定しました。`);
    } else {
      alert("保存に失敗しました: " + result.error);
    }
  };

  return {
    salary,
    extras,
    setExtras,
    isSaved,
    handleSaveResult,
    wageLabel,
    customEarningItems,
    customDeductionItems,
    earningItemsCount,
    deductionItemsCount,
    targetRows,
    insMaster,
    flatTaxTotal,
    fmtH
  };
}