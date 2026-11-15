/**
 * 産休・育休の申出書の画面の状態
 * ・産前産後休業取得者申出書／変更（終了）届、育児休業等取得者申出書（新規・延長）／終了届
 * ・従業員の画面の「休業・休職」に入れた期間ごとに1行。ファイルを保存したら、届け出た内容を期間に残し（staff.leave_periods の reported）、
 *   あとで期間を直したら、出す届書（変更・延長・終了）を出す（utils/leaveReport.ts の suggestSankyuKind・suggestIkukyuKind）
 * ファイルは useShahoFile（年金事務所に出す SHFD0006.CSV。産休・育休の申出書は健康保険組合に出すファイルの形がないので、
 * 健康保険組合の人は、組合の決まりで別に出す）、マイナンバーは useShahoMyNumbers
 */
import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { SHAHO_FILE_NAME } from "../../constants/shahoTodoke";
import { writeLog } from "../../utils/logUtils";
import { parseLeavePeriods, stringifyLeavePeriods, type LeavePeriod } from "../../utils/leaveExemption";
import {
  IKUKYU_KIND_LABELS, SANKYU_KIND_LABELS, buildIkukyuRow, buildSankyuRow, childcareReportedOf, maternityReportedOf, suggestIkukyuKind,
  suggestSankyuKind, type ChildcareReported, type IkukyuKind, type LeaveReportRow, type MaternityReported, type SankyuKind,
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
  /** 申出のときに届けた内容（変更・延長・終了の共通記載欄。直さなければ期間に残したもの） */
  reported: MaternityReported | ChildcareReported;
  workDays: number;
  remarks: string;
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
  const today = dayjs().format("YYYY-MM-DD");
  const type = mode === "sankyu" ? "maternity" : "childcare";

  // 休業の期間（新しい順）と、次に出す届書
  const periods = useMemo(() => staffList.flatMap((s) => parseLeavePeriods(s.leave_periods).map((leave, index) => ({ staff: s, leave, index })))
    .filter((p) => p.leave.type === type)
    .map((p) => ({ ...p, suggest: type === "maternity" ? suggestSankyuKind(p.leave) : suggestIkukyuKind(p.leave) }))
    .sort((a, b) => b.leave.start.localeCompare(a.leave.start)), [staffList, type]);
  const shown = useMemo(() => (onlyPending ? periods.filter((p) => p.suggest !== null) : periods), [periods, onlyPending]);

  const editOf = useCallback((staffId: string, index: number, leave: LeavePeriod, suggest: string | null): LeaveEdit => edits[keyOf(staffId, index)] ?? {
    include: suggest !== null,
    kind: suggest ?? (leave.type === "maternity" ? "change" : "extend"),
    reported: leave.type === "maternity" ? maternityReportedOf(leave) : childcareReportedOf(leave),
    workDays: 0,
    remarks: "",
  }, [edits]);
  const update = (staffId: string, index: number, leave: LeavePeriod, suggest: string | null, patch: Partial<LeaveEdit>) =>
    setEdits((prev) => ({ ...prev, [keyOf(staffId, index)]: { ...editOf(staffId, index, leave, suggest), ...patch } }));

  const rows = useMemo(() => shown.map(({ staff, leave, index, suggest }) => {
    const e = editOf(String(staff.id), index, leave, suggest);
    const myNumber = my.writes(String(staff.id));
    const row: LeaveReportRow = leave.type === "maternity"
      ? buildSankyuRow({
        staff, leaveIndex: index, leave, kind: e.kind as SankyuKind, reported: e.kind === "apply" ? null : e.reported as MaternityReported,
        remarks: e.remarks, myNumber, today,
      }, file.office.values)
      : buildIkukyuRow({
        staff, leaveIndex: index, leave, kind: e.kind as IkukyuKind, reported: e.kind === "apply" ? null : e.reported as ChildcareReported,
        workDays: e.workDays, remarks: e.remarks, myNumber, today,
        sameMonthLeaves: parseLeavePeriods(staff.leave_periods).filter((p) => p.type === "childcare" && p.start.slice(0, 7) === leave.start.slice(0, 7)).length,
      }, file.office.values);
    return { staff, leave, index, suggest, edit: e, row };
  }), [shown, editOf, my.writes, today, file.office]);

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
    const resolved = await my.resolve(included.map((r) => ({ staffId: r.staffId, values: r.values })));
    if (!resolved) return;
    const ok = await file.exportFile(resolved.lines.map((v) => v.join(",")), label, included.length, resolved.count > 0 ? `マイナンバーあり ${resolved.count}人分` : "");
    if (!ok) return;
    if (resolved.count > 0) await my.logWritten(label, resolved.count, SHAHO_FILE_NAME);
    try {
      for (const staffId of [...new Set(included.map((r) => r.staffId))]) {
        const staff = staffList.find((s) => String(s.id) === staffId);
        const leaves = parseLeavePeriods(staff?.leave_periods);
        for (const r of included.filter((x) => x.staffId === staffId)) {
          if (leaves[r.leaveIndex]) leaves[r.leaveIndex] = { ...leaves[r.leaveIndex], reported: r.reported };
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
