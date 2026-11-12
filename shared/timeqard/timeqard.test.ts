/**
 * TimeQard の共通の形（shared/timeqard）のテスト
 * 実行方法: bun test shared
 */
import { describe, expect, test } from "bun:test";
import {
  addDays,
  buildDayRows,
  buildStaffFile,
  cardHash,
  cardPayload,
  isDateString,
  isInStaffFile,
  jstDate,
  jstIso,
  jstMs,
  jstTime,
  monthRange,
  newCardNumber,
  newCompanyMark,
  normalizeDate,
  normalizeTime,
  NO_BREAK_LABEL,
  parseCardPayload,
  parseCardlessKinds,
  parseCsv,
  parseCsvRecords,
  parseFormatVersion,
  parseIso,
  parseNoBreakRequest,
  parseNotes,
  parseSpanList,
  formatSpanList,
  parseStaffFile,
  randomCode,
  serializeStaffFile,
  sha256Hex,
  staffFileFingerprint,
  staffFileName,
  TIMEQARD_CSV_HEADERS,
  workStateOf,
  writeTimeQardCsv,
  type Punch,
  type PunchKind,
  type PunchRequest,
  type RequestKind,
  type TimeQardCsvRow,
} from "./index";

describe("日本時間", () => {
  test("パソコンの時計（UTC のミリ秒）から、日本時間の日付と時刻を作る", () => {
    // 2026-11-06T23:30:00Z は、日本時間の 2026-11-07 08:30
    const ms = Date.UTC(2026, 10, 6, 23, 30, 45);
    expect(jstDate(ms)).toBe("2026-11-07");
    expect(jstTime(ms)).toBe("08:30");
    expect(jstIso(ms)).toBe("2026-11-07T08:30:45+09:00");
    expect(parseIso(jstIso(ms))).toBe(ms);
  });

  test("日本時間の日付・時刻から、ミリ秒に戻せる", () => {
    const ms = jstMs("2026-11-07", "08:58");
    expect(jstDate(ms)).toBe("2026-11-07");
    expect(jstTime(ms)).toBe("08:58");
    expect(jstMs("2026-11-08") - jstMs("2026-11-07")).toBe(24 * 60 * 60 * 1000);
  });

  test("本当にある日だけを日付とする（うるう年も）", () => {
    expect(isDateString("2028-02-29")).toBe(true);
    expect(isDateString("2026-02-29")).toBe(false);
    expect(isDateString("2026-11-31")).toBe(false);
    expect(isDateString("2026-1-07")).toBe(false);
    expect(parseIso("2026-11-07 08:58")).toBeNull();
  });

  test("日数を足す・月の初めと終わり", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(monthRange(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("会社の印・カードの番号・QR コードの中身", () => {
  test("1バイトの下の5ビットで、32文字から選ぶ", () => {
    const bytes = new Uint8Array([0, 1, 25, 26, 31, 32, 255, 224]);
    expect(randomCode(8, () => bytes)).toBe("ABZ27A7A");
  });

  test("会社の印は8文字・カードの番号は26文字で、A〜Z と 2〜7 だけ", () => {
    for (let i = 0; i < 50; i++) {
      expect(newCompanyMark()).toMatch(/^[A-Z2-7]{8}$/);
      expect(newCardNumber()).toMatch(/^[A-Z2-7]{26}$/);
    }
  });

  test("QR コードの中身は「TQ1」＋会社の印＋カードの番号の37文字で、読み戻せる", () => {
    const mark = "K7M3QP2X";
    const number = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const payload = cardPayload(mark, number);
    expect(payload).toBe("TQ1K7M3QP2XABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(payload.length).toBe(37);
    expect(parseCardPayload(payload)).toEqual({ companyMark: mark, cardNumber: number });
  });

  test("小文字・全角・空白・改行が混ざっても読む（USB の読み取り機・ID の欄から）", () => {
    expect(parseCardPayload(" tq1k7m3qp2xabcdefghijklmnopqrstuvwxyz\r\n")).toEqual({
      companyMark: "K7M3QP2X",
      cardNumber: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    });
    expect(parseCardPayload("ＴＱ１Ｋ７Ｍ３ＱＰ２ＸＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ")?.companyMark).toBe("K7M3QP2X");
  });

  test("TimeQard のカードの形でなければ読まない", () => {
    expect(parseCardPayload("1001")).toBeNull();
    expect(parseCardPayload("TQ2K7M3QP2XABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBeNull(); // 知らない形
    expect(parseCardPayload("TQ1K7M3QP2XABCDEFGHIJKLMNOPQRSTUVWXY")).toBeNull(); // 1文字足りない
    expect(parseCardPayload("TQ1K7M3QP2XABCDEFGHIJKLMNOPQRSTUVWXY8")).toBeNull(); // 8 は使わない
    expect(() => cardPayload("K7M3QP2", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toThrow();
  });

  test("SHA-256（「abc」の値）とカードの確かめ用の値", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const number = newCardNumber();
    expect(await cardHash(number)).toBe(await sha256Hex(number));
    expect(await cardHash(number)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("日付・時刻を決まった形に直す（Excel で保存し直した CSV など）", () => {
  test("日付", () => {
    expect(normalizeDate("2026-11-07")).toBe("2026-11-07");
    expect(normalizeDate("2026/11/7")).toBe("2026-11-07");
    expect(normalizeDate("2026.11.07")).toBe("2026-11-07");
    expect(normalizeDate("2026年11月7日")).toBe("2026-11-07");
    expect(normalizeDate("２０２６／１１／７")).toBe("2026-11-07");
    expect(normalizeDate("2026/2/30")).toBeNull();
    expect(normalizeDate("11/7")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });

  test("時刻", () => {
    expect(normalizeTime("08:58")).toBe("08:58");
    expect(normalizeTime("8:58")).toBe("08:58");
    expect(normalizeTime("8:58:59")).toBe("08:58"); // 秒は切り捨て
    expect(normalizeTime("８：５８")).toBe("08:58");
    expect(normalizeTime("8時58分")).toBe("08:58");
    expect(normalizeTime("25:30")).toBe("01:30"); // 24時以後の書き方は次の日の時刻
    expect(normalizeTime("")).toBe("");
    expect(normalizeTime("--:--")).toBe("");
    expect(normalizeTime(undefined)).toBe("");
    expect(normalizeTime("8:60")).toBeNull();
    expect(normalizeTime("48:00")).toBeNull();
    expect(normalizeTime("858")).toBeNull();
  });
});

const row = (over: Partial<TimeQardCsvRow> & Pick<TimeQardCsvRow, "staffId" | "name" | "date">): TimeQardCsvRow => ({
  times: { entry: "", exit: "" },
  breaks: [],
  requests: {},
  requestBreaks: [],
  noBreakRequest: false,
  requestReason: "",
  cardless: [],
  web: [],
  notes: [],
  companyMark: "K7M3QP2X",
  ...over,
});

describe("CSV", () => {
  test("設計メモ（付録 A）の例と同じ行を書く", () => {
    const csv = writeTimeQardCsv([
      row({
        staffId: "1001",
        name: "山田 太郎",
        date: "2026-11-04",
        times: { entry: "08:58", exit: "18:02" },
        breaks: [{ start: "12:00", end: "13:00" }, { start: "15:00", end: "15:10" }],
      }),
      row({
        staffId: "1002",
        name: "佐藤 花子",
        date: "2026-11-04",
        times: { entry: "", exit: "17:31" },
        requests: { entry: "09:00" },
        requestBreaks: [{ start: "12:00", end: "13:00" }],
        requestReason: "出勤：押し忘れた／休憩（12:00〜13:00）：押し忘れた",
        cardless: ["exit"],
        notes: ["出勤がありません"],
      }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "スタッフID,名前,日付,出勤,退勤,休憩,申出_出勤,申出_退勤,申出_休憩,申出_休憩なし,申出_理由,カードなし,ブラウザ,注意,会社の印,形式",
      "1001,山田 太郎,2026-11-04,08:58,18:02,12:00-13:00 15:00-15:10,,,,,,,,,K7M3QP2X,TimeQard 1",
      "1002,佐藤 花子,2026-11-04,,17:31,,09:00,,12:00-13:00,,出勤：押し忘れた／休憩（12:00〜13:00）：押し忘れた,退勤,,出勤がありません,K7M3QP2X,TimeQard 1",
      "",
    ]);
  });

  test("文の中の改行・「,」・「\"」は空白にする（列がずれない）", () => {
    const csv = writeTimeQardCsv([
      row({ staffId: "1001", name: "山田 太郎", date: "2026-11-04", requestReason: '退勤：そのほか（会議,"長引いた"\n）', notes: ["a", "b"] }),
    ]);
    const { records } = parseCsvRecords(csv);
    expect(records[0].values["申出_理由"]).toBe("退勤：そのほか（会議 長引いた ）");
    expect(records[0].values["注意"]).toBe("a／b");
    expect(records[0].values["会社の印"]).toBe("K7M3QP2X");
  });

  test("休憩の一覧の書き方：始め・終わりを「-」でつなぎ、空白で区切る。一方しかない休憩も書く。全角・「〜」・「、」区切りも読む", () => {
    const spans = [{ start: "12:00", end: "13:00" }, { start: "15:00", end: "" }, { start: "", end: "17:10" }];
    expect(formatSpanList(spans)).toBe("12:00-13:00 15:00- -17:10");
    expect(parseSpanList("12:00-13:00 15:00- -17:10")).toEqual({ spans, bad: [] });
    expect(parseSpanList("１２：００〜１３：００、9:05~9:15")).toEqual({
      spans: [{ start: "12:00", end: "13:00" }, { start: "09:05", end: "09:15" }],
      bad: [],
    });
    expect(parseSpanList("12:00-13:00 昼 25:99-26:00 -")).toEqual({ spans: [{ start: "12:00", end: "13:00" }], bad: ["昼", "25:99-26:00", "-"] });
    expect(parseSpanList("")).toEqual({ spans: [], bad: [] });
    expect(formatSpanList([])).toBe("");
  });

  test("引用符でくくった値の中の「,」「\"\"」・改行も読む", () => {
    const text = '\uFEFFa,b,c\r\n"1,2","say ""hi""","line1\nline2"\n,"",x\n\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1,2", 'say "hi"', "line1\nline2"],
      ["", "", "x"],
      [""],
    ]);
    const { headers, records } = parseCsvRecords(text);
    expect(headers).toEqual(["a", "b", "c"]);
    expect(records.map((r) => r.values)).toEqual([
      { a: "1,2", b: 'say "hi"', c: "line1\nline2" },
      { a: "", b: "", c: "x" },
    ]);
    expect(records.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  test("見出しの列の数と値の数が違っても読む・見出しの前後の空白を取る", () => {
    const { records } = parseCsvRecords(' スタッフID , 日付 \n1001,2026-11-04,余り\n1002\n');
    expect(records.map((r) => r.values)).toEqual([
      { スタッフID: "1001", 日付: "2026-11-04" },
      { スタッフID: "1002", 日付: "" },
    ]);
  });

  test("形式・カードなし・注意の列を読む", () => {
    expect(parseFormatVersion("TimeQard 1")).toBe(1);
    expect(parseFormatVersion("TimeQard 12")).toBe(12);
    expect(parseFormatVersion("")).toBeNull();
    expect(parseFormatVersion("ほかのソフト")).toBeNull();
    expect(parseCardlessKinds("退勤 出勤 休憩終")).toEqual(["entry", "exit", "break_end"]);
    expect(parseCardlessKinds("外出")).toEqual([]);
    expect(parseCardlessKinds("")).toEqual([]);
    expect(parseNotes("出勤がありません／退勤がありません")).toEqual(["出勤がありません", "退勤がありません"]);
    expect(TIMEQARD_CSV_HEADERS.length).toBe(16);
  });

  test("「休憩を取れなかった」の申し出は、「申出_休憩なし」の列に○を書く。列がない CSV（手で作ったものなど）は、申し出なし", () => {
    const csv = writeTimeQardCsv([
      row({ staffId: "1001", name: "山田 太郎", date: "2026-11-04", noBreakRequest: true, requestReason: "休憩なし：休憩を取れなかった（来客が続いた）" }),
    ]);
    const { records } = parseCsvRecords(csv);
    expect(records[0].values["申出_休憩なし"]).toBe("○");
    expect(records[0].values["形式"]).toBe("TimeQard 1");
    expect(parseNoBreakRequest(records[0].values["申出_休憩なし"])).toBe(true);
    expect(parseNoBreakRequest("")).toBe(false);
    expect(parseNoBreakRequest(undefined)).toBe(false);
  });
});

describe("従業員ファイル", () => {
  const staff = [
    { id: "10", name: "後から 入社", status: "active", join_date: "2026-12-01", retirement_date: "" },
    { id: "2", name: "山田 太郎", status: "active", join_date: "2019-04-01", retirement_date: null },
    { id: "3", name: "今月 退職", status: "retired", join_date: "2020-04-01", retirement_date: "2026-11-30" },
    { id: "4", name: "先月 退職", status: "retired", join_date: "2020-04-01", retirement_date: "2026-10-31" },
    { id: "5", name: "退職日なし", status: "retired", join_date: "", retirement_date: "" },
    { id: "6", name: "休職中", status: "on_leave", join_date: "2021-04-01", retirement_date: "" },
  ];

  test("書き出した日に在籍している人と、これから入社する人を入れる（退職日の当日までは入れる）", () => {
    expect(staff.filter((s) => isInStaffFile(s, "2026-11-07")).map((s) => s.id)).toEqual(["10", "2", "3", "6"]);
    expect(isInStaffFile({ id: "x", name: "x", retirement_date: "2026-11-07" }, "2026-11-07")).toBe(true);
    expect(isInStaffFile({ id: "x", name: "x", retirement_date: "2026-11-06" }, "2026-11-07")).toBe(false);
  });

  const build = (hashes = new Map<string, string[]>()) =>
    buildStaffFile({
      companyName: "○○株式会社",
      companyMark: "K7M3QP2X",
      exportedAt: "2026-11-07T16:30:00+09:00",
      staff,
      cardHashesByStaff: hashes,
    });

  test("ID の数の順に並べ、入社日・退職日は日付の形だけを入れる", () => {
    const file = build(new Map([["2", ["f".repeat(64)]]]));
    expect(file.staff.map((s) => s.id)).toEqual(["2", "3", "6", "10"]);
    expect(file.staff[0]).toEqual({ id: "2", name: "山田 太郎", joinDate: "2019-04-01", retirementDate: null, cardHashes: ["f".repeat(64)] });
    expect(file.staff[3]).toEqual({ id: "10", name: "後から 入社", joinDate: "2026-12-01", retirementDate: null, cardHashes: [] });
  });

  test("書き出したファイルを読み戻せる", () => {
    const file = build();
    const parsed = parseStaffFile(serializeStaffFile(file));
    expect(parsed).toEqual({ ok: true, file });
  });

  test("おかしなファイルは、わけを返して読まない", () => {
    const file = build();
    const text = (over: object) => JSON.stringify({ ...file, ...over });
    const error = (s: string) => {
      const r = parseStaffFile(s);
      return r.ok ? "" : r.error;
    };
    expect(error("{")).toContain("JSON");
    expect(error(text({ format: "other" }))).toContain("TimeQard の従業員ファイルではありません");
    expect(error(text({ version: 2 }))).toContain("TimeQard を新しく");
    expect(error(text({ companyMark: "abc" }))).toContain("会社の印");
    expect(error(text({ staff: [file.staff[0], file.staff[0]] }))).toContain("同じスタッフID");
    expect(error(text({ staff: [{ ...file.staff[0], cardHashes: ["xyz"] }] }))).toContain("カードの値");
    expect(error(text({ staff: [{ ...file.staff[0], joinDate: "2019/04/01" }] }))).toContain("入社日");
  });

  test("中身の確かめ用の値は、書き出した日時では変わらず、カードが変わると変わる", async () => {
    const a = await staffFileFingerprint(build());
    const b = await staffFileFingerprint({ ...build(), exportedAt: "2026-11-08T09:00:00+09:00" });
    const c = await staffFileFingerprint(build(new Map([["2", ["a".repeat(64)]]])));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("ファイル名に使えない文字は「_」にする", () => {
    expect(staffFileName("○○株式会社", "2026-11-07")).toBe("○○株式会社_TimeQard従業員_2026-11-07.json");
    expect(staffFileName('A/B:C*"D', "2026-11-07")).toBe("A_B_C__D_TimeQard従業員_2026-11-07.json");
  });
});

// --- 1日のまとめ方 ---
let nextId = 1;
const punch = (staffId: string, date: string, time: string, kind: PunchKind, method: "card" | "id" | "web" = "card"): Punch => ({
  id: nextId++,
  staffId,
  kind,
  at: jstMs(date, time),
  method,
});
const request = (
  staffId: string, date: string, kind: RequestKind, time: string, reason = "押し忘れた", note = "", requestedAt = jstMs(date, "23:00"), endTime = "",
): PunchRequest => ({
  id: nextId++,
  staffId,
  date,
  kind,
  time,
  endTime,
  reason,
  note,
  requestedAt,
});
const LATER = jstMs("2026-11-30", "00:00");
/** 「出勤 退勤 休憩…」（休憩は「12:00-13:00」） */
const times = (r: { times: { entry: string; exit: string }; breaks: { start: string; end: string }[] }) =>
  [r.times.entry, r.times.exit, formatSpanList(r.breaks)].join(" ").trim();

describe("1日のまとめ方（付録 E）", () => {
  test("ふつうの日：出勤・休憩・退勤が1行に入る", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "08:58", "entry"),
        punch("1001", "2026-11-04", "12:00", "break_start"),
        punch("1001", "2026-11-04", "13:00", "break_end"),
        punch("1001", "2026-11-04", "18:02", "exit"),
      ],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe("2026-11-04");
    expect(rows[0].times).toEqual({ entry: "08:58", exit: "18:02" });
    expect(rows[0].breaks).toEqual([{ start: "12:00", end: "13:00" }]);
    expect(rows[0].notes).toEqual([]);
    expect(rows[0].cardless).toEqual([]);
  });

  test("夜勤：次の日の朝の退勤・夜中の休憩は、出勤した日の行に入る", () => {
    const rows = buildDayRows({
      punches: [
        punch("1003", "2026-11-04", "22:00", "entry"),
        punch("1003", "2026-11-05", "02:00", "break_start"),
        punch("1003", "2026-11-05", "02:45", "break_end"),
        punch("1003", "2026-11-05", "06:05", "exit"),
      ],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe("2026-11-04");
    expect(times(rows[0])).toBe("22:00 06:05 02:00-02:45");
  });

  test("出勤を押し忘れた日：退勤は押した日の行にして「出勤がありません」。申し出も同じ行に入る", () => {
    const rows = buildDayRows({
      punches: [punch("1002", "2026-11-04", "17:31", "exit", "id")],
      requests: [request("1002", "2026-11-04", "entry", "09:00")],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].times.exit).toBe("17:31");
    expect(rows[0].times.entry).toBe("");
    expect(rows[0].notes).toEqual(["出勤がありません"]);
    expect(rows[0].cardless).toEqual(["exit"]);
    expect(rows[0].requests).toEqual({ entry: "09:00" });
    expect(rows[0].requestReason).toBe("出勤：押し忘れた");
  });

  test("夜勤のあと、次の日に出勤を押し忘れた退勤は、前の日の勤務に入れない", () => {
    const rows = buildDayRows({
      punches: [
        punch("1003", "2026-11-04", "22:00", "entry"),
        punch("1003", "2026-11-05", "06:05", "exit"),
        punch("1003", "2026-11-05", "17:31", "exit"), // 退勤から3時間を超えている
      ],
      now: LATER,
    });
    expect(rows.map((r) => [r.date, r.times.entry, r.times.exit, r.notes])).toEqual([
      ["2026-11-04", "22:00", "06:05", []],
      ["2026-11-05", "", "17:31", ["出勤がありません"]],
    ]);
  });

  test("退勤のあと3時間のうちに、もう一度退勤を押したら、後の退勤を入れて知らせる", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry"),
        punch("1001", "2026-11-04", "18:00", "exit"),
        punch("1001", "2026-11-04", "20:00", "exit"),
      ],
      now: LATER,
    });
    expect(rows[0].times.exit).toBe("20:00");
    expect(rows[0].notes).toEqual(["退勤を2回押しています（18:00・20:00）。最後の退勤を入れました"]);
  });

  test("出勤を2回押したら、初めの出勤を入れて、後の打刻は同じ勤務に入れる", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "08:58", "entry"),
        punch("1001", "2026-11-04", "09:01", "entry"),
        punch("1001", "2026-11-04", "18:00", "exit"),
      ],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(times(rows[0])).toBe("08:58 18:00");
    expect(rows[0].notes).toEqual(["出勤を2回押しています（8:58・9:01）。初めの出勤を入れました"]);
  });

  test("退勤を押し忘れた：24時間たつまでは知らせず、たったら「退勤がありません」", () => {
    const punches = [punch("1001", "2026-11-04", "09:00", "entry")];
    expect(buildDayRows({ punches, now: jstMs("2026-11-04", "20:00") })[0].notes).toEqual([]);
    expect(buildDayRows({ punches, now: jstMs("2026-11-05", "09:00") })[0].notes).toEqual(["退勤がありません"]);
  });

  test("退勤を押し忘れて次の日に出勤したら、前の日に「退勤がありません」を出し、次の日は新しい勤務にする", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry"),
        punch("1001", "2026-11-05", "08:50", "entry"),
        punch("1001", "2026-11-05", "18:00", "exit"),
      ],
      now: jstMs("2026-11-05", "19:00"),
    });
    expect(rows.map((r) => [r.date, times(r), r.notes])).toEqual([
      ["2026-11-04", "09:00", ["退勤がありません"]],
      ["2026-11-05", "08:50 18:00", []],
    ]);
  });

  test("1日に2回出勤した日は、1回目を入れて、2回目を注意に書く", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry"),
        punch("1001", "2026-11-04", "12:00", "exit"),
        punch("1001", "2026-11-04", "17:00", "entry"),
        punch("1001", "2026-11-04", "21:00", "exit"),
      ],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(times(rows[0])).toBe("09:00 12:00");
    expect(rows[0].notes).toEqual(["1日に2回出勤しています（2回目 17:00〜21:00）。2回目は Q に入りません"]);
  });

  test("休憩は何回でも、押した順に組にして入れる。休憩終のない休憩・押し直しを知らせる（中抜けも休憩として押す）", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry"),
        punch("1001", "2026-11-04", "12:00", "break_start"),
        punch("1001", "2026-11-04", "12:01", "break_start"),
        punch("1001", "2026-11-04", "13:00", "break_end"),
        punch("1001", "2026-11-04", "15:00", "break_start"),
        punch("1001", "2026-11-04", "15:10", "break_end"),
        punch("1001", "2026-11-04", "16:00", "break_start"),
        punch("1001", "2026-11-04", "18:00", "exit"),
      ],
      now: LATER,
    });
    expect(times(rows[0])).toBe("09:00 18:00 12:00-13:00 15:00-15:10 16:00-");
    expect(rows[0].notes).toEqual([
      "休憩始を2回押しています（12:00・12:01）。初めのほうを入れました",
      "休憩終がありません（休憩始 16:00）",
    ]);
  });

  test("休憩始のない休憩終も入れて知らせる。退勤のあとの休憩は入れずに知らせる", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry"),
        punch("1001", "2026-11-04", "13:00", "break_end"),
        punch("1001", "2026-11-04", "18:00", "exit"),
        punch("1001", "2026-11-04", "18:01", "break_start"),
      ],
      now: LATER,
    });
    expect(rows[0].times).toEqual({ entry: "09:00", exit: "18:00" });
    expect(rows[0].breaks).toEqual([{ start: "", end: "13:00" }]);
    expect(rows[0].notes).toEqual([
      "休憩始がありません（休憩終 13:00）",
      "ほかに 休憩始 18:01 を押しています（その日の勤務と合わないので、Q には入りません）",
    ]);
  });

  test("出勤のない日の休憩も、組にして入れる", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "12:00", "break_start"),
        punch("1001", "2026-11-04", "13:00", "break_end"),
        punch("1001", "2026-11-04", "18:00", "exit"),
      ],
      now: LATER,
    });
    expect(times(rows[0])).toBe("18:00 12:00-13:00");
    expect(rows[0].notes).toEqual(["出勤がありません"]);
  });

  test("カードなし：行に入れた打刻のうち、ID で押した種類", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry", "id"),
        punch("1001", "2026-11-04", "12:00", "break_start"),
        punch("1001", "2026-11-04", "13:00", "break_end", "id"),
        punch("1001", "2026-11-04", "18:00", "exit"),
      ],
      now: LATER,
    });
    expect(rows[0].cardless).toEqual(["entry", "break_end"]);
    expect(rows[0].web).toEqual([]);
    const later = buildDayRows({
      punches: [
        punch("1001", "2026-11-05", "09:00", "entry"),
        punch("1001", "2026-11-05", "12:00", "break_start"),
        punch("1001", "2026-11-05", "13:00", "break_end"),
        punch("1001", "2026-11-05", "15:00", "break_start", "web"),
        punch("1001", "2026-11-05", "15:10", "break_end", "web"),
        punch("1001", "2026-11-05", "18:00", "exit"),
      ],
      now: LATER,
    });
    // 2回目の休憩をブラウザで押した
    expect(later[0].web).toEqual(["break_start", "break_end"]);
  });

  test("ブラウザ：行に入れた打刻のうち、ブラウザで押した種類。CSV の「ブラウザ」の列に書き、読める", () => {
    const rows = buildDayRows({
      punches: [
        punch("1001", "2026-11-04", "09:00", "entry", "web"),
        punch("1001", "2026-11-04", "18:00", "exit", "id"),
      ],
      now: LATER,
    });
    expect([rows[0].web, rows[0].cardless]).toEqual([["entry"], ["exit"]]);
    const csv = writeTimeQardCsv([{ ...rows[0], name: "山田 太郎", companyMark: "K7M3QP2X" }]);
    const { records } = parseCsvRecords(csv);
    expect(records[0].values["ブラウザ"]).toBe("出勤");
    expect(parseCardlessKinds(records[0].values["ブラウザ"])).toEqual(["entry"]);
  });

  test("申し出：同じ日・同じ種類なら後の申し出を使い、打刻のない日も行を作る", () => {
    const rows = buildDayRows({
      punches: [],
      requests: [
        request("1001", "2026-11-06", "exit", "18:00", "押し間違えた", "", jstMs("2026-11-07", "09:00")),
        request("1001", "2026-11-06", "exit", "19:00", "押し間違えた", "会議が長引いた", jstMs("2026-11-07", "09:05")),
        request("1001", "2026-11-06", "entry", "09:00", "カードを忘れて押せなかった"),
      ],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(times(rows[0])).toBe("");
    expect(rows[0].notes).toEqual([]);
    expect(rows[0].requests).toEqual({ entry: "09:00", exit: "19:00" });
    expect(rows[0].noBreakRequest).toBe(false);
    expect(rows[0].requestReason).toBe("出勤：カードを忘れて押せなかった／退勤：押し間違えた（会議が長引いた）");
  });

  test("休憩の申し出（始めと終わり）は、ちがう時刻ならどれも入れ、理由の文に時刻を書く。「休憩を取れなかった」は最後に書く", () => {
    const rows = buildDayRows({
      punches: [punch("1001", "2026-11-06", "09:00", "entry"), punch("1001", "2026-11-06", "18:00", "exit")],
      requests: [
        request("1001", "2026-11-06", "no_break", "", NO_BREAK_LABEL, "来客が続いた", jstMs("2026-11-06", "18:01")),
        request("1001", "2026-11-06", "break", "15:00", "押し忘れた", "病院", jstMs("2026-11-06", "18:02"), "17:00"),
        request("1001", "2026-11-06", "break", "12:00", "押し忘れた", "", jstMs("2026-11-06", "18:03"), "13:00"),
        request("1001", "2026-11-06", "break", "12:00", "押し間違えた", "", jstMs("2026-11-06", "18:04"), "13:00"),
      ],
      now: LATER,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].noBreakRequest).toBe(true);
    expect(rows[0].requests).toEqual({});
    expect(rows[0].requestBreaks).toEqual([{ start: "12:00", end: "13:00" }, { start: "15:00", end: "17:00" }]);
    expect(rows[0].requestReason).toBe(
      "休憩（12:00〜13:00）：押し間違えた／休憩（15:00〜17:00）：押し忘れた（病院）／休憩なし：休憩を取れなかった（来客が続いた）"
    );
  });

  test("期間で選び、ID の数の順・日付の順に並べる", () => {
    const rows = buildDayRows({
      punches: [
        punch("10", "2026-11-04", "09:00", "entry"),
        punch("2", "2026-11-05", "09:00", "entry"),
        punch("2", "2026-11-03", "09:00", "entry"),
        punch("2", "2026-11-20", "22:00", "entry"),
        punch("2", "2026-11-21", "06:00", "exit"),
        punch("2", "2026-11-21", "22:00", "entry"),
      ],
      now: LATER,
      from: "2026-11-04",
      to: "2026-11-20",
    });
    expect(rows.map((r) => `${r.staffId} ${r.date} ${times(r)}`)).toEqual([
      "2 2026-11-05 09:00",
      "2 2026-11-20 22:00 06:00",
      "10 2026-11-04 09:00",
    ]);
  });
});

describe("いまの状態（打刻の画面で、押すはずのボタンを大きくする）", () => {
  test("出勤前 → 出勤中 → 休憩中 → 出勤中 → 退勤済み → 次の日は出勤前", () => {
    const ps: Punch[] = [];
    const at = (time: string) => jstMs("2026-11-04", time);
    expect(workStateOf(ps, at("08:00"))).toBe("before");
    ps.push(punch("1", "2026-11-04", "08:58", "entry"));
    expect(workStateOf(ps, at("09:00"))).toBe("working");
    ps.push(punch("1", "2026-11-04", "12:00", "break_start"));
    expect(workStateOf(ps, at("12:30"))).toBe("on_break");
    ps.push(punch("1", "2026-11-04", "13:00", "break_end"));
    expect(workStateOf(ps, at("13:30"))).toBe("working");
    ps.push(punch("1", "2026-11-04", "15:00", "break_start"));
    expect(workStateOf(ps, at("15:30"))).toBe("on_break");
    ps.push(punch("1", "2026-11-04", "16:00", "break_end"));
    expect(workStateOf(ps, at("16:30"))).toBe("working");
    ps.push(punch("1", "2026-11-04", "18:00", "exit"));
    expect(workStateOf(ps, at("18:30"))).toBe("done");
    expect(workStateOf(ps, jstMs("2026-11-05", "08:00"))).toBe("before");
  });

  test("夜勤の途中は、日をまたいでも出勤中", () => {
    const ps = [punch("1", "2026-11-04", "22:00", "entry")];
    expect(workStateOf(ps, jstMs("2026-11-05", "03:00"))).toBe("working");
    expect(workStateOf(ps, jstMs("2026-11-05", "22:00"))).toBe("before"); // 24時間たった
  });
});
