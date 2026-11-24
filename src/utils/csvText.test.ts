/**
 * 人が表計算ソフト（Excel など）で開く CSV を、式として読まれないように書く（見直しの P5。utils/csvText.ts と、
 * shared/timeqard の guardSpreadsheetText）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CSV_HEADERS,
  csvCheckProblem,
  guardSpreadsheetText,
  parseCsv,
  parseCsvRecords,
  verifyCsvChecks,
  writeTimeQardCsv,
  type TimeQardCsvRow,
} from "../../shared/timeqard";
import { importCheckProblem, readAttendanceImport } from "./attendanceImport";
import { csvField } from "./csvText";
import { generateAttendanceCSV } from "./csvUtils";
import { leaveLedgerCsv } from "./leaveLedger";
import { rosterCsv, rosterRowOf } from "./legalBooks";
import { payListColumns, payListCsv, payListRows, type PayDocPerson } from "./payReports";

describe("式として読まれないようにする（guardSpreadsheetText）", () => {
  test("字の頭が =・+・-・@（全角の＝・＋・－・＠も）・タブ・CR なら、頭に ' を付ける", () => {
    for (const s of ["=1+1", '=HYPERLINK("http://example.com","見る")', "+81-3-1234-5678", "-田中", "-1+2", "@SUM(A1:A3)", "\t=1+1", "\r=1+1", "＝１＋１", "＋α", "－調整", "＠メモ", "=", "-"]) {
      expect(guardSpreadsheetText(s)).toBe(`'${s}`);
    }
  });

  test("ほかの字・空・数字だけのもの（マイナスの額など。表計算ソフトは数として読む）はそのまま", () => {
    for (const s of ["", "山田 太郎", "1001", "2026-11-24", "8:30", "12:00-13:00", "a=b", "メモ@会議", "'=1+1", "-1200", "+3.5", "-12,000", "-0.25", "1,234"]) {
      expect(guardSpreadsheetText(s)).toBe(s);
    }
  });
});

describe("CSV の1つの欄（csvField）", () => {
  test("' を付けてから、「,」「\"」・改行があれば \"\" で囲む。null・undefined は空。数はそのまま", () => {
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("=SUM(A1,A2)")).toBe(`"'=SUM(A1,A2)"`);
    expect(csvField('@a"b')).toBe(`"'@a""b"`);
    expect(csvField("山田, 太郎")).toBe('"山田, 太郎"');
    expect(csvField("1行め\n2行め")).toBe('"1行め\n2行め"');
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(-1200)).toBe("-1200");
    expect(csvField(0)).toBe("0");
  });

  test("頭が「\"」の値も \"\" で囲むので、読むと頭が「\"」のまま（「\"」の内側が式として読まれない）", () => {
    expect(csvField('"=1+1"')).toBe('"""=1+1"""');
    expect(parseCsv(csvField('"=1+1"'))).toEqual([['"=1+1"']]);
  });
});

describe("人が見る一覧表の CSV", () => {
  test("勤怠の詳細：名前・休暇の種類・備考の頭が = などなら ' を付ける", () => {
    const row = {
      staff_id: "1001", staff_name: "=1+1", work_date: "2026-11-04", csv_entry_time: "09:00", csv_exit_time: "18:00", csv_breaks: null,
      entry_time: "", exit_time: "", breaks: null, work_type: "normal", leave_name: "-調整", leave_paid: 1, paid_leave_hours: 0, memo: "@SUM(A1)", is_finalized: 0,
    };
    const lines = generateAttendanceCSV([row], "full").split("\n");
    expect(lines[1].split(",")).toEqual(["1001", "'=1+1", "2026-11-04", "09:00", "18:00", "", "", "", "", "", "normal", "'-調整", "0", "'@SUM(A1)", "0"]);
  });

  test("勤怠の詳細：頭が「\"」の備考も、読むと頭が「\"」のまま（「\"」の内側の =… が式として読まれない）", () => {
    const row = {
      staff_id: "1001", staff_name: "山田", work_date: "2026-11-04", csv_entry_time: "09:00", csv_exit_time: "18:00", csv_breaks: null,
      entry_time: "", exit_time: "", breaks: null, work_type: "normal", leave_name: "", leave_paid: 1, paid_leave_hours: 0,
      memo: '"=HYPERLINK(""http://example.com"")"', is_finalized: 0,
    };
    const csv = generateAttendanceCSV([row], "full");
    const [, values] = parseCsv(csv.replace(/^﻿/, ""));
    expect(values[13]).toBe('"=HYPERLINK(""http://example.com"")"');
    expect(values.slice(0, 5)).toEqual(["1001", "山田", "2026-11-04", "09:00", "18:00"]);
  });

  test("労働者名簿（賃金台帳・出勤簿も同じ書き方）：名前・履歴の頭が = などなら ' を付け、「,」があれば \"\" で囲む", () => {
    const lines = rosterCsv([rosterRowOf({ id: "1001", name: "=1+1", address: "東京都千代田区1-1", career_history: "-2003年4月 入社, 総務" })]).split("\r\n");
    expect(lines[1].startsWith("1001,'=1+1,")).toBe(true);
    expect(lines[1].endsWith(`,"'-2003年4月 入社, 総務"`)).toBe(true);
  });

  test("年次有給休暇管理簿：名前の頭が + なら ' を付ける", () => {
    const ledger = {
      hoursPerDay: 8, dayMinutes: 480, asOf: "2026-11-24", beforeFirstGrant: [], shortage: [],
      grants: [{ grantDate: "2026-10-01", expiryDate: "2028-09-30", grantedDays: 10, taken: [], takenMinutes: 0, expiredMinutes: 0, remainingMinutes: 4800, state: "active" as const, fiveDays: null }],
    };
    const lines = leaveLedgerCsv([{ staffId: "1001", name: "+田中", ledger }]).split("\r\n");
    expect(lines[1].startsWith("1001,'+田中,2026-10-01,2028-09-30,10,")).toBe(true);
  });

  test("支給控除一覧表：名前と、支給・控除の行の名前の頭が - などなら ' を付ける。マイナスの額はそのまま", () => {
    const person: PayDocPerson = {
      staffId: "1001", name: "=1+1", branchName: "本店", totalEarnings: 0, totalDeductions: 0, netPay: 0,
      ledger: {
        periodStart: "2026-10-01", periodEnd: "2026-10-31", workDays: 20, workHours: 160, overtimeHours: 0, holidayHours: 0, nightHours: 0,
        earnings: [{ name: "基本給", amount: 300000 }, { name: "-調整", amount: -5000 }], deductions: [{ name: "所得税", amount: 7000 }],
        totalEarnings: 295000, totalDeductions: 7000, netPay: 288000, yearEndSettlement: 0,
      },
    };
    const columns = payListColumns([person], false);
    const lines = payListCsv("2026年11月支給 支給控除一覧表", columns, payListRows([person])).split("\r\n");
    const head = lines[1].split(",");
    const values = lines[2].split(",");
    const at = (label: string) => values[head.indexOf(label)];
    expect(head).toContain("'-調整");
    expect(values[2]).toBe("'=1+1");
    expect(at("'-調整")).toBe("-5000");
    expect(at("基本給")).toBe("300000");
  });
});

describe("TimeQard の打刻の CSV", () => {
  const MARK = "K7M3QP2X";
  const KEY = "K7M3QP2X".repeat(6) + "ABCD";
  const row = (o: Partial<TimeQardCsvRow>): TimeQardCsvRow => ({
    staffId: "1001", name: "山田 太郎", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" }, breaks: [], requests: {}, requestBreaks: [],
    noBreakRequest: false, requestReason: "", cardless: [], web: [], notes: [], companyMark: MARK, ...o,
  });

  test("名前の頭が = などなら ' を付ける（ほかの列は付けない）。確かめの印は合い、Q の取り込みは変わらない", async () => {
    const csv = await writeTimeQardCsv([row({ name: "=1+1" }), row({ date: "2026-11-05", name: "-田中" }), row({ date: "2026-11-06" })], { key: KEY });
    const { records } = parseCsvRecords(csv);
    expect(records.map((r) => r.values[CSV_HEADERS.name])).toEqual(["'=1+1", "'-田中", "山田 太郎"]);
    expect(records.map((r) => r.values[CSV_HEADERS.staffId])).toEqual(["1001", "1001", "1001"]);
    // 確かめの印は、名前を入れずに計算するので合う
    const check = await verifyCsvChecks(records, KEY, (r) => [r.values[CSV_HEADERS.staffId]]);
    expect(check.checkedRows).toBe(3);
    expect(csvCheckProblem(check)).toBe(false);
    // Q は CSV の名前を使わない（名前は Q の従業員の名前）
    const read = await readAttendanceImport(csv, { staff: [{ id: "1001", name: "山田 太郎" }], companyMark: MARK, csvKey: KEY });
    expect(importCheckProblem(read.check)).toBe(false);
    expect(read.rows.map((r) => [r.name, r.date, r.times.entry, r.times.exit])).toEqual([
      ["山田 太郎", "2026-11-04", "09:00", "18:00"],
      ["山田 太郎", "2026-11-05", "09:00", "18:00"],
      ["山田 太郎", "2026-11-06", "09:00", "18:00"],
    ]);
  });
});

describe("どの CSV に付けるか", () => {
  const SRC = join(import.meta.dir, "..");
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  test("人が見る一覧表の CSV は、どれも csvField を通す（ほかの書き方を残さない）", () => {
    for (const f of [
      "utils/legalBooks.ts",
      "utils/leaveLedger.ts",
      "utils/payReports.ts",
      "features/nencho/NenchoListView.tsx",
      "features/payroll/PremiumSummaryManager.tsx",
      "features/payroll/PayReportManager.tsx",
    ]) {
      const text = read(f);
      expect(text).toContain("csvField");
      expect(text).not.toContain("csvEscape");
      expect(text).not.toContain(`replace(/"/g, '""')`);
    }
    expect(read("utils/csvUtils.ts")).toContain("csvField(cell(v))");
  });

  test("決まった形のファイル（届書の電子申請用ファイル・eLTAX・e-Tax・仕訳データ）には付けない（入れたとおりに書く）", () => {
    for (const f of [
      "utils/shahoCsv.ts",
      "utils/koyoCsv.ts",
      "utils/salaryPaymentReportCsv.ts",
      "utils/residentTaxIdou.ts",
      "utils/residentTaxPaymentCsv.ts",
      "utils/retirementReports.ts",
      "utils/payJournal.ts",
    ]) {
      expect(read(f)).not.toMatch(/csvField|guardSpreadsheetText/);
    }
  });
});
