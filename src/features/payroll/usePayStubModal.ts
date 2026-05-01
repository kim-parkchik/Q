import { useState, useMemo, useEffect } from 'react';
import * as Master from '../../constants/salaryMaster2026';
import { calculateSalary, saveSalaryResult, type SalaryExtras } from '../../utils/calcSalary';

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
        prefecture: staff.prefecture || "京都",
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

    // 給与計算
    const salary = useMemo(
        () => calculateSalary(staff, attendanceData, extras, year, month, companySettings),
        [staff, attendanceData, extras, year, month, companySettings]
    );

    const wageLabel = staff.wage_type === "monthly" ? "月給制" : "時給制";
    const customEarningItems = extras.customItems.filter(i => i.type === 'earning');
    const customDeductionItems = extras.customItems.filter(i => i.type === 'deduction');

    // 行数計算ロジック
    const earningItemsCount = 1 
        + (salary.absenceDeduction > 0 ? 1 : 0)
        + (salary.statutoryOvertimePay > 0 ? 1 : 0)
        + (salary.standardOvertimePay > 0 ? 1 : 0)
        + (salary.highOvertimePay > 0 ? 1 : 0)
        + 1 + 1 + 1 + customEarningItems.length;
    const deductionItemsCount = 6 + customDeductionItems.length;
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
        fmtH
    };
}