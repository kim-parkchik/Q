/**
 * 年末調整画面の状態とデータ操作
 * 計算は utils/nencho.ts、申告書の内容から計算の入力を作るのは utils/nenchoDeclaration.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { getNenchoMaster } from "../../constants/nencho";
import { calcNencho, type NenchoResult } from "../../utils/nencho";
import {
  buildNenchoInput, nenchoExclusion, parseDeclaration, sumYearTotals, validateDeclaration,
  type NenchoDeclaration, type YearTotals,
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
  /** 保存した申告書・計算結果 */
  saved: { declaration: NenchoDeclaration; result: NenchoResult | null; updatedAt: string } | null;
}

export function useNenchoManager(db: Database, staffList: any[]) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [year, setYear] = useState(NENCHO_YEARS[NENCHO_YEARS.length - 1] ?? new Date().getFullYear());
  const master = getNenchoMaster(year);
  const [data, setData] = useState<{ salaries: any[]; bonuses: any[]; saved: any[] }>({ salaries: [], bonuses: [], saved: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NenchoDeclaration | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    if (!db) return;
    setIsLoading(true);
    try {
      const salaries = await db.select<any[]>(
        "SELECT staff_id, target_month, taxable_amount, social_ins_total, income_tax FROM salary_results WHERE target_year = ?",
        [year]
      );
      const bonuses = await db.select<any[]>(
        `SELECT r.* FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id WHERE s.target_year = ?`,
        [year]
      );
      const saved = await db.select<any[]>("SELECT * FROM year_end_adjustments WHERE year = ?", [year]);
      setData({ salaries, bonuses, saved });
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

  const rows: NenchoStaffRow[] = useMemo(() => staffList
    // その年に在籍していない人は出さない
    .filter((s) => !(s.join_date && s.join_date > `${year}-12-31`) && !(s.retirement_date && s.retirement_date < `${year}-01-01`))
    .map((staff) => {
      const sid = String(staff.id);
      const savedRow = data.saved.find((r) => String(r.staff_id) === sid);
      let result: NenchoResult | null = null;
      try { result = savedRow?.result ? JSON.parse(savedRow.result) : null; } catch { result = null; }
      return {
        staff,
        exclusion: nenchoExclusion(staff, year),
        note: staff.retirement_date && staff.retirement_date <= `${year}-12-31`
          ? "12月中に退職する人は、その年最後の給与を支払った後に年末調整をします"
          : null,
        totals: sumYearTotals(
          data.salaries.filter((r) => String(r.staff_id) === sid),
          data.bonuses.filter((r) => String(r.staff_id) === sid),
        ),
        saved: savedRow ? { declaration: parseDeclaration(savedRow.declaration), result, updatedAt: savedRow.updated_at } : null,
      };
    }), [staffList, data, year]);

  const selected = rows.find((r) => String(r.staff.id) === selectedId) ?? null;

  /** 従業員を選ぶ（保存した申告書があれば、それを読み込む） */
  const select = (staffId: string) => {
    const row = rows.find((r) => String(r.staff.id) === staffId);
    setSelectedId(staffId);
    setDraft(row?.saved?.declaration ?? parseDeclaration(null));
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
        `INSERT INTO year_end_adjustments (staff_id, year, declaration, result, updated_at)
         VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(staff_id, year) DO UPDATE SET
           declaration = excluded.declaration, result = excluded.result, updated_at = excluded.updated_at`,
        [selected.staff.id, year, JSON.stringify(draft), JSON.stringify(result)]
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
    rows, selected, select, draft, setDraft, errors, result, save,
  };
}
