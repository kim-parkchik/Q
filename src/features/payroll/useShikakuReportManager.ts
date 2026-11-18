/**
 * 資格取得届・資格喪失届の画面の状態
 * ・資格取得届：選んだ月に資格を取得した（入社した・加入した）社会保険の加入者
 * ・資格喪失届：選んだ月に退職した・亡くなった社会保険の加入者と、健康保険だけの資格を失った人（75歳の誕生日・後期高齢者医療の障害認定）
 * 届書の中身は utils/shikakuReport.ts、ファイルは useShahoFile（年金事務所）と UnionFilePanel（健康保険組合）、
 * マイナンバーは useShahoMyNumbers（事務取扱担当者だけ。保存するときだけ番号を読む）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { branchPrefectureOf } from "../../utils/branchPrefecture";
import { checkSocialInsEnrolled, prescribedWorkDays } from "../../utils/calcSalary";
import { insurerOf, loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import {
  acquiredOnOf, buildShutokuRow, buildSoshitsuRow, estimatedInKindOf, estimatedWageOf, isHealthOnlyLoss, isOtherLoss, lossEventsOf,
  type LossCause, type ShutokuRow, type SoshitsuRow,
} from "../../utils/shikakuReport";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { age70Form } from "../../utils/printForms";
import { parseHealthDependents } from "../../utils/healthDependents";
import { reach70Date } from "../../utils/shahoPerson";
import { useShahoFile } from "./useShahoFile";
import { useShahoMyNumbers } from "./useShahoMyNumbers";

export type ShikakuMode = "shutoku" | "soshitsu" | "age70";
export const SHIKAKU_LABELS: Record<ShikakuMode, string> = { shutoku: "資格取得届", soshitsu: "資格喪失届", age70: "70歳到達届" };

/** 70歳到達届の画面で入れるもの（1人分） */
export interface Age70Edit {
  submittedOn: string;
  /** 70歳到達日の報酬月額（通貨）。null は月給の人の見込み */
  wage: number | null;
  /** 報酬月額（現物）。null は「現物で払う報酬」などからの見込み */
  inKind: number | null;
  shortTime: boolean;
  remarks: string;
}

/** 資格取得届の画面で入れるもの（1人分） */
export interface ShutokuEdit {
  include: boolean;
  acquiredOn: string;
  wage: number | null;
  /** 報酬月額（現物）。null は従業員の画面の「現物で払う報酬」などからの見込み */
  inKind: number | null;
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
  /** 拠点（現物の価額は、勤務地の都道府県のもの） */
  const [branches, setBranches] = useState<any[]>([]);
  const [insurerKey, setInsurerKey] = useState(0);
  const [shutokuEdits, setShutokuEdits] = useState<Record<string, ShutokuEdit>>({});
  const [soshitsuEdits, setSoshitsuEdits] = useState<Record<string, SoshitsuEdit>>({});
  const [age70Edits, setAge70Edits] = useState<Record<string, Age70Edit>>({});
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
      try {
        const rows = await db.select("SELECT id, name, prefecture FROM branches ORDER BY id ASC");
        if (!cancelled) setBranches(rows ?? []);
      } catch (e) {
        console.error("拠点の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db, insurerKey]);

  // 資格取得届：その月に資格を取得した加入者（資格取得日の初めの値は入社日。履歴でのちに加入した人はその月の1日）
  const shutokuStaff = useMemo(() => staffList.filter((s) => {
    const { date } = acquiredOnOf(s);
    return ymOf(date) === month && enrolledOn(s, date);
  }), [staffList, month]);
  // 資格喪失届：その月に退職した・亡くなった加入者と、健康保険だけの資格を失った加入者（75歳の誕生日・障害認定の日。
  // 国民健康保険組合の人は、国保組合で手続きするので入れない）
  // 社会保障協定・任意喪失は、その月の分から加入していないので、前の月に加入していたかで見る
  const soshitsuEvents = useMemo(() => staffList.flatMap((s) => lossEventsOf(s)
    .filter((e) => ymOf(e.date) === month
      && enrolledOn(s, isOtherLoss(e.cause) ? dayjs(`${ymOf(e.date)}-01`).subtract(1, "day").format("YYYY-MM-DD") : e.date)
      && !(isHealthOnlyLoss(e.cause) && insurerOf(insurers, s.social_insurance_group_id)?.type === "kokuho"))
    .map((e) => ({ staff: s, cause: e.cause as LossCause, date: e.date, key: `${s.id}:${e.cause}` }))), [staffList, month, insurers]);

  const shutokuEditOf = useCallback((s: any): ShutokuEdit => shutokuEdits[String(s.id)] ?? {
    // 被扶養者の有無：従業員の画面の「健康保険の被扶養者」に、外れていない人がいれば「あり」（被扶養者（異動）届も出す）
    include: true, acquiredOn: acquiredOnOf(s).date, wage: estimatedWageOf(s), inKind: null,
    dependents: parseHealthDependents(s.health_dependents).some((d) => !d.until), certificate: false,
    shortTime: false, rehired: false, remarks: "",
  }, [shutokuEdits]);
  const soshitsuEditOf = useCallback((key: string): SoshitsuEdit => soshitsuEdits[key] ?? {
    include: true, rehired: false, remarks: "", returned: null, unreturned: null,
  }, [soshitsuEdits]);
  const updateShutoku = (s: any, patch: Partial<ShutokuEdit>) =>
    setShutokuEdits((prev) => ({ ...prev, [String(s.id)]: { ...shutokuEditOf(s), ...patch } }));
  /** 資格喪失届の画面で入れるもの（key は「従業員ID:喪失の原因」。同じ月に75歳になって退職した人は2行） */
  const updateSoshitsu = (key: string, patch: Partial<SoshitsuEdit>) =>
    setSoshitsuEdits((prev) => ({ ...prev, [key]: { ...soshitsuEditOf(key), ...patch } }));

  const shutokuRows = useMemo(() => shutokuStaff.map((s) => {
    const e = shutokuEditOf(s);
    // 報酬月額（現物）の見込み：社宅・食事など（勤務地の都道府県の価額）と、定期券などで渡す通勤手当。画面で直したらその額
    const [y, m] = (e.acquiredOn || today).split("-").map(Number);
    const estimate = estimatedInKindOf(s, e.acquiredOn, branchPrefectureOf(branches, s.branch_id).prefecture, prescribedWorkDays(s, y, m));
    const inKind = e.inKind ?? estimate.amount;
    const row = buildShutokuRow({
      staff: s, acquiredOn: e.acquiredOn, wage: e.wage, inKind, dependents: e.dependents, certificate: e.certificate, shortTime: e.shortTime,
      rehired: e.rehired, remarks: e.remarks, insurer: insurerOf(insurers, s.social_insurance_group_id), myNumber: my.writes(String(s.id)), today,
    }, file.office.values) as ShutokuRow;
    if (e.inKind === null && estimate.problems.length > 0) {
      row.notes.push(`現物の見込みを出せないものがあります（${estimate.problems.join("。")}）。現物の額を入れてください`);
    }
    return { edit: e, fromHistory: acquiredOnOf(s).fromHistory, inKind, row };
  }), [shutokuStaff, shutokuEditOf, insurers, branches, my.writes, today, file.office]);
  const soshitsuRows = useMemo(() => soshitsuEvents.map(({ staff: s, cause, date, key }) => {
    const e = soshitsuEditOf(key);
    return {
      key, edit: e,
      row: buildSoshitsuRow({
        staff: s, cause, eventDate: date, rehired: e.rehired, remarks: e.remarks, returned: e.returned, unreturned: e.unreturned,
        insurer: insurerOf(insurers, s.social_insurance_group_id), myNumber: my.writes(String(s.id)), today,
      }, file.office.values) as SoshitsuRow,
    };
  }), [soshitsuEvents, soshitsuEditOf, insurers, my.writes, today, file.office]);

  // 70歳到達届：その月に70歳に達する（誕生日の前日が来る）厚生年金の被保険者（入社した日より後で、退職していない人）
  const age70Staff = useMemo(() => staffList.filter((s) => {
    if (!s.birthday) return false;
    const reached = reach70Date(s.birthday);
    return ymOf(reached) === month && enrolledOn(s, reached) && (!s.join_date || s.join_date < reached) && (!s.retirement_date || s.retirement_date >= reached);
  }), [staffList, month]);
  const age70EditOf = useCallback((s: any): Age70Edit => age70Edits[String(s.id)] ?? {
    submittedOn: today, wage: null, inKind: null, shortTime: false, remarks: "",
  }, [age70Edits, today]);
  const updateAge70 = (s: any, patch: Partial<Age70Edit>) =>
    setAge70Edits((prev) => ({ ...prev, [String(s.id)]: { ...age70EditOf(s), ...patch } }));
  const age70Forms = useMemo(() => age70Staff.map((s) => {
    const e = age70EditOf(s);
    const reached = reach70Date(s.birthday);
    const [y, m] = reached.split("-").map(Number);
    const estimate = estimatedInKindOf(s, reached, branchPrefectureOf(branches, s.branch_id).prefecture, prescribedWorkDays(s, y, m));
    const wage = e.wage ?? estimatedWageOf(s);
    return {
      staff: s, edit: e, wage, inKind: e.inKind ?? estimate.amount,
      form: age70Form({ staff: s, submittedOn: e.submittedOn, wage, inKind: e.inKind ?? estimate.amount, shortTime: e.shortTime, remarks: e.remarks, myNumber: my.writes(String(s.id)) }),
    };
  }), [age70Staff, age70EditOf, branches, my.writes]);

  const rows = (mode === "shutoku" ? shutokuRows : mode === "soshitsu" ? soshitsuRows : []) as { edit: { include: boolean }; row: ShutokuRow | SoshitsuRow }[];
  /** 届ける人（健康保険組合に出す行も入れる） */
  const included = rows.filter((r) => r.edit.include).map((r) => r.row);
  /** 年金事務所に出す人（健康保険組合の人の75歳到達・障害認定は、組合にだけ出す） */
  const toOffice = included.filter((r) => !("toOffice" in r) || r.toOffice);
  const blocked = [...new Set(toOffice.flatMap((r) => r.problems.map((p) => `${r.name}：${p}`)))];
  if (toOffice.length === 0) blocked.unshift(included.length === 0 ? "届ける人を選んでください" : "年金事務所に出す人はいません（健康保険組合にだけ出す人です）");
  const dataLines = toOffice.length > 0 ? toOffice.map((r) => r.values.join(",")) : null;
  const label = SHIKAKU_LABELS[mode];

  /** 年金事務所に出すファイルを保存する（マイナンバーを書く人がいれば、鍵を開けて番号を入れる） */
  const save = useCallback(async () => {
    if (blocked.length > 0) {
      dialog.warning(blocked.join("\n"));
      return;
    }
    await my.saveFile(file, toOffice.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values })), label, toOffice.length);
  }, [blocked, toOffice, my, file, label, dialog]);

  const onUnionSaved = useCallback(async (myNumbers: number) => {
    if (myNumbers > 0) await my.logWritten(`${label}（健康保険組合）`, myNumbers, "KPFD0006.CSV");
    setInsurerKey((k) => k + 1);
  }, [my, label]);

  return {
    mode, setMode, month, setMonth, file, my, insurers, today,
    shutokuRows, soshitsuRows, updateShutoku, updateSoshitsu, age70Forms, updateAge70,
    included, toOffice, blocked, dataLines, label, save, onUnionSaved,
  };
}
