/**
 * 月変（随時改定）画面の状態とデータ操作
 * 判定のきまりは utils/zuiji.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from "../../constants";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";
import type { AttendanceRecord, SalaryRecord, SanteiMonth } from "../../utils/santei";
import {
  addMonths, buildZuijiCandidate, findZuijiCandidates, judgeZuiji,
  type ZuijiCandidate, type ZuijiDirection, type ZuijiJudgement,
} from "../../utils/zuiji";
import { latestStandardRemuneration, remunerationHistoryOf, stringifyRemunerationHistory } from "../../utils/standardRemuneration";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

/** 画面で変動月を指定した候補 */
interface ManualEntry {
  staffId: string;
  year: number;
  month: number;
  direction: ZuijiDirection;
}

/** 画面で直した値（特定適用事業所の短時間労働者か・3か月の日数と報酬） */
interface Override {
  short?: boolean;
  months?: Record<number, Partial<Pick<SanteiMonth, "days" | "amount">>>;
}

export interface ZuijiRow extends ZuijiCandidate {
  key: string;
  manual: boolean;
  short: boolean;
  judgement: ZuijiJudgement;
}

const keyOf = (staffId: string, year: number, month: number) => `${staffId}-${year}-${month}`;

export function useZuijiManager(db: Database, staffList: any[], onDataChange: () => void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<{ groups: any[]; salaries: SalaryRecord[]; attendance: AttendanceRecord[] }>({ groups: [], salaries: [], attendance: [] });
  const [manual, setManual] = useState<ManualEntry[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!db) return;
      setIsLoading(true);
      try {
        const groups = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
        // 前の年の12月（1月の変動を見るため）から、次の年の2月（11・12月の変動の3か月目まで）に支払った給与
        const salaries = await db.select<SalaryRecord[]>(
          `SELECT staff_id, target_year, target_month, total_earnings, applied_base_wage, fixed_overtime_allowance FROM salary_results
           WHERE (target_year * 12 + target_month) BETWEEN ? AND ?`,
          [(year - 1) * 12 + 12, (year + 1) * 12 + 2]
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
        console.error("月変のデータの読み込みに失敗しました:", e);
        dialog.error(`月変のデータを読み込めませんでした。\n${e}`);
      } finally {
        setIsLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, staffList, year]);

  const rows: ZuijiRow[] = useMemo(() => {
    const auto = findZuijiCandidates(staffList, year, data.groups, data.salaries, data.attendance)
      .map((c) => ({ c, manual: false }));
    const fromManual = manual
      .filter((m) => m.year === year)
      .map((m) => {
        const staff = staffList.find((s) => String(s.id) === m.staffId);
        return staff
          ? { c: buildZuijiCandidate(staff, m.year, m.month, m.direction, data.groups, data.salaries, data.attendance), manual: true }
          : null;
      })
      .filter((x): x is { c: ZuijiCandidate; manual: boolean } => x !== null);
    // 同じ人・同じ変動月なら、手で指定したほうを使う
    const byKey = new Map<string, { c: ZuijiCandidate; manual: boolean }>();
    for (const x of [...auto, ...fromManual]) byKey.set(keyOf(String(x.c.staff.id), x.c.year, x.c.month), x);

    return [...byKey.entries()]
      .sort(([, a], [, b]) => (a.c.year * 12 + a.c.month) - (b.c.year * 12 + b.c.month) || String(a.c.staff.id).localeCompare(String(b.c.staff.id)))
      .map(([key, { c, manual: isManual }]) => {
        const o = overrides[key] ?? {};
        const months = c.months.map((m, i) => ({ ...m, ...(o.months?.[i] ?? {}) }));
        const short = !!o.short;
        const table = Master.getInsuranceMaster(addMonths(c.year, c.month, 3).year, addMonths(c.year, c.month, 3).month).HYOJUN_TABLE;
        return { ...c, months, key, manual: isManual, short, judgement: judgeZuiji(months, short, c.previous, c.direction, table) };
      });
  }, [staffList, year, data, manual, overrides]);

  const setShort = (key: string, short: boolean) =>
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], short } }));

  /** 3か月の日数・報酬を手で直す（空にすると、その月の給与は未確定の扱い） */
  const updateMonth = (key: string, index: number, patch: Partial<Pick<SanteiMonth, "days" | "amount">>) =>
    setOverrides((prev) => ({
      ...prev,
      [key]: { ...prev[key], months: { ...prev[key]?.months, [index]: { ...prev[key]?.months?.[index], ...patch } } },
    }));

  const addManual = (entry: ManualEntry) =>
    setManual((prev) => [...prev.filter((m) => keyOf(m.staffId, m.year, m.month) !== keyOf(entry.staffId, entry.year, entry.month)), entry]);
  const removeManual = (key: string) =>
    setManual((prev) => prev.filter((m) => keyOf(m.staffId, m.year, m.month) !== key));

  /** 改定後の標準報酬月額を、変動月から4か月目の分から履歴に登録する（同じ月の分があれば置き換える） */
  const register = async (row: ZuijiRow) => {
    if (!db || row.judgement.standard === null) return;
    const [ry, rm] = row.revisionFrom.split("-").map(Number);
    const ok = await ask(
      `${row.staff.name}さんの標準報酬月額を、${ry}年${rm}月分から ${row.judgement.standard.toLocaleString()}円 として履歴に登録します。\n` +
      `すでに${ry}年${rm}月分からの行があれば、置き換えます。よろしいですか？`,
      { title: "随時改定の登録", kind: "info" }
    );
    if (!ok) return;
    setSavingKey(row.key);
    try {
      const history = [
        ...remunerationHistoryOf(row.staff).filter((e) => e.from !== row.revisionFrom),
        { from: row.revisionFrom, amount: row.judgement.standard, reason: "zuiji" as const },
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

  return {
    year, setYear, isLoading, savingKey, rows,
    setShort, updateMonth, addManual, removeManual, register,
  };
}
