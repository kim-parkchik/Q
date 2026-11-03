/**
 * 「住民税の納入」の画面の状態とデータ操作
 * 選んだ月（給与を支給した月）に引いた住民税を、納付先の市区町村ごとに合計し、納期限を出す。きまりは utils/residentTaxPayment.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { designationNumberError, normalizeDesignationNumber } from "../../utils/salaryPaymentReport";
import { buildPaymentSummary, type MunicipalitySetting } from "../../utils/residentTaxPayment";

/** 宛名番号：半角の英数字とハイフンで11文字まで（地方税共同機構「処分通知等（税額通知）CSVレイアウト仕様書」項番2）。よければ null */
export const atenaNumberError = (s: string): string | null => {
  const v = s.normalize("NFKC").trim();
  if (!v) return null;
  if (!/^[0-9A-Za-z-]+$/.test(v)) return "宛名番号は、半角の英数字とハイフンで入れてください";
  if (v.length > 11) return "宛名番号は11文字までです";
  return null;
};

/** 初めに出す月：前の月（その月に引いた分の納期限が、今月10日） */
const previousMonth = (today = new Date()): [number, number] =>
  today.getMonth() === 0 ? [today.getFullYear() - 1, 12] : [today.getFullYear(), today.getMonth()];

export function useResidentTaxPaymentManager(db: Database, staffList: any[]) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [[year, month], setYearMonth] = useState<[number, number]>(previousMonth());
  const [salaries, setSalaries] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, MunicipalitySetting>>({});
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const loadSettings = async () => {
    const rows = await db.select<any[]>("SELECT code, designation_number, atena_number, special_due FROM resident_tax_municipalities");
    setSettings(Object.fromEntries(rows.map((r) => [String(r.code), {
      designation: String(r.designation_number ?? ""), atena: String(r.atena_number ?? ""), specialDue: Number(r.special_due) === 1,
    }])));
  };

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        // 納期の特例の期間は前の年の12月からなので、前の年から読む
        const s = await db.select<any[]>(
          "SELECT staff_id, target_year, target_month, resident_tax FROM salary_results WHERE target_year BETWEEN ? AND ?",
          [year - 1, year]
        );
        const h = await db.select<any[]>("SELECT holiday_date FROM holiday_master");
        if (cancelled) return;
        setSalaries(s);
        setHolidays(new Set(h.map((r) => String(r.holiday_date))));
        await loadSettings();
      } catch (e) {
        console.error(e);
        dialog.error(`住民税の納入のデータを読み込めませんでした。\n${e}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, year]);

  const summary = useMemo(
    () => buildPaymentSummary(staffList, salaries, settings, year, month, holidays),
    [staffList, salaries, settings, year, month, holidays]
  );

  /** 市区町村ごとの設定を保存する（指定番号・宛名番号・納期の特例。変えた項目だけ渡す） */
  const saveSetting = async (code: string, patch: Partial<MunicipalitySetting>): Promise<boolean> => {
    const next = { ...(settings[code] ?? { designation: "", atena: "", specialDue: false }), ...patch };
    next.designation = normalizeDesignationNumber(next.designation);
    next.atena = next.atena.normalize("NFKC").trim();
    const error = designationNumberError(next.designation) ?? atenaNumberError(next.atena);
    if (error) {
      dialog.warning(error);
      return false;
    }
    const before = settings[code];
    if (before && before.designation === next.designation && before.atena === next.atena && before.specialDue === next.specialDue) return true;
    try {
      await db.execute(
        `INSERT INTO resident_tax_municipalities (code, designation_number, atena_number, special_due, updated_at)
         VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(code) DO UPDATE SET
           designation_number = excluded.designation_number, atena_number = excluded.atena_number,
           special_due = excluded.special_due, updated_at = excluded.updated_at`,
        [code, next.designation || null, next.atena || null, next.specialDue ? 1 : 0]
      );
      setSettings({ ...settings, [code]: next });
      toast.success("保存しました");
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
      return false;
    }
  };

  return { year, month, setYearMonth, isLoading, summary, saveSetting };
}
