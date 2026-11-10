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
  paymentPeriodOf, staffTotalOnJan1, summaryCounts,
  type MunicipalityGroup, type ReportPerson, type ReportSetting,
} from "../../utils/salaryPaymentReport";
import { rollForward } from "../../utils/residentTaxPayment";
import type { SummarySheet } from "./SalaryReportSummaryView";
import { buildSalaryReportCsv, type ReportCsvCompany, type ReportCsvPerson } from "../../utils/salaryPaymentReportCsv";
import { hasMyNumberAccess, logMyNumber, type MyNumberUser } from "../mynumber/myNumberStore";
import { useMyNumberUnlock } from "../mynumber/MyNumberUnlock";
import { saveCsvFile } from "../../utils/fileSaveUtils";
import { localGovLabel } from "../../utils/localGov";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { EMPTY_NENCHO_DATA, buildNenchoRows, loadNenchoData, type NenchoData } from "./useNenchoManager";
import { OFFICIAL_SLIP_YEARS, statusOf } from "./useWithholdingSlipManager";

/**
 * 給与支払報告書を作れる年分（年末調整の表と、手引から作った区分の両方がある年分）
 * 源泉徴収票の画面の、手引が出る前の年分（仮の書き方）は入れない（給与支払報告書を出すのは翌年1月31日までで、そのころには手引が出ている）
 */
export const REPORT_YEARS = OFFICIAL_SLIP_YEARS;

export interface ReportRow extends ReportPerson {
  /** 年末調整の状況（源泉徴収票の画面と同じ） */
  status: string;
  attention: boolean;
  /** 源泉徴収票と同じ中身（CSV に書く） */
  slip: WithholdingSlip;
  /** まだ CSV に入れられない理由（年末調整がまだ・保存し直しが必要。空なら入れられる） */
  notReady: string;
  /** 給与を払った月（総括表の給与の支払期間に使う） */
  salaryMonths: number[];
}

/** 紙の総括表に書く、会社の表にない事項（salary_report_settings） */
export interface PaperSettings {
  payerKana: string; officeName: string; addressKana: string; businessType: string; taxOffice: string;
  contactDept: string; contactSection: string; contactName: string; contactPhone: string;
  accountantName: string; accountantPhone: string; paymentMethod: string; paymentSlip: "need" | "no" | "";
}

const PAPER_COLUMNS: Record<keyof PaperSettings, string> = {
  payerKana: "payer_kana", officeName: "office_name", addressKana: "address_kana", businessType: "business_type", taxOffice: "tax_office",
  contactDept: "contact_dept", contactSection: "contact_section", contactName: "contact_name", contactPhone: "contact_phone",
  accountantName: "accountant_name", accountantPhone: "accountant_phone", paymentMethod: "payment_method", paymentSlip: "payment_slip",
};

const parsePaperSettings = (row: any): PaperSettings => {
  const out = Object.fromEntries(Object.entries(PAPER_COLUMNS).map(([k, col]) => [k, String(row?.[col] ?? "")])) as unknown as PaperSettings;
  out.paymentSlip = out.paymentSlip === "need" || out.paymentSlip === "no" ? out.paymentSlip : "";
  return out;
};

/** 給与支払報告書の摘要（普通徴収の人は、理由を先に書く。CSV と同じ） */
export const reportRemarksOf = (r: ReportRow) => [r.ordinary ? r.reason : "", ...r.slip.reportRemarks].filter(Boolean);

export function useSalaryPaymentReportManager(db: Database, staffList: any[], user: MyNumberUser | null, onDataChange: () => Promise<void> | void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const unlock = useMyNumberUnlock();
  const [year, setYear] = useState(REPORT_YEARS[REPORT_YEARS.length - 1] ?? new Date().getFullYear());
  const master = getNenchoMaster(year);
  const slipMaster = getWithholdingSlipMaster(year);
  const [data, setData] = useState<NenchoData>(EMPTY_NENCHO_DATA);
  const [settings, setSettings] = useState<Record<string, ReportSetting>>({});
  const [designations, setDesignations] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<ReportCsvCompany & { zip?: string; representative?: string }>({});
  const [paper, setPaper] = useState<PaperSettings>(parsePaperSettings(null));
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  /** 印刷する市区町村（印刷している間だけ）と、書くマイナンバー */
  const [printing, setPrinting] = useState<{ code: string; numbers: Record<string, Record<string, string>> | null } | null>(null);
  /** マイナンバーを扱える（事務取扱担当者）。扱える人が書き出すときだけ、CSV に番号を書く */
  const [myNumberAccess, setMyNumberAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!db) return;
    hasMyNumberAccess(db, user).then(setMyNumberAccess).catch(() => setMyNumberAccess(false));
  }, [db, user?.id]);

  const load = async (target = year) => {
    const nencho = await loadNenchoData(db, target);
    const s = await db.select<any[]>("SELECT * FROM salary_payment_reports WHERE year = ?", [target]);
    const d = await db.select<any[]>("SELECT code, designation_number FROM resident_tax_municipalities");
    const c = await db.select<any[]>("SELECT name, zip_code, address, phone, corporate_number, representative FROM company WHERE id = 1");
    const p = await db.select<any[]>("SELECT * FROM salary_report_settings WHERE id = 1");
    const h = await db.select<any[]>("SELECT holiday_date FROM holiday_master");
    return {
      nencho,
      settings: Object.fromEntries(s.map((r) => [String(r.staff_id), parseReportSetting(r)])),
      designations: Object.fromEntries(d.map((r) => [String(r.code), String(r.designation_number ?? "")])),
      company: {
        name: c[0]?.name, address: c[0]?.address, phone: c[0]?.phone, corporateNumber: c[0]?.corporate_number,
        zip: c[0]?.zip_code ?? "", representative: c[0]?.representative ?? "",
      },
      paper: parsePaperSettings(p[0]),
      holidays: new Set(h.map((r) => String(r.holiday_date).replace(/\//g, "-"))),
    };
  };
  const apply = (loaded: Awaited<ReturnType<typeof load>>) => {
    setData(loaded.nencho);
    setSettings(loaded.settings);
    setDesignations(loaded.designations);
    setCompany(loaded.company);
    setPaper(loaded.paper);
    setHolidays(loaded.holidays);
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
          sourceDeclaration: r.exclusion && r.saved ? r.saved.declaration : null,
        }, master, slipMaster);
        const person = buildReportPerson({
          year, staff: r.staff, payment: slip.payment, withholdingTax: slip.withholdingTax,
          setting: settings[String(r.staff.id)] ?? parseReportSetting(null),
        });
        // 年末調整をする人で、まだ保存していない・保存し直しが要るときは、金額が決まっていないので CSV に入れない
        const notReady = r.exclusion ? "" : !r.saved ? "年末調整がまだです" : r.stale ? "年末調整を保存し直してください" : "";
        return { ...person, ...statusOf(r, true), slip, notReady, salaryMonths: r.totals.salaryMonths };
      });
  }, [staffList, data, year, master, slipMaster, settings]);

  const groups = useMemo(() => groupByMunicipality(rows), [rows]);

  /** 出す期限：翌年1月31日。土曜日・日曜日・祝日なら次の日（地方税法20条の5第2項、施行令6条の18第2項） */
  const deadline = useMemo(() => {
    const statutory = `${year + 1}-01-31`;
    return { statutory, due: rollForward(statutory, holidays) };
  }, [year, holidays]);

  /** 紙の総括表の中身（市区町村ごと） */
  const summarySheetOf = (g: MunicipalityGroup<ReportRow>): SummarySheet => {
    const out = g.people.filter((p) => p.submit);
    return {
      year,
      municipalityLabel: localGovLabel(g.municipality) || g.code,
      designation: designations[g.code] ?? "",
      period: paymentPeriodOf(out.map((p) => p.salaryMonths)),
      payerNumber: String(company.corporateNumber ?? "").normalize("NFKC").replace(/[^0-9]/g, "").length === 13
        ? String(company.corporateNumber).normalize("NFKC").replace(/[^0-9]/g, "") : "",
      payerKana: paper.payerKana,
      payerName: String(company.name ?? ""),
      officeName: paper.officeName || String(company.name ?? ""),
      addressKana: paper.addressKana,
      zip: String(company.zip ?? ""),
      address: String(company.address ?? ""),
      representative: String(company.representative ?? ""),
      contact: { dept: paper.contactDept, section: paper.contactSection, name: paper.contactName, phone: paper.contactPhone },
      accountant: { name: paper.accountantName, phone: paper.accountantPhone },
      businessType: paper.businessType,
      staffTotal: staffTotalOnJan1(staffList, year),
      counts: summaryCounts(out),
      taxOffice: paper.taxOffice,
      paymentMethod: paper.paymentMethod,
      paymentSlip: paper.paymentSlip,
    };
  };

  /** 紙の総括表に書く事項を保存する（変えた項目だけ渡す） */
  const savePaperSettings = async (patch: Partial<PaperSettings>) => {
    const next = { ...paper, ...patch };
    const cols = Object.values(PAPER_COLUMNS);
    try {
      await db.execute(
        `INSERT INTO salary_report_settings (id, ${cols.join(", ")}, updated_at)
         VALUES (1, ${cols.map(() => "?").join(", ")}, DATETIME('now', 'localtime'))
         ON CONFLICT(id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = excluded.updated_at`,
        (Object.keys(PAPER_COLUMNS) as (keyof PaperSettings)[]).map((k) => next[k].trim() || null)
      );
      setPaper(next);
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    }
  };

  /** 紙の総括表・個人別明細書を印刷する（市区町村ごと。事務取扱担当者が選べば、個人別明細書にマイナンバーを書く。鍵が閉じていれば開ける） */
  const printGroup = async (g: MunicipalityGroup<ReportRow>, withNumbers: boolean) => {
    let numbers: Record<string, Record<string, string>> | null = null;
    const out = g.people.filter((p) => p.submit);
    if (withNumbers) {
      try {
        numbers = await unlock.readNumbers(db, user, out.map((p) => p.staffId));
        if (!numbers) return;
        await logMyNumber(db, user, `給与支払報告書（個人別明細書）を印刷しました（${year}年分・${localGovLabel(g.municipality) || g.code}・${out.length}人。マイナンバーあり）`);
      } catch (e) {
        console.error(e);
        dialog.error(`マイナンバーを読めませんでした。\n${e}`);
        return;
      }
    }
    setPrinting({ code: g.code, numbers });
  };

  // 印刷する中身を画面に置いてから印刷し、終わったら片付ける
  useEffect(() => {
    if (!printing) return;
    const done = () => {
      setPrinting(null);
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 200);
    return () => clearTimeout(t);
  }, [printing]);

  const csvPeople = (myNumbers?: Record<string, Record<string, string>>): ReportCsvPerson[] => rows.map((r) => ({
    report: r, slip: r.slip, staffNumber: r.staffId, designationNumber: r.municipality ? designations[r.municipality.code] ?? "" : "", notReady: r.notReady,
    myNumbers: myNumbers ? myNumbers[r.staffId] ?? {} : undefined,
  }));

  /** eLTAX に取り込む CSV（画面に、入る人数と入らない人を出す。番号は書き出すときに読む） */
  const csv = useMemo(() => buildSalaryReportCsv(year, company, csvPeople()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year, company, rows, designations]);

  /** CSV を保存する（事務取扱担当者なら、登録したマイナンバーを書く。鍵が閉じていれば開ける） */
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
      const withNumbers = await hasMyNumberAccess(db, user);
      const numbers = withNumbers ? await unlock.readNumbers(db, user, rows.map((r) => r.staffId)) : null;
      if (withNumbers && !numbers) return;
      const out = numbers ? buildSalaryReportCsv(year, company, csvPeople(numbers)) : csv;
      const saved = await saveCsvFile(out.csv, `給与支払報告書_${year}年分.csv`);
      if (!saved) return;
      if (withNumbers) {
        await logMyNumber(db, user, `給与支払報告書の CSV（${year}年分・${out.count}人。本人のマイナンバー ${out.myNumbers}人分）を書き出しました：${saved.name}`);
      }
      toast.success(`「${saved.name}」を保存しました（${out.count}人・${out.municipalities}市区町村）`);
      const notes = withNumbers ? out.notes : [...out.notes, "マイナンバーは書いていません（事務取扱担当者の印がある人が書き出すと書きます）"];
      if (notes.length > 0) await dialog.warning(notes.join("\n"));
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

  return {
    year, setYear, isLoading, rows, groups, designations, csv, myNumberAccess, exportCsv, saveSetting, saveDesignation, fillFromAddress,
    deadline, paper, savePaperSettings, summarySheetOf, printGroup, printing, company,
  };
}
