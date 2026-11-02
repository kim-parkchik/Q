/**
 * 休業終了時改定（産前産後休業終了時改定・育児休業等終了時改定）画面の状態とデータ操作
 * 判定のきまりは utils/leaveEndRevision.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from "../../constants";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";
import type { AttendanceRecord, SalaryRecord, SanteiMonth, SanteiWorkerKind } from "../../utils/santei";
import { addMonths } from "../../utils/zuiji";
import { findLeaveEndCandidates, judgeLeaveEnd, type LeaveEndCandidate, type LeaveEndJudgement } from "../../utils/leaveEndRevision";
import { latestStandardRemuneration, remunerationHistoryOf, stringifyRemunerationHistory } from "../../utils/standardRemuneration";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

/** 画面で直した値（働き方の区分・3か月の日数と報酬） */
interface Override {
  kind?: SanteiWorkerKind;
  months?: Record<number, Partial<Pick<SanteiMonth, "days" | "amount">>>;
}

export interface LeaveEndRow extends LeaveEndCandidate {
  key: string;
  kind: SanteiWorkerKind;
  judgement: LeaveEndJudgement;
}

export function useLeaveEndRevisionManager(db: Database, staffList: any[], onDataChange: () => void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<{ groups: any[]; salaries: SalaryRecord[]; attendance: AttendanceRecord[] }>({ groups: [], salaries: [], attendance: [] });
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!db) return;
      setIsLoading(true);
      try {
        const groups = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
        // その年の1月から、次の年の2月（12月が最初の月なら3か月目）までに支払った給与
        const salaries = await db.select<SalaryRecord[]>(
          `SELECT staff_id, target_year, target_month, total_earnings, applied_base_wage FROM salary_results
           WHERE (target_year * 12 + target_month) BETWEEN ? AND ?`,
          [year * 12 + 1, (year + 1) * 12 + 2]
        );
        const periods = groups.flatMap((g) =>
          Array.from({ length: 14 }, (_, k) => addMonths(year, 1, k)).map((ym) => getPeriodForPayMonth(g, ym.year, ym.month)));
        const from = periods.map((p) => p.startStr).sort()[0];
        const to = periods.map((p) => p.endStr).sort().reverse()[0];
        const attendance = from && to
          ? await db.select<AttendanceRecord[]>(
              "SELECT staff_id, work_date, work_type, work_hours FROM attendance WHERE is_finalized = 1 AND work_date BETWEEN ? AND ?",
              [from, to]
            )
          : [];
        setData({ groups, salaries, attendance });
      } catch (e) {
        console.error("休業終了時改定のデータの読み込みに失敗しました:", e);
        dialog.error(`休業終了時改定のデータを読み込めませんでした。\n${e}`);
      } finally {
        setIsLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, staffList, year]);

  const rows: LeaveEndRow[] = useMemo(() =>
    findLeaveEndCandidates(staffList, year, data.groups, data.salaries, data.attendance).map((c) => {
      const key = `${c.staff.id}-${c.leave.type}-${c.nextDay}`;
      const o = overrides[key] ?? {};
      const months = c.months.map((m, i) => ({ ...m, ...(o.months?.[i] ?? {}) }));
      const kind = o.kind ?? "general";
      const revision = addMonths(c.year, c.month, 3);
      const table = Master.getInsuranceMaster(revision.year, revision.month).HYOJUN_TABLE;
      return { ...c, months, key, kind, judgement: judgeLeaveEnd(months, kind, c.previous, table, c.followedBy !== null) };
    }), [staffList, year, data, overrides]);

  const setKind = (key: string, kind: SanteiWorkerKind) =>
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], kind } }));

  /** 3か月の日数・報酬を手で直す（空にすると、その月の給与は未確定の扱い） */
  const updateMonth = (key: string, index: number, patch: Partial<Pick<SanteiMonth, "days" | "amount">>) =>
    setOverrides((prev) => ({
      ...prev,
      [key]: { ...prev[key], months: { ...prev[key]?.months, [index]: { ...prev[key]?.months?.[index], ...patch } } },
    }));

  /** 改定後の標準報酬月額を、4か月目の分から履歴に登録する（同じ月の分があれば置き換える） */
  const register = async (row: LeaveEndRow) => {
    if (!db || row.judgement.standard === null) return;
    const [ry, rm] = row.revisionFrom.split("-").map(Number);
    const ok = await ask(
      `${row.staff.name}さんの標準報酬月額を、${ry}年${rm}月分から ${row.judgement.standard.toLocaleString()}円 として履歴に登録します（${row.leave.type === "childcare" ? "育児休業等" : "産前産後休業"}終了時改定）。\n` +
      `本人から申出があったときだけ届け出ます。すでに${ry}年${rm}月分からの行があれば、置き換えます。よろしいですか？`,
      { title: "休業終了時改定の登録", kind: "info" }
    );
    if (!ok) return;
    setSavingKey(row.key);
    try {
      const history = [
        ...remunerationHistoryOf(row.staff).filter((e) => e.from !== row.revisionFrom),
        { from: row.revisionFrom, amount: row.judgement.standard, reason: "kyugyo" as const },
      ];
      await db.execute(
        "UPDATE staff SET standard_remuneration_history = ?, standard_remuneration = ? WHERE id = ?",
        [stringifyRemunerationHistory(history), latestStandardRemuneration(history), row.staff.id]
      );
      toast.success(`${row.staff.name}さんの標準報酬月額を、${ry}年${rm}月分から登録しました`);
      onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`登録できませんでした。\n${e}`);
    } finally {
      setSavingKey(null);
    }
  };

  return { year, setYear, isLoading, savingKey, rows, setKind, updateMonth, register };
}
