/**
 * 勤怠の CSV 取り込みの確かめ（attendanceImport.ts）のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_SCHEMAS } from "../types/dbSchema";
import {
  decodeCsvBytes,
  importStatements,
  planAttendanceImport,
  readAttendanceImport,
  reasonForKind,
  type ExistingDay,
} from "./attendanceImport";

const MARK = "K7M3QP2X";
const staff = [
  { id: "1001", name: "山田 太郎" },
  { id: "1002", name: "佐藤 花子" },
  { id: "0012", name: "先頭 ゼロ" },
];
const HEADER =
  "スタッフID,名前,日付,出勤,退勤,休憩始,休憩終,外出,戻り,申出_出勤,申出_退勤,申出_休憩始,申出_休憩終,申出_外出,申出_戻り,申出_理由,カードなし,注意,会社の印,形式";
const tq = (...lines: string[]) => [HEADER, ...lines].join("\r\n") + "\r\n";

describe("TimeQard の CSV：会社の印と形式を確かめる", () => {
  test("この会社ファイルの印なら読む", () => {
    const r = readAttendanceImport(tq(`1001,山田 太郎,2026-11-04,08:58,18:02,12:00,13:00,,,,,,,,,,,,${MARK},TimeQard 1`), {
      staff,
      companyMark: MARK,
    });
    expect(r.error).toBeNull();
    expect(r.fromTimeQard).toBe(true);
    expect(r.companyMark).toBe(MARK);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].times).toEqual({ entry: "08:58", exit: "18:02", break_start: "12:00", break_end: "13:00", out: "", return: "" });
    expect(r.period).toEqual({ from: "2026-11-04", to: "2026-11-04" });
  });

  test("ほかの会社の印なら、何も取り込まない", () => {
    const r = readAttendanceImport(tq(`1001,山田 太郎,2026-11-04,08:58,18:02,,,,,,,,,,,,,,ABCD2345,TimeQard 1`), {
      staff,
      companyMark: MARK,
    });
    expect(r.error).toContain("ほかの会社の打刻です");
    expect(r.error).toContain("ABCD 2345");
    expect(r.rows).toEqual([]);
  });

  test("まだ従業員ファイルを書き出していない会社ファイルには、TimeQard の CSV を取り込まない", () => {
    const r = readAttendanceImport(tq(`1001,山田 太郎,2026-11-04,08:58,18:02,,,,,,,,,,,,,,${MARK},TimeQard 1`), {
      staff,
      companyMark: null,
    });
    expect(r.error).toContain("まだ TimeQard の従業員ファイルを書き出していません");
  });

  test("新しい形式・いくつかの印が混ざった CSV は取り込まない", () => {
    expect(
      readAttendanceImport(tq(`1001,山田 太郎,2026-11-04,08:58,,,,,,,,,,,,,,,${MARK},TimeQard 2`), { staff, companyMark: MARK }).error
    ).toContain("Q を新しくしてから");
    expect(
      readAttendanceImport(
        tq(`1001,山田 太郎,2026-11-04,08:58,,,,,,,,,,,,,,,${MARK},TimeQard 1`, `1002,佐藤 花子,2026-11-04,08:58,,,,,,,,,,,,,,,ABCD2345,TimeQard 1`),
        { staff, companyMark: MARK }
      ).error
    ).toContain("いくつかの会社の印");
  });

  test("カードなし・注意・申し出の列を読む", () => {
    const r = readAttendanceImport(
      tq(`1002,佐藤 花子,2026-11-04,,17:31,,,,,09:00,,,,,,出勤：押し忘れた,退勤,出勤がありません,${MARK},TimeQard 1`),
      { staff, companyMark: MARK }
    );
    expect(r.rows[0].cardless).toEqual(["exit"]);
    expect(r.rows[0].notes).toEqual(["出勤がありません"]);
    expect(r.rows[0].requests).toEqual({ entry: "09:00" });
    expect(r.rows[0].requestReason).toBe("出勤：押し忘れた");
  });
});

describe("どの CSV でも確かめること", () => {
  test("印のない CSV（手で作ったもの・ほかのタイムカード）は、いままでどおり取り込める", () => {
    const r = readAttendanceImport("スタッフID,日付,出勤,退勤\n1001,2026-11-04,09:00,18:00\n", { staff, companyMark: null });
    expect(r.error).toBeNull();
    expect(r.fromTimeQard).toBe(false);
    expect(r.rows[0].times.entry).toBe("09:00");
    expect(r.rows[0].requests).toEqual({});
  });

  test("Q にない ID の行は入れずに一覧にする。先頭の 0 が消えた ID・全角の ID は直す", () => {
    const r = readAttendanceImport(
      "スタッフID,日付,出勤\n9999,2026-11-04,09:00\n9999,2026-11-05,09:00\n12,2026-11-04,09:00\n１００１,2026-11-04,09:00\n",
      { staff, companyMark: null }
    );
    expect(r.unknownIds).toEqual([{ id: "9999", rows: 2 }]);
    expect(r.rows.map((x) => x.staffId)).toEqual(["0012", "1001"]);
    expect(r.fixedIds).toEqual([
      { csvId: "12", staffId: "0012" },
      { csvId: "１００１", staffId: "1001" },
    ]);
  });

  test("Excel で保存し直した日付・時刻（「2026/11/7」「8:58」）は直して入れ、直した数を数える", () => {
    const r = readAttendanceImport("スタッフID,日付,出勤,退勤,休憩始\n1001,2026/11/7,8:58,18:02:30,\n", { staff, companyMark: null });
    expect(r.rows[0].date).toBe("2026-11-07");
    expect(r.rows[0].times.entry).toBe("08:58");
    expect(r.rows[0].times.exit).toBe("18:02");
    expect(r.fixedValues).toBe(3);
  });

  test("直せない日付・時刻の行は入れずに、わけを出す", () => {
    const r = readAttendanceImport(
      "スタッフID,日付,出勤,退勤\n1001,11月7日,09:00,18:00\n1002,2026-11-07,9時,18:00\n,2026-11-07,09:00,\n",
      { staff, companyMark: null }
    );
    expect(r.rows).toEqual([]);
    expect(r.invalid).toEqual([
      { rowNumber: 2, reason: "日付が読めません（「11月7日」）" },
      { rowNumber: 3, reason: "出勤の時刻が読めません（「9時」）" },
      { rowNumber: 4, reason: "スタッフID か日付が空です" },
    ]);
  });

  test("同じ人・同じ日の行が2つあれば、後の行を使って知らせる", () => {
    const r = readAttendanceImport("スタッフID,日付,出勤\n1001,2026-11-04,09:00\n1001,2026-11-04,09:30\n", { staff, companyMark: null });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].times.entry).toBe("09:30");
    expect(r.duplicates).toEqual([{ staffId: "1001", date: "2026-11-04", rowNumbers: [2, 3] }]);
  });

  test("見出しのない CSV は取り込まない", () => {
    expect(readAttendanceImport("1001,2026-11-04,09:00\n", { staff, companyMark: null }).error).toContain("見出し");
    expect(readAttendanceImport("", { staff, companyMark: null }).error).toContain("見出し");
  });

  test("Shift_JIS（Excel の「CSV（コンマ区切り）」）でも読む", () => {
    // 「日付」の Shift_JIS
    expect(decodeCsvBytes(new Uint8Array([0x93, 0xfa, 0x95, 0x74]))).toBe("日付");
    expect(decodeCsvBytes(new TextEncoder().encode("\uFEFF日付"))).toBe("日付"); // BOM は読むときに取れる
  });
});

const day = (over: Partial<ExistingDay> = {}): ExistingDay => ({
  finalized: false,
  manual: { entry: "", exit: "", break_start: "", break_end: "", out: "", return: "" },
  memo: "",
  ...over,
});

describe("会社ファイルの勤怠と合わせる", () => {
  const read = readAttendanceImport(
    tq(
      `1001,山田 太郎,2026-11-04,,18:02,,,,,09:00,,,,,,出勤：押し忘れた,,出勤がありません,${MARK},TimeQard 1`,
      `1001,山田 太郎,2026-11-05,08:58,17:00,,,,,,19:00,,,,,退勤：押し間違えた（会議が長引いた）,,,${MARK},TimeQard 1`,
      `1002,佐藤 花子,2026-11-04,08:50,,,,,,,18:00,,,,,退勤：押し忘れた,,,${MARK},TimeQard 1`
    ),
    { staff, companyMark: MARK }
  );

  test("確定した日は入れない。申し出は、確定した日・修正の欄に値がある日には入れられない", () => {
    const existing = new Map([
      ["1001\u00002026-11-05", day({ manual: { ...day().manual, exit: "19:30" } })],
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

  test("申出_理由の中から、その種類の理由を取り出す", () => {
    expect(reasonForKind("出勤：押し忘れた／退勤：押し間違えた（会議）", "exit")).toBe("押し間違えた（会議）");
    expect(reasonForKind("押し忘れた", "entry")).toBe("押し忘れた");
  });

  test("書き込み：打刻の列は確定していない日だけ。選んだ申し出は空の修正の欄に入れ、備考に書き足す", () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec(`INSERT INTO staff (id, name, base_wage) VALUES ('1001', '山田 太郎', 1), ('1002', '佐藤 花子', 1)`);
    db.exec(`INSERT INTO attendance (staff_id, work_date, csv_entry_time, memo, is_finalized) VALUES
      ('1001', '2026-11-04', '07:00', '遅れて来た', 0),
      ('1002', '2026-11-04', '08:00', '', 1)`);
    const plan = planAttendanceImport(read, new Map([["1002\u00002026-11-04", day({ finalized: true })]]));
    const statements = importStatements(plan, new Set(plan.requests.map((r) => r.key)));
    db.transaction(() => {
      for (const s of statements) db.prepare(s.sql).run(...((s.values ?? []) as any[]));
    })();
    const rows = db
      .query("SELECT staff_id, work_date, csv_entry_time, csv_exit_time, entry_time, exit_time, memo, is_finalized FROM attendance ORDER BY staff_id, work_date")
      .all();
    expect(rows).toEqual([
      { staff_id: "1001", work_date: "2026-11-04", csv_entry_time: "", csv_exit_time: "18:02", entry_time: "09:00", exit_time: null, memo: "遅れて来た／TimeQard の申し出：出勤 9:00（押し忘れた）", is_finalized: 0 },
      { staff_id: "1001", work_date: "2026-11-05", csv_entry_time: "08:58", csv_exit_time: "17:00", entry_time: null, exit_time: "19:00", memo: "TimeQard の申し出：退勤 19:00（押し間違えた（会議が長引いた））", is_finalized: 0 },
      { staff_id: "1002", work_date: "2026-11-04", csv_entry_time: "08:00", csv_exit_time: null, entry_time: null, exit_time: null, memo: "", is_finalized: 1 },
    ]);
  });

  test("書き込むときにも確かめる：あとで修正の欄に値を入れた日には、申し出を入れない", () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec(`INSERT INTO staff (id, name, base_wage) VALUES ('1001', '山田 太郎', 1)`);
    const plan = planAttendanceImport(read, new Map());
    db.exec(`INSERT INTO attendance (staff_id, work_date, entry_time) VALUES ('1001', '2026-11-04', '08:30')`);
    for (const s of importStatements(plan, new Set(plan.requests.map((r) => r.key)))) {
      db.prepare(s.sql).run(...((s.values ?? []) as any[]));
    }
    expect(db.query("SELECT entry_time, memo FROM attendance WHERE work_date = '2026-11-04'").get()).toEqual({ entry_time: "08:30", memo: null });
  });

  test("選んでいない申し出は入れない", () => {
    const plan = planAttendanceImport(read, new Map());
    expect(importStatements(plan, new Set()).length).toBe(plan.toWrite.length);
  });
});

describe("「休憩を取れなかった」の申し出（「申出_休憩なし」の列）", () => {
  const HEADER2 =
    "スタッフID,名前,日付,出勤,退勤,休憩始,休憩終,外出,戻り,申出_出勤,申出_退勤,申出_休憩始,申出_休憩終,申出_外出,申出_戻り,申出_休憩なし,申出_理由,カードなし,注意,会社の印,形式";
  const tq2 = (...lines: string[]) => [HEADER2, ...lines].join("\r\n") + "\r\n";
  const read = readAttendanceImport(
    tq2(
      `1001,山田 太郎,2026-11-04,09:00,18:00,,,,,,,,,,,○,休憩なし：休憩を取れなかった（来客が続いた）,,,${MARK},TimeQard 1`,
      `1001,山田 太郎,2026-11-05,09:00,18:00,,,,,,,,,,,○,休憩なし：休憩を取れなかった,,,${MARK},TimeQard 1`,
      `1002,佐藤 花子,2026-11-04,09:00,18:00,,,,,,,,,,,○,休憩なし：休憩を取れなかった,,,${MARK},TimeQard 1`
    ),
    { staff, companyMark: MARK }
  );

  test("「申出_休憩なし」に何か入っている日は、申し出ありとして読む。列がない CSV は、申し出なし", () => {
    expect(read.error).toBeNull();
    expect(read.rows.map((r) => r.noBreakRequest)).toEqual([true, true, true]);
    const old = readAttendanceImport(tq(`1001,山田 太郎,2026-11-04,08:58,18:02,,,,,,,,,,,,,,${MARK},TimeQard 1`), { staff, companyMark: MARK });
    expect(old.rows[0].noBreakRequest).toBe(false);
  });

  test("確定した日・もう「休憩なし」にしてある日には入れられない", () => {
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

  test("選ぶと、その日を「休憩なし」にして備考に書き足す（確定していない日だけ）", () => {
    const db = new Database(":memory:");
    for (const s of DB_SCHEMAS) db.exec(s);
    db.exec(`INSERT INTO staff (id, name, base_wage) VALUES ('1001', '山田 太郎', 1), ('1002', '佐藤 花子', 1)`);
    db.exec(`INSERT INTO attendance (staff_id, work_date, memo, is_finalized) VALUES ('1002', '2026-11-04', '', 1)`);
    const plan = planAttendanceImport(read, new Map([["1002\u00002026-11-04", day({ finalized: true })]]));
    const statements = importStatements(plan, new Set(plan.requests.map((r) => r.key)));
    db.transaction(() => {
      for (const s of statements) db.prepare(s.sql).run(...((s.values ?? []) as any[]));
    })();
    expect(db.query("SELECT staff_id, work_date, break_none, memo FROM attendance ORDER BY staff_id, work_date").all()).toEqual([
      { staff_id: "1001", work_date: "2026-11-04", break_none: 1, memo: "TimeQard の申し出：休憩を取れなかった（来客が続いた）" },
      { staff_id: "1001", work_date: "2026-11-05", break_none: 1, memo: "TimeQard の申し出：休憩を取れなかった" },
      { staff_id: "1002", work_date: "2026-11-04", break_none: 0, memo: "" },
    ]);
  });

  test("選んでいなければ「休憩なし」にしない", () => {
    const plan = planAttendanceImport(read, new Map());
    expect(importStatements(plan, new Set()).length).toBe(plan.toWrite.length);
  });
});
