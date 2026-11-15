/**
 * 資格取得届・資格喪失届の画面の状態
 * ・資格取得届：選んだ月に資格を取得した（入社した・加入した）社会保険の加入者
 * ・資格喪失届：選んだ月に退職した・亡くなった社会保険の加入者
 * 届書の中身は utils/shikakuReport.ts、ファイルは useShahoFile（年金事務所）と UnionFilePanel（健康保険組合）、
 * マイナンバーは useShahoMyNumbers（事務取扱担当者だけ。保存するときだけ番号を読む）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { SHAHO_FILE_NAME } from "../../constants/shahoTodoke";
import { checkSocialInsEnrolled } from "../../utils/calcSalary";
import { insurerOf, loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import {
  acquiredOnOf, buildShutokuRow, buildSoshitsuRow, estimatedWageOf, lossOf, type ShutokuRow, type SoshitsuRow,
} from "../../utils/shikakuReport";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { useShahoFile } from "./useShahoFile";
import { useShahoMyNumbers } from "./useShahoMyNumbers";

export type ShikakuMode = "shutoku" | "soshitsu";
export const SHIKAKU_LABELS: Record<ShikakuMode, string> = { shutoku: "資格取得届", soshitsu: "資格喪失届" };

/** 資格取得届の画面で入れるもの（1人分） */
export interface ShutokuEdit {
  include: boolean;
  acquiredOn: string;
  wage: number | null;
  dependents: boolean;
  certificate: boolean;
  shortTime: boolean;
  rehired: boolean;
  remarks: string;
}
/** 資格喪失届の画面で入れるもの（1人分） */
export interface SoshitsuEdit {
  include: boolean;
  rehired: boolean;
  remarks: string;
  returned: number | null;
  unreturned: number | null;
}

const ymOf = (date: string) => (date ? date.slice(0, 7) : "");
const enrolledOn = (staff: any, date: string) => {
  const [y, m] = date.split("-").map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && checkSocialInsEnrolled(staff, y, m);
};

export function useShikakuReportManager(db: any, staffList: any[], user: MyNumberUser | null) {
  const dialog = useMessageDialog();
  const file = useShahoFile(db);
  const my = useShahoMyNumbers(db, user);
  const [mode, setMode] = useState<ShikakuMode>("shutoku");
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [insurers, setInsurers] = useState<Map<number, HealthInsurer>>(new Map());
  const [insurerKey, setInsurerKey] = useState(0);
  const [shutokuEdits, setShutokuEdits] = useState<Record<string, ShutokuEdit>>({});
  const [soshitsuEdits, setSoshitsuEdits] = useState<Record<string, SoshitsuEdit>>({});
  const today = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const map = await loadHealthInsurers(db);
        if (!cancelled) setInsurers(map);
      } catch (e) {
        console.error("社会保険規定の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db, insurerKey]);

  // 資格取得届：その月に資格を取得した加入者（資格取得日の初めの値は入社日。履歴でのちに加入した人はその月の1日）
  const shutokuStaff = useMemo(() => staffList.filter((s) => {
    const { date } = acquiredOnOf(s);
    return ymOf(date) === month && enrolledOn(s, date);
  }), [staffList, month]);
  // 資格喪失届：その月に退職した・亡くなった加入者
  const soshitsuStaff = useMemo(() => staffList.filter((s) => {
    const loss = lossOf(s);
    return !!loss && ymOf(loss.date) === month && enrolledOn(s, loss.date);
  }), [staffList, month]);

  const shutokuEditOf = useCallback((s: any): ShutokuEdit => shutokuEdits[String(s.id)] ?? {
    include: true, acquiredOn: acquiredOnOf(s).date, wage: estimatedWageOf(s), dependents: false, certificate: false,
    shortTime: false, rehired: false, remarks: "",
  }, [shutokuEdits]);
  const soshitsuEditOf = useCallback((s: any): SoshitsuEdit => soshitsuEdits[String(s.id)] ?? {
    include: true, rehired: false, remarks: "", returned: null, unreturned: null,
  }, [soshitsuEdits]);
  const updateShutoku = (s: any, patch: Partial<ShutokuEdit>) =>
    setShutokuEdits((prev) => ({ ...prev, [String(s.id)]: { ...shutokuEditOf(s), ...patch } }));
  const updateSoshitsu = (s: any, patch: Partial<SoshitsuEdit>) =>
    setSoshitsuEdits((prev) => ({ ...prev, [String(s.id)]: { ...soshitsuEditOf(s), ...patch } }));

  const shutokuRows = useMemo(() => shutokuStaff.map((s) => {
    const e = shutokuEditOf(s);
    return {
      edit: e, fromHistory: acquiredOnOf(s).fromHistory,
      row: buildShutokuRow({
        staff: s, acquiredOn: e.acquiredOn, wage: e.wage, dependents: e.dependents, certificate: e.certificate, shortTime: e.shortTime,
        rehired: e.rehired, remarks: e.remarks, insurer: insurerOf(insurers, s.social_insurance_group_id), myNumber: my.writes(String(s.id)), today,
      }, file.office.values) as ShutokuRow,
    };
  }), [shutokuStaff, shutokuEditOf, insurers, my.writes, today, file.office]);
  const soshitsuRows = useMemo(() => soshitsuStaff.map((s) => {
    const e = soshitsuEditOf(s);
    const loss = lossOf(s)!;
    return {
      edit: e,
      row: buildSoshitsuRow({
        staff: s, cause: loss.cause, eventDate: loss.date, rehired: e.rehired, remarks: e.remarks, returned: e.returned, unreturned: e.unreturned,
        insurer: insurerOf(insurers, s.social_insurance_group_id), myNumber: my.writes(String(s.id)), today,
      }, file.office.values) as SoshitsuRow,
    };
  }), [soshitsuStaff, soshitsuEditOf, insurers, my.writes, today, file.office]);

  const rows = (mode === "shutoku" ? shutokuRows : soshitsuRows) as { edit: { include: boolean }; row: ShutokuRow | SoshitsuRow }[];
  const included = rows.filter((r) => r.edit.include).map((r) => r.row);
  const blocked = [...new Set(included.flatMap((r) => r.problems.map((p) => `${r.name}：${p}`)))];
  if (included.length === 0) blocked.unshift("届ける人を選んでください");
  const dataLines = included.length > 0 ? included.map((r) => r.values.join(",")) : null;
  const label = SHIKAKU_LABELS[mode];

  /** 年金事務所に出すファイルを保存する（マイナンバーを書く人がいれば、鍵を開けて番号を入れる） */
  const save = useCallback(async () => {
    if (blocked.length > 0) {
      dialog.warning(blocked.join("\n"));
      return;
    }
    const resolved = await my.resolve(included.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values })));
    if (!resolved) return;
    const ok = await file.exportFile(resolved.lines.map((v) => v.join(",")), label, included.length, resolved.count > 0 ? `マイナンバーあり ${resolved.count}人分` : "");
    if (ok && resolved.count > 0) await my.logWritten(label, resolved.count, SHAHO_FILE_NAME);
  }, [blocked, included, my, file, label, dialog]);

  const onUnionSaved = useCallback(async (myNumbers: number) => {
    if (myNumbers > 0) await my.logWritten(`${label}（健康保険組合）`, myNumbers, "KPFD0006.CSV");
    setInsurerKey((k) => k + 1);
  }, [my, label]);

  return {
    mode, setMode, month, setMonth, file, my, insurers, today,
    shutokuRows, soshitsuRows, updateShutoku, updateSoshitsu,
    included, blocked, dataLines, label, save, onUnionSaved,
  };
}
