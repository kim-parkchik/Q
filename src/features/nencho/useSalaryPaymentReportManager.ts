/**
 * 給与支払報告書の画面の状態とデータ操作
 * 出す人・出す先・徴収のしかたを決めるのは utils/salaryPaymentReport.ts、eLTAX に取り込む CSV は utils/salaryPaymentReportCsv.ts。
 * 支払金額・源泉徴収税額などは、源泉徴収票と同じもの（utils/withholdingSlip.ts）を使う
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { getNenchoMaster, getWithholdingSlipMaster } from "../../constants/nencho";
import { buildWithholdingSlip, type WithholdingSlip } from "../../utils/withholdingSlip";
import {
  buildReportPerson, designationNumberError, groupByMunicipality, normalizeDesignationNumber, parseReportSetting,
  type ReportPerson, type ReportSetting,
} from "../../utils/salaryPaymentReport";
import { buildSalaryReportCsv, type ReportCsvCompany } from "../../utils/salaryPaymentReportCsv";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { localGovLabel } from "../../utils/localGov";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { EMPTY_NENCHO_DATA, buildNenchoRows, loadNenchoData, type NenchoData } from "./useNenchoManager";
import { SLIP_YEARS, statusOf } from "./useWithholdingSlipManager";

/** 給与支払報告書を作れる年分（源泉徴収票と同じ） */
export const REPORT_YEARS = SLIP_YEARS;

export interface ReportRow extends ReportPerson {
  /** 年末調整の状況（源泉徴収票の画面と同じ） */
  status: string;
  attention: boolean;
  /** 源泉徴収票と同じ中身（CSV に書く） */
  slip: WithholdingSlip;
  /** まだ CSV に入れられない理由（年末調整がまだ・保存し直しが必要。空なら入れられる） */
  notReady: string;
}

export function useSalaryPaymentReportManager(db: Database, staffList: any[], onDataChange: () => Promise<void> | void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [year, setYear] = useState(REPORT_YEARS[REPORT_YEARS.length - 1] ?? new Date().getFullYear());
  const master = getNenchoMaster(year);
  const slipMaster = getWithholdingSlipMaster(year);
  const [data, setData] = useState<NenchoData>(EMPTY_NENCHO_DATA);
  const [settings, setSettings] = useState<Record<string, ReportSetting>>({});
  const [designations, setDesignations] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<ReportCsvCompany>({});
  const [isLoading, setIsLoading] = useState(false);

  const load = async (target = year) => {
    const nencho = await loadNenchoData(db, target);
    const s = await db.select<any[]>("SELECT * FROM salary_payment_reports WHERE year = ?", [target]);
    const d = await db.select<any[]>("SELECT code, designation_number FROM resident_tax_municipalities");
    const c = await db.select<any[]>("SELECT name, address, phone, corporate_number FROM company WHERE id = 1");
    return {
      nencho,
      settings: Object.fromEntries(s.map((r) => [String(r.staff_id), parseReportSetting(r)])),
      designations: Object.fromEntries(d.map((r) => [String(r.code), String(r.designation_number ?? "")])),
      company: { name: c[0]?.name, address: c[0]?.address, phone: c[0]?.phone, corporateNumber: c[0]?.corporate_number },
    };
  };
  const apply = (loaded: Awaited<ReturnType<typeof load>>) => {
    setData(loaded.nencho);
    setSettings(loaded.settings);
    setDesignations(loaded.designations);
    setCompany(loaded.company);
  };

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const loaded = await load(year);
        if (!cancelled) apply(loaded);
      } catch (e) {
        console.error("給与支払報告書のデータの読み込みに失敗しました:", e);
        dialog.error(`給与支払報告書のデータを読み込めませんでした。\n${e}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, year]);

  /** その年に給与・賞与を支払った人（支払金額・源泉徴収税額は源泉徴収票と同じ） */
  const rows: ReportRow[] = useMemo(() => {
    if (!master || !slipMaster) return [];
    return buildNenchoRows(staffList, data, year, master)
      .filter((r) => r.totals.salary > 0 || r.totals.withheldTax > 0)
      .map((r) => {
        const adjusted = !r.exclusion && r.saved;
        const slip = buildWithholdingSlip({
          year, staff: r.staff, company: {}, totals: r.totals, declaration: adjusted ? r.saved!.declaration : null,
        }, master, slipMaster);
        const person = buildReportPerson({
          year, staff: r.staff, payment: slip.payment, withholdingTax: slip.withholdingTax,
          setting: settings[String(r.staff.id)] ?? parseReportSetting(null),
        });
        // 年末調整をする人で、まだ保存していない・保存し直しが要るときは、金額が決まっていないので CSV に入れない
        const notReady = r.exclusion ? "" : !r.saved ? "年末調整がまだです" : r.stale ? "年末調整を保存し直してください" : "";
        return { ...person, ...statusOf(r, true), slip, notReady };
      });
  }, [staffList, data, year, master, slipMaster, settings]);

  const groups = useMemo(() => groupByMunicipality(rows), [rows]);

  /** eLTAX に取り込む CSV（画面に、入る人数と入らない人を出す） */
  const csv = useMemo(() => buildSalaryReportCsv(year, company, rows.map((r) => ({
    report: r, slip: r.slip, staffNumber: r.staffId, designationNumber: r.municipality ? designations[r.municipality.code] ?? "" : "", notReady: r.notReady,
  }))), [year, company, rows, designations]);

  /** CSV を保存する */
  const exportCsv = async () => {
    if (csv.errors.length > 0) {
      dialog.warning(csv.errors.join("\n"), "CSV を作れません");
      return;
    }
    if (csv.count === 0) {
      dialog.warning("CSV に入れられる人がいません。下の「CSV に入らない人」を直してください。", "CSV を作れません");
      return;
    }
    if (csv.skipped.length > 0) {
      const ok = await ask(
        `次の${csv.skipped.length}人は、直すところがあるので CSV に入りません。\n\n`
        + csv.skipped.map((s) => `・${s.name}：${s.reasons.join("／")}`).join("\n")
        + `\n\nほかの${csv.count}人で CSV を作りますか？（PCdesk では、取り込んだ個人別明細書を後から直せません。入らない人は、直してから「追加」で出します）`,
        { title: "CSV に入らない人がいます", kind: "warning" }
      );
      if (!ok) return;
    }
    try {
      const saved = await saveCsvFile(csv.csv, `給与支払報告書_${year}年分.csv`);
      if (!saved) return;
      toast.success(`「${saved.name}」を保存しました（${csv.count}人・${csv.municipalities}市区町村）`);
      if (csv.notes.length > 0) await dialog.warning(csv.notes.join("\n"));
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を保存できませんでした。\n${e}`);
    }
  };

  /** 従業員ごとの設定を保存する（変えた項目だけ渡す） */
  const saveSetting = async (row: ReportRow, patch: Partial<ReportSetting>) => {
    const current = settings[row.staffId] ?? parseReportSetting(null);
    const next = { ...current, ...patch };
    try {
      await db.execute(
        `INSERT INTO salary_payment_reports (staff_id, year, ordinary_collection, ordinary_reason, submit, updated_at)
         VALUES (?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(staff_id, year) DO UPDATE SET
           ordinary_collection = excluded.ordinary_collection, ordinary_reason = excluded.ordinary_reason,
           submit = excluded.submit, updated_at = excluded.updated_at`,
        [row.staffId, year, next.ordinary === null ? null : next.ordinary ? 1 : 0, next.reason || null, next.submit ? 1 : 0]
      );
      setSettings({ ...settings, [row.staffId]: next });
    } catch (e) {
      console.error(e);
      dialog.error(`${row.name}さんの設定を保存できませんでした。\n${e}`);
    }
  };

  /** 市区町村ごとの指定番号を保存する（空にもできる） */
  const saveDesignation = async (code: string, value: string): Promise<boolean> => {
    const v = normalizeDesignationNumber(value);
    const error = designationNumberError(v);
    if (error) {
      dialog.error(error);
      return false;
    }
    if ((designations[code] ?? "") === v) return true;
    try {
      await db.execute(
        `INSERT INTO resident_tax_municipalities (code, designation_number, updated_at)
         VALUES (?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(code) DO UPDATE SET designation_number = excluded.designation_number, updated_at = excluded.updated_at`,
        [code, v || null]
      );
      setDesignations({ ...designations, [code]: v });
      toast.success("指定番号を保存しました");
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`指定番号を保存できませんでした。\n${e}`);
      return false;
    }
  };

  /** 市区町村が未設定の人に、住所から探した市区町村を入れる（従業員の画面の値を書き換える） */
  const fillFromAddress = async (targets: ReportRow[]) => {
    const list = targets.filter((r) => r.suggested);
    if (list.length === 0) return;
    const ok = await ask(
      `次の${list.length}人の市区町村を、住所から入れます（従業員の画面の「住民税（特別徴収）」の市区町村が変わります）。\n\n`
      + list.map((r) => `・${r.name}：${localGovLabel(r.suggested)}`).join("\n")
      + "\n\n年の途中で退職した人は、退職した日の住所の市区町村です。違う人は、従業員の画面で直してください。",
      { title: "住所から市区町村を入れる", kind: "info" }
    );
    if (!ok) return;
    try {
      for (const r of list) {
        await db.execute("UPDATE staff SET resident_tax_municipality = ? WHERE id = ?", [r.suggested!.code, r.staffId]);
      }
      toast.success(`${list.length}人の市区町村を入れました`);
      await onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`市区町村を入れられませんでした。\n${e}`);
    }
  };

  return { year, setYear, isLoading, rows, groups, designations, csv, exportCsv, saveSetting, saveDesignation, fillFromAddress };
}
