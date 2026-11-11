/**
 * Q の勤怠の「CSV 取り込み」の、取り込む前のまとめ（src/features/attendance/AttendanceImportButton.tsx）を、
 * 見本の CSV で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/import.html を開く
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PreviewDialog } from "../../src/features/attendance/AttendanceImportButton";
import { planAttendanceImport, readAttendanceImport, type ExistingDay } from "../../src/utils/attendanceImport";

const MARK = "K7M3QP2X";
const csv = [
  "スタッフID,名前,日付,出勤,退勤,休憩始,休憩終,外出,戻り,申出_出勤,申出_退勤,申出_休憩始,申出_休憩終,申出_外出,申出_戻り,申出_休憩なし,申出_理由,カードなし,注意,会社の印,形式",
  `1001,山田 太郎,2026/11/4,8:58,18:02,12:00,13:00,,,,,,,,,,,,,${MARK},TimeQard 1`,
  `1002,佐藤 花子,2026-11-04,,17:31,,,,,09:00,,,,,,,出勤：押し忘れた,退勤,出勤がありません,${MARK},TimeQard 1`,
  `1002,佐藤 花子,2026-11-05,08:50,17:00,,,,,,19:00,,,,,,退勤：押し間違えた（会議が長引いた）,,,${MARK},TimeQard 1`,
  `1003,鈴木 一郎,2026-11-04,22:00,06:05,02:00,02:45,,,,,,,,,,,,2回目の休憩（04:00〜04:10）は Q に入りません,${MARK},TimeQard 1`,
  `1004,確定 済子,2026-11-04,09:00,18:00,,,,,,,,,,,,,,,${MARK},TimeQard 1`,
  `9999,知らない 人,2026-11-04,09:00,18:00,,,,,,,,,,,,,,,${MARK},TimeQard 1`,
  `1001,山田 太郎,2026-11-05,9時,18:00,,,,,,,,,,,,,,,${MARK},TimeQard 1`,
  `1001,山田 太郎,2026-11-06,09:00,18:00,,,,,,,,,,,○,休憩なし：休憩を取れなかった（来客が続いた）,,,${MARK},TimeQard 1`,
].join("\r\n");

const staff = [
  { id: "1001", name: "山田 太郎" },
  { id: "1002", name: "佐藤 花子" },
  { id: "1003", name: "鈴木 一郎" },
  { id: "1004", name: "確定 済子" },
];
const blank = { entry: "", exit: "", break_start: "", break_end: "", out: "", return: "" };
const existing = new Map<string, ExistingDay>([
  ["1004\u00002026-11-04", { finalized: true, manual: blank, memo: "" }],
  ["1002\u00002026-11-05", { finalized: false, manual: { ...blank, exit: "19:30" }, memo: "" }],
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
