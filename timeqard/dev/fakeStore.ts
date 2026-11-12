/**
 * 確かめ用の画面（dev/preview.html）で、記録のファイル（src/store.ts）の代わりに使うもの（開発用。配るものには入らない）
 *
 * 記録をブラウザの中（配列）に持つ。打刻・申し出・取り消しの決まり（1分の取り消し・1日のまとめ方・会社の印ごとの従業員）と、
 * ブラウザ版のパスワード・ログインの記録は、src/store.ts と同じにする（本物の SQLite の動きは、src/store.test.ts・src/webApi.test.ts で確かめている）。
 */
import {
  addDays,
  buildDayRows,
  jstDate,
  jstIso,
  jstMs,
  type PunchKind,
  type PunchMethod,
  type PunchRequest,
  type RequestKind,
  type StaffFile,
  type TimeQardCsvRow,
} from "../../shared/timeqard";
import { DEFAULT_WEB_PORT } from "../src/store";
import type { DayEvent, KioskDb, KioskSettings, KioskStaff, WebAccount, WebLogin } from "../src/store";
export { ADMIN_LOGIN_ID, CANCEL_WINDOW_MS, CLOCK_TOLERANCE_MS, clockProblem, DEFAULT_WEB_PORT, methodOf } from "../src/store";
export type { DayEvent, KioskDb, KioskSettings, KioskStaff, WebAccount, WebLogin } from "../src/store";

interface PunchRec { id: number; staffId: string; kind: PunchKind; at: number; method: PunchMethod; clientIp: string; mark: string }
interface RequestRec extends PunchRequest { method: PunchMethod; clientIp: string; mark: string }

const settings = new Map<string, string>();
const staff: (KioskStaff & { mark: string })[] = [];
const punches: PunchRec[] = [];
const requests: RequestRec[] = [];
const cancelled = new Set<string>();
const webAccounts: (WebAccount & { mark: string })[] = [];
const webLogins: (WebLogin & { mark: string })[] = [];
let nextId = 1;

// 開発者の道具の Console から中身を見られるように
Object.assign(((window as any).__timeqardPreview ??= {}), { settings, staff, punches, requests, cancelled, webAccounts, webLogins });

export const prepareDb = async (_db: KioskDb) => {};

export const getSetting = async (_db: KioskDb, key: string) => settings.get(key) ?? null;
export const setSetting = async (_db: KioskDb, key: string, value: string) => {
  settings.set(key, value);
};

export const loadSettings = async (_db: KioskDb): Promise<KioskSettings> => {
  const flag = (key: string, initial: boolean) => (settings.has(key) ? settings.get(key) === "1" : initial);
  return {
    adminPasswordHash: settings.get("admin_password_hash") ?? null,
    companyMark: settings.get("company_mark") ?? null,
    companyName: settings.get("company_name") ?? "",
    staffFileExportedAt: settings.get("staff_file_exported_at") ?? null,
    showBreak: flag("show_break", true),
    sound: flag("sound", true),
    fullscreen: flag("fullscreen", false),
    camera: flag("camera", true),
    cameraDevice: settings.get("camera_device") ?? "",
    webEnabled: flag("web_enabled", false),
    webPort: Number(settings.get("web_port")) || DEFAULT_WEB_PORT,
    backupDir: settings.get("backup_dir") ?? "",
    lastBackupDate: settings.get("last_backup_date") ?? "",
    lastBackupError: settings.get("last_backup_error") ?? "",
  };
};

export const loadStaff = async (_db: KioskDb, mark: string): Promise<KioskStaff[]> =>
  staff.filter((s) => s.mark === mark).map(({ mark: _m, ...s }) => ({ ...s, cardHashes: [...s.cardHashes] }));

export const applyStaffFile = async (_db: KioskDb, file: StaffFile, _loadedAt: string) => {
  const before = staff.filter((s) => s.mark === file.companyMark && s.inFile).map((s) => s.id);
  const ids = new Set(file.staff.map((s) => s.id));
  for (const s of file.staff) {
    const existing = staff.find((x) => x.mark === file.companyMark && x.id === s.id);
    const rec = { mark: file.companyMark, id: s.id, name: s.name, joinDate: s.joinDate, retirementDate: s.retirementDate, cardHashes: [...s.cardHashes], inFile: true };
    if (existing) Object.assign(existing, rec);
    else staff.push(rec);
  }
  let removed = 0;
  for (const s of staff) {
    if (s.mark === file.companyMark && s.inFile && !ids.has(s.id)) {
      s.inFile = false;
      s.cardHashes = [];
      removed++;
      const i = webAccounts.findIndex((a) => a.mark === file.companyMark && a.staffId === s.id);
      if (i >= 0) webAccounts.splice(i, 1);
    }
  }
  settings.set("company_mark", file.companyMark);
  settings.set("company_name", file.companyName);
  settings.set("staff_file_exported_at", file.exportedAt);
  return { added: file.staff.filter((s) => !before.includes(s.id)).length, removed, total: file.staff.length };
};

export const addPunch = async (
  _db: KioskDb,
  p: { staffId: string; kind: PunchKind; at: number; method: PunchMethod; companyMark: string; clientIp?: string }
) => {
  const id = nextId++;
  punches.push({ id, staffId: p.staffId, kind: p.kind, at: p.at, method: p.method, clientIp: p.clientIp ?? "", mark: p.companyMark });
  return id;
};

export const addRequest = async (
  _db: KioskDb,
  r: {
    staffId: string; date: string; kind: RequestKind; time: string; endTime?: string; reason: string; note: string; at: number; method: PunchMethod;
    companyMark: string; clientIp?: string;
  }
) => {
  const id = nextId++;
  requests.push({
    id, staffId: r.staffId, date: r.date, kind: r.kind, time: r.time, endTime: r.kind === "break" ? r.endTime ?? "" : "", reason: r.reason,
    note: r.note.trim(), requestedAt: r.at, method: r.method, clientIp: r.clientIp ?? "", mark: r.companyMark,
  });
  return id;
};

export const cancelRecord = async (_db: KioskDb, target: "punch" | "request", id: number, now: number) => {
  const at = target === "punch" ? punches.find((p) => p.id === id)?.at : requests.find((r) => r.id === id)?.requestedAt;
  if (at === undefined) throw new Error("取り消す記録が見つかりません");
  if (now - at > 60_000) throw new Error("押してから1分を過ぎたので、取り消せません。押し忘れの申し出か、担当者に伝えてください。");
  cancelled.add(`${target}:${id}`);
};

export const loadPunches = async (_db: KioskDb, a: { companyMark: string; fromMs: number; toMs: number; staffId?: string }) =>
  punches
    .filter((p) => p.mark === a.companyMark && p.at >= a.fromMs && p.at < a.toMs && (a.staffId === undefined || p.staffId === a.staffId) && !cancelled.has(`punch:${p.id}`))
    .map(({ id, staffId, kind, at, method }) => ({ id, staffId, kind, at, method }));

export const loadRequests = async (_db: KioskDb, a: { companyMark: string; from: string; to: string }): Promise<PunchRequest[]> =>
  requests.filter((r) => r.mark === a.companyMark && r.date >= a.from && r.date <= a.to && !cancelled.has(`request:${r.id}`));

export const lastPunchMs = async (_db: KioskDb) => (punches.length ? Math.max(...punches.map((p) => p.at)) : null);

export const exportRows = async (db: KioskDb, a: { companyMark: string; from: string; to: string; now: number }): Promise<TimeQardCsvRow[]> => {
  const ps = await loadPunches(db, { companyMark: a.companyMark, fromMs: jstMs(addDays(a.from, -1)), toMs: jstMs(addDays(a.to, 2)) });
  const rs = await loadRequests(db, a);
  const names = new Map(staff.filter((s) => s.mark === a.companyMark).map((s) => [s.id, s.name]));
  return buildDayRows({ punches: ps, requests: rs, now: a.now, from: a.from, to: a.to }).map((r) => ({ ...r, name: names.get(r.staffId) ?? "", companyMark: a.companyMark }));
};

export const recordExport = async (_db: KioskDb, e: { fileName: string }) => {
  console.info("[確かめ用] 書き出した", e.fileName, jstIso(Date.now()));
};

export const loadDayEvents = async (_db: KioskDb, mark: string, date: string): Promise<DayEvent[]> => {
  const names = new Map(staff.filter((s) => s.mark === mark).map((s) => [s.id, s.name]));
  const events: DayEvent[] = [
    ...punches
      .filter((p) => p.mark === mark && jstDate(p.at) === date)
      .map((p) => ({
        type: "punch" as const, id: p.id, staffId: p.staffId, name: names.get(p.staffId) ?? "", at: p.at, kind: p.kind, method: p.method,
        cancelled: cancelled.has(`punch:${p.id}`), clientIp: p.clientIp,
      })),
    ...requests
      .filter((r) => r.mark === mark && r.date === date)
      .map((r) => ({
        type: "request" as const,
        id: r.id,
        staffId: r.staffId,
        name: names.get(r.staffId) ?? "",
        at: r.requestedAt,
        kind: r.kind,
        method: r.method,
        cancelled: cancelled.has(`request:${r.id}`),
        clientIp: r.clientIp,
        requestDate: r.date,
        requestTime: r.time,
        requestEndTime: r.endTime,
        reason: r.reason,
        note: r.note,
      })),
  ];
  return events.sort((a, b) => a.staffId.localeCompare(b.staffId, "ja", { numeric: true }) || a.at - b.at);
};

// --- ブラウザ版：従業員のパスワードとログインの記録 ---

const copyAccount = ({ mark: _m, ...a }: WebAccount & { mark: string }): WebAccount => ({ ...a });

export const loadWebAccounts = async (_db: KioskDb, mark: string) => webAccounts.filter((a) => a.mark === mark).map(copyAccount);

export const loadWebAccount = async (_db: KioskDb, mark: string, staffId: string) => {
  const a = webAccounts.find((x) => x.mark === mark && x.staffId === staffId);
  return a ? copyAccount(a) : null;
};

export const saveWebPassword = async (
  _db: KioskDb,
  a: { companyMark: string; staffId: string; passwordHash: string; initial: boolean; initialExpiresMs: number | null; at: number }
) => {
  const rec = {
    mark: a.companyMark, staffId: a.staffId, passwordHash: a.passwordHash, initial: a.initial, initialExpiresMs: a.initialExpiresMs,
    failedCount: 0, lockedUntilMs: null, updatedAt: jstIso(a.at),
  };
  const existing = webAccounts.find((x) => x.mark === a.companyMark && x.staffId === a.staffId);
  if (existing) Object.assign(existing, rec);
  else webAccounts.push(rec);
};

export const saveWebFailures = async (_db: KioskDb, mark: string, staffId: string, failedCount: number, lockedUntilMs: number | null) => {
  const a = webAccounts.find((x) => x.mark === mark && x.staffId === staffId);
  if (a) Object.assign(a, { failedCount, lockedUntilMs });
};

export const deleteWebAccount = async (_db: KioskDb, mark: string, staffId: string) => {
  const i = webAccounts.findIndex((x) => x.mark === mark && x.staffId === staffId);
  if (i >= 0) webAccounts.splice(i, 1);
};

export const logWebLogin = async (_db: KioskDb, e: { companyMark: string; staffId: string; result: string; clientIp: string; at: number }) => {
  webLogins.push({ id: nextId++, mark: e.companyMark, staffId: e.staffId, result: e.result, clientIp: e.clientIp, at: e.at });
};

export const loadWebLogins = async (_db: KioskDb, mark: string, limit: number) =>
  webLogins
    .filter((l) => l.mark === mark)
    .sort((a, b) => b.at - a.at || b.id - a.id)
    .slice(0, limit)
    .map(({ mark: _m, ...l }) => l);
