/**
 * 勤怠の CSV の書き出し
 *
 * ・raw（打刻ログ）：スタッフID・日付・出勤・退勤・休憩（打刻の値）。勤怠の「CSV 取り込み」でそのまま取り込める形。
 * ・full（詳細）：打刻と修正（手入力）の両方と、勤務区分・時間有給・備考・確定したか。
 * ・休憩は一覧で書く（「12:00-13:00 15:00-15:10」。shared/timeqard/spans.ts。TimeQard の CSV と同じ書き方）。
 *   時間有給にした中抜けは、「時間有給の中抜け」の列に分けて書く。
 */
import { formatSpanList } from "../../shared/timeqard";
import { formatBreakList, formatLeaveList, parseBreaksJson } from "./breaks";

const RAW_HEADER = ["スタッフID", "日付", "出勤", "退勤", "休憩"];
const FULL_HEADER = [
  "スタッフID", "名前", "日付",
  "打刻_出勤", "打刻_退勤", "打刻_休憩",
  "修正_出勤", "修正_退勤", "修正_休憩", "時間有給の中抜け",
  "区分", "有給h", "備考", "確定",
];

/** 文の中の改行・「,」を空白にする（CSV の列がずれないように） */
const cell = (v: unknown) => String(v ?? "").replace(/[\n\r,]/g, " ");

/**
 * 勤怠の CSV を作る（Excel で文字化けしないよう、BOM を付ける）
 * @param data 勤怠の行（attendance の列。full は名前（staff_name）も）
 */
export const generateAttendanceCSV = (data: any[], mode: "raw" | "full"): string => {
  if (!data || data.length === 0) return "";
  const rows = data.map((row) => {
    const punched = parseBreaksJson(row.csv_breaks) ?? [];
    if (mode === "raw") {
      return [row.staff_id, row.work_date, row.csv_entry_time || "", row.csv_exit_time || "", formatSpanList(punched)].map(cell).join(",");
    }
    // 修正の休憩は、手入力した一覧があるときだけ書く（ないときは打刻を使っている）
    const manual = parseBreaksJson(row.breaks);
    return [
      row.staff_id,
      row.staff_name || "",
      row.work_date,
      row.csv_entry_time || "",
      row.csv_exit_time || "",
      formatSpanList(punched),
      row.entry_time || "",
      row.exit_time || "",
      manual ? formatBreakList(manual) : "",
      manual ? formatLeaveList(manual) : "",
      row.work_type || "normal",
      row.paid_leave_hours || 0,
      row.memo || "",
      Number(row.is_finalized) === 1 ? "1" : "0",
    ].map(cell).join(",");
  });
  const bom = "﻿";
  return bom + [(mode === "raw" ? RAW_HEADER : FULL_HEADER).join(","), ...rows].join("\n");
};
