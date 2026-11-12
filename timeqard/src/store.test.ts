/**
 * TimeQard の記録（store.ts）と、打刻の画面の決まり（kiosk.ts）のテスト
 * 実行方法: bun test timeqard
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildStaffFile, cardHash, cardPayload, jstMs, newCardNumber, NO_BREAK_LABEL, parseCsvRecords, writeTimeQardCsv } from "../../shared/timeqard";
import { readAttendanceImport } from "../../src/utils/attendanceImport";
import {
  addPunch,
  addRequest,
  applyStaffFile,
  cancelRecord,
  clockProblem,
  exportRows,
  lastPunchMs,
  loadDayEvents,
  loadPunches,
  loadSettings,
  loadStaff,
  prepareDb,
  setSetting,
  TIMEQARD_FILE_ID,
  type KioskDb,
} from "./store";
import { availableKinds, findByCard, findById, punchBlockReason, suggestedKind } from "./kioskRules";

const wrap = (db: Database): KioskDb => ({
  execute: async (sql, params = []) => {
    const r = db.prepare(sql).run(...(params as any[]));
    return { rowsAffected: r.changes, lastInsertId: Number(r.lastInsertRowid) };
  },
  select: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])) as T,
});

const MARK = "K7M3QP2X";

const setup = async () => {
  const raw = new Database(":memory:");
  const db = wrap(raw);
  await prepareDb(db);
  const cardNumbers = { "1001": newCardNumber(), "1002": newCardNumber() };
  const file = buildStaffFile({
    companyName: "○○株式会社",
    companyMark: MARK,
    exportedAt: "2026-11-01T09:00:00+09:00",
    staff: [
      { id: "1001", name: "山田 太郎", join_date: "2019-04-01" },
      { id: "1002", name: "佐藤 花子", join_date: "2026-11-05" },
      { id: "A-7", name: "英字 ID" },
    ],
    cardHashesByStaff: new Map([
      ["1001", [await cardHash(cardNumbers["1001"])]],
      ["1002", [await cardHash(cardNumbers["1002"])]],
    ]),
  });
  await applyStaffFile(db, file, "2026-11-01T10:00:00+09:00");
  return { raw, db, cardNumbers, file };
};

describe("記録のファイル", () => {
  test("新しいファイルに表を作り、印を付ける。開き直してもエラーにならない", async () => {
    const raw = new Database(":memory:");
    await prepareDb(wrap(raw));
    expect(raw.query("PRAGMA application_id").get()).toEqual({ application_id: TIMEQARD_FILE_ID });
    await prepareDb(wrap(raw));
  });

  test("ほかのソフトのファイルは開かない", async () => {
    const raw = new Database(":memory:");
    raw.exec("CREATE TABLE other (x)");
    await expect(prepareDb(wrap(raw))).rejects.toThrow("TimeQard の記録のファイルではありません");
  });

  test("打刻・申し出・取り消しは、書き換えも削除もできない", async () => {
    const { raw, db } = await setup();
    const id = await addPunch(db, { staffId: "1001", kind: "entry", at: jstMs("2026-11-04", "08:58"), method: "card", companyMark: MARK });
    expect(() => raw.exec(`UPDATE punches SET pressed_ms = 0 WHERE id = ${id}`)).toThrow("書き換えられません");
    expect(() => raw.exec(`DELETE FROM punches WHERE id = ${id}`)).toThrow("消せません");
    await cancelRecord(db, "punch", id, jstMs("2026-11-04", "08:58") + 30_000);
    expect(() => raw.exec("DELETE FROM cancellations")).toThrow("消せません");
  });
});

describe("従業員ファイルの読み込み", () => {
  test("会社の印・会社名・書き出した日時を設定にする", async () => {
    const { db } = await setup();
    const s = await loadSettings(db);
    expect([s.companyMark, s.companyName, s.staffFileExportedAt]).toEqual([MARK, "○○株式会社", "2026-11-01T09:00:00+09:00"]);
    expect([s.showBreak, s.sound]).toEqual([true, true]);
  });

  test("読み込み直すと入れ替え、一覧から消えた人は押せなくして、名前を残す", async () => {
    const { db, file } = await setup();
    const next = { ...file, exportedAt: "2026-11-10T09:00:00+09:00", staff: file.staff.filter((s) => s.id !== "1002") };
    expect(await applyStaffFile(db, next, "2026-11-10T10:00:00+09:00")).toEqual({ added: 0, removed: 1, total: 2 });
    const staff = await loadStaff(db, MARK);
    const hanako = staff.find((s) => s.id === "1002")!;
    expect(hanako.inFile).toBe(false);
    expect(hanako.cardHashes).toEqual([]);
    expect(hanako.name).toBe("佐藤 花子");
  });
});

describe("人を見つける", () => {
  test("カード：この会社のカードか、使えるカードかを確かめる", async () => {
    const { db, cardNumbers } = await setup();
    const staff = await loadStaff(db, MARK);
    const ok = await findByCard(staff, MARK, cardPayload(MARK, cardNumbers["1001"]));
    expect(ok.ok && ok.person.name).toBe("山田 太郎");
    const other = await findByCard(staff, MARK, cardPayload("ABCD2345", cardNumbers["1001"]));
    expect(other).toEqual({ ok: false, error: "この会社のカードではありません。" });
    const old = await findByCard(staff, MARK, cardPayload(MARK, newCardNumber()));
    expect(old.ok).toBe(false);
    expect(!old.ok && old.error).toContain("このカードは使えません");
    expect((await findByCard(staff, MARK, "1001")).ok).toBe(false);
  });

  test("ID：全角・小文字・空白があっても見つける", async () => {
    const { db } = await setup();
    const staff = await loadStaff(db, MARK);
    expect(findById(staff, "１００１")?.name).toBe("山田 太郎");
    expect(findById(staff, " a-7 ")?.name).toBe("英字 ID");
    expect(findById(staff, "9999")).toBeNull();
  });

  test("入社日より前・退職日より後は押せない", () => {
    const p = { id: "1", name: "x", joinDate: "2026-11-05", retirementDate: "2026-11-30", cardHashes: [], inFile: true };
    expect(punchBlockReason(p, "2026-11-04")).toContain("入社日");
    expect(punchBlockReason(p, "2026-11-05")).toBeNull();
    expect(punchBlockReason(p, "2026-11-30")).toBeNull();
    expect(punchBlockReason(p, "2026-12-01")).toContain("退職日");
    expect(punchBlockReason({ ...p, inFile: false }, "2026-11-10")).toContain("従業員ファイルにいない");
  });

  test("出すボタンと、大きく出すボタン", () => {
    expect(availableKinds({ showBreak: true })).toEqual(["entry", "exit", "break_start", "break_end"]);
    expect(availableKinds({ showBreak: false })).toEqual(["entry", "exit"]);
    expect(suggestedKind("before", ["entry", "exit"])).toBe("entry");
    expect(suggestedKind("working", ["entry", "exit"])).toBe("exit");
    expect(suggestedKind("on_break", ["entry", "exit"])).toBe("exit"); // 休憩のボタンを出していないとき
    expect(suggestedKind("on_break", ["entry", "exit", "break_start", "break_end"])).toBe("break_end");
  });
});

describe("取り消し", () => {
  test("押してから1分のうちなら取り消せ、取り消した打刻は数えない", async () => {
    const { db } = await setup();
    const at = jstMs("2026-11-04", "08:58");
    const a = await addPunch(db, { staffId: "1001", kind: "exit", at, method: "card", companyMark: MARK });
    await cancelRecord(db, "punch", a, at + 59_000);
    const b = await addPunch(db, { staffId: "1001", kind: "entry", at: at + 60_000, method: "card", companyMark: MARK });
    await expect(cancelRecord(db, "punch", b, at + 60_000 + 61_000)).rejects.toThrow("1分を過ぎた");
    const punches = await loadPunches(db, { companyMark: MARK, fromMs: 0, toMs: Number.MAX_SAFE_INTEGER });
    expect(punches.map((p) => p.id)).toEqual([b]);
    const events = await loadDayEvents(db, MARK, "2026-11-04");
    expect(events.map((e) => [e.kind, e.cancelled])).toEqual([["exit", true], ["entry", false]]);
  });
});

describe("時計の確かめ", () => {
  test("前に押した時刻より前・従業員ファイルを書き出した日より前なら止める（少し戻っただけなら止めない）", () => {
    const last = jstMs("2026-11-04", "18:00");
    expect(clockProblem(last - 30_000, last, null)).toBeNull();
    expect(clockProblem(last - 5 * 60_000, last, null)).toContain("前に押した時刻");
    expect(clockProblem(jstMs("2026-10-31", "12:00"), null, "2026-11-01T09:00:00+09:00")).toContain("書き出した日");
    expect(clockProblem(jstMs("2026-11-01", "08:00"), null, "2026-11-01T09:00:00+09:00")).toBeNull();
  });

  test("いちばん新しい打刻の日時", async () => {
    const { db } = await setup();
    expect(await lastPunchMs(db)).toBeNull();
    await addPunch(db, { staffId: "1001", kind: "entry", at: 1000, method: "card", companyMark: MARK });
    await addPunch(db, { staffId: "1001", kind: "exit", at: 5000, method: "card", companyMark: MARK });
    expect(await lastPunchMs(db)).toBe(5000);
  });
});

describe("CSV の書き出し → Q の取り込み", () => {
  test("期間の行だけを出し、前の日に始まった夜勤はその日の行にする。名前・申し出・会社の印が入り、Q で読める", async () => {
    const { db } = await setup();
    const add = (staffId: string, date: string, time: string, kind: any, method: any = "card") =>
      addPunch(db, { staffId, kind, at: jstMs(date, time), method, companyMark: MARK });
    await add("1001", "2026-10-31", "22:00", "entry"); // 前の期間の夜勤
    await add("1001", "2026-11-01", "06:00", "exit");
    await add("1001", "2026-11-02", "08:58", "entry");
    await add("1001", "2026-11-02", "18:02", "exit", "id");
    await add("1001", "2026-11-30", "22:00", "entry"); // 期間の終わりの夜勤
    await add("1001", "2026-12-01", "06:05", "exit");
    await addRequest(db, { staffId: "1002", date: "2026-11-06", kind: "entry", time: "09:00", reason: "押し忘れた", note: "", at: jstMs("2026-11-06", "18:00"), method: "card", companyMark: MARK });
    const rows = await exportRows(db, { companyMark: MARK, from: "2026-11-01", to: "2026-11-30", now: jstMs("2026-12-01", "12:00") });
    expect(rows.map((r) => `${r.staffId} ${r.name} ${r.date} ${r.times.entry}-${r.times.exit} ${r.cardless.join(",")}`)).toEqual([
      "1001 山田 太郎 2026-11-02 08:58-18:02 exit",
      "1001 山田 太郎 2026-11-30 22:00-06:05 ",
      "1002 佐藤 花子 2026-11-06 - ",
    ]);
    const csv = writeTimeQardCsv(rows);
    const read = readAttendanceImport(csv, { staff: [{ id: "1001", name: "山田 太郎" }, { id: "1002", name: "佐藤 花子" }], companyMark: MARK });
    expect(read.error).toBeNull();
    expect(read.rows.length).toBe(3);
    expect(read.rows[2].requests).toEqual({ entry: "09:00" });
    expect(parseCsvRecords(csv).records[0].values["会社の印"]).toBe(MARK);
  });

  test("「休憩を取れなかった」の申し出（no_break。時刻は空）を申し出の表に残せ、Q では「休憩なし」の申し出として読める", async () => {
    const { db } = await setup();
    await addPunch(db, { staffId: "1001", kind: "entry", at: jstMs("2026-11-04", "09:00"), method: "card", companyMark: MARK });
    await addPunch(db, { staffId: "1001", kind: "exit", at: jstMs("2026-11-04", "18:00"), method: "card", companyMark: MARK });
    await addRequest(db, {
      staffId: "1001", date: "2026-11-04", kind: "no_break", time: "", reason: NO_BREAK_LABEL, note: "来客が続いた",
      at: jstMs("2026-11-04", "18:01"), method: "card", companyMark: MARK,
    });
    const rows = await exportRows(db, { companyMark: MARK, from: "2026-11-01", to: "2026-11-30", now: jstMs("2026-12-01", "12:00") });
    expect(rows.map((r) => [r.date, r.noBreakRequest, r.requests, r.requestReason])).toEqual([
      ["2026-11-04", true, {}, "休憩なし：休憩を取れなかった（来客が続いた）"],
    ]);
    const read = readAttendanceImport(writeTimeQardCsv(rows), { staff: [{ id: "1001", name: "山田 太郎" }], companyMark: MARK });
    expect(read.error).toBeNull();
    expect(read.rows[0].noBreakRequest).toBe(true);
  });
});

describe("設定", () => {
  test("ボタン・音などを変えられる", async () => {
    const { db } = await setup();
    await setSetting(db, "show_break", "0");
    await setSetting(db, "sound", "0");
    const s = await loadSettings(db);
    expect([s.showBreak, s.sound]).toEqual([false, false]);
  });
});

describe("休憩の申し出（始めと終わり）と、外出のない打刻", () => {
  test("休憩の申し出は終わりの時刻も残し、読み直せる。1日の行・管理の一覧・CSV に出る", async () => {
    const { db } = await setup();
    const at = jstMs("2026-11-06", "19:00");
    await addRequest(db, { staffId: "1001", date: "2026-11-06", kind: "break", time: "15:00", endTime: "17:00", reason: "押し忘れた", note: "病院", at, method: "card", companyMark: MARK });
    // 休憩でない申し出の終わりの時刻は残さない
    await addRequest(db, { staffId: "1001", date: "2026-11-06", kind: "exit", time: "18:00", endTime: "19:00", reason: "押し忘れた", note: "", at, method: "card", companyMark: MARK });
    const events = await loadDayEvents(db, MARK, "2026-11-06");
    expect(events.map((e) => [e.kind, e.requestTime, e.requestEndTime])).toEqual([["break", "15:00", "17:00"], ["exit", "18:00", ""]]);
    const rows = await exportRows(db, { companyMark: MARK, from: "2026-11-06", to: "2026-11-06", now: at });
    expect(rows[0].requestBreaks).toEqual([{ start: "15:00", end: "17:00" }]);
    expect(rows[0].requests).toEqual({ exit: "18:00" });
    expect(writeTimeQardCsv(rows)).toContain(",15:00-17:00,");
  });
  test("休憩は何回でも押せて、1日の行に全部入る。外出の打刻は残せない（休憩にまとめた）", async () => {
    const { db } = await setup();
    const p = (time: string, kind: "entry" | "exit" | "break_start" | "break_end") =>
      addPunch(db, { staffId: "1001", kind, at: jstMs("2026-11-06", time), method: "card", companyMark: MARK });
    await p("09:00", "entry");
    await p("12:00", "break_start");
    await p("13:00", "break_end");
    await p("15:00", "break_start");
    await p("15:30", "break_end");
    await p("18:00", "exit");
    const rows = await exportRows(db, { companyMark: MARK, from: "2026-11-06", to: "2026-11-06", now: jstMs("2026-11-07", "09:00") });
    expect(rows[0].breaks).toEqual([{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:30" }]);
    await expect(addPunch(db, { staffId: "1001", kind: "out" as any, at: jstMs("2026-11-06", "16:00"), method: "card", companyMark: MARK })).rejects.toThrow();
  });
});
