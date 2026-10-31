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
  SANTEI_MONTHS, buildSanteiInputs, decideTeiji, gradeOfStandard,
  type SanteiInput, type SanteiMonth, type SanteiResult, type SanteiWorkerKind,
} from "../../utils/santei";
import { latestStandardRemuneration, remunerationHistoryOf, stringifyRemunerationHistory } from "../../utils/standardRemuneration";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

/** 画面で選ぶ値（区分・登録するか）を足したもの */
type RowInput = SanteiInput & { kind: SanteiWorkerKind; selected: boolean };

export interface SanteiRow extends RowInput {
  previousGrade: number | null;
  result: SanteiResult;
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
        const salaries = await db.select<any[]>(
          "SELECT staff_id, target_month, total_earnings FROM salary_results WHERE target_year = ? AND target_month IN (4, 5, 6)",
          [year]
        );
        // 4〜6月に支払う給与の計算期間（給与規定グループごとに違う）をすべて含む範囲の、確定した勤怠
        const periods = groups.flatMap((g) => SANTEI_MONTHS.map((m) => getPeriodForPayMonth(g, year, m)));
        const from = periods.map((p) => p.startStr).sort()[0];
        const to = periods.map((p) => p.endStr).sort().reverse()[0];
        const attendance = from && to
          ? await db.select<any[]>(
              "SELECT staff_id, work_date, work_type, work_hours FROM attendance WHERE is_finalized = 1 AND work_date BETWEEN ? AND ?",
              [from, to]
            )
          : [];
        setInputs(buildSanteiInputs(staffList, year, groups, salaries, attendance)
          .map((r) => ({ ...r, kind: "general", selected: r.exclusion === null })));
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
    () => inputs.map((r) => ({
      ...r,
      previousGrade: gradeOfStandard(table, r.previous),
      result: decideTeiji(r.months, r.kind, r.previous, table),
    })),
    [inputs, table]
  );

  const updateRow = (staffId: string, patch: Partial<Pick<RowInput, "kind" | "selected">>) =>
    setInputs((prev) => prev.map((r) => (String(r.staff.id) === String(staffId) ? { ...r, ...patch } : r)));

  /** 支払基礎日数・報酬を手で直す（空にすると、その月は給与を支払っていない扱い） */
  const updateMonth = (staffId: string, month: number, patch: Partial<Pick<SanteiMonth, "days" | "amount" | "partialJoin">>) =>
    setInputs((prev) => prev.map((r) => String(r.staff.id) !== String(staffId) ? r : {
      ...r,
      months: r.months.map((m) => (m.month === month ? { ...m, ...patch } : m)),
    }));

  const targets = rows.filter((r) => r.exclusion === null);
  const excluded = rows.filter((r) => r.exclusion !== null);
  const selectedRows = targets.filter((r) => r.selected);

  /** 選んだ人の標準報酬月額を、この年の9月分から履歴に登録する（同じ月の分があれば置き換える） */
  const register = async () => {
    if (!db || selectedRows.length === 0) return;
    const ok = await ask(
      `${selectedRows.length}人の標準報酬月額を、${year}年9月分から履歴に登録します。\n` +
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
          { from, amount: r.result.standard, reason: "teiji" as const },
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
    updateRow, updateMonth, register,
    rateWarnings: ins.WARNINGS,
  };
}
