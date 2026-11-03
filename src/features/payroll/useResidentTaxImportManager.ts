/**
 * 「住民税の取り込み」の画面の状態とデータ操作
 * eLTAX で受け取る特別徴収税額通知（特別徴収義務者用）の CSV を読み、従業員の住民税（年度の12か月）に入れる。
 * 読み方・結び付け方は utils/residentTaxNotice.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { localGovByCode, type LocalGov } from "../../utils/localGov";
import { fiscalYearOf, residentTaxScheduleOf, stringifyResidentTaxSchedule } from "../../utils/residentTax";
import {
  compareWithSchedule, decodeNoticeFile, matchNoticeRecord, parseResidentTaxNotice, withNoticeAmounts,
  type NoticeMatch, type NoticeRecord,
} from "../../utils/residentTaxNotice";

export interface ImportRow {
  key: string;
  file: string;
  record: NoticeRecord;
  municipality: LocalGov | null;
  match: NoticeMatch;
  /** 選んだ従業員（空なら取り込まない） */
  staffId: string;
  staff: any | null;
  /** いまの額と比べて（new：その年度の額がまだない / same：同じ / changed：違う） */
  status: "new" | "same" | "changed" | null;
  /** 取り込む前に確かめてほしいこと */
  notes: string[];
  checked: boolean;
}

/** 通知が届く5月からは、その年の6月から始まる年度を初めに出す */
export const defaultNoticeFiscalYear = (today = new Date()) => {
  const y = today.getFullYear();
  return today.getMonth() + 1 >= 5 ? y : fiscalYearOf(y, today.getMonth() + 1);
};

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

export function useResidentTaxImportManager(db: Database, staffList: any[], onDataChange: () => Promise<void> | void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [fiscalYear, setFiscalYear] = useState(defaultNoticeFiscalYear());
  const [loaded, setLoaded] = useState<{ key: string; file: string; record: NoticeRecord }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const [designations, setDesignations] = useState<Record<string, string>>({});

  const loadDesignations = async () => {
    const d = await db.select<any[]>("SELECT code, designation_number FROM resident_tax_municipalities");
    setDesignations(Object.fromEntries(d.map((r) => [String(r.code), String(r.designation_number ?? "")])));
  };
  useEffect(() => {
    if (db) loadDesignations().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  /** CSV を選んで読む（いくつでも。前に読んだものは入れ替える） */
  const pickFiles = async () => {
    try {
      const selected = await open({ multiple: true, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const next: typeof loaded = [];
      const errs: string[] = [];
      for (const path of paths) {
        const name = baseName(String(path));
        const { records, errors: e } = parseResidentTaxNotice(decodeNoticeFile(await readFile(String(path))));
        records.forEach((record) => next.push({ key: `${name}#${record.line}`, file: name, record }));
        e.forEach((m) => errs.push(`${name}：${m}`));
        if (records.length === 0 && e.length === 0) errs.push(`${name}：中身がありません`);
      }
      setLoaded(next);
      setErrors(errs);
      setChoice({});
      setUnchecked({});
    } catch (e) {
      console.error(e);
      dialog.error(`CSV を読めませんでした。\n${e}`);
    }
  };

  const rows: ImportRow[] = useMemo(() => {
    const base = loaded.map(({ key, file, record }) => {
      const match = matchNoticeRecord(record, staffList);
      const staffId = choice[key] ?? match.staffId ?? "";
      const staff = staffList.find((s) => String(s.id) === staffId) ?? null;
      const status = staff ? compareWithSchedule(residentTaxScheduleOf(staff), fiscalYear, record.amounts) : null;
      return { key, file, record, municipality: localGovByCode(record.code), match, staffId, staff, status };
    });
    const count = new Map<string, number>();
    base.forEach((r) => r.staffId && count.set(r.staffId, (count.get(r.staffId) ?? 0) + 1));
    return base.map((r) => {
      const notes = [...r.record.warnings];
      if (!r.municipality) notes.push(`市町村コード ${r.record.code} は、Q の一覧にありません`);
      if (r.staffId && (count.get(r.staffId) ?? 0) > 1) notes.push("同じ従業員に、2行以上が結び付いています。どちらかを外してください");
      const own = String(r.staff?.resident_tax_municipality ?? "").trim();
      if (r.staff && own && own !== r.record.code) {
        notes.push(`従業員の画面の市区町村（${localGovByCode(own)?.name ?? own}）と違います。取り込んでも、従業員の画面の市区町村は変えません`);
      }
      const saved = designations[r.record.code] ?? "";
      if (saved && r.record.designationNumber && saved !== r.record.designationNumber) {
        notes.push(`指定番号が、給与支払報告書の画面の番号（${saved}）と違います（通知：${r.record.designationNumber}）`);
      }
      const duplicate = !!r.staffId && (count.get(r.staffId) ?? 0) > 1;
      const checked = !!r.staff && r.status !== "same" && !duplicate && !unchecked[r.key];
      return { ...r, notes, checked };
    });
  }, [loaded, staffList, choice, unchecked, fiscalYear, designations]);

  const choose = (key: string, staffId: string) => setChoice({ ...choice, [key]: staffId });
  const toggle = (key: string, on: boolean) => setUnchecked({ ...unchecked, [key]: !on });

  /** 選んだ行の額を、その年度の12か月に入れる */
  const apply = async () => {
    const targets = rows.filter((r) => r.checked && r.staff);
    if (targets.length === 0) return;
    const ok = await ask(
      `${targets.length}人の${fiscalYear}年度（${fiscalYear}年6月分〜${fiscalYear + 1}年5月分）の住民税を、通知の額にします。\n\n`
      + targets.map((r) => `・${r.staff.name}：年税額 ${r.record.annual.toLocaleString()}円（6月分 ${r.record.amounts[0].toLocaleString()}円）`).join("\n")
      + "\n\n確定した給与明細の住民税は変わりません。",
      { title: "住民税を入れる", kind: "info" }
    );
    if (!ok) return;
    try {
      for (const r of targets) {
        const schedule = withNoticeAmounts(residentTaxScheduleOf(r.staff), fiscalYear, r.record.amounts, r.municipality ? r.record.code : undefined);
        // 市区町村がまだ空なら、通知の市区町村を入れる（入っていれば変えない）
        await db.execute(
          `UPDATE staff SET resident_tax_schedule = ?,
             resident_tax_municipality = CASE WHEN COALESCE(TRIM(resident_tax_municipality), '') = '' THEN ? ELSE resident_tax_municipality END
           WHERE id = ?`,
          [stringifyResidentTaxSchedule(schedule), r.municipality ? r.record.code : null, r.staffId]
        );
      }
      // 指定番号・宛名番号がまだ入っていない市区町村には、通知の番号を入れる（入っていれば変えない）
      const filled = new Set<string>();
      for (const r of targets) {
        const { code, designationNumber, atenaNumber } = r.record;
        if (!r.municipality || (!designationNumber && !atenaNumber) || filled.has(code)) continue;
        await db.execute(
          `INSERT INTO resident_tax_municipalities (code, designation_number, atena_number, updated_at)
           VALUES (?, ?, ?, DATETIME('now', 'localtime'))
           ON CONFLICT(code) DO UPDATE SET
             designation_number = COALESCE(NULLIF(TRIM(designation_number), ''), excluded.designation_number),
             atena_number = COALESCE(NULLIF(TRIM(atena_number), ''), excluded.atena_number),
             updated_at = excluded.updated_at`,
          [code, designationNumber || null, atenaNumber || null]
        );
        if (!designations[code] && designationNumber) filled.add(code);
      }
      toast.success(`${targets.length}人の住民税を入れました${filled.size > 0 ? `（指定番号 ${filled.size}か所も）` : ""}`);
      setLoaded([]);
      setErrors([]);
      await loadDesignations();
      await onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`住民税を入れられませんでした。\n${e}`);
    }
  };

  return { fiscalYear, setFiscalYear, rows, errors, pickFiles, choose, toggle, apply, loadedCount: loaded.length };
}
