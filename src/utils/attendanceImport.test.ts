/**
 * 勤怠の CSV 取り込みの確かめ（attendanceImport.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIMEQARD_CSV_HEADERS, writeTimeQardCsv, type TimeQardCsvRow } from "../../shared/timeqard";
import { DB_SCHEMAS } from "../types/dbSchema";
import {
  decodeCsvBytes,
  importCheckLogText,
  importCheckMessage,
  importCheckProblem,
  importCheckSummary,
  importStatements,
  NO_TIMEQARD_MARK_NOTE,
  planAttendanceImport,
  readAttendanceImport,
  reasonForKind,
  type ExistingDay,
} from "./attendanceImport";
import { applyBreakRequests, parseBreaksJson } from "./breaks";

const MARK = "K7M3QP2X";
/** この会社ファイルの、打刻の CSV の確かめの印の鍵（52文字） */
const KEY = "K7M3QP2X".repeat(6) + "ABCD";
const staff = [
  { id: "1001", name: "山田 太郎" },
  { id: "1002", name: "佐藤 花子" },
  { id: "0012", name: "先頭 ゼロ" },
];

/** TimeQard の CSV（shared/timeqard の書き方で作る） */
const tqRow = (o: Partial<TimeQardCsvRow> & Pick<TimeQardCsvRow, "staffId" | "date">): TimeQardCsvRow => ({
  name: staff.find((s) => s.id === o.staffId)?.name ?? "",
  times: { entry: "", exit: "" },
  breaks: [],
  requests: {},
  requestBreaks: [],
  noBreakRequest: false,
  requestReason: "",
  cardless: [],
  web: [],
  notes: [],
  companyMark: MARK,
  ...o,
});
const tq = (...rows: TimeQardCsvRow[]) => writeTimeQardCsv(rows, { key: KEY });
/** 形式を書き換える（新しい形式の CSV を作る） */
const withFormat = (csv: string, format: string) => csv.replaceAll("TimeQard 2", format);

describe("TimeQard の CSV：会社の印と形式を確かめる", () => {
  test("この会社ファイルの印なら読む。休憩は「休憩」の列の一覧を読む", async () => {
    const r = await readAttendanceImport(
      await tq(tqRow({ staffId: "1001", date: "2026-11-04", times: { entry: "08:58", exit: "18:02" }, breaks: [{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:10" }] })),
      { staff, companyMark: MARK, csvKey: KEY }
    );
    expect(r.error).toBeNull();
    expect(r.fromTimeQard).toBe(true);
    expect(r.companyMark).toBe(MARK);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].times).toEqual({ entry: "08:58", exit: "18:02" });
    expect(r.rows[0].breaks).toEqual([{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:10" }]);
    expect(r.period).toEqual({ from: "2026-11-04", to: "2026-11-04" });
  });

  test("ほかの会社の印なら、何も取り込まない", async () => {
    const r = await readAttendanceImport(await tq(tqRow({ staffId: "1001", date: "2026-11-04", companyMark: "ABCD2345" })), { staff, companyMark: MARK, csvKey: KEY });
    expect(r.error).toContain("ほかの会社の打刻です");
    expect(r.error).toContain("ABCD 2345");
    expect(r.rows).toEqual([]);
  });

  test("まだ従業員ファイルを書き出していない会社ファイルには、TimeQard の CSV を取り込まない", async () => {
    const r = await readAttendanceImport(await tq(tqRow({ staffId: "1001", date: "2026-11-04" })), { staff, companyMark: null, csvKey: null });
    expect(r.error).toContain("まだ TimeQard の従業員ファイルを書き出していません");
  });

  test("新しい形式・いくつかの印が混ざった CSV・前の形（休憩が1組だけの形・確かめの印がない形 1）は取り込まない", async () => {
    const one = await tq(tqRow({ staffId: "1001", date: "2026-11-04" }));
    expect((await readAttendanceImport(withFormat(one, "TimeQard 3"), { staff, companyMark: MARK, csvKey: KEY })).error).toContain("Q を新しくしてから");
    const mixed = await tq(tqRow({ staffId: "1001", date: "2026-11-04" }), tqRow({ staffId: "1002", date: "2026-11-04", companyMark: "ABCD2345" }));
    expect((await readAttendanceImport(mixed, { staff, companyMark: MARK, csvKey: KEY })).error).toContain("いくつかの会社の印");
    const old = "スタッフID,名前,日付,出勤,退勤,休憩始,休憩終,外出,戻り,会社の印,形式\r\n" + `1001,山田 太郎,2026-11-04,08:58,18:02,12:00,13:00,,,${MARK},TimeQard 1\r\n`;
    expect((await readAttendanceImport(old, { staff, companyMark: MARK, csvKey: KEY })).error).toContain("前の形の TimeQard の CSV");
    // 形 1（確かめの列がない）
    const v1 = "スタッフID,名前,日付,出勤,退勤,休憩,会社の印,形式\r\n" + `1001,山田 太郎,2026-11-04,08:58,18:02,12:00-13:00,${MARK},TimeQard 1\r\n`;
    expect((await readAttendanceImport(v1, { staff, companyMark: MARK, csvKey: KEY })).error).toBe(
      "前の形の TimeQard の CSV です（確かめの印がない形）。TimeQard を新しくして、CSV を書き出し直してください。"
    );
  });

  test("カードなし・ブラウザ・注意・申し出（出勤・退勤・休憩）の列を読む", async () => {
    const r = await readAttendanceImport(
      await tq(
        tqRow({
          staffId: "1002",
          date: "2026-11-04",
          times: { entry: "", exit: "17:31" },
          requests: { entry: "09:00" },
          requestBreaks: [{ start: "12:00", end: "13:00" }],
          requestReason: "出勤：押し忘れた／休憩（12:00〜13:00）：押し忘れた",
          cardless: ["exit"],
          web: ["break_start"],
          notes: ["出勤がありません"],
        })
      ),
      { staff, companyMark: MARK, csvKey: KEY }
    );
    expect(r.rows[0].cardless).toEqual(["exit"]);
    expect(r.rows[0].web).toEqual(["break_start"]);
    expect(r.rows[0].notes).toEqual(["出勤がありません"]);
    expect(r.rows[0].requests).toEqual({ entry: "09:00" });
    expect(r.rows[0].requestBreaks).toEqual([{ start: "12:00", end: "13:00" }]);
    expect(r.rows[0].requestReason).toBe("出勤：押し忘れた／休憩（12:00〜13:00）：押し忘れた");
  });

  test("見出しは17列（終わりに「確かめ」）", async () => {
    expect(TIMEQARD_CSV_HEADERS.length).toBe(17);
    expect(TIMEQARD_CSV_HEADERS[16]).toBe("確かめ");
  });
});

describe("TimeQard の CSV：確かめの印（書き出したあとの書き換え）", () => {
  const rows = () => [
    tqRow({ staffId: "1001", date: "2026-11-04", times: { entry: "08:58", exit: "18:02" }, breaks: [{ start: "12:00", end: "13:00" }] }),
    tqRow({ staffId: "0012", date: "2026-11-04", times: { entry: "09:00", exit: "17:31" } }),
    tqRow({ staffId: "1002", date: "2026-11-05", times: { entry: "", exit: "17:31" }, requests: { entry: "09:00" }, requestReason: "出勤：押し忘れた", cardless: ["exit"] }),
  ];
  const read = (csv: string, csvKey: string | null = KEY) => readAttendanceImport(csv, { staff, companyMark: MARK, csvKey });
  const lines = async () => (await tq(...rows())).split("\r\n");

  test("書き出したままなら、どの行も印が合う（Excel で保存し直して、日付・時刻の形が変わり、ID の先頭の 0 が消えても合う）", async () => {
    const r = await read(await tq(...rows()));
    expect(r.error).toBeNull();
    expect(r.check).toEqual({ checkedRows: 3, changedRows: [], noCheckRows: [], copiedRows: [], missingRows: 0, mixed: false, noKey: false });
    expect(importCheckProblem(r.check)).toBe(false);
    expect(importCheckSummary(r.check!)).toBe("3行すべて、TimeQard の印が合っています（書き出したあと、書き換えられていません）");
    expect(importCheckLogText(r)).toBe("印が合う");
    expect(r.noTimeQardMark).toBe(false);
    const [header, a, b, c, ...rest] = await lines();
    const excel = [header, a.replace("2026-11-04", "2026/11/4").replace("08:58", "8:58"), b.replace("0012,", "12,"), c, ...rest].join("\r\n");
    const fixed = await read(excel);
    expect(fixed.fixedIds).toEqual([{ csvId: "12", staffId: "0012" }]);
    expect(fixed.fixedValues).toBe(2);
    expect(importCheckProblem(fixed.check)).toBe(false);
  });

  test("時刻を書き換えた行は、知らせの文で行を示し、取り込むかを聞く（読むのはやめない）", async () => {
    const [header, a, b, c, ...rest] = await lines();
    const r = await read([header, a.replace("18:02", "17:00"), b, c, ...rest].join("\r\n"));
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.times.exit)).toEqual(["17:00", "17:31", "17:31"]);
    expect(r.check?.changedRows).toEqual([2]);
    expect(importCheckProblem(r.check)).toBe(true);
    const message = importCheckMessage(r.check!);
    expect(message).toContain("この CSV は、TimeQard で書き出したあとに書き換えられています（TimeQard の印が合いません）。");
    expect(message).toContain("・中身が、書き出したときと違う行：2行目");
    expect(message).toContain("TimeQard で書き出し直した CSV を取り込んでください");
    expect(message).toContain("勤怠の画面の修正の欄で直してください（打刻の時刻と直した時刻が、どちらも残ります）");
    expect(message).toContain("「このまま取り込む」を選ぶと、書き換えたあとの時刻を、打刻の時刻として取り込みます（操作の記録に残します）。");
    expect(message).not.toContain("どの行も合わないときは");
    expect(importCheckSummary(r.check!)).toBe("TimeQard の印が合いません（中身が違う行 2行目）");
    expect(importCheckLogText(r)).toBe("印が合わないまま取り込んだ（中身が違う行 2行目）");
  });

  test("消した行・足した行・写した行・確かめの列を消した CSV・鍵が違う CSV も知らせる", async () => {
    const [header, a, b, c, ...rest] = await lines();
    const deleted = await read([header, a, c, ...rest].join("\r\n"));
    expect(importCheckMessage(deleted.check!)).toContain("・書き出したときより、1行足りません（消した行があります）");
    const added = await read([header, a, b, c, "1002,佐藤 花子,2026-11-06,09:00,18:00,,,,,,,,,," + MARK + ",TimeQard 2,", ...rest].join("\r\n"));
    expect(importCheckMessage(added.check!)).toContain("・確かめの印がない行（あとから足した行など）：5行目");
    expect(added.rows.length).toBe(4);
    const copied = await read([header, a, b, b, c, ...rest].join("\r\n"));
    expect(importCheckMessage(copied.check!)).toContain("・同じ行が2つ以上あります（写した行）：4行目");
    const noColumn = await read((await lines()).map((l) => l.replace(/,[^,]*$/, "")).join("\r\n"));
    expect(noColumn.check?.noCheckRows).toEqual([2, 3, 4]);
    const otherKey = await read(await tq(...rows()), "A".repeat(52));
    expect(otherKey.check?.changedRows).toEqual([2, 3, 4]);
    expect(importCheckMessage(otherKey.check!)).toContain("どの行も合わないときは、TimeQard に読み込んである従業員ファイルが、この会社ファイルで書き出したものかも確かめてください。");
    // Q の従業員にない ID の行も、印は確かめる（その行は入れない）
    const unknown = await read(await tq(tqRow({ staffId: "9999", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" } })));
    expect(unknown.unknownIds).toEqual([{ id: "9999", rows: 1 }]);
    expect(importCheckProblem(unknown.check)).toBe(false);
  });

  test("行の番号は、多ければ初めの10行と、ほかの行の数", async () => {
    const many = Array.from({ length: 12 }, (_, i) => tqRow({ staffId: "1001", date: `2026-11-${String(i + 1).padStart(2, "0")}`, times: { entry: "09:00", exit: "18:00" } }));
    const csv = (await tq(...many)).replaceAll(",09:00,18:00,", ",09:00,17:00,");
    const r = await read(csv);
    expect(importCheckMessage(r.check!)).toContain("・中身が、書き出したときと違う行：2行目・3行目・4行目・5行目・6行目・7行目・8行目・9行目・10行目・11行目 ほか 2行");
  });

  test("この会社ファイルに鍵がなければ、確かめられないことを知らせ、取り込むかを聞く", async () => {
    const r = await read(await tq(...rows()), null);
    expect(r.error).toBeNull();
    expect(r.check?.noKey).toBe(true);
    expect(importCheckProblem(r.check)).toBe(true);
    expect(importCheckMessage(r.check!)).toContain("この会社ファイルには、TimeQard の CSV の印を確かめる鍵がない");
    expect(importCheckMessage(r.check!)).toContain("「このまま取り込む」を選ぶと、確かめずに取り込みます（操作の記録に残します）。");
    expect(importCheckLogText(r)).toBe("鍵がないので、印を確かめずに取り込んだ");
  });

  test("TimeQard を使っている会社（会社の印がある）で、TimeQard の印のない CSV は、知らせてから取り込む", async () => {
    const plain = "スタッフID,日付,出勤,退勤\n1001,2026-11-04,08:58,18:02\n";
    const used = await readAttendanceImport(plain, { staff, companyMark: MARK, csvKey: KEY });
    expect(used.error).toBeNull();
    expect(used.check).toBeNull();
    expect(used.noTimeQardMark).toBe(true);
    expect(importCheckProblem(used.check)).toBe(false);
    expect(importCheckLogText(used)).toBe("TimeQard の印なし");
    expect(NO_TIMEQARD_MARK_NOTE).toContain("TimeQard の打刻なら、TimeQard で書き出し直した CSV を取り込んでください。");
    // 印の列（会社の印・形式）を消した TimeQard の CSV も、印のない CSV になる
    const stripped = (await tq(...rows())).split("\r\n").map((l) => l.split(",").slice(0, 14).join(",")).join("\r\n");
    expect((await readAttendanceImport(stripped, { staff, companyMark: MARK, csvKey: KEY })).noTimeQardMark).toBe(true);
    // TimeQard を使っていない会社は、知らせない
    const notUsed = await readAttendanceImport(plain, { staff, companyMark: null, csvKey: null });
    expect(notUsed.noTimeQardMark).toBe(false);
    expect(importCheckLogText(notUsed)).toBe("");
  });

  test("取り込みの画面は、読んだあと、印が合わなければ「このまま取り込む」を選んだときだけ、まとめに進む", () => {
    const button = readFileSync(join(import.meta.dir, "../features/attendance/AttendanceImportButton.tsx"), "utf8");
    const readAt = button.indexOf("await readAttendanceImport(");
    const askAt = button.indexOf('dialog.choose(importCheckMessage(read.check), ["このまま取り込む"]');
    const previewAt = button.indexOf("setPreview({ fileName, plan: planAttendanceImport(read, existing) })");
    expect(readAt).toBeGreaterThan(0);
    expect(button.slice(readAt, askAt)).toContain("csvKey: settings?.csvKey ?? null");
    expect(askAt).toBeGreaterThan(readAt);
    expect(button.slice(askAt, askAt + 200)).toContain("if (choice !== 0) return;");
    expect(previewAt).toBeGreaterThan(askAt);
  });
});

describe("どの CSV でも確かめること", () => {
  test("印のない CSV（手で作ったもの・ほかのタイムカード）も取り込める。休憩は「休憩」の列か、「休憩始」「休憩終」「外出」「戻り」の列を読む", async () => {
    const list = await readAttendanceImport("スタッフID,日付,出勤,退勤,休憩\n1001,2026-11-04,09:00,18:00,12:00-13:00 15:00-15:10\n", { staff, companyMark: null, csvKey: null });
    expect(list.error).toBeNull();
    expect(list.fromTimeQard).toBe(false);
    expect(list.rows[0].times.entry).toBe("09:00");
    expect(list.rows[0].breaks).toEqual([{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:10" }]);
    expect(list.rows[0].requests).toEqual({});
    const pairs = await readAttendanceImport("スタッフID,日付,出勤,退勤,休憩始,休憩終,外出,戻り\n1001,2026-11-04,09:00,18:00,12:00,13:00,16:00,16:30\n", {
      staff,
      companyMark: null,
      csvKey: null,
    });
    expect(pairs.rows[0].breaks).toEqual([{ start: "12:00", end: "13:00" }, { start: "16:00", end: "16:30" }]);
  });

  test("Q にない ID の行は入れずに一覧にする。先頭の 0 が消えた ID・全角の ID は直す", async () => {
    const r = await readAttendanceImport(
      "スタッフID,日付,出勤\n9999,2026-11-04,09:00\n9999,2026-11-05,09:00\n12,2026-11-04,09:00\n１００１,2026-11-04,09:00\n",
      { staff, companyMark: null, csvKey: null }
    );
    expect(r.unknownIds).toEqual([{ id: "9999", rows: 2 }]);
    expect(r.rows.map((x) => x.staffId)).toEqual(["0012", "1001"]);
    expect(r.fixedIds).toEqual([
      { csvId: "12", staffId: "0012" },
      { csvId: "１００１", staffId: "1001" },
    ]);
  });

  test("Excel で保存し直した日付・時刻（「2026/11/7」「8:58」）は直して入れ、直した数を数える", async () => {
    const r = await readAttendanceImport("スタッフID,日付,出勤,退勤,休憩\n1001,2026/11/7,8:58,18:02:30,12:00〜13:00\n", { staff, companyMark: null, csvKey: null });
    expect(r.rows[0].date).toBe("2026-11-07");
    expect(r.rows[0].times.entry).toBe("08:58");
    expect(r.rows[0].times.exit).toBe("18:02");
    expect(r.rows[0].breaks).toEqual([{ start: "12:00", end: "13:00" }]);
    expect(r.fixedValues).toBe(4);
  });

  test("直せない日付・時刻・休憩の行は入れずに、わけを出す", async () => {
    const r = await readAttendanceImport(
      "スタッフID,日付,出勤,退勤,休憩\n1001,11月7日,09:00,18:00,\n1002,2026-11-07,9時,18:00,\n,2026-11-07,09:00,,\n1001,2026-11-08,09:00,18:00,昼休み\n",
      { staff, companyMark: null, csvKey: null }
    );
    expect(r.rows).toEqual([]);
    expect(r.invalid).toEqual([
      { rowNumber: 2, reason: "日付が読めません（「11月7日」）" },
      { rowNumber: 3, reason: "出勤の時刻が読めません（「9時」）" },
      { rowNumber: 4, reason: "スタッフID か日付が空です" },
      { rowNumber: 5, reason: "休憩の時刻が読めません（「昼休み」）" },
    ]);
  });

  test("同じ人・同じ日の行が2つあれば、後の行を使って知らせる", async () => {
    const r = await readAttendanceImport("スタッフID,日付,出勤\n1001,2026-11-04,09:00\n1001,2026-11-04,09:30\n", { staff, companyMark: null, csvKey: null });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].times.entry).toBe("09:30");
    expect(r.duplicates).toEqual([{ staffId: "1001", date: "2026-11-04", rowNumbers: [2, 3] }]);
  });

  test("見出しのない CSV は取り込まない", async () => {
    expect((await readAttendanceImport("1001,2026-11-04,09:00\n", { staff, companyMark: null, csvKey: null })).error).toContain("見出し");
    expect((await readAttendanceImport("", { staff, companyMark: null, csvKey: null })).error).toContain("見出し");
  });

  test("Shift_JIS（Excel の「CSV（コンマ区切り）」）でも読む", async () => {
    // 「日付」の Shift_JIS
    expect(decodeCsvBytes(new Uint8Array([0x93, 0xfa, 0x95, 0x74]))).toBe("日付");
    expect(decodeCsvBytes(new TextEncoder().encode("﻿日付"))).toBe("日付"); // BOM は読むときに取れる
  });
});

const day = (over: Partial<ExistingDay> = {}): ExistingDay => ({
  finalized: false,
  manual: { entry: "", exit: "" },
  manualBreaks: null,
  memo: "",
  ...over,
});

const run = (db: Database, statements: { sql: string; values?: unknown[] }[]) =>
  db.transaction(() => {
    for (const s of statements) db.prepare(s.sql).run(...((s.values ?? []) as any[]));
  })();

const newDb = () => {
  const db = new Database(":memory:");
  for (const s of DB_SCHEMAS) db.exec(s);
  db.exec(`INSERT INTO staff (id, name, base_wage) VALUES ('1001', '山田 太郎', 1), ('1002', '佐藤 花子', 1)`);
  return db;
};

/** 「会社ファイルの勤怠と合わせる」で使う CSV（TimeQard の書き方で作り、鍵で確かめて読む） */
const mergeRead = await readAttendanceImport(
    await tq(
      tqRow({ staffId: "1001", date: "2026-11-04", times: { entry: "", exit: "18:02" }, requests: { entry: "09:00" }, requestReason: "出勤：押し忘れた", notes: ["出勤がありません"] }),
      tqRow({ staffId: "1001", date: "2026-11-05", times: { entry: "08:58", exit: "17:00" }, breaks: [{ start: "12:00", end: "13:00" }], requests: { exit: "19:00" }, requestReason: "退勤：押し間違えた（会議が長引いた）" }),
      tqRow({ staffId: "1002", date: "2026-11-04", times: { entry: "08:50", exit: "" }, requests: { exit: "18:00" }, requestReason: "退勤：押し忘れた" })
    ),
  { staff, companyMark: MARK, csvKey: KEY }
);

describe("会社ファイルの勤怠と合わせる", () => {
  const read = mergeRead;

  test("確定した日は入れない。申し出は、確定した日・修正の欄に値がある日には入れられない", async () => {
    const existing = new Map([
      ["1001\u00002026-11-05", day({ manual: { entry: "", exit: "19:30" } })],
      ["1002\u00002026-11-04", day({ finalized: true })],
    ]);
    const plan = planAttendanceImport(read, existing);
    expect(plan.toWrite.map((r) => `${r.staffId} ${r.date}`)).toEqual(["1001 2026-11-04", "1001 2026-11-05"]);
    expect(plan.finalized.map((r) => `${r.staffId} ${r.date}`)).toEqual(["1002 2026-11-04"]);
    expect(plan.requests.map((r) => [r.staffId, r.date, r.kind, r.time, r.applicable, r.whyNot])).toEqual([
      ["1001", "2026-11-04", "entry", "09:00", true, null],
      ["1001", "2026-11-05", "exit", "19:00", false, "修正の欄に、もう 19:30 が入っています"],
      ["1002", "2026-11-04", "exit", "18:00", false, "確定した日です"],
    ]);
    expect(plan.requests[0].memoText).toBe("TimeQard の申し出：出勤 9:00（押し忘れた）");
    expect(plan.requests[1].memoText).toBe("TimeQard の申し出：退勤 19:00（押し間違えた（会議が長引いた））");
  });

  test("申出_理由の中から、その種類の理由を取り出す（休憩は時刻で見分ける）", async () => {
    expect(reasonForKind("出勤：押し忘れた／退勤：押し間違えた（会議）", "exit")).toBe("押し間違えた（会議）");
    expect(reasonForKind("押し忘れた", "entry")).toBe("押し忘れた");
    const text = "休憩（9:00〜9:15）：押し忘れた／休憩（15:00〜17:00）：押し間違えた（病院）";
    expect(reasonForKind(text, "break", { start: "15:00", end: "17:00" })).toBe("押し間違えた（病院）");
    expect(reasonForKind(text, "break", { start: "09:00", end: "09:15" })).toBe("押し忘れた");
  });

  test("書き込み：打刻の列（出勤・退勤・休憩の一覧）は確定していない日だけ。選んだ申し出は空の修正の欄に入れ、備考に書き足す", async () => {
    const db = newDb();
    db.exec(`INSERT INTO attendance (staff_id, work_date, csv_entry_time, memo, is_finalized) VALUES
      ('1001', '2026-11-04', '07:00', '遅れて来た', 0),
      ('1002', '2026-11-04', '08:00', '', 1)`);
    const plan = planAttendanceImport(read, new Map([["1002\u00002026-11-04", day({ finalized: true })]]));
    run(db, importStatements(plan, new Set(plan.requests.map((r) => r.key))));
    const rows = db
      .query("SELECT staff_id, work_date, csv_entry_time, csv_exit_time, csv_breaks, entry_time, exit_time, memo, is_finalized FROM attendance ORDER BY staff_id, work_date")
      .all();
    expect(rows).toEqual([
      { staff_id: "1001", work_date: "2026-11-04", csv_entry_time: "", csv_exit_time: "18:02", csv_breaks: null, entry_time: "09:00", exit_time: null, memo: "遅れて来た／TimeQard の申し出：出勤 9:00（押し忘れた）", is_finalized: 0 },
      {
        staff_id: "1001", work_date: "2026-11-05", csv_entry_time: "08:58", csv_exit_time: "17:00", csv_breaks: JSON.stringify([{ start: "12:00", end: "13:00" }]),
        entry_time: null, exit_time: "19:00", memo: "TimeQard の申し出：退勤 19:00（押し間違えた（会議が長引いた））", is_finalized: 0,
      },
      { staff_id: "1002", work_date: "2026-11-04", csv_entry_time: "08:00", csv_exit_time: null, csv_breaks: null, entry_time: null, exit_time: null, memo: "", is_finalized: 1 },
    ]);
  });

  test("書き込むときにも確かめる：あとで修正の欄に値を入れた日には、申し出を入れない", async () => {
    const db = newDb();
    const plan = planAttendanceImport(read, new Map());
    db.exec(`INSERT INTO attendance (staff_id, work_date, entry_time) VALUES ('1001', '2026-11-04', '08:30')`);
    for (const s of importStatements(plan, new Set(plan.requests.map((r) => r.key)))) {
      db.prepare(s.sql).run(...((s.values ?? []) as any[]));
    }
    expect(db.query("SELECT entry_time, memo FROM attendance WHERE work_date = '2026-11-04'").get()).toEqual({ entry_time: "08:30", memo: null });
  });

  test("選んでいない申し出は入れない", async () => {
    const plan = planAttendanceImport(read, new Map());
    expect(importStatements(plan, new Set()).length).toBe(plan.toWrite.length);
  });
});

describe("休憩の申し出（始めと終わり）", () => {
  test("その日の休憩の一覧に足す。同じ始め・同じ終わり・重なる休憩・押し忘れで一方しかない休憩は、申し出たものに置き換える", async () => {
    const base = [{ start: "12:00", end: "" }, { start: "15:00", end: "15:10" }, { start: "18:00", end: "18:30" }];
    expect(applyBreakRequests(base, [{ start: "11:55", end: "13:00" }, { start: "15:05", end: "15:20" }])).toEqual([
      { start: "11:55", end: "13:00" },
      { start: "15:05", end: "15:20" },
      { start: "18:00", end: "18:30" },
    ]);
    // 時間有給の印も残す（置き換えない休憩）
    expect(applyBreakRequests([{ start: "15:00", end: "17:00", leave: true }], [{ start: "12:00", end: "13:00" }])).toEqual([
      { start: "12:00", end: "13:00" },
      { start: "15:00", end: "17:00", leave: true },
    ]);
    // 日をまたぐ休憩
    expect(applyBreakRequests([{ start: "23:50", end: "" }], [{ start: "23:45", end: "00:30" }])).toEqual([{ start: "23:45", end: "00:30" }]);
  });

  test("確定した日・同じ休憩がもう入っている日には入れられない。選ぶと、打刻の休憩（手入力があれば手入力）に足して手入力の一覧にし、備考に書き足す", async () => {
    const read = await readAttendanceImport(
      await tq(
        tqRow({
          staffId: "1001", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" }, breaks: [{ start: "12:00", end: "" }],
          requestBreaks: [{ start: "12:00", end: "13:00" }, { start: "15:00", end: "17:00" }],
          requestReason: "休憩（12:00〜13:00）：押し忘れた／休憩（15:00〜17:00）：押し忘れた（病院）",
        }),
        tqRow({ staffId: "1001", date: "2026-11-05", times: { entry: "09:00", exit: "18:00" }, requestBreaks: [{ start: "12:00", end: "13:00" }], requestReason: "休憩（12:00〜13:00）：押し忘れた" }),
        tqRow({ staffId: "1002", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" }, requestBreaks: [{ start: "12:00", end: "13:00" }], requestReason: "休憩（12:00〜13:00）：押し忘れた" })
      ),
      { staff, companyMark: MARK, csvKey: KEY }
    );
    const existing = new Map([
      ["1001\u00002026-11-05", day({ manualBreaks: [{ start: "12:00", end: "13:00" }] })],
      ["1002\u00002026-11-04", day({ finalized: true })],
    ]);
    const plan = planAttendanceImport(read, existing);
    expect(plan.requests.map((r) => [r.date, r.staffId, r.kind, r.time, r.endTime, r.applicable, r.whyNot])).toEqual([
      ["2026-11-04", "1001", "break", "12:00", "13:00", true, null],
      ["2026-11-04", "1001", "break", "15:00", "17:00", true, null],
      ["2026-11-05", "1001", "break", "12:00", "13:00", false, "同じ休憩が、もう入っています"],
      ["2026-11-04", "1002", "break", "12:00", "13:00", false, "確定した日です"],
    ]);
    expect(plan.requests[1].memoText).toBe("TimeQard の申し出：休憩 15:00〜17:00（押し忘れた（病院））");
    const db = newDb();
    run(db, importStatements(plan, new Set(plan.requests.map((r) => r.key))));
    const row = db.query("SELECT csv_breaks AS c, breaks AS b, memo FROM attendance WHERE staff_id = '1001' AND work_date = '2026-11-04'").get() as any;
    expect(parseBreaksJson(row.c)).toEqual([{ start: "12:00", end: "" }]);
    expect(parseBreaksJson(row.b)).toEqual([{ start: "12:00", end: "13:00" }, { start: "15:00", end: "17:00" }]);
    expect(row.memo).toBe("TimeQard の申し出：休憩 12:00〜13:00（押し忘れた）／TimeQard の申し出：休憩 15:00〜17:00（押し忘れた（病院））");
  });
});

/** 「休憩を取れなかった」の申し出の CSV */
const noBreakRead = await readAttendanceImport(
    await tq(
      tqRow({ staffId: "1001", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" }, noBreakRequest: true, requestReason: "休憩なし：休憩を取れなかった（来客が続いた）" }),
      tqRow({ staffId: "1001", date: "2026-11-05", times: { entry: "09:00", exit: "18:00" }, noBreakRequest: true, requestReason: "休憩なし：休憩を取れなかった" }),
      tqRow({ staffId: "1002", date: "2026-11-04", times: { entry: "09:00", exit: "18:00" }, noBreakRequest: true, requestReason: "休憩なし：休憩を取れなかった" })
    ),
  { staff, companyMark: MARK, csvKey: KEY }
);

describe("「休憩を取れなかった」の申し出（「申出_休憩なし」の列）", () => {
  const read = noBreakRead;

  test("「申出_休憩なし」に何か入っている日は、申し出ありとして読む。列がない CSV は、申し出なし", async () => {
    expect(read.error).toBeNull();
    expect(read.rows.map((r) => r.noBreakRequest)).toEqual([true, true, true]);
    const plain = await readAttendanceImport("スタッフID,日付,出勤,退勤\n1001,2026-11-04,08:58,18:02\n", { staff, companyMark: MARK, csvKey: KEY });
    expect(plain.rows[0].noBreakRequest).toBe(false);
  });

  test("確定した日・もう「休憩なし」にしてある日には入れられない", async () => {
    const existing = new Map([
      ["1001\u00002026-11-05", day({ breakNone: true })],
      ["1002\u00002026-11-04", day({ finalized: true })],
    ]);
    const plan = planAttendanceImport(read, existing);
    expect(plan.requests.map((r) => [r.staffId, r.date, r.kind, r.time, r.applicable, r.whyNot])).toEqual([
      ["1001", "2026-11-04", "no_break", "", true, null],
      ["1001", "2026-11-05", "no_break", "", false, "もう「休憩なし」になっています"],
      ["1002", "2026-11-04", "no_break", "", false, "確定した日です"],
    ]);
    expect(plan.requests[0].reason).toBe("休憩を取れなかった（来客が続いた）");
    expect(plan.requests[0].memoText).toBe("TimeQard の申し出：休憩を取れなかった（来客が続いた）");
  });

  test("選ぶと、その日を「休憩なし」にして備考に書き足す（確定していない日だけ）", async () => {
    const db = newDb();
    db.exec(`INSERT INTO attendance (staff_id, work_date, memo, is_finalized) VALUES ('1002', '2026-11-04', '', 1)`);
    const plan = planAttendanceImport(read, new Map([["1002\u00002026-11-04", day({ finalized: true })]]));
    run(db, importStatements(plan, new Set(plan.requests.map((r) => r.key))));
    expect(db.query("SELECT staff_id, work_date, break_none, memo FROM attendance ORDER BY staff_id, work_date").all()).toEqual([
      { staff_id: "1001", work_date: "2026-11-04", break_none: 1, memo: "TimeQard の申し出：休憩を取れなかった（来客が続いた）" },
      { staff_id: "1001", work_date: "2026-11-05", break_none: 1, memo: "TimeQard の申し出：休憩を取れなかった" },
      { staff_id: "1002", work_date: "2026-11-04", break_none: 0, memo: "" },
    ]);
  });

  test("選んでいなければ「休憩なし」にしない", async () => {
    const plan = planAttendanceImport(read, new Map());
    expect(importStatements(plan, new Set()).length).toBe(plan.toWrite.length);
  });
});
