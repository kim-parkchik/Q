/**
 * Q の勤怠の「CSV 取り込み」（src/features/attendance/AttendanceImportButton.tsx）を、見本の CSV で確かめる（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/import.html を開く
 * ・上のボタンで見本の CSV を選ぶと（ファイルを選ぶ窓の代わりに、見本の CSV を渡す）、本物の「CSVファイルを読み込む」の流れで、取り込む前のまとめが出る
 *   - 「書き出したままの CSV」：TimeQard の書き方（shared/timeqard）で、見本の鍵で確かめの印を付けたもの。まとめの「確かめ」の行に、印が合うと出る
 *   - 「時刻を書き換えた CSV」：上の CSV の、山田さんの 11月4日の退勤を 18:02 → 17:00 に書き換え、鈴木さんの 11月6日の行を消したもの。
 *     「TimeQard の印が合いません」の窓が出る。「取り込まない」ならまとめを出さず、「このまま取り込む」なら、まとめの「確かめ」の行に赤で出る
 *   - 「印のない CSV」：手で作った CSV（会社の印・確かめの列がない）。まとめの「確かめ」の行に、TimeQard の印がないことを出す
 * ・会社ファイルの代わりの db は、TimeQard の設定（会社の印・鍵）と勤怠（確定した日など）を返し、「取り込む」で書く文と操作の記録を
 *   window.__importPreview（batches・logs）に入れる（本物の書き込みは src/utils/attendanceImport.test.ts で確かめている）
 */
import { createRoot } from "react-dom/client";
import AttendanceImportButton from "../../src/features/attendance/AttendanceImportButton";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { ToastProvider } from "../../src/components/Toast";
import { writeTimeQardCsv, type TimeQardCsvRow } from "../../shared/timeqard";

const MARK = "K7M3QP2X";
/** 打刻の CSV の確かめの印の鍵（見本。TimeQard の確かめ用の画面 dev/preview.html と同じ） */
const KEY = "K7M3QP2X".repeat(6) + "ABCD";
// 見本の CSV（shared/timeqard の書き方で作る。TimeQard が書き出すものと同じ形）
const row = (o: Partial<TimeQardCsvRow> & Pick<TimeQardCsvRow, "staffId" | "name" | "date">): TimeQardCsvRow => ({
  times: { entry: "", exit: "" }, breaks: [], requests: {}, requestBreaks: [], noBreakRequest: false, requestReason: "",
  cardless: [], web: [], notes: [], companyMark: MARK, ...o,
});
const signed = await writeTimeQardCsv([
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
], { key: KEY });
// 書き出したあとに、Excel などで書き換えたつもり（山田さんの 11月4日の退勤を早くし、鈴木さんの 11月6日の行を消す）
const changed = signed
  .split("\r\n")
  .map((l) => (l.startsWith("1001,山田 太郎,2026-11-04,") ? l.replace(",18:02,", ",17:00,") : l))
  .filter((l) => !l.startsWith("1003,鈴木 一郎,2026-11-06,"))
  .join("\r\n");
// 手で作った CSV（TimeQard の印がない）
const plain = "スタッフID,日付,出勤,退勤,休憩\r\n1001,2026-11-10,09:00,18:00,12:00-13:00\r\n1002,2026-11-10,08:55,17:40,\r\n";

const CASES = [
  { id: "signed", label: "書き出したままの CSV", name: "確かめ用株式会社_打刻_2026-11-01〜2026-11-30.csv", text: signed },
  { id: "changed", label: "時刻を書き換えた CSV", name: "確かめ用株式会社_打刻_2026-11-01〜2026-11-30（書き換え）.csv", text: changed },
  { id: "plain", label: "印のない CSV", name: "手で作った打刻.csv", text: plain },
];

const staff = [
  { id: "1001", name: "山田 太郎" },
  { id: "1002", name: "佐藤 花子" },
  { id: "1003", name: "鈴木 一郎" },
  { id: "1004", name: "確定 済子" },
];
const attendance = [
  { staff_id: "1004", work_date: "2026-11-04", is_finalized: 1, entry_time: "", exit_time: "", breaks: null, memo: "", break_none: 0 },
  { staff_id: "1002", work_date: "2026-11-05", is_finalized: 0, entry_time: "", exit_time: "19:30", breaks: null, memo: "", break_none: 0 },
];

/** 「取り込む」で書く文と、操作の記録（app_logs に入れる値） */
const state = { batches: [] as { sql: string; values?: unknown[] }[][], logs: [] as unknown[][] };
(window as any).__importPreview = state;

/** 会社ファイルの代わり */
const db = {
  select: async (sql: string) => {
    if (sql.includes("FROM timeqard_settings")) return [{ company_mark: MARK, csv_key: KEY, last_export_at: null, last_export_fingerprint: null }];
    if (sql.includes("FROM attendance")) return attendance;
    return [];
  },
  execute: async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO app_logs")) state.logs.push(values);
    return { rowsAffected: 1, lastInsertId: 0 };
  },
  executeBatch: async (statements: { sql: string; values?: unknown[] }[]) => {
    state.batches.push(statements);
    return statements.map(() => ({ rowsAffected: 1, lastInsertId: 0 }));
  },
};

// ファイルを選ぶ窓の代わりに、選んだ見本の CSV を渡す（TimeQard と同じく、BOM を付けた UTF-8）
let nextFile: File | null = null;
const click = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
  if (this.type !== "file" || !nextFile) return click.call(this);
  const transfer = new DataTransfer();
  transfer.items.add(nextFile);
  this.files = transfer.files;
  this.onchange?.call(this, new Event("change"));
};

function Page() {
  const pick = (c: (typeof CASES)[number]) => {
    nextFile = new File(["﻿" + c.text], c.name, { type: "text/csv" });
    document.querySelector<HTMLButtonElement>("[data-import-button] button")?.click();
  };
  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        {CASES.map((c) => (
          <button key={c.id} data-case={c.id} onClick={() => pick(c)}>{c.label}</button>
        ))}
      </div>
      <div data-import-button>
        <AttendanceImportButton db={db} staffList={staff} userName="管理者（admin）" onImported={() => console.info("取り込みました")} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <ToastProvider>
    <MessageDialogProvider>
      <Page />
    </MessageDialogProvider>
  </ToastProvider>
);
