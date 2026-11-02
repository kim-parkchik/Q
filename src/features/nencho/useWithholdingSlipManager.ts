/**
 * 源泉徴収票の画面の状態とデータ操作
 * 各欄の中身を作るのは utils/withholdingSlip.ts。1年分の集計・保存した年末調整は年末調整の画面と同じもの（useNenchoManager.ts）を使う
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { getNenchoMaster, getWithholdingSlipMaster } from "../../constants/nencho";
import { buildWithholdingSlip, type WithholdingSlip } from "../../utils/withholdingSlip";
import { useMessageDialog } from "../../components/MessageDialog";
import { EMPTY_NENCHO_DATA, NENCHO_YEARS, buildNenchoRows, loadNenchoData, type NenchoData, type NenchoStaffRow } from "./useNenchoManager";

/** 源泉徴収票を作れる年分（年末調整の表と、源泉徴収票の区分の両方を用意している年分） */
export const SLIP_YEARS = NENCHO_YEARS.filter((y) => getWithholdingSlipMaster(y) !== null);

export interface SlipStaffRow extends NenchoStaffRow {
  /** その年に支払った給与・賞与がある */
  paid: boolean;
  /** 一覧に出す状況 */
  status: string;
  /** 注意が必要（年末調整がまだ・保存し直しが必要など） */
  attention: boolean;
}

/** 一覧に出す状況（源泉徴収簿の画面でも使う） */
export const statusOf = (r: NenchoStaffRow, paid: boolean): { status: string; attention: boolean } => {
  if (!paid) return { status: "支払なし", attention: false };
  if (r.exclusion) return { status: "年末調整なし", attention: false };
  if (!r.saved) return { status: "年末調整がまだ", attention: true };
  if (r.stale) return { status: "年末調整の保存し直しが必要", attention: true };
  if (r.settlement !== "done") return { status: "過不足額の精算がまだ", attention: true };
  return { status: "年末調整済み", attention: false };
};

export function useWithholdingSlipManager(db: Database, staffList: any[]) {
  const dialog = useMessageDialog();
  const [year, setYear] = useState(SLIP_YEARS[SLIP_YEARS.length - 1] ?? new Date().getFullYear());
  const master = getNenchoMaster(year);
  const slipMaster = getWithholdingSlipMaster(year);
  const [data, setData] = useState<NenchoData>(EMPTY_NENCHO_DATA);
  const [company, setCompany] = useState<{ name?: string; address?: string; phone?: string }>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setIsLoading(true);
    setSelectedId(null);
    (async () => {
      try {
        const loaded = await loadNenchoData(db, year);
        const c = await db.select<any[]>("SELECT name, address, phone FROM company WHERE id = 1");
        if (cancelled) return;
        setData(loaded);
        setCompany(c[0] ?? {});
      } catch (e) {
        console.error("源泉徴収票のデータの読み込みに失敗しました:", e);
        dialog.error(`源泉徴収票のデータを読み込めませんでした。\n${e}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, year]);

  const rows: SlipStaffRow[] = useMemo(() => buildNenchoRows(staffList, data, year, master).map((r) => {
    const paid = r.totals.salary > 0 || r.totals.withheldTax > 0;
    return { ...r, paid, ...statusOf(r, paid) };
  }), [staffList, data, year, master]);

  const selected = rows.find((r) => String(r.staff.id) === selectedId) ?? null;

  /** 選んだ人の源泉徴収票と、画面にだけ出す注意 */
  const slip: WithholdingSlip | null = useMemo(() => {
    if (!selected || !master || !slipMaster) return null;
    const adjusted = !selected.exclusion && selected.saved;
    const s = buildWithholdingSlip({
      year,
      staff: selected.staff,
      company,
      totals: selected.totals,
      declaration: adjusted ? selected.saved!.declaration : null,
    }, master, slipMaster);
    const notes: string[] = [];
    if (!selected.exclusion && !selected.saved) {
      notes.push("年末調整をまだ保存していません。年末調整をする人は、先に「年末調整」の画面で申告書の内容を保存してください。");
    }
    if (adjusted && selected.stale) {
      notes.push("年末調整を保存した後に、確定した給与・賞与が変わりました。「年末調整」の画面で保存し直してください（この源泉徴収票は、いまの給与・賞与で計算し直した値です）。");
    } else if (adjusted && selected.settlement !== "done") {
      const s2 = selected.saved!;
      notes.push(`過不足額の精算がまだです。${s2.settleYear}年${s2.settleMonth}月に支払う給与の明細を、過不足額を載せて確定してください。`);
    }
    if (!company.name || !company.address) notes.push("会社設定に会社の名称・所在地を入れてください（支払者の欄に書きます）。");
    if (!selected.staff.address) notes.push("従業員の住所が入っていません（従業員の画面で入れてください）。");
    return { ...s, warnings: [...notes, ...s.warnings] };
  }, [selected, master, slipMaster, year, company]);

  return { year, setYear, isLoading, rows, selected, select: setSelectedId, slip };
}
