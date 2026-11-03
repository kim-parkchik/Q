/**
 * 年末調整画面の状態とデータ操作
 * 計算は utils/nencho.ts、申告書の内容から計算の入力を作るのは utils/nenchoDeclaration.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { getNenchoMaster, type NenchoMaster } from "../../constants/nencho";
import { calcNencho, type NenchoResult } from "../../utils/nencho";
import {
  buildNenchoInput, nenchoExclusion, parseDeclaration, settlementStatusOf, sumYearTotals, validateDeclaration,
  type NenchoDeclaration, type SettlementStatus, type YearTotals,
} from "../../utils/nenchoDeclaration";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

/** 年末調整の表を用意している年分（いまは令和8年分だけ） */
export const NENCHO_YEARS = [2026].filter((y) => getNenchoMaster(y) !== null);

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
  /** 精算の状況（保存していなければ null） */
  settlement: SettlementStatus | null;
}

/** 精算する給与の候補：その年の12月、または翌年1月に支払う給与 */
export const settleOptions = (year: number) => [{ year, month: 12 }, { year: year + 1, month: 1 }];

/** 年末調整・源泉徴収票の画面で使う、その年の確定した給与・賞与と保存した年末調整 */
export interface NenchoData { salaries: any[]; bonuses: any[]; saved: any[]; settled: any[] }

export const EMPTY_NENCHO_DATA: NenchoData = { salaries: [], bonuses: [], saved: [], settled: [] };

export async function loadNenchoData(db: Database, year: number): Promise<NenchoData> {
  const salaries = await db.select<any[]>(
    "SELECT staff_id, target_month, taxable_amount, social_ins_total, income_tax FROM salary_results WHERE target_year = ?",
    [year]
  );
  const bonuses = await db.select<any[]>(
    `SELECT r.* FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id WHERE s.target_year = ?`,
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
    const totals = sumYearTotals(
      data.salaries.filter((r) => String(r.staff_id) === sid),
      data.bonuses.filter((r) => String(r.staff_id) === sid),
    );
    const declaration = parseDeclaration(savedRow?.declaration);
    const settleYear = Number(savedRow?.settle_year) || year;
    const settleMonth = Number(savedRow?.settle_month) || 12;
    // 保存した申告書のまま、いまの給与・賞与で計算し直すと過不足額が変わるか
    const stale = !!(savedRow && result && master
      && calcNencho(buildNenchoInput(declaration, totals, year, master), master).difference !== result.difference);
    const settledRow = data.settled.find((r) =>
      String(r.staff_id) === sid && Number(r.target_year) === settleYear && Number(r.target_month) === settleMonth);
    const settlement: SettlementStatus | null = !savedRow || !result ? null
      : settlementStatusOf(result.difference, settledRow ? Number(settledRow.year_end_adjustment) || 0 : null);
    return {
      staff,
      exclusion: nenchoExclusion(staff, year),
      note: staff.retirement_date && staff.retirement_date <= `${year}-12-31`
        ? "12月中に退職する人は、その年最後の給与を支払った後に年末調整をします"
        : null,
      totals,
      saved: savedRow ? { declaration, result, updatedAt: savedRow.updated_at, settleYear, settleMonth } : null,
      stale,
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
    setSettle(row?.saved ? { year: row.saved.settleYear, month: row.saved.settleMonth } : { year, month: 12 });
  };

  const errors = draft ? validateDeclaration(draft) : [];
  const result: NenchoResult | null = useMemo(
    () => (master && selected && draft ? calcNencho(buildNenchoInput(draft, selected.totals, year, master), master) : null),
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

  return {
    year, setYear, master, isLoading, isSaving,
    rows, selected, select, draft, setDraft, errors, result, save, settle, setSettle,
  };
}
