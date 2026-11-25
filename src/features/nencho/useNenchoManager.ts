/**
 * 年末調整画面の状態とデータ操作
 * 計算は utils/nencho.ts、申告書の内容から計算の入力を作るのは utils/nenchoDeclaration.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { PROVISIONAL_SLIP_YEAR, getNenchoMaster, getProvisionalSlipMaster, getWithholdingSlipMaster, type NenchoMaster } from "../../constants/nencho";
import { calcNencho, type NenchoResult } from "../../utils/nencho";
import {
  buildNenchoInput, diedInYear, judgeDateOf, midYearAdjustmentNote, nenchoExclusion, parseDeclaration, settlementStatusOf, sumYearTotals,
  validateDeclaration, type NenchoDeclaration, type SettlementStatus, type YearTotals,
} from "../../utils/nenchoDeclaration";
import { salaryPayDate } from "../../utils/flatTaxReduction";
import type { UsedDependents } from "../../utils/withholdingDependents";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

/** 年末調整の表を用意している年分（いまは令和8年分だけ） */
export const NENCHO_YEARS = [2026].filter((y) => getNenchoMaster(y) !== null);

/**
 * 年末調整の画面で選べる年分：年末調整の表がある年分と、手引が出る前のすぐ次の年分（令和9年分）。
 * すぐ次の年分は、年末調整をしない人（年の途中で退職した人・乙欄の人）の扶養控除等申告書の内容だけを入れる（源泉徴収票に書くため）
 */
export const NENCHO_SCREEN_YEARS = [...new Set([...NENCHO_YEARS, PROVISIONAL_SLIP_YEAR])].sort((a, b) => a - b);

export interface NenchoStaffRow {
  staff: any;
  /** 年末調整をしない人なら、その理由 */
  exclusion: string | null;
  /** 年の途中（12月）に退職した人などへの注意 */
  note: string | null;
  totals: YearTotals;
  /** 保存した申告書・計算結果・精算する給与の年月 */
  saved: { declaration: NenchoDeclaration; result: NenchoResult | null; updatedAt: string; settleYear: number; settleMonth: number } | null;
  /** 保存した後に、確定した給与・賞与が変わって、過不足額が変わる */
  stale: boolean;
  /** その年に確定した給与の月ごとの、支払った日と使った扶養人数（申告書から数えた人数と比べる。utils/withholdingDependents.ts） */
  usedDependents: UsedDependents[];
  /** 精算の状況（保存していなければ null） */
  settlement: SettlementStatus | null;
}

/** 精算する給与の候補：その年の12月、または翌年1月に支払う給与 */
export const settleOptions = (year: number) => [{ year, month: 12 }, { year: year + 1, month: 1 }];

/** 年の途中で退職して年末調整をする人か（12月より前に退職し、対象外でない人） */
const isMidYearAdjusted = (row: Pick<NenchoStaffRow, "staff" | "exclusion">, year: number) =>
  !row.exclusion && !!row.staff.retirement_date && row.staff.retirement_date < `${year}-12-01`;

/**
 * 精算する給与の候補（行ごと）
 * ・年の途中で退職して年末調整をする人：退職した月からその年の12月までと翌年1月に支払う給与（その年最後に支払う給与で精算する）
 * ・ほかの人：その年の12月・翌年1月
 */
export const settleOptionsFor = (row: Pick<NenchoStaffRow, "staff" | "exclusion"> | null, year: number) => {
  if (!row || !isMidYearAdjusted(row, year)) return settleOptions(year);
  const from = Number(String(row.staff.retirement_date).slice(5, 7)) || 12;
  return [...Array.from({ length: 13 - from }, (_, i) => ({ year, month: from + i })), { year: year + 1, month: 1 }];
};

/** 精算する給与の初めの値：年の途中で退職して年末調整をする人は、その年に確定した最後の給与の月（なければ退職した月）。ほかは12月 */
export const defaultSettleFor = (row: Pick<NenchoStaffRow, "staff" | "exclusion" | "totals"> | null, year: number) => {
  if (!row || !isMidYearAdjusted(row, year)) return { year, month: 12 };
  const last = row.totals.salaryMonths[row.totals.salaryMonths.length - 1];
  return { year, month: last ?? (Number(String(row.staff.retirement_date).slice(5, 7)) || 12) };
};

/** 年末調整・源泉徴収票の画面で使う、その年の確定した給与・賞与と保存した年末調整 */
export interface NenchoData { salaries: any[]; bonuses: any[]; saved: any[]; settled: any[] }

export const EMPTY_NENCHO_DATA: NenchoData = { salaries: [], bonuses: [], saved: [], settled: [] };

export async function loadNenchoData(db: Database, year: number): Promise<NenchoData> {
  // 給与を支払った日（給与規定グループの支払日。死亡した後に支払日が来る給与を年末調整に入れないために使う）
  const salaries = await db.select<any[]>(
    `SELECT r.staff_id, r.target_month, r.taxable_amount, r.social_ins_total, r.income_tax, r.applied_dependents, g.payment_day
     FROM salary_results r
     LEFT JOIN staff st ON st.id = r.staff_id
     LEFT JOIN payroll_groups g ON g.id = COALESCE(NULLIF(st.payroll_group_id, 0), 1)
     WHERE r.target_year = ?`,
    [year]
  );
  const bonuses = await db.select<any[]>(
    `SELECT r.*, s.payment_date AS payment_date FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id WHERE s.target_year = ?`,
    [year]
  );
  const saved = await db.select<any[]>("SELECT * FROM year_end_adjustments WHERE year = ?", [year]);
  // 精算する給与（その年の12月・翌年1月）の確定結果に載っている過不足額
  const settled = await db.select<any[]>(
    `SELECT staff_id, target_year, target_month, year_end_adjustment FROM salary_results
     WHERE (target_year = ? AND target_month = 12) OR (target_year = ? AND target_month = 1)`,
    [year, year + 1]
  );
  return { salaries, bonuses, saved, settled };
}

/** その年に在籍した人ごとに、1年分の集計・保存した年末調整・精算の状況をまとめる */
export const buildNenchoRows = (staffList: any[], data: NenchoData, year: number, master: NenchoMaster | null): NenchoStaffRow[] => staffList
  // その年に在籍した人と、その年に給与・賞与を支払った人（12月末に退職して、翌年1月に最後の給与を支払った人など）
  .filter((s) => (!(s.join_date && s.join_date > `${year}-12-31`) && !(s.retirement_date && s.retirement_date < `${year}-01-01`))
    || [...data.salaries, ...data.bonuses].some((r) => String(r.staff_id) === String(s.id)))
  .map((staff) => {
    const sid = String(staff.id);
    const savedRow = data.saved.find((r) => String(r.staff_id) === sid);
    let result: NenchoResult | null = null;
    try { result = savedRow?.result ? JSON.parse(savedRow.result) : null; } catch { result = null; }
    // 死亡した人は、死亡した日より後に支払日が来る給与・賞与を入れない（相続税の対象で、所得税の対象ではない。所得税基本通達9-17）
    const beforeDeath = (payDate: string) => !diedInYear(staff, year) || !payDate || payDate <= String(staff.death_date);
    const salaries = data.salaries.filter((r) => String(r.staff_id) === sid && beforeDeath(salaryPayDate(year, Number(r.target_month), r.payment_day ?? 25)));
    const totals = sumYearTotals(
      salaries,
      data.bonuses.filter((r) => String(r.staff_id) === sid && beforeDeath(String(r.payment_date ?? ""))),
    );
    const usedDependents: UsedDependents[] = salaries
      .filter((r) => r.applied_dependents !== null && r.applied_dependents !== undefined)
      .map((r) => ({
        month: Number(r.target_month),
        payDate: salaryPayDate(year, Number(r.target_month), r.payment_day ?? 25),
        used: Math.max(0, Math.floor(Number(r.applied_dependents) || 0)),
      }));
    const declaration = parseDeclaration(savedRow?.declaration);
    const exclusion = nenchoExclusion(staff, year, declaration);
    const settleDefault = defaultSettleFor({ staff, exclusion, totals }, year);
    const settleYear = Number(savedRow?.settle_year) || settleDefault.year;
    const settleMonth = Number(savedRow?.settle_month) || settleDefault.month;
    const on = judgeDateOf(staff, year);
    // 保存した申告書のまま、いまの給与・賞与で計算し直すと過不足額が変わるか
    const stale = !!(savedRow && result && master
      && calcNencho(buildNenchoInput(declaration, totals, year, master, on), master).difference !== result.difference);
    const settledRow = data.settled.find((r) =>
      String(r.staff_id) === sid && Number(r.target_year) === settleYear && Number(r.target_month) === settleMonth);
    const settlement: SettlementStatus | null = !savedRow || !result ? null
      : settlementStatusOf(result.difference, settledRow ? Number(settledRow.year_end_adjustment) || 0 : null);
    return {
      staff,
      exclusion,
      note: midYearAdjustmentNote(staff, year, declaration)
        ?? (staff.retirement_date && staff.retirement_date <= `${year}-12-31` && !exclusion
          ? "12月中に退職する人は、その年最後の給与を支払った後に年末調整をします"
          : null),
      totals,
      saved: savedRow ? { declaration, result, updatedAt: savedRow.updated_at, settleYear, settleMonth } : null,
      stale,
      usedDependents,
      settlement,
    };
  });

export function useNenchoManager(db: Database, staffList: any[]) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [year, setYear] = useState(NENCHO_YEARS[NENCHO_YEARS.length - 1] ?? new Date().getFullYear());
  const master = getNenchoMaster(year);
  const [data, setData] = useState<NenchoData>(EMPTY_NENCHO_DATA);
  const [settle, setSettle] = useState<{ year: number; month: number }>({ year, month: 12 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NenchoDeclaration | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    if (!db) return;
    setIsLoading(true);
    try {
      setData(await loadNenchoData(db, year));
    } catch (e) {
      console.error("年末調整のデータの読み込みに失敗しました:", e);
      dialog.error(`年末調整のデータを読み込めませんでした。\n${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    setSelectedId(null);
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, year]);

  const rows: NenchoStaffRow[] = useMemo(() => buildNenchoRows(staffList, data, year, master), [staffList, data, year, master]);

  const selected = rows.find((r) => String(r.staff.id) === selectedId) ?? null;

  /** 従業員を選ぶ（保存した申告書があれば、それを読み込む） */
  const select = (staffId: string) => {
    const row = rows.find((r) => String(r.staff.id) === staffId);
    setSelectedId(staffId);
    setDraft(row?.saved?.declaration ?? parseDeclaration(null));
    setSettle(row?.saved ? { year: row.saved.settleYear, month: row.saved.settleMonth } : defaultSettleFor(row ?? null, year));
  };

  const errors = draft ? validateDeclaration(draft) : [];
  const result: NenchoResult | null = useMemo(
    () => (master && selected && draft
      ? calcNencho(buildNenchoInput(draft, selected.totals, year, master, judgeDateOf(selected.staff, year)), master)
      : null),
    [master, selected, draft, year]
  );

  /** 申告書の内容と、いまの計算結果を保存する */
  const save = async () => {
    if (!db || !selected || !draft || !result || errors.length > 0) return;
    setIsSaving(true);
    try {
      await db.execute(
        `INSERT INTO year_end_adjustments (staff_id, year, declaration, result, settle_year, settle_month, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(staff_id, year) DO UPDATE SET
           declaration = excluded.declaration, result = excluded.result,
           settle_year = excluded.settle_year, settle_month = excluded.settle_month, updated_at = excluded.updated_at`,
        [selected.staff.id, year, JSON.stringify(draft), JSON.stringify(result), settle.year, settle.month]
      );
      toast.success(`${selected.staff.name}さんの${year}年分の年末調整を保存しました`);
      await load();
    } catch (e) {
      console.error(e);
      dialog.error(`年末調整を保存できませんでした。\n${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  /** 年末調整をしない人（甲欄）の扶養控除等申告書を保存する（計算結果・精算はない。源泉徴収票の配偶者・扶養親族の欄に使う） */
  const saveSource = async () => {
    if (!db || !selected || !draft || errors.length > 0) return;
    setIsSaving(true);
    try {
      await db.execute(
        `INSERT INTO year_end_adjustments (staff_id, year, declaration, result, settle_year, settle_month, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, DATETIME('now', 'localtime'))
         ON CONFLICT(staff_id, year) DO UPDATE SET
           declaration = excluded.declaration, result = NULL, settle_year = NULL, settle_month = NULL, updated_at = excluded.updated_at`,
        [selected.staff.id, year, JSON.stringify(draft)]
      );
      toast.success(`${selected.staff.name}さんの${year}年分の扶養控除等申告書の内容を保存しました`);
      await load();
    } catch (e) {
      console.error(e);
      dialog.error(`扶養控除等申告書の内容を保存できませんでした。\n${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  /** 年末調整をしない人の扶養控除等申告書を入れられる（手引の区分がある年分と、手引が出る前のすぐ次の年分） */
  const sourceFormAvailable = getWithholdingSlipMaster(year) !== null || getProvisionalSlipMaster(year) !== null;

  return {
    year, setYear, master, sourceFormAvailable, isLoading, isSaving,
    rows, selected, select, draft, setDraft, errors, result, save, saveSource, settle, setSettle,
    settleChoices: settleOptionsFor(selected, year),
  };
}
