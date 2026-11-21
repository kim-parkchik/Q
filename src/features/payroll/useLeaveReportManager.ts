/**
 * 産休・育休の申出書の画面の状態
 * ・産前産後休業取得者申出書／変更（終了）届、育児休業等取得者申出書（新規・延長）／終了届
 * ・従業員の画面の「休業・休職」に入れた期間ごとに1行（同じ月のうちに始まって終わる育休が2つ以上ある月は、まとめて1行にし、
 *   育休等取得内訳に書く。utils/leaveReport.ts の sameMonthChildcareGroups）。ファイルを保存したら、届け出た内容を期間に残し（staff.leave_periods の reported）、
 *   あとで期間を直したら、出す届書（変更・延長・終了）を出す（utils/leaveReport.ts の suggestSankyuKind・suggestIkukyuKind）
 * ファイルは useShahoFile（年金事務所に出す SHFD0006.CSV。産休・育休の申出書は健康保険組合に出すファイルの形がないので、
 * 健康保険組合の人は、組合の決まりで別に出す）、マイナンバーは useShahoMyNumbers
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { insurerOf, loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { SHAHO_FILE_NAME } from "../../constants/shahoTodoke";
import { writeLog } from "../../utils/logUtils";
import { parseLeavePeriods, stringifyLeavePeriods, type LeavePeriod } from "../../utils/leaveExemption";
import {
  IKUKYU_KIND_LABELS, SANKYU_KIND_LABELS, buildIkukyuRow, buildSankyuRow, childcareGroupReportedOf, childcareReportedOf, maternityReportedOf,
  sameMonthChildcareGroups, suggestIkukyuGroupKind, suggestIkukyuKind, suggestSankyuKind,
  type ChildcareReported, type IkukyuKind, type LeaveReportRow, type MaternityReported, type SankyuKind,
} from "../../utils/leaveReport";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { useShahoFile } from "./useShahoFile";
import { useShahoMyNumbers } from "./useShahoMyNumbers";

export type LeaveReportMode = "sankyu" | "ikukyu";
export const LEAVE_REPORT_LABELS: Record<LeaveReportMode, string> = {
  sankyu: "産前産後休業取得者申出書／変更（終了）届",
  ikukyu: "育児休業等取得者申出書（新規・延長）／終了届",
};

/** 画面で入れるもの（期間ごと） */
export interface LeaveEdit {
  include: boolean;
  kind: string;
  /**
   * 申出のときに届けた内容（変更・延長・終了の共通記載欄。直さなければ期間に残したもの）。
   * 育児休業等の就業予定日数は、従業員の画面の育児休業の行（産後パパ育休で働かせる時間）から数える（utils/leaveExemption.ts の papaLeaveWorkDays）
   */
  reported: MaternityReported | ChildcareReported;
  remarks: string;
}

/** 画面の1行の元（期間か、同じ月の育休をまとめたもの） */
export interface LeaveItem {
  key: string;
  staff: any;
  /** 期間（まとめた行は、初めの期間） */
  leave: LeavePeriod;
  index: number;
  /** 同じ月のうちに始まって終わる育休をまとめた行の、期間（開始日の順） */
  group: { leave: LeavePeriod; index: number }[] | null;
  suggest: string | null;
}

/** 期間を見分ける印 */
const keyOf = (staffId: string, index: number) => `${staffId}#${index}`;

export function useLeaveReportManager(db: any, staffList: any[], user: MyNumberUser | null, onDataChange: () => Promise<void> | void) {
  const dialog = useMessageDialog();
  const file = useShahoFile(db);
  const my = useShahoMyNumbers(db, user);
  const [mode, setMode] = useState<LeaveReportMode>("sankyu");
  /** 届け出るものだけ出す（届けた内容のままの期間は出さない） */
  const [onlyPending, setOnlyPending] = useState(true);
  const [edits, setEdits] = useState<Record<string, LeaveEdit>>({});
  /** 健康保険の保険者（健康保険組合の人は、組合にも申出書を出す。仕様書に組合に出すファイルの形がないので、組合の様式で） */
  const [insurers, setInsurers] = useState<Map<number, HealthInsurer>>(new Map());
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
  }, [db]);
  const today = dayjs().format("YYYY-MM-DD");
  const type = mode === "sankyu" ? "maternity" : "childcare";

  // 休業の期間（新しい順）と、次に出す届書。同じ月のうちに始まって終わる育休が2つ以上あれば、まとめて1行
  const periods = useMemo((): LeaveItem[] => staffList.flatMap((s) => {
    const leaves = parseLeavePeriods(s.leave_periods);
    const groups = type === "childcare" ? sameMonthChildcareGroups(leaves) : [];
    const grouped = new Set(groups.flat());
    const singles: LeaveItem[] = leaves.map((leave, index) => ({ leave, index }))
      .filter((p) => p.leave.type === type && !grouped.has(p.index))
      .map((p) => ({
        key: keyOf(String(s.id), p.index), staff: s, leave: p.leave, index: p.index, group: null,
        suggest: type === "maternity" ? suggestSankyuKind(p.leave) : suggestIkukyuKind(p.leave),
      }));
    const merged: LeaveItem[] = groups.map((g) => ({
      key: `${s.id}#g${g.join(",")}`, staff: s, leave: leaves[g[0]], index: g[0],
      group: g.map((i) => ({ leave: leaves[i], index: i })), suggest: suggestIkukyuGroupKind(g.map((i) => leaves[i])),
    }));
    return [...singles, ...merged];
  }).sort((a, b) => b.leave.start.localeCompare(a.leave.start)), [staffList, type]);
  const shown = useMemo(() => (onlyPending ? periods.filter((p) => p.suggest !== null) : periods), [periods, onlyPending]);

  const editOf = useCallback((item: LeaveItem): LeaveEdit => edits[item.key] ?? {
    include: item.suggest !== null,
    kind: item.suggest ?? (item.leave.type === "maternity" ? "change" : "extend"),
    reported: item.leave.type === "maternity" ? maternityReportedOf(item.leave)
      : item.group ? childcareGroupReportedOf(item.group.map((g) => g.leave)) : childcareReportedOf(item.leave),
    remarks: "",
  }, [edits]);
  const update = (item: LeaveItem, patch: Partial<LeaveEdit>) =>
    setEdits((prev) => ({ ...prev, [item.key]: { ...editOf(item), ...patch } }));

  const rows = useMemo(() => shown.map((item) => {
    const { staff, leave, index } = item;
    const e = editOf(item);
    const myNumber = my.writes(String(staff.id));
    const row: LeaveReportRow = leave.type === "maternity"
      ? buildSankyuRow({
        staff, leaveIndex: index, leave, kind: e.kind as SankyuKind, reported: e.kind === "apply" ? null : e.reported as MaternityReported,
        remarks: e.remarks, myNumber, today,
      }, file.office.values)
      : buildIkukyuRow({
        staff, leaveIndex: index, leave, kind: e.kind as IkukyuKind, reported: e.kind === "apply" ? null : e.reported as ChildcareReported,
        remarks: e.remarks, myNumber, today,
        group: item.group?.map((g) => ({ leave: g.leave, leaveIndex: g.index })),
      }, file.office.values);
    const insurer = insurerOf(insurers, staff.social_insurance_group_id);
    if (insurer?.type === "union") {
      row.notes.push(`健康保険組合（${insurer.name}）にも、組合の様式で申出書を出します（下の「健康保険組合に出す申出書」。電子申請用のファイルの形が仕様書にないので、内容を印刷します）`);
    }
    return { ...item, edit: e, row, union: insurer?.type === "union" ? insurer : null };
  }), [shown, editOf, my.writes, today, file.office, insurers]);

  const included = rows.filter((r) => r.edit.include).map((r) => r.row);
  const blocked = [...new Set(included.flatMap((r) => r.problems.map((p) => `${r.name}：${p}`)))];
  if (included.length === 0) blocked.unshift("届け出る期間を選んでください");
  const dataLines = included.length > 0 ? included.map((r) => r.values.join(",")) : null;
  const label = LEAVE_REPORT_LABELS[mode];
  const kindLabels: Record<string, string> = mode === "sankyu" ? SANKYU_KIND_LABELS : IKUKYU_KIND_LABELS;

  /** ファイルを保存し、届け出た内容を期間に残す（次に期間を直したら、出す届書がわかるように） */
  const save = useCallback(async () => {
    if (blocked.length > 0) {
      dialog.warning(blocked.join("\n"));
      return;
    }
    const resolved = await my.resolve(included.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values })));
    if (!resolved) return;
    const ok = await file.exportFile(resolved.lines.map((v) => v.join(",")), label, included.length, resolved.count > 0 ? `マイナンバーあり ${resolved.count}人分` : "");
    if (!ok) return;
    if (resolved.count > 0) await my.logWritten(label, resolved.count, SHAHO_FILE_NAME);
    try {
      for (const staffId of [...new Set(included.map((r) => r.staffId))]) {
        const staff = staffList.find((s) => String(s.id) === staffId);
        const leaves = parseLeavePeriods(staff?.leave_periods);
        for (const r of included.filter((x) => x.staffId === staffId)) {
          // 同じ月の育休をまとめた届書は、期間ごとに届け出た内容を残す
          for (const { leaveIndex, reported } of r.group ?? [{ leaveIndex: r.leaveIndex, reported: r.reported }]) {
            if (leaves[leaveIndex]) leaves[leaveIndex] = { ...leaves[leaveIndex], reported };
          }
        }
        await db.execute("UPDATE staff SET leave_periods = ? WHERE id = ?", [stringifyLeavePeriods(leaves) || null, staffId]);
      }
      await writeLog(db, "INFO", "staff", `${label}で届け出た内容を、休業の期間に残しました（${included.length}件）`);
      setEdits({});
      await onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`ファイルは保存しましたが、届け出た内容を休業の期間に残せませんでした。\n${e}`);
    }
  }, [blocked, included, my, file, label, dialog, staffList, db, onDataChange]);

  return {
    mode, setMode, onlyPending, setOnlyPending, file, my, today, rows, update, included, blocked, dataLines, label, kindLabels, save,
    total: periods.length,
  };
}
