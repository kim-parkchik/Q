/**
 * Q の勤怠の「CSV 取り込み」の、取り込む前のまとめ（src/features/attendance/AttendanceImportButton.tsx）を、
 * 見本の CSV で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/import.html を開く
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PreviewDialog } from "../../src/features/attendance/AttendanceImportButton";
import { planAttendanceImport, readAttendanceImport, type ExistingDay } from "../../src/utils/attendanceImport";
import { writeTimeQardCsv, type TimeQardCsvRow } from "../../shared/timeqard";

const MARK = "K7M3QP2X";
// 見本の CSV（shared/timeqard の書き方で作る。TimeQard が書き出すものと同じ形）
const row = (o: Partial<TimeQardCsvRow> & Pick<TimeQardCsvRow, "staffId" | "name" | "date">): TimeQardCsvRow => ({
  times: { entry: "", exit: "" }, breaks: [], requests: {}, requestBreaks: [], noBreakRequest: false, requestReason: "",
  cardless: [], web: [], notes: [], companyMark: MARK, ...o,
});
const csv = writeTimeQardCsv([
  row({ staffId: "1001", name: "山田 太郎", date: "2026-11-04", times: { entry: "08:58", exit: "18:02" }, breaks: [{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:10" }] }),
  row({ staffId: "1002", name: "佐藤 花子", date: "2026-11-04", times: { entry: "", exit: "17:31" }, requests: { entry: "09:00" }, requestReason: "出勤：押し忘れた", cardless: ["exit"], notes: ["出勤がありません"] }),
  row({ staffId: "1002", name: "佐藤 花子", date: "2026-11-05", times: { entry: "08:50", exit: "17:00" }, requests: { exit: "19:00" }, requestReason: "退勤：押し間違えた（会議が長引いた）" }),
  row({ staffId: "1003", name: "鈴木 一郎", date: "2026-11-04", times: { entry: "22:00", exit: "06:05" }, breaks: [{ start: "02:00", end: "02:45" }, { start: "04:00", end: "04:10" }] }),
  row({ staffId: "1004", name: "確定 済子", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" } }),
  row({ staffId: "9999", name: "知らない 人", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" } }),
  row({
    staffId: "1001", name: "山田 太郎", date: "2026-11-05", times: { entry: "09:00", exit: "18:00" }, breaks: [{ start: "12:00", end: "" }],
    requestBreaks: [{ start: "12:00", end: "13:00" }, { start: "15:00", end: "17:00" }], requestReason: "休憩（12:00〜13:00）：押し忘れた／休憩（15:00〜17:00）：そのほか（病院）",
    notes: ["休憩終がありません（休憩始 12:00）"],
  }),
  row({ staffId: "1001", name: "山田 太郎", date: "2026-11-06", times: { entry: "09:00", exit: "18:00" }, noBreakRequest: true, requestReason: "休憩なし：休憩を取れなかった（来客が続いた）" }),
  row({ staffId: "1003", name: "鈴木 一郎", date: "2026-11-06", times: { entry: "09:02", exit: "18:10" }, web: ["entry", "exit"] }),
]);

const staff = [
  { id: "1001", name: "山田 太郎" },
  { id: "1002", name: "佐藤 花子" },
  { id: "1003", name: "鈴木 一郎" },
  { id: "1004", name: "確定 済子" },
];
const blank = { entry: "", exit: "" };
const existing = new Map<string, ExistingDay>([
  ["1004\u00002026-11-04", { finalized: true, manual: blank, manualBreaks: null, memo: "" }],
  ["1002\u00002026-11-05", { finalized: false, manual: { ...blank, exit: "19:30" }, manualBreaks: null, memo: "" }],
]);
const plan = planAttendanceImport(readAttendanceImport(csv, { staff, companyMark: MARK }), existing);

function Page() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <PreviewDialog
      preview={{ fileName: "確かめ用株式会社_打刻_2026-11-01〜2026-11-30.csv", plan }}
      selected={selected}
      setSelected={setSelected}
      busy={false}
      onCancel={() => console.info("やめる")}
      onImport={() => console.info("取り込む", [...selected])}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Page />);
