/**
 * TimeQard の記録（SQLite の1つのファイル。くわしくは timeqard/DESIGN.md の 4.2・付録 D）
 *
 * ・打刻・申し出・取り消しは、足すだけにする（表のトリガーで、書き換えと削除を止める）。
 * ・取り消しは、元の打刻（申し出）を消さずに「取り消した」という記録を足す。
 * ・従業員は、会社の印ごとに持つ。従業員ファイルを読み込み直すと入れ替えるが、一覧から消えた人も、CSV に名前を出すために残す。
 * ・1日の行（出勤・退勤…）は、記録から毎回計算し、表には残さない（shared/timeqard/days.ts）。
 */
import {
  addDays,
  buildDayRows,
  isPunchKind,
  jstDate,
  jstIso,
  jstMs,
  parseIso,
  type DayRow,
  type Punch,
  type PunchKind,
  type PunchMethod,
  type PunchRequest,
  type StaffFile,
  type TimeQardCsvRow,
} from "../../shared/timeqard";

/** ここで使う DB の操作（tauri-plugin-sql の Database と同じ使い方） */
export interface KioskDb {
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

/** TimeQard の記録のファイルの印（SQLite の application_id。"TQ01" の文字コード） */
export const TIMEQARD_FILE_ID = 0x54513031;
export const TIMEQARD_DB_VERSION = 1;

const appendOnly = (table: string, label: string) => [
  `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${label}は書き換えられません'); END;`,
  `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${label}は消せません'); END;`,
];

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('entry', 'exit', 'break_start', 'break_end', 'out', 'return')),
    pressed_at TEXT NOT NULL,        -- 押した日時（日本時間。「2026-11-07T08:58:30+09:00」）
    pressed_ms INTEGER NOT NULL,     -- 押した日時（1970年からのミリ秒。並べる・期間で選ぶのに使う）
    method TEXT NOT NULL CHECK (method IN ('card', 'id')),
    company_mark TEXT NOT NULL       -- 押したときの会社の印
  );`,
  `CREATE INDEX IF NOT EXISTS punches_by_time ON punches(company_mark, pressed_ms);`,
  `CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    work_date TEXT NOT NULL,         -- 申し出た日（「2026-11-07」）
    kind TEXT NOT NULL CHECK (kind IN ('entry', 'exit', 'break_start', 'break_end', 'out', 'return')),
    time TEXT NOT NULL,              -- 申し出た時刻（「09:00」）
    reason TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    requested_at TEXT NOT NULL,
    requested_ms INTEGER NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('card', 'id')),
    company_mark TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL CHECK (target IN ('punch', 'request')),
    target_id INTEGER NOT NULL,
    cancelled_at TEXT NOT NULL,
    UNIQUE (target, target_id)
  );`,
  ...appendOnly("punches", "打刻"),
  ...appendOnly("requests", "申し出"),
  ...appendOnly("cancellations", "取り消しの記録"),
  `CREATE TABLE IF NOT EXISTS staff (
    company_mark TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    join_date TEXT,
    retirement_date TEXT,
    card_hashes TEXT NOT NULL DEFAULT '[]', -- カードの確かめ用の値（JSON の配列）
    in_file INTEGER NOT NULL DEFAULT 1,     -- いま読み込んでいる従業員ファイルにいるか（0 の人は押せない。名前は CSV に出す）
    PRIMARY KEY (company_mark, id)
  );`,
  `CREATE TABLE IF NOT EXISTS staff_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    company_mark TEXT NOT NULL,
    exported_at TEXT NOT NULL,       -- Q で書き出した日時
    loaded_at TEXT NOT NULL,         -- 読み込んだ日時
    staff_count INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_mark TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    file_name TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    exported_at TEXT NOT NULL
  );`,
];

const readPragma = async (db: KioskDb, name: "user_version" | "application_id") => {
  const rows = await db.select<Record<string, number>[]>(`PRAGMA ${name}`);
  return Number(rows?.[0]?.[name] ?? 0);
};

/** 記録のファイルを開いたときに、表を作る（新しいファイルには印と番号を付ける。ほかのソフトのファイルは触らない） */
export const prepareDb = async (db: KioskDb) => {
  const tables = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'");
  const isNew = Number(tables?.[0]?.n ?? 0) === 0;
  if (!isNew) {
    const fileId = await readPragma(db, "application_id");
    if (fileId !== TIMEQARD_FILE_ID) throw new Error("TimeQard の記録のファイルではありません。");
    const version = await readPragma(db, "user_version");
    if (version > TIMEQARD_DB_VERSION) throw new Error("新しい TimeQard で使っていた記録です。TimeQard を新しくしてください。");
  }
  for (const s of SCHEMA) await db.execute(s);
  if (isNew) {
    await db.execute(`PRAGMA application_id = ${TIMEQARD_FILE_ID}`);
    await db.execute(`PRAGMA user_version = ${TIMEQARD_DB_VERSION}`);
  }
};

// --- 設定 ---

export interface KioskSettings {
  adminPasswordHash: string | null;
  companyMark: string | null;
  companyName: string;
  staffFileExportedAt: string | null;
  showBreak: boolean;
  showOut: boolean;
  sound: boolean;
  fullscreen: boolean;
  /** カメラで QR コードを読むか（初めは読む） */
  camera: boolean;
  /** 使うカメラ（空なら、いつものカメラ） */
  cameraDevice: string;
  backupDir: string;
  lastBackupDate: string;
  lastBackupError: string;
}

export const getSetting = async (db: KioskDb, key: string) => {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = ?", [key]);
  return rows?.[0]?.value ?? null;
};

export const setSetting = async (db: KioskDb, key: string, value: string) => {
  await db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
};

export const loadSettings = async (db: KioskDb): Promise<KioskSettings> => {
  const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings");
  const m = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const flag = (key: string, initial: boolean) => (m.has(key) ? m.get(key) === "1" : initial);
  return {
    adminPasswordHash: m.get("admin_password_hash") ?? null,
    companyMark: m.get("company_mark") ?? null,
    companyName: m.get("company_name") ?? "",
    staffFileExportedAt: m.get("staff_file_exported_at") ?? null,
    showBreak: flag("show_break", true), // 初めは、休憩は出す
    showOut: flag("show_out", false), // 初めは、外出は出さない
    sound: flag("sound", true),
    fullscreen: flag("fullscreen", false),
    camera: flag("camera", true),
    cameraDevice: m.get("camera_device") ?? "",
    backupDir: m.get("backup_dir") ?? "",
    lastBackupDate: m.get("last_backup_date") ?? "",
    lastBackupError: m.get("last_backup_error") ?? "",
  };
};

// --- 従業員 ---

export interface KioskStaff {
  id: string;
  name: string;
  joinDate: string | null;
  retirementDate: string | null;
  cardHashes: string[];
  inFile: boolean;
}

export const loadStaff = async (db: KioskDb, companyMark: string): Promise<KioskStaff[]> => {
  const rows = await db.select<{ id: string; name: string; join_date: string | null; retirement_date: string | null; card_hashes: string; in_file: number }[]>(
    "SELECT id, name, join_date, retirement_date, card_hashes, in_file FROM staff WHERE company_mark = ?",
    [companyMark]
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    joinDate: r.join_date,
    retirementDate: r.retirement_date,
    cardHashes: JSON.parse(r.card_hashes || "[]"),
    inFile: Number(r.in_file) === 1,
  }));
};

/**
 * 従業員ファイルの中身を入れる（その会社の印の従業員を入れ替える。一覧から消えた人は、押せないようにして名前を残す）。
 * 会社の印・会社名・書き出した日時を、いまの設定にする。
 */
export const applyStaffFile = async (db: KioskDb, file: StaffFile, loadedAt: string) => {
  const before = await loadStaff(db, file.companyMark);
  const ids = new Set(file.staff.map((s) => s.id));
  for (const s of file.staff) {
    await db.execute(
      `INSERT INTO staff (company_mark, id, name, join_date, retirement_date, card_hashes, in_file) VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(company_mark, id) DO UPDATE SET name = excluded.name, join_date = excluded.join_date,
         retirement_date = excluded.retirement_date, card_hashes = excluded.card_hashes, in_file = 1`,
      [file.companyMark, s.id, s.name, s.joinDate, s.retirementDate, JSON.stringify(s.cardHashes)]
    );
  }
  const removed = before.filter((s) => s.inFile && !ids.has(s.id));
  for (const s of removed) {
    await db.execute("UPDATE staff SET in_file = 0, card_hashes = '[]' WHERE company_mark = ? AND id = ?", [file.companyMark, s.id]);
  }
  await setSetting(db, "company_mark", file.companyMark);
  await setSetting(db, "company_name", file.companyName);
  await setSetting(db, "staff_file_exported_at", file.exportedAt);
  await db.execute(
    "INSERT INTO staff_files (company_name, company_mark, exported_at, loaded_at, staff_count) VALUES (?, ?, ?, ?, ?)",
    [file.companyName, file.companyMark, file.exportedAt, loadedAt, file.staff.length]
  );
  const beforeIds = new Set(before.filter((s) => s.inFile).map((s) => s.id));
  return {
    added: file.staff.filter((s) => !beforeIds.has(s.id)).length,
    removed: removed.length,
    total: file.staff.length,
  };
};

// --- 打刻・申し出・取り消し ---

/** 取り消しができる長さ（押してから1分） */
export const CANCEL_WINDOW_MS = 60 * 1000;

export const addPunch = async (db: KioskDb, p: { staffId: string; kind: PunchKind; at: number; method: PunchMethod; companyMark: string }) => {
  const r = await db.execute(
    "INSERT INTO punches (staff_id, kind, pressed_at, pressed_ms, method, company_mark) VALUES (?, ?, ?, ?, ?, ?)",
    [p.staffId, p.kind, jstIso(p.at), p.at, p.method, p.companyMark]
  );
  return Number(r.lastInsertId);
};

export const addRequest = async (
  db: KioskDb,
  r: { staffId: string; date: string; kind: PunchKind; time: string; reason: string; note: string; at: number; method: PunchMethod; companyMark: string }
) => {
  const res = await db.execute(
    `INSERT INTO requests (staff_id, work_date, kind, time, reason, note, requested_at, requested_ms, method, company_mark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.staffId, r.date, r.kind, r.time, r.reason, r.note.trim(), jstIso(r.at), r.at, r.method, r.companyMark]
  );
  return Number(res.lastInsertId);
};

/** 取り消す（押してから1分のうちだけ。2回は取り消せない） */
export const cancelRecord = async (db: KioskDb, target: "punch" | "request", id: number, now: number) => {
  const table = target === "punch" ? "punches" : "requests";
  const col = target === "punch" ? "pressed_ms" : "requested_ms";
  const rows = await db.select<{ ms: number }[]>(`SELECT ${col} AS ms FROM ${table} WHERE id = ?`, [id]);
  const at = rows?.[0]?.ms;
  if (at === undefined) throw new Error("取り消す記録が見つかりません");
  if (now - Number(at) > CANCEL_WINDOW_MS) throw new Error("押してから1分を過ぎたので、取り消せません。押し忘れの申し出か、担当者に伝えてください。");
  await db.execute("INSERT OR IGNORE INTO cancellations (target, target_id, cancelled_at) VALUES (?, ?, ?)", [target, id, jstIso(now)]);
};

interface PunchRow {
  id: number;
  staff_id: string;
  kind: string;
  pressed_ms: number;
  method: string;
  cancelled: number;
}

const toPunch = (r: PunchRow): Punch => ({
  id: Number(r.id),
  staffId: String(r.staff_id),
  kind: isPunchKind(r.kind) ? r.kind : "entry",
  at: Number(r.pressed_ms),
  method: r.method === "id" ? "id" : "card",
});

/** 打刻（取り消していないもの）。期間は押した日時のミリ秒（from 以上・to 未満） */
export const loadPunches = async (db: KioskDb, args: { companyMark: string; fromMs: number; toMs: number; staffId?: string }) => {
  const rows = await db.select<PunchRow[]>(
    `SELECT p.id, p.staff_id, p.kind, p.pressed_ms, p.method, 0 AS cancelled FROM punches p
     WHERE p.company_mark = ? AND p.pressed_ms >= ? AND p.pressed_ms < ? ${args.staffId !== undefined ? "AND p.staff_id = ?" : ""}
       AND NOT EXISTS (SELECT 1 FROM cancellations c WHERE c.target = 'punch' AND c.target_id = p.id)
     ORDER BY p.pressed_ms, p.id`,
    args.staffId !== undefined ? [args.companyMark, args.fromMs, args.toMs, args.staffId] : [args.companyMark, args.fromMs, args.toMs]
  );
  return (rows ?? []).map(toPunch);
};

interface RequestRow {
  id: number;
  staff_id: string;
  work_date: string;
  kind: string;
  time: string;
  reason: string;
  note: string;
  requested_ms: number;
}

/** 申し出（取り消していないもの）。期間は申し出た日（その日を含む） */
export const loadRequests = async (db: KioskDb, args: { companyMark: string; from: string; to: string }): Promise<PunchRequest[]> => {
  const rows = await db.select<RequestRow[]>(
    `SELECT r.id, r.staff_id, r.work_date, r.kind, r.time, r.reason, r.note, r.requested_ms FROM requests r
     WHERE r.company_mark = ? AND r.work_date BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM cancellations c WHERE c.target = 'request' AND c.target_id = r.id)
     ORDER BY r.requested_ms, r.id`,
    [args.companyMark, args.from, args.to]
  );
  return (rows ?? [])
    .filter((r) => isPunchKind(r.kind))
    .map((r) => ({
      id: Number(r.id),
      staffId: String(r.staff_id),
      date: r.work_date,
      kind: r.kind as PunchKind,
      time: r.time,
      reason: r.reason,
      note: r.note ?? "",
      requestedAt: Number(r.requested_ms),
    }));
};

/** いちばん新しい打刻の日時（時計の確かめに使う） */
export const lastPunchMs = async (db: KioskDb): Promise<number | null> => {
  const rows = await db.select<{ ms: number | null }[]>("SELECT MAX(pressed_ms) AS ms FROM punches");
  const ms = rows?.[0]?.ms;
  return ms === null || ms === undefined ? null : Number(ms);
};

// --- 時計の確かめ ---

/** 時計が少し戻ったとき（インターネットの時計に合わせ直したときなど）に止めないための余裕 */
export const CLOCK_TOLERANCE_MS = 60 * 1000;

/**
 * パソコンの時計がおかしくないか（古いパソコンは、時計の電池が切れていて、電源を抜くと時計が戻ることがある）。
 * いまの時刻が、前に押した時刻より前か、従業員ファイルを書き出した日より前なら、わけを返す（打刻を止める）。
 */
export const clockProblem = (now: number, lastPunch: number | null, staffFileExportedAt: string | null): string | null => {
  if (lastPunch !== null && now < lastPunch - CLOCK_TOLERANCE_MS) {
    return `パソコンの時計が、前に押した時刻（${jstDate(lastPunch)} ${jstIso(lastPunch).slice(11, 16)}）より前になっています。`;
  }
  const exported = staffFileExportedAt ? parseIso(staffFileExportedAt) : null;
  if (exported !== null && jstDate(now) < jstDate(exported)) {
    return `パソコンの時計が、従業員ファイルを書き出した日（${jstDate(exported)}）より前になっています。`;
  }
  return null;
};

// --- CSV に書き出す行 ---

/**
 * 期間（その日を含む）の、1人1日1行。夜勤の勤務を正しくまとめるため、前の日と次の日の打刻も読んでから、期間の行だけを返す。
 */
export const exportRows = async (db: KioskDb, args: { companyMark: string; from: string; to: string; now: number }): Promise<TimeQardCsvRow[]> => {
  const punches = await loadPunches(db, {
    companyMark: args.companyMark,
    fromMs: jstMs(addDays(args.from, -1)),
    toMs: jstMs(addDays(args.to, 2)),
  });
  const requests = await loadRequests(db, { companyMark: args.companyMark, from: args.from, to: args.to });
  const rows: DayRow[] = buildDayRows({ punches, requests, now: args.now, from: args.from, to: args.to });
  const names = new Map((await loadStaff(db, args.companyMark)).map((s) => [s.id, s.name]));
  return rows.map((r) => ({ ...r, name: names.get(r.staffId) ?? "", companyMark: args.companyMark }));
};

export const recordExport = async (db: KioskDb, e: { companyMark: string; from: string; to: string; fileName: string; rowCount: number; at: number }) => {
  await db.execute(
    "INSERT INTO exports (company_mark, from_date, to_date, file_name, row_count, exported_at) VALUES (?, ?, ?, ?, ?, ?)",
    [e.companyMark, e.from, e.to, e.fileName, e.rowCount, jstIso(e.at)]
  );
};

// --- 管理の画面の一覧 ---

export interface DayEvent {
  type: "punch" | "request";
  id: number;
  staffId: string;
  name: string;
  /** 押した（申し出た）日時のミリ秒 */
  at: number;
  kind: PunchKind;
  method: PunchMethod;
  cancelled: boolean;
  /** 申し出：日・時刻・理由 */
  requestDate?: string;
  requestTime?: string;
  reason?: string;
  note?: string;
}

/** その日（日本時間）に押した打刻と、その日の分の申し出（取り消したものも、印を付けて出す） */
export const loadDayEvents = async (db: KioskDb, companyMark: string, date: string): Promise<DayEvent[]> => {
  const names = new Map((await loadStaff(db, companyMark)).map((s) => [s.id, s.name]));
  const punches = await db.select<(PunchRow & { cancelled: number })[]>(
    `SELECT p.id, p.staff_id, p.kind, p.pressed_ms, p.method,
       EXISTS (SELECT 1 FROM cancellations c WHERE c.target = 'punch' AND c.target_id = p.id) AS cancelled
     FROM punches p WHERE p.company_mark = ? AND p.pressed_ms >= ? AND p.pressed_ms < ?`,
    [companyMark, jstMs(date), jstMs(addDays(date, 1))]
  );
  const requests = await db.select<(RequestRow & { method: string; cancelled: number })[]>(
    `SELECT r.id, r.staff_id, r.work_date, r.kind, r.time, r.reason, r.note, r.requested_ms, r.method,
       EXISTS (SELECT 1 FROM cancellations c WHERE c.target = 'request' AND c.target_id = r.id) AS cancelled
     FROM requests r WHERE r.company_mark = ? AND r.work_date = ?`,
    [companyMark, date]
  );
  const events: DayEvent[] = [
    ...(punches ?? []).map((r) => ({
      type: "punch" as const,
      id: Number(r.id),
      staffId: String(r.staff_id),
      name: names.get(String(r.staff_id)) ?? "",
      at: Number(r.pressed_ms),
      kind: (isPunchKind(r.kind) ? r.kind : "entry") as PunchKind,
      method: (r.method === "id" ? "id" : "card") as PunchMethod,
      cancelled: Number(r.cancelled) === 1,
    })),
    ...(requests ?? []).map((r) => ({
      type: "request" as const,
      id: Number(r.id),
      staffId: String(r.staff_id),
      name: names.get(String(r.staff_id)) ?? "",
      at: Number(r.requested_ms),
      kind: (isPunchKind(r.kind) ? r.kind : "entry") as PunchKind,
      method: (r.method === "id" ? "id" : "card") as PunchMethod,
      cancelled: Number(r.cancelled) === 1,
      requestDate: r.work_date,
      requestTime: r.time,
      reason: r.reason,
      note: r.note ?? "",
    })),
  ];
  return events.sort((a, b) => a.staffId.localeCompare(b.staffId, "ja", { numeric: true }) || a.at - b.at || a.id - b.id);
};
