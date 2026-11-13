/**
 * 算定基礎（定時決定）画面の状態とデータ操作
 * 計算のきまりは utils/santei.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from "../../constants";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";
import {
  SANTEI_MONTHS, buildSanteiInputs, decideTeiji, gradeOfStandard, groupOf,
  type SanteiInput, type SanteiMonth, type SanteiResult, type SanteiWorkerKind,
} from "../../utils/santei";
import {
  buildAnnualEarlierMonths, decideTeijiAnnual, earlierMonthsOf, type AnnualMonth, type AnnualResult,
} from "../../utils/santeiAnnual";
import { latestStandardRemuneration, remunerationHistoryOf, stringifyRemunerationHistory } from "../../utils/standardRemuneration";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

/**
 * 画面で選ぶ値（区分・登録するか・年間平均で申し立てるか）と、年間平均に使う前年7月〜当年3月の値を足したもの
 */
type RowInput = SanteiInput & {
  kind: SanteiWorkerKind;
  selected: boolean;
  earlierMonths: AnnualMonth[];
  /** 年間報酬の平均で申し立てる（例年の差で、本人が同意している） */
  annualRequested: boolean;
};

export interface SanteiRow extends RowInput {
  previousGrade: number | null;
  /** 4〜6月の平均で決めた結果 */
  result: SanteiResult;
  /** 前年7月〜当年6月の平均と比べた結果（utils/santeiAnnual.ts） */
  annual: AnnualResult;
  /** 登録する標準報酬月額（年間平均で申し立てて、2等級以上の差があるときは年間平均で決めた額） */
  decided: { standard: number; grade: number | null; byAnnual: boolean };
}

/** 4月以後なら今年、1〜3月なら前の年の算定を初めに開く */
const defaultYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

export function useSanteiManager(db: Database, staffList: any[], onDataChange: () => void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [year, setYear] = useState(defaultYear());
  const [inputs, setInputs] = useState<RowInput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 9月分から使う等級表（協会けんぽの保険料額表）
  const ins = Master.getInsuranceMaster(year, 9);
  const table = ins.HYOJUN_TABLE;

  useEffect(() => {
    const load = async () => {
      if (!db) return;
      setIsLoading(true);
      try {
        const groups = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
        // 年間平均と比べるため、前年7月〜当年6月に支払った給与を読む
        const salaries = await db.select<any[]>(
          // 欠勤控除の額・計算期間の所定労働日数は、月給制の人の支払基礎日数に使う（utils/santei.ts の monthFigures）
          "SELECT staff_id, target_year, target_month, total_earnings, absence_deduction, unpaid_leave_deduction, prescribed_work_days, leave_paid_days FROM salary_results " +
          "WHERE (target_year = ? AND target_month >= 7) OR (target_year = ? AND target_month <= 6)",
          [year - 1, year]
        );
        // 前年7月〜当年6月に支払う給与の計算期間（給与規定グループごとに違う）をすべて含む範囲の、確定した勤怠
        const payMonths = [...earlierMonthsOf(year), ...SANTEI_MONTHS.map((month) => ({ year, month }))];
        const periods = groups.flatMap((g) => payMonths.map((p) => getPeriodForPayMonth(g, p.year, p.month)));
        const from = periods.map((p) => p.startStr).sort()[0];
        const to = periods.map((p) => p.endStr).sort().reverse()[0];
        const attendance = from && to
          ? await db.select<any[]>(
              "SELECT staff_id, work_date, work_type, work_hours, leave_paid FROM attendance WHERE is_finalized = 1 AND work_date BETWEEN ? AND ?",
              [from, to]
            )
          : [];
        setInputs(buildSanteiInputs(staffList, year, groups, salaries, attendance)
          .map((r) => ({
            ...r, kind: "general", selected: r.exclusion === null, annualRequested: false,
            earlierMonths: buildAnnualEarlierMonths(r.staff, year, groupOf(r.staff, groups), salaries, attendance),
          })));
      } catch (e) {
        console.error("算定基礎の読み込みに失敗しました:", e);
        dialog.error(`算定基礎のデータを読み込めませんでした。\n${e}`);
      } finally {
        setIsLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, staffList, year]);

  const rows: SanteiRow[] = useMemo(
    () => inputs.map((r) => {
      const result = decideTeiji(r.months, r.kind, r.previous, table);
      const annual = decideTeijiAnnual(year, r.earlierMonths, r.months, r.kind, result, table);
      const byAnnual = r.annualRequested && annual.status === "target";
      return {
        ...r,
        previousGrade: gradeOfStandard(table, r.previous),
        result,
        annual,
        decided: byAnnual
          ? { standard: annual.standard!, grade: annual.grade, byAnnual }
          : { standard: result.standard, grade: result.grade, byAnnual },
      };
    }),
    [inputs, table, year]
  );

  const updateRow = (staffId: string, patch: Partial<Pick<RowInput, "kind" | "selected" | "annualRequested">>) =>
    setInputs((prev) => prev.map((r) => (String(r.staff.id) === String(staffId) ? { ...r, ...patch } : r)));

  /** 支払基礎日数・報酬を手で直す（空にすると、その月は給与を支払っていない扱い） */
  const updateMonth = (staffId: string, month: number, patch: Partial<Pick<SanteiMonth, "days" | "amount" | "partialJoin">>) =>
    setInputs((prev) => prev.map((r) => String(r.staff.id) !== String(staffId) ? r : {
      ...r,
      months: r.months.map((m) => (m.month === month ? { ...m, ...patch } : m)),
    }));

  /** 前年7月〜当年3月の支払基礎日数・報酬を手で直す（空にすると、その月は平均に入れない） */
  const updateEarlierMonth = (staffId: string, year: number, month: number, patch: Partial<Pick<AnnualMonth, "days" | "amount" | "partialJoin">>) =>
    setInputs((prev) => prev.map((r) => String(r.staff.id) !== String(staffId) ? r : {
      ...r,
      earlierMonths: r.earlierMonths.map((m) => (m.year === year && m.month === month ? { ...m, ...patch } : m)),
    }));

  const targets = rows.filter((r) => r.exclusion === null);
  const excluded = rows.filter((r) => r.exclusion !== null);
  const selectedRows = targets.filter((r) => r.selected);

  /** 選んだ人の標準報酬月額を、この年の9月分から履歴に登録する（同じ月の分があれば置き換える） */
  const register = async () => {
    if (!db || selectedRows.length === 0) return;
    const annualCount = selectedRows.filter((r) => r.decided.byAnnual).length;
    const ok = await ask(
      `${selectedRows.length}人の標準報酬月額を、${year}年9月分から履歴に登録します。\n` +
      (annualCount > 0 ? `うち${annualCount}人は、年間報酬の平均で決めた額です。\n` : "") +
      `すでに${year}年9月分からの行がある人は、置き換えます。よろしいですか？`,
      { title: "算定基礎の登録", kind: "info" }
    );
    if (!ok) return;
    setIsSaving(true);
    try {
      const from = `${year}-09`;
      for (const r of selectedRows) {
        const history = [
          ...remunerationHistoryOf(r.staff).filter((e) => e.from !== from),
          { from, amount: r.decided.standard, reason: "teiji" as const },
        ];
        await db.execute(
          "UPDATE staff SET standard_remuneration_history = ?, standard_remuneration = ? WHERE id = ?",
          [stringifyRemunerationHistory(history), latestStandardRemuneration(history), r.staff.id]
        );
      }
      toast.success(`${selectedRows.length}人の標準報酬月額を、${year}年9月分から登録しました`);
      onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`登録できませんでした。\n${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    year, setYear, isLoading, isSaving,
    targets, excluded, selectedRows,
    updateRow, updateMonth, updateEarlierMonth, register,
    rateWarnings: ins.WARNINGS,
  };
}
