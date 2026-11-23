/**
 * 操作の記録（会社ファイルの app_logs。utils/logUtils.ts の writeLog で残す）を見る画面（システム設定の「操作の記録」。
 * features/settings/OperationLogTab.tsx）の決まり
 * ・記録の日時は、残したときの時刻を世界標準時の ISO（"2026-11-23T01:02:03.456Z"）で持つ。画面ではこのパソコンの時刻で出し、
 *   日付で絞るときは、その日の0時から次の日の0時まで（このパソコンの時刻）を、同じ形に直して比べる
 * ・新しい順（残した順の逆）に出し、一度に出す数（LOG_PAGE_SIZE）ずつ古い記録を足す
 */

/** 記録の1行 */
export interface AppLogRow {
  id: number;
  created_at: string;
  level: string;
  category: string;
  message: string;
  user_name: string | null;
}

/** 使った人で絞らない */
export const ALL_USERS = "";
/** 使った人が残っていない記録（ログインする前の記録など） */
export const NO_USER = "\u0000none";

/** 絞り込み（日付は "YYYY-MM-DD"。空ならそちらの端なし。category が空ならすべて） */
export interface AppLogFilter {
  from: string;
  to: string;
  category: string;
  user: string;
}

export const EMPTY_FILTER: AppLogFilter = { from: "", to: "", category: "", user: ALL_USERS };

/** 一度に出す記録の数 */
export const LOG_PAGE_SIZE = 200;

/** 記録の種類（writeLog の category）の名前。知らない種類は、そのまま出す */
const CATEGORY_LABELS: Record<string, string> = {
  system: "システム",
  auth: "ログイン",
  staff: "従業員",
  attendance: "勤怠・休暇",
  salary: "給与",
  backup: "バックアップ",
  mynumber: "マイナンバー",
};

export const categoryLabel = (category: string): string => CATEGORY_LABELS[category] ?? category;

/** 注意・エラーの記録の印（ふつうの記録は null） */
export const levelLabel = (level: string): string | null => {
  const upper = level.toUpperCase();
  return upper === "WARN" ? "注意" : upper === "ERROR" ? "エラー" : null;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 記録の日時を、このパソコンの時刻で "2026/11/23 09:05:07" にする（読めなければそのまま） */
export const formatLogTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** "YYYY-MM-DD" の日（addDays 日あと）の0時（このパソコンの時刻）を、記録の日時と同じ形にする。日付でなければ null */
const startOfDay = (ymd: string, addDays = 0): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays).toISOString();
};

/** 絞り込みの SQL（値は ? で渡す）。新しい順に limit 件まで（まだ古い記録があるかを知るため、1件多く読む） */
export const appLogQuery = (filter: AppLogFilter, limit: number): { sql: string; params: unknown[] } => {
  const where: string[] = [];
  const params: unknown[] = [];
  const from = startOfDay(filter.from);
  const to = startOfDay(filter.to, 1);
  if (from) {
    where.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    where.push("created_at < ?");
    params.push(to);
  }
  if (filter.category) {
    where.push("category = ?");
    params.push(filter.category);
  }
  if (filter.user === NO_USER) {
    where.push("(user_name IS NULL OR user_name = '')");
  } else if (filter.user) {
    where.push("user_name = ?");
    params.push(filter.user);
  }
  return {
    sql: "SELECT id, created_at, level, category, message, user_name FROM app_logs"
      + (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "")
      + " ORDER BY id DESC LIMIT ?",
    params: [...params, limit + 1],
  };
};

/** 記録を読む相手（アプリでは tauri-plugin-sql の Database） */
export interface LogDb {
  select: <T>(sql: string, params?: unknown[]) => Promise<T>;
}

/** 記録を読む（rows は limit 件まで。more：まだ古い記録がある） */
export const loadAppLogs = async (db: LogDb, filter: AppLogFilter, limit: number): Promise<{ rows: AppLogRow[]; more: boolean }> => {
  const { sql, params } = appLogQuery(filter, limit);
  const rows = await db.select<AppLogRow[]>(sql, params);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
};

/** 絞り込みで選べるもの（残っている記録の種類と、使った人） */
export interface AppLogChoices {
  categories: string[];
  users: string[];
  /** 使った人が残っていない記録がある */
  hasNoUser: boolean;
}

export const loadAppLogChoices = async (db: LogDb): Promise<AppLogChoices> => {
  const categories = await db.select<{ category: string }[]>("SELECT DISTINCT category FROM app_logs ORDER BY category");
  const users = await db.select<{ user_name: string | null }[]>("SELECT DISTINCT user_name FROM app_logs ORDER BY user_name");
  return {
    categories: categories.map((r) => r.category),
    users: [...new Set(users.map((r) => r.user_name ?? "").filter((name) => name !== ""))],
    hasNoUser: users.some((r) => !r.user_name),
  };
};
