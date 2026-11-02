/**
 * 源泉徴収簿の画面の状態とデータ操作
 * 各欄の中身を作るのは utils/withholdingLedger.ts。年末調整の状況は年末調整の画面と同じもの（useNenchoManager.ts）を使う
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { getNenchoMaster } from "../../constants/nencho";
import { buildWithholdingLedger, type LedgerBonusInput, type LedgerSalaryInput, type WithholdingLedger } from "../../utils/withholdingLedger";
import { useMessageDialog } from "../../components/MessageDialog";
import { EMPTY_NENCHO_DATA, NENCHO_YEARS, buildNenchoRows, loadNenchoData, type NenchoData } from "./useNenchoManager";
import { statusOf, type SlipStaffRow } from "./useWithholdingSlipManager";

interface LedgerData {
  nencho: NenchoData;
  /** その年と前年12月の確定した給与 */
  salaries: (LedgerSalaryInput & { staff_id: string })[];
  bonuses: (LedgerBonusInput & { staff_id: string })[];
  /** 前年の年末調整（この年の1月の給与で精算するもの） */
  previousYear: { staff_id: string; result: string | null; settle_year: number | null; settle_month: number | null }[];
  paymentDays: Record<string, number>;
  branches: Record<string, string>;
}

const EMPTY: LedgerData = { nencho: EMPTY_NENCHO_DATA, salaries: [], bonuses: [], previousYear: [], paymentDays: {}, branches: {} };

export function useWithholdingLedgerManager(db: Database, staffList: any[]) {
  const dialog = useMessageDialog();
  const [years, setYears] = useState<number[]>(NENCHO_YEARS);
  const [year, setYear] = useState(NENCHO_YEARS[NENCHO_YEARS.length - 1] ?? new Date().getFullYear());
  const master = getNenchoMaster(year);
  const [data, setData] = useState<LedgerData>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 選べる年分：確定した給与・賞与がある年と、年末調整の表がある年
  useEffect(() => {
    if (!db) return;
    (async () => {
      try {
        const rows = await db.select<{ y: number }[]>(
          "SELECT DISTINCT target_year AS y FROM salary_results UNION SELECT DISTINCT target_year AS y FROM bonus_settings",
        );
        const all = [...new Set([...rows.map((r) => Number(r.y)).filter(Boolean), ...NENCHO_YEARS])].sort((a, b) => a - b);
        setYears(all);
      } catch (e) {
        console.error("源泉徴収簿の年分の読み込みに失敗しました:", e);
      }
    })();
  }, [db]);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setIsLoading(true);
    setSelectedId(null);
    (async () => {
      try {
        const nencho = await loadNenchoData(db, year);
        const salaries = await db.select<any[]>(
          `SELECT staff_id, target_year, target_month, taxable_amount, social_ins_total, applied_dependents, income_tax, year_end_adjustment
           FROM salary_results WHERE target_year = ? OR (target_year = ? AND target_month = 12)`,
          [year, year - 1],
        );
        const bonuses = await db.select<any[]>(
          `SELECT r.*, s.target_year, s.target_month, s.payment_date
           FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id WHERE s.target_year = ?`,
          [year],
        );
        const previousYear = await db.select<any[]>(
          "SELECT staff_id, result, settle_year, settle_month FROM year_end_adjustments WHERE year = ?",
          [year - 1],
        );
        const groups = await db.select<{ id: number; payment_day: number }[]>("SELECT id, payment_day FROM payroll_groups");
        const branchRows = await db.select<{ id: number; name: string }[]>("SELECT id, name FROM branches");
        if (cancelled) return;
        setData({
          nencho, salaries, bonuses, previousYear,
          paymentDays: Object.fromEntries(groups.map((g) => [String(g.id), Number(g.payment_day)])),
          branches: Object.fromEntries(branchRows.map((b) => [String(b.id), b.name])),
        });
      } catch (e) {
        console.error("源泉徴収簿のデータの読み込みに失敗しました:", e);
        dialog.error(`源泉徴収簿のデータを読み込めませんでした。\n${e}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, year]);

  const rows: SlipStaffRow[] = useMemo(() => buildNenchoRows(staffList, data.nencho, year, master).map((r) => {
    const paid = r.totals.salary > 0 || r.totals.withheldTax > 0;
    return { ...r, paid, ...statusOf(r, paid) };
  }), [staffList, data.nencho, year, master]);

  const selected = rows.find((r) => String(r.staff.id) === selectedId) ?? null;

  /** 選んだ人の源泉徴収簿と、画面にだけ出す注意 */
  const ledger: (WithholdingLedger & { warnings: string[]; branchName: string | null }) | null = useMemo(() => {
    if (!selected) return null;
    const sid = String(selected.staff.id);
    const adjusted = !selected.exclusion && selected.saved;
    const prev = data.previousYear.find((r) => String(r.staff_id) === sid && Number(r.settle_year) === year && Number(r.settle_month) === 1);
    let previousYearDifference: number | null = null;
    try { previousYearDifference = prev?.result ? Number(JSON.parse(prev.result).difference) || 0 : null; } catch { previousYearDifference = null; }

    const l = buildWithholdingLedger({
      year,
      staff: selected.staff,
      paymentDay: data.paymentDays[String(selected.staff.payroll_group_id || 1)] ?? null,
      salaries: data.salaries.filter((r) => String(r.staff_id) === sid),
      bonuses: data.bonuses.filter((r) => String(r.staff_id) === sid),
      adjustment: adjusted ? { declaration: selected.saved!.declaration, settleYear: selected.saved!.settleYear, settleMonth: selected.saved!.settleMonth } : null,
      previousYearDifference,
    }, master);

    const warnings: string[] = [];
    if (!master) warnings.push(`${year}年分の年末調整の表はまだないので、年末調整の欄は作りません（月ごとの欄だけ）。`);
    else if (selected.exclusion) warnings.push(`年末調整をしない人です（${selected.exclusion}）。年末調整の欄は空けておきます。`);
    else if (!selected.saved) warnings.push("年末調整をまだ保存していません。年末調整をする人は、先に「年末調整」の画面で申告書の内容を保存してください。");
    else if (selected.stale) warnings.push("年末調整を保存した後に、確定した給与・賞与が変わりました。「年末調整」の画面で保存し直してください（この源泉徴収簿の年末調整の欄は、いまの給与・賞与で計算し直した値です）。");
    else if (selected.settlement !== "done") {
      const s = selected.saved;
      warnings.push(`過不足額の精算がまだです。${s.settleYear}年${s.settleMonth}月に支払う給与の明細を、過不足額を載せて確定してください。`);
    }
    if (l.adjustment && !l.adjustment.result.eligible && l.adjustment.result.ineligibleReason) warnings.push(l.adjustment.result.ineligibleReason);
    if (l.bonusRows.some((b) => b.rate === null)) {
      warnings.push("賞与の税率は、前月の給与がない・賞与が前月の給与の10倍を超える（月額表で計算した）とき、または確定したときの扶養親族等の数などがわからず確かめられないときは書いていません。");
    }
    return { ...l, warnings, branchName: data.branches[String(selected.staff.branch_id || 1)] ?? null };
  }, [selected, data, master, year]);

  return { years, year, setYear, isLoading, rows, selected, select: setSelectedId, ledger };
}
