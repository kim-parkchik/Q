/**
 * ブラウザ版の頼みを受けるところ（timeqard/DESIGN.md の 10）
 *
 * Rust のサーバー（src-tauri/src/web.rs）は、ブラウザから来た頼み（/api/<名前>）を、そのままこの画面に渡し、
 * ここで決めた答え（状態の番号と JSON）をブラウザに返す。記録のファイルには、ここで決めた口からしか触らせない。
 *
 * ・ログインは毎回、スタッフID とパスワードで。ログインの印（token）は、この画面の中（メモリ）にだけ持つ。
 *   5分のあいだ何もしなければ、ログアウトにする。打刻したら、すぐにログアウトにする（取り消しは、1分だけ使える札で）。
 * ・はじめのパスワードは、管理者が人ごとに作って渡す（7日まで）。本人が自分のパスワードに変えるまで、押せない。
 * ・5回続けてまちがえたら、15分は使えない（人ごと。ブラウザの管理の画面も同じ）。1台のパソコンから何人分も試せないように、
 *   つないできたアドレスごとにも数える。
 * ・時刻は、このパソコン（入口のパソコン）の時計で記録する。本人が時刻を選べるのは、押し忘れの申し出だけ。
 * ・本人の分しか見せない・押させない。パスワードはそのまま残さず、確かめ用の値（Argon2）だけを残す。
 */
import {
  addDays,
  DAY_MS,
  isDateString,
  isPunchKind,
  isRequestKind,
  isRequestReason,
  isTimeString,
  jstDate,
  jstMs,
  jstTime,
  monthRange,
  NO_BREAK_LABEL,
  PUNCH_LABELS,
  safeFileNamePart,
  shortDateLabel,
  timeLabel,
  WORK_STATE_LABELS,
  workStateOf,
  writeTimeQardCsv,
  buildDayRows,
  compareStaffId,
  type PunchKind,
  type PunchMethod,
  type RequestKind,
  type TimeQardCsvRow,
  type TimeRequestKind,
  type TimeSpan,
  type WorkState,
} from "../../shared/timeqard";
import { availableKinds, breakEndDate, findById, punchBlockReason, requestWhatLabel, suggestedKind } from "./kioskRules";
import { cryptoRandomBytes, newInitialPassword, normalizePassword, passwordProblem } from "./passwordRules";
import {
  ADMIN_LOGIN_ID,
  addPunch,
  addRequest,
  CANCEL_WINDOW_MS,
  cancelRecord,
  clockProblem,
  deleteWebAccount,
  exportRows,
  getSetting,
  lastPunchMs,
  loadPunches,
  loadRequests,
  loadSettings,
  loadStaff,
  loadWebAccount,
  loadWebAccounts,
  logWebLogin,
  recordExport,
  saveWebFailures,
  saveWebPassword,
  setSetting,
  type KioskDb,
  type KioskSettings,
  type KioskStaff,
  type WebAccount,
} from "./store";

/** 何もしなければログアウトにするまでの長さ */
export const SESSION_IDLE_MS = 5 * 60 * 1000;
/** 続けてこの回数まちがえたら、しばらく使えなくする */
export const MAX_FAILURES = 5;
/** 使えなくする長さ */
export const LOCK_MS = 15 * 60 * 1000;
/** 1台のパソコン（つないできたアドレス）から、この長さのうちにこの回数まちがえたら、そのパソコンからのログインを止める */
export const IP_MAX_FAILURES = 20;
export const IP_WINDOW_MS = 15 * 60 * 1000;
/** はじめのパスワードの期限 */
export const INITIAL_PASSWORD_DAYS = 7;
/** 押し忘れの申し出ができる日（今日から、この日数前まで。入口のパソコンの申し出と同じ） */
export const REQUEST_DAYS_BACK = 31;
/** ブラウザから CSV をダウンロードできる期間の長さ */
export const MAX_CSV_DAYS = 366;

/** ログインの記録の結果 */
export const LOGIN_RESULT_LABELS: Record<string, string> = {
  ok: "ログインした",
  wrong: "パスワード（ID）のまちがい",
  locked: "まちがいが続いて止めた",
  expired: "はじめのパスワードの期限切れ",
  no_account: "パスワードがまだない",
  ip_blocked: "このパソコンからのログインを止めていた",
  changed: "本人がパスワードを変えた",
  issued: "管理者がはじめのパスワードを作った",
  cleared: "管理者がパスワードを消した",
};

export interface WebDeps {
  db: KioskDb;
  /** パスワードの確かめ用の値を作る・確かめる（本物は Rust の Argon2） */
  hash: (password: string) => Promise<string>;
  verify: (password: string, hash: string) => Promise<boolean>;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  /** 打刻したあと・取り消したあと（入口のパソコンの画面の、最後に押した時刻を読み直す） */
  onChanged?: () => void | Promise<void>;
}

export interface WebAnswer {
  status: number;
  /** JSON にして返す中身（うまくいかなかったときは { error: わけ }） */
  body: object;
}

// --- ブラウザの画面に返す形（src/web/ も使う） ---

/** 本人の画面 */
export interface WebHome {
  staffId: string;
  name: string;
  companyName: string;
  /** 入口のパソコンの時刻（ミリ秒。ブラウザの時計ではなく、こちらを出す） */
  now: number;
  state: WorkState;
  stateLabel: string;
  suggested: PunchKind;
  kinds: PunchKind[];
  today: { kind: PunchKind; time: string; method: PunchMethod }[];
  /** 押せないわけ（入社日より前・退職日より後・入口のパソコンの時計がおかしい） */
  block: string | null;
  /** 申し出られないわけ */
  requestBlock: string | null;
}

export type WebLogin =
  | { token: string; mustChange: true; staffId: string; name: string; companyName: string }
  | ({ token: string; mustChange: false } & WebHome);

/** 記録したあと（取り消しは、1分だけ使える札で） */
export interface WebRecorded {
  message: string;
  cancelTicket: string;
  cancelUntil: number;
  loggedOut?: boolean;
}

export interface WebRecords {
  month: string;
  from: string;
  to: string;
  rows: {
    date: string;
    times: Record<TimeRequestKind, string>;
    /** 休憩（何回でも。一方しかない休憩も入る） */
    breaks: TimeSpan[];
    requests: Partial<Record<TimeRequestKind, string>>;
    requestBreaks: TimeSpan[];
    noBreakRequest: boolean;
    requestReason: string;
    notes: string[];
    web: PunchKind[];
    cardless: PunchKind[];
  }[];
  requests: { date: string; kind: RequestKind; time: string; endTime: string; reason: string; note: string; requestedAt: number }[];
}

export interface WebAccountRow {
  staffId: string;
  name: string;
  state: AccountState;
  stateLabel: string;
  updatedAt: string | null;
}

export interface WebIssued {
  staffId: string;
  name: string;
  password: string;
  expiresMs: number;
  expiresLabel: string;
}

export interface WebCsv {
  fileName: string;
  csv: string;
  summary: ReturnType<typeof summarizeExport>;
  summaryText: string;
}

class WebError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

interface Session {
  kind: "staff" | "admin";
  companyMark: string;
  staffId: string;
  ip: string;
  /** はじめのパスワードでログインした（自分のパスワードに変えるまで、ほかのことはできない） */
  mustChange: boolean;
  lastMs: number;
  /** 打刻・申し出などを記録しているあいだ（2回押しても、1回だけ記録する） */
  busy: boolean;
}

interface CancelTicket {
  target: "punch" | "request";
  id: number;
  companyMark: string;
  ip: string;
  until: number;
}


const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");


/** 「15:30」（今日でなければ「11月13日 15:30」） */
export const untilLabel = (ms: number, now: number) => {
  const time = timeLabel(jstTime(ms));
  return jstDate(ms) === jstDate(now) ? time : `${shortDateLabel(jstDate(ms))} ${time}`;
};

/** パスワードの状態（管理の画面に出す） */
export type AccountState = "none" | "initial" | "expired" | "set" | "locked";

export const accountState = (a: WebAccount | null | undefined, now: number): AccountState => {
  if (!a) return "none";
  if (a.lockedUntilMs !== null && a.lockedUntilMs > now) return "locked";
  if (a.initial) return a.initialExpiresMs !== null && a.initialExpiresMs <= now ? "expired" : "initial";
  return "set";
};

export const accountStateLabel = (a: WebAccount | null | undefined, now: number) => {
  switch (accountState(a, now)) {
    case "none":
      return "まだない";
    case "initial":
      return `はじめのパスワード（${untilLabel(a?.initialExpiresMs ?? now, now)}まで。本人が変えるのを待っています）`;
    case "expired":
      return "はじめのパスワードの期限が過ぎました（作り直してください）";
    case "locked":
      return `まちがいが続いたので、${untilLabel(a?.lockedUntilMs ?? now, now)}まで使えません`;
    case "set":
      return "本人が決めたパスワード";
  }
};

/** CSV の中身のまとめ（入口のパソコンの書き出しと、ブラウザのダウンロードで同じものを出す） */
export const summarizeExport = (rows: TimeQardCsvRow[]) => ({
  people: new Set(rows.map((r) => r.staffId)).size,
  days: rows.length,
  requests: rows.reduce((a, r) => a + Object.keys(r.requests).length + r.requestBreaks.length + (r.noBreakRequest ? 1 : 0), 0),
  notes: rows.filter((r) => r.notes.length > 0).length,
  cardless: rows.filter((r) => r.cardless.length > 0).length,
  web: rows.filter((r) => r.web.length > 0).length,
});

export const exportSummaryText = (s: ReturnType<typeof summarizeExport>) =>
  `${s.people}人・${s.days}日分。申し出 ${s.requests}件・注意のある日 ${s.notes}日・ID で押した日 ${s.cardless}日・ブラウザで押した日 ${s.web}日`;

export const csvFileName = (companyName: string, from: string, to: string) => `${safeFileNamePart(companyName)}_打刻_${from}〜${to}.csv`;

const WRONG = "スタッフID かパスワードがちがいます。";

interface Ctx {
  settings: KioskSettings;
  mark: string;
  now: number;
  ip: string;
  body: Record<string, unknown>;
}

const str = (body: Record<string, unknown>, key: string, max: number) => {
  const v = body[key];
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
};

const cleanText = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/**
 * ブラウザ版の頼みを受けるものを作る（ログインの印などは、この中にだけ持つ）
 */
export const createWebApi = (deps: WebDeps) => {
  const { db } = deps;
  const clock = deps.now ?? (() => Date.now());
  const randomBytes = deps.randomBytes ?? cryptoRandomBytes;
  const sessions = new Map<string, Session>();
  const tickets = new Map<string, CancelTicket>();
  const ipFailures = new Map<string, { since: number; count: number; blockedUntil: number }>();

  const newToken = () => hex(randomBytes(32));

  const sweep = (now: number) => {
    for (const [k, s] of sessions) if (now - s.lastMs > SESSION_IDLE_MS) sessions.delete(k);
    for (const [k, t] of tickets) if (now > t.until) tickets.delete(k);
    for (const [k, f] of ipFailures) if (f.blockedUntil <= now && now - f.since > IP_WINDOW_MS) ipFailures.delete(k);
  };

  const log = (ctx: Ctx, staffId: string, result: keyof typeof LOGIN_RESULT_LABELS) =>
    logWebLogin(db, { companyMark: ctx.mark, staffId, result, clientIp: ctx.ip, at: ctx.now });

  const ipBlockedUntil = (ctx: Ctx) => {
    const f = ipFailures.get(ctx.ip);
    return f && f.blockedUntil > ctx.now ? f.blockedUntil : null;
  };

  const ipFailed = (ctx: Ctx) => {
    let f = ipFailures.get(ctx.ip);
    if (!f || ctx.now - f.since > IP_WINDOW_MS) f = { since: ctx.now, count: 0, blockedUntil: 0 };
    f.count++;
    if (f.count >= IP_MAX_FAILURES) {
      f.blockedUntil = ctx.now + LOCK_MS;
      f.count = 0;
      f.since = ctx.now;
    }
    ipFailures.set(ctx.ip, f);
  };

  const checkIp = async (ctx: Ctx, staffId: string) => {
    const blocked = ipBlockedUntil(ctx);
    if (blocked === null) return;
    await log(ctx, staffId, "ip_blocked");
    throw new WebError(429, `このパソコンから何度もまちがえたので、${untilLabel(blocked, ctx.now)}まで、ログインを止めています。`);
  };

  const lockedText = (until: number, now: number) =>
    `パスワードを${MAX_FAILURES}回続けてまちがえたので、${untilLabel(until, now)}まで使えません。忘れたときは、管理者に、はじめのパスワードを作り直してもらってください。`;

  /** ログインの印を確かめる（何もしなかった長さを、ここで0に戻す） */
  const session = (ctx: Ctx, kind: Session["kind"], allowMustChange = false) => {
    const token = str(ctx.body, "token", 128);
    const s = token ? sessions.get(token) : undefined;
    // ほかのパソコン（アドレス）から同じ印が来ても、使わせない（本人のログインは、そのまま残す）
    const usable = s && s.kind === kind && s.ip === ctx.ip && s.companyMark === ctx.mark;
    if (s && usable && ctx.now - s.lastMs > SESSION_IDLE_MS) sessions.delete(token);
    if (!s || !usable || ctx.now - s.lastMs > SESSION_IDLE_MS) {
      throw new WebError(401, "ログインしてください（しばらく何もしなかったときは、ログアウトにしています）。", { loggedOut: true });
    }
    if (s.mustChange && !allowMustChange) throw new WebError(403, "はじめに、自分のパスワードに変えてください。", { mustChange: true });
    s.lastMs = ctx.now;
    return { token, s };
  };

  /** 記録するあいだ、同じログインからの2つ目の頼みを断る */
  const exclusive = async <T>(s: Session, fn: () => Promise<T>) => {
    if (s.busy) throw new WebError(409, "いま記録しています。少し待ってください。");
    s.busy = true;
    try {
      return await fn();
    } finally {
      s.busy = false;
    }
  };

  const endSessionsOf = (mark: string, staffId: string) => {
    for (const [k, s] of sessions) if (s.kind === "staff" && s.companyMark === mark && s.staffId === staffId) sessions.delete(k);
  };

  /** ログインしている本人（いまの従業員ファイルにいて、パスワードが消されていない人） */
  const currentPerson = async (ctx: Ctx, token: string, s: Session) => {
    const person = (await loadStaff(db, ctx.mark)).find((p) => p.inFile && p.id === s.staffId);
    const account = person ? await loadWebAccount(db, ctx.mark, s.staffId) : null;
    if (!person || !account) {
      sessions.delete(token);
      throw new WebError(401, "ログインし直してください（管理者がパスワードを作り直したか、従業員の一覧が変わりました）。", { loggedOut: true });
    }
    return { person, account };
  };

  const newTicket = (ctx: Ctx, target: CancelTicket["target"], id: number) => {
    const ticket = newToken();
    const until = ctx.now + CANCEL_WINDOW_MS;
    tickets.set(ticket, { target, id, companyMark: ctx.mark, ip: ctx.ip, until });
    return { cancelTicket: ticket, cancelUntil: until };
  };

  /** 本人の画面（いまの状態・押せるボタン・今日の打刻） */
  const home = async (ctx: Ctx, person: KioskStaff): Promise<WebHome> => {
    const { now, settings, mark } = ctx;
    const punches = await loadPunches(db, { companyMark: mark, staffId: person.id, fromMs: now - 2 * DAY_MS, toMs: now + 60_000 });
    const kinds = availableKinds(settings);
    const state = workStateOf(punches, now);
    const today = jstDate(now);
    const clockText = clockProblem(now, await lastPunchMs(db), settings.staffFileExportedAt);
    return {
      staffId: person.id,
      name: person.name,
      companyName: settings.companyName,
      now,
      state,
      stateLabel: WORK_STATE_LABELS[state],
      suggested: suggestedKind(state, kinds),
      kinds,
      today: punches.filter((p) => jstDate(p.at) === today).map((p) => ({ kind: p.kind, time: jstTime(p.at), method: p.method })),
      block: punchBlockReason(person, today) ?? (clockText ? `入口のパソコンの時計がおかしいので、押せません。${clockText} 担当者に伝えてください。` : null),
      requestBlock: punchBlockReason(person, today),
    };
  };

  // ---------------------------------------------------------------- 従業員

  const login = async (ctx: Ctx): Promise<WebLogin> => {
    const idInput = str(ctx.body, "staffId", 64);
    const password = str(ctx.body, "password", 256);
    if (!idInput.trim() || !password) throw new WebError(400, "スタッフID とパスワードを入れてください。");
    const person = findById(await loadStaff(db, ctx.mark), idInput);
    const logId = person?.id ?? cleanText(idInput, 40);
    await checkIp(ctx, logId);
    if (!person) {
      ipFailed(ctx);
      await log(ctx, logId, "wrong");
      throw new WebError(401, WRONG);
    }
    const account = await loadWebAccount(db, ctx.mark, person.id);
    if (!account) {
      await log(ctx, person.id, "no_account");
      throw new WebError(403, "ブラウザで押すためのパスワードが、まだありません。管理者に、はじめのパスワードを作ってもらってください。");
    }
    if (account.lockedUntilMs !== null && account.lockedUntilMs > ctx.now) {
      await log(ctx, person.id, "locked");
      throw new WebError(423, lockedText(account.lockedUntilMs, ctx.now));
    }
    if (!(await deps.verify(normalizePassword(password), account.passwordHash))) {
      const count = account.failedCount + 1;
      const lock = count >= MAX_FAILURES;
      await saveWebFailures(db, ctx.mark, person.id, lock ? 0 : count, lock ? ctx.now + LOCK_MS : null);
      ipFailed(ctx);
      await log(ctx, person.id, lock ? "locked" : "wrong");
      if (lock) throw new WebError(423, lockedText(ctx.now + LOCK_MS, ctx.now));
      throw new WebError(401, `${WRONG}（あと${MAX_FAILURES - count}回続けてまちがえると、15分使えなくなります）`);
    }
    if (account.initial && account.initialExpiresMs !== null && account.initialExpiresMs <= ctx.now) {
      await log(ctx, person.id, "expired");
      throw new WebError(
        403,
        `はじめのパスワードの期限（${untilLabel(account.initialExpiresMs, ctx.now)}）が過ぎました。管理者に、はじめのパスワードを作り直してもらってください。`
      );
    }
    if (account.failedCount > 0 || account.lockedUntilMs !== null) await saveWebFailures(db, ctx.mark, person.id, 0, null);
    await log(ctx, person.id, "ok");
    const token = newToken();
    sessions.set(token, { kind: "staff", companyMark: ctx.mark, staffId: person.id, ip: ctx.ip, mustChange: account.initial, lastMs: ctx.now, busy: false });
    if (account.initial) return { token, mustChange: true, staffId: person.id, name: person.name, companyName: ctx.settings.companyName };
    return { token, mustChange: false, ...(await home(ctx, person)) };
  };

  const changePassword = async (ctx: Ctx) => {
    const { token, s } = session(ctx, "staff", true);
    return exclusive(s, async () => {
      const { person, account } = await currentPerson(ctx, token, s);
      const next = str(ctx.body, "next", 256);
      if (!s.mustChange) {
        const current = str(ctx.body, "current", 256);
        if (!current) throw new WebError(400, "いまのパスワードを入れてください。");
        if (!(await deps.verify(normalizePassword(current), account.passwordHash))) {
          const count = account.failedCount + 1;
          const lock = count >= MAX_FAILURES;
          await saveWebFailures(db, ctx.mark, person.id, lock ? 0 : count, lock ? ctx.now + LOCK_MS : null);
          await log(ctx, person.id, lock ? "locked" : "wrong");
          if (lock) {
            sessions.delete(token);
            throw new WebError(423, lockedText(ctx.now + LOCK_MS, ctx.now), { loggedOut: true });
          }
          throw new WebError(400, "いまのパスワードがちがいます。");
        }
      } else if (account.initial && account.initialExpiresMs !== null && account.initialExpiresMs <= ctx.now) {
        sessions.delete(token);
        throw new WebError(403, "はじめのパスワードの期限が過ぎました。管理者に、はじめのパスワードを作り直してもらってください。", { loggedOut: true });
      }
      const problem = passwordProblem(next, person.id);
      if (problem) throw new WebError(400, problem);
      if (await deps.verify(normalizePassword(next), account.passwordHash)) {
        throw new WebError(400, s.mustChange ? "はじめのパスワードとは、ちがうパスワードにしてください。" : "いまのパスワードとは、ちがうパスワードにしてください。");
      }
      await saveWebPassword(db, {
        companyMark: ctx.mark,
        staffId: person.id,
        passwordHash: await deps.hash(normalizePassword(next)),
        initial: false,
        initialExpiresMs: null,
        at: ctx.now,
      });
      await log(ctx, person.id, "changed");
      s.mustChange = false;
      return { message: "パスワードを変えました。次からは、新しいパスワードでログインしてください。", ...(await home(ctx, person)) };
    });
  };

  const status = async (ctx: Ctx) => {
    const { token, s } = session(ctx, "staff");
    const { person } = await currentPerson(ctx, token, s);
    return home(ctx, person);
  };

  const punch = async (ctx: Ctx) => {
    const { token, s } = session(ctx, "staff");
    return exclusive(s, async () => {
      const { person } = await currentPerson(ctx, token, s);
      const kind = ctx.body.kind;
      if (!isPunchKind(kind) || !availableKinds(ctx.settings).includes(kind)) throw new WebError(400, "このボタンは使えません。");
      const block = punchBlockReason(person, jstDate(ctx.now));
      if (block) throw new WebError(403, block);
      const clockText = clockProblem(ctx.now, await lastPunchMs(db), ctx.settings.staffFileExportedAt);
      if (clockText) throw new WebError(503, `入口のパソコンの時計がおかしいので、押せません。${clockText} 担当者に伝えてください。`);
      const id = await addPunch(db, { staffId: person.id, kind, at: ctx.now, method: "web", companyMark: ctx.mark, clientIp: ctx.ip });
      // 押したら、ログアウトにする（取り消しは、1分だけ使える札で）
      sessions.delete(token);
      await deps.onChanged?.();
      return {
        message: `${person.name}さん　${PUNCH_LABELS[kind]} ${timeLabel(jstTime(ctx.now))} を記録しました`,
        loggedOut: true,
        ...newTicket(ctx, "punch", id),
      };
    });
  };

  const cancel = async (ctx: Ctx) => {
    const key = str(ctx.body, "ticket", 128);
    const t = key ? tickets.get(key) : undefined;
    if (!t || t.ip !== ctx.ip || t.companyMark !== ctx.mark || ctx.now > t.until) {
      throw new WebError(409, "取り消せませんでした（押してから1分を過ぎたか、もう取り消しています）。押し忘れの申し出か、担当者に伝えてください。");
    }
    tickets.delete(key);
    try {
      await cancelRecord(db, t.target, t.id, ctx.now);
    } catch (e) {
      throw new WebError(409, e instanceof Error ? e.message : String(e));
    }
    if (t.target === "punch") await deps.onChanged?.();
    return {
      message: t.target === "punch" ? "いまの打刻を取り消しました。押し直すときは、もう一度ログインしてください。" : "いまの申し出を取り消しました。",
    };
  };

  /** 申し出の中身を確かめる（入口のパソコンの申し出の画面と同じ決まり） */
  const requestInput = (ctx: Ctx) => {
    const { body, now } = ctx;
    const date = str(body, "date", 10);
    const kind = body.kind;
    const today = jstDate(now);
    if (!isDateString(date) || date > today || date < addDays(today, -REQUEST_DAYS_BACK)) {
      throw new WebError(400, `申し出られるのは、今日から${REQUEST_DAYS_BACK}日前までの日です。`);
    }
    // 休憩（中抜けも）と「休憩を取れなかった」は、休憩のボタンを出さない会社でも申し出られる
    if (!isRequestKind(kind)) throw new WebError(400, "この種類は申し出られません。");
    const note = cleanText(str(body, "note", 200), 100);
    if (kind === "no_break") return { date, kind: kind as RequestKind, time: "", endTime: "", reason: NO_BREAK_LABEL, note };
    const time = str(body, "time", 5);
    if (!isTimeString(time)) throw new WebError(400, "時刻を選んでください。");
    let endTime = "";
    if (kind === "break") {
      endTime = str(body, "endTime", 5);
      if (!isTimeString(endTime)) throw new WebError(400, "休憩の終わりの時刻を選んでください。");
      if (endTime === time) throw new WebError(400, "休憩の始めと終わりが同じです。");
      // 終わりが始めより前なら、次の日の時刻（夜勤の休憩）
      if (jstMs(breakEndDate(date, time, endTime, addDays), endTime) > now) throw new WebError(400, "これからの時刻は申し出られません。");
    } else if (jstMs(date, time) > now) {
      throw new WebError(400, "これからの時刻は申し出られません。");
    }
    const reason = body.reason;
    if (!isRequestReason(reason)) throw new WebError(400, "理由を選んでください。");
    if (reason === "そのほか" && !note) throw new WebError(400, "理由が「そのほか」のときは、ひとこと書いてください。");
    return { date, kind: kind as RequestKind, time, endTime, reason: reason as string, note };
  };

  const request = async (ctx: Ctx) => {
    const { token, s } = session(ctx, "staff");
    return exclusive(s, async () => {
      const { person } = await currentPerson(ctx, token, s);
      const block = punchBlockReason(person, jstDate(ctx.now));
      if (block) throw new WebError(403, block);
      const r = requestInput(ctx);
      const id = await addRequest(db, { staffId: person.id, ...r, at: ctx.now, method: "web", companyMark: ctx.mark, clientIp: ctx.ip });
      return {
        message: `${shortDateLabel(r.date)}の${requestWhatLabel(r)}の申し出を受け付けました（担当者が確かめます）`,
        ...newTicket(ctx, "request", id),
      };
    });
  };

  const records = async (ctx: Ctx): Promise<WebRecords> => {
    const { token, s } = session(ctx, "staff");
    const { person } = await currentPerson(ctx, token, s);
    const month = str(ctx.body, "month", 7);
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new WebError(400, "月の形がちがいます。");
    const { from, to } = monthRange(Number(m[1]), Number(m[2]));
    if (from > jstDate(ctx.now)) throw new WebError(400, "これからの月は見られません。");
    const punches = await loadPunches(db, { companyMark: ctx.mark, staffId: person.id, fromMs: jstMs(addDays(from, -1)), toMs: jstMs(addDays(to, 2)) });
    const requests = (await loadRequests(db, { companyMark: ctx.mark, from, to })).filter((r) => r.staffId === person.id);
    const rows = buildDayRows({ punches, requests, now: ctx.now, from, to });
    return {
      month,
      from,
      to,
      rows: rows.map((r) => ({
        date: r.date,
        times: r.times,
        breaks: r.breaks,
        requests: r.requests,
        requestBreaks: r.requestBreaks,
        noBreakRequest: r.noBreakRequest,
        requestReason: r.requestReason,
        notes: r.notes,
        web: r.web,
        cardless: r.cardless,
      })),
      requests: requests
        .sort((a, b) => a.requestedAt - b.requestedAt)
        .map((r) => ({ date: r.date, kind: r.kind, time: r.time, endTime: r.endTime, reason: r.reason, note: r.note, requestedAt: r.requestedAt })),
    };
  };

  // ---------------------------------------------------------------- 管理（管理のパスワードで入る）

  const adminLogin = async (ctx: Ctx) => {
    const password = str(ctx.body, "password", 256);
    if (!password) throw new WebError(400, "管理のパスワードを入れてください。");
    await checkIp(ctx, ADMIN_LOGIN_ID);
    const failed = Number(await getSetting(db, "web_admin_failed")) || 0;
    const lockedUntil = Number(await getSetting(db, "web_admin_locked_until")) || 0;
    if (lockedUntil > ctx.now) {
      await log(ctx, ADMIN_LOGIN_ID, "locked");
      throw new WebError(423, `管理のパスワードを${MAX_FAILURES}回続けてまちがえたので、${untilLabel(lockedUntil, ctx.now)}まで、ブラウザからは入れません（入口のパソコンの管理の画面は使えます）。`);
    }
    if (!ctx.settings.adminPasswordHash || !(await deps.verify(password, ctx.settings.adminPasswordHash))) {
      const count = failed + 1;
      const lock = count >= MAX_FAILURES;
      await setSetting(db, "web_admin_failed", String(lock ? 0 : count));
      await setSetting(db, "web_admin_locked_until", String(lock ? ctx.now + LOCK_MS : 0));
      ipFailed(ctx);
      await log(ctx, ADMIN_LOGIN_ID, lock ? "locked" : "wrong");
      if (lock) throw new WebError(423, `管理のパスワードを${MAX_FAILURES}回続けてまちがえたので、${untilLabel(ctx.now + LOCK_MS, ctx.now)}まで、ブラウザからは入れません。`);
      throw new WebError(401, `管理のパスワードがちがいます（あと${MAX_FAILURES - count}回続けてまちがえると、15分入れなくなります）。`);
    }
    if (failed || lockedUntil) {
      await setSetting(db, "web_admin_failed", "0");
      await setSetting(db, "web_admin_locked_until", "0");
    }
    await log(ctx, ADMIN_LOGIN_ID, "ok");
    const token = newToken();
    sessions.set(token, { kind: "admin", companyMark: ctx.mark, staffId: ADMIN_LOGIN_ID, ip: ctx.ip, mustChange: false, lastMs: ctx.now, busy: false });
    return { token, companyName: ctx.settings.companyName };
  };

  const adminAccounts = async (ctx: Ctx) => {
    session(ctx, "admin");
    const staff = (await loadStaff(db, ctx.mark)).filter((p) => p.inFile).sort((a, b) => compareStaffId(a.id, b.id));
    const accounts = new Map((await loadWebAccounts(db, ctx.mark)).map((a) => [a.staffId, a]));
    return {
      now: ctx.now,
      accounts: staff.map((p): WebAccountRow => {
        const a = accounts.get(p.id);
        return {
          staffId: p.id,
          name: p.name,
          state: accountState(a, ctx.now),
          stateLabel: accountStateLabel(a, ctx.now),
          updatedAt: a?.updatedAt ?? null,
        };
      }),
    };
  };

  const adminIssue = async (ctx: Ctx) => {
    const { s } = session(ctx, "admin");
    return exclusive(s, () => issueInitialPassword(ctx, str(ctx.body, "staffId", 64), str(ctx.body, "password", 256)));
  };

  /** はじめのパスワードを作る（入口のパソコンの管理の画面からも使う） */
  const issueInitialPassword = async (ctx: Ctx, staffId: string, typed: string): Promise<WebIssued> => {
    const person = (await loadStaff(db, ctx.mark)).find((p) => p.inFile && p.id === staffId);
    if (!person) throw new WebError(404, "その人は、いまの従業員ファイルにいません。");
    let password: string;
    if (typed) {
      const problem = passwordProblem(typed, person.id);
      if (problem) throw new WebError(400, problem);
      password = normalizePassword(typed);
      // ほかの人の、まだ使えるはじめのパスワードと同じなら使えない（全員同じだと、本人より先にほかの人が入れてしまう）
      const others = (await loadWebAccounts(db, ctx.mark)).filter(
        (a) => a.staffId !== person.id && accountState(a, ctx.now) === "initial"
      );
      for (const a of others) {
        if (await deps.verify(password, a.passwordHash)) {
          throw new WebError(400, "ほかの人のはじめのパスワードと同じです。人ごとに、ちがうパスワードにしてください。");
        }
      }
    } else {
      password = newInitialPassword(randomBytes);
    }
    const expiresMs = ctx.now + INITIAL_PASSWORD_DAYS * DAY_MS;
    await saveWebPassword(db, { companyMark: ctx.mark, staffId: person.id, passwordHash: await deps.hash(password), initial: true, initialExpiresMs: expiresMs, at: ctx.now });
    endSessionsOf(ctx.mark, person.id);
    await log(ctx, person.id, "issued");
    return { staffId: person.id, name: person.name, password, expiresMs, expiresLabel: `${shortDateLabel(jstDate(expiresMs))} ${timeLabel(jstTime(expiresMs))}` };
  };

  const adminClear = async (ctx: Ctx) => {
    session(ctx, "admin");
    return clearPassword(ctx, str(ctx.body, "staffId", 64));
  };

  const clearPassword = async (ctx: Ctx, staffId: string) => {
    const person = (await loadStaff(db, ctx.mark)).find((p) => p.id === staffId);
    if (!person) throw new WebError(404, "その人は見つかりません。");
    await deleteWebAccount(db, ctx.mark, person.id);
    endSessionsOf(ctx.mark, person.id);
    await log(ctx, person.id, "cleared");
    return { message: `${person.name}さんのパスワードを消しました（ブラウザでは押せなくなります）。` };
  };

  const adminCsv = async (ctx: Ctx): Promise<WebCsv> => {
    session(ctx, "admin");
    const from = str(ctx.body, "from", 10);
    const to = str(ctx.body, "to", 10);
    if (!isDateString(from) || !isDateString(to)) throw new WebError(400, "期間を選んでください。");
    if (from > to) throw new WebError(400, "期間の初めの日が、終わりの日より後になっています。");
    if ((jstMs(to) - jstMs(from)) / DAY_MS + 1 > MAX_CSV_DAYS) throw new WebError(400, "期間は1年までにしてください。");
    const rows = await exportRows(db, { companyMark: ctx.mark, from, to, now: ctx.now });
    if (rows.length === 0) throw new WebError(404, `${from}〜${to} の打刻・申し出はありません。`);
    const fileName = csvFileName(ctx.settings.companyName, from, to);
    await recordExport(db, { companyMark: ctx.mark, from, to, fileName: `${fileName}（ブラウザ ${ctx.ip}）`, rowCount: rows.length, at: ctx.now });
    const summary = summarizeExport(rows);
    return { fileName, csv: writeTimeQardCsv(rows), summary, summaryText: exportSummaryText(summary) };
  };

  // ---------------------------------------------------------------- 受け口

  const contextOf = async (body: Record<string, unknown>, ip: string): Promise<Ctx> => {
    const settings = await loadSettings(db);
    if (!settings.companyMark || !settings.adminPasswordHash) throw new WebError(503, "入口のパソコンの TimeQard の、最初の設定が終わっていません。");
    if (!settings.webEnabled) throw new WebError(503, "ブラウザ版は、いま使えないようにしてあります。");
    return { settings, mark: settings.companyMark, now: clock(), ip, body };
  };

  const handlers: Record<string, (ctx: Ctx) => Promise<object>> = {
    hello: async (ctx) => ({ companyName: ctx.settings.companyName }),
    login,
    change_password: changePassword,
    status,
    punch,
    cancel,
    request,
    records,
    logout: async (ctx) => {
      const token = str(ctx.body, "token", 128);
      if (token) sessions.delete(token);
      return {};
    },
    admin_login: adminLogin,
    admin_accounts: adminAccounts,
    admin_issue: adminIssue,
    admin_clear: adminClear,
    admin_csv: adminCsv,
  };

  /** ブラウザからの頼みに答える（action は /api/ のあとの名前、raw は送られた JSON、ip はつないできたパソコンのアドレス） */
  const handle = async (action: string, raw: string, ip: string): Promise<WebAnswer> => {
    try {
      const fn = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : undefined;
      if (!fn) throw new WebError(404, "見つかりません。");
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new WebError(400, "送られた中身を読めません。");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new WebError(400, "送られた中身を読めません。");
      const ctx = await contextOf(body as Record<string, unknown>, ip);
      sweep(ctx.now);
      return { status: 200, body: await fn(ctx) };
    } catch (e) {
      if (e instanceof WebError) return { status: e.status, body: { error: e.message, ...e.extra } };
      console.error("ブラウザ版の頼みに答えられませんでした", action, e);
      return { status: 500, body: { error: `うまくいきませんでした。担当者に伝えてください。（${e instanceof Error ? e.message : String(e)}）` } };
    }
  };

  /** 入口のパソコンの管理の画面から使う（管理のパスワードは、管理の画面を開くときに確かめてある） */
  const local = async <T>(fn: (ctx: Ctx) => Promise<T>) => {
    const settings = await loadSettings(db);
    if (!settings.companyMark) throw new Error("会社がまだ決まっていません。");
    const now = clock();
    try {
      return await fn({ settings, mark: settings.companyMark, now, ip: "入口のパソコン", body: {} });
    } catch (e) {
      if (e instanceof WebError) throw new Error(e.message);
      throw e;
    }
  };

  return {
    handle,
    issueInitialPassword: (staffId: string, typed = "") => local((ctx) => issueInitialPassword(ctx, staffId, typed)),
    clearPassword: (staffId: string) => local((ctx) => clearPassword(ctx, staffId)),
    /** いまログインしている人の数（確かめ用） */
    sessionCount: () => sessions.size,
  };
};

export type WebApi = ReturnType<typeof createWebApi>;
