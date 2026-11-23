/**
 * ログインのまちがいの回数と、ログインの記録（見直しの P4。TimeQard のブラウザ版と同じ決まり）
 *
 * ・人（ログインID）ごとに、パスワードを続けてまちがえた回数を数え（users.failed_logins）、5回続けてまちがえたら、その人のログインを
 *   15分止める（users.locked_until）。止めているあいだは、正しいパスワードでも入れない。15分たてば入れる。ログインできたら数え直す。
 * ・管理者は、システム設定のユーザー管理で、止めたのを解ける（パスワードを変えたときも解く。useSystemSettings.ts）。
 * ・ログインできたこと・できなかったことは、操作の記録の「ログイン」（auth）に残す。マイナンバーのガイドライン（事業者編）の
 *   組織的安全管理措置 b は、記録する項目の例に「事務取扱担当者の情報システムの利用状況（ログイン実績、アクセスログ等）の記録」を挙げている。
 *   登録されていないログインIDのときは、入れた字は残さない（ID の欄にパスワードを入れてしまうことがあるため）。
 * ・時刻はこのパソコンの時計で数える。画面の入口の守りで、会社ファイルを持ち出されたときは守れない。
 */
import { logUserName, writeLog } from "../../utils/logUtils";

/** 続けてまちがえると止める回数 */
export const MAX_LOGIN_FAILURES = 5;
/** 止める長さ（分） */
export const LOGIN_LOCK_MINUTES = 15;
export const LOGIN_LOCK_MS = LOGIN_LOCK_MINUTES * 60 * 1000;

/** ログインIDかパスワードがちがうときの知らせ（どちらがちがうかは出さない） */
export const WRONG_LOGIN = "ログインIDまたはパスワードが正しくありません。";

/** ログインする人（users の行） */
export interface LoginUser {
  id: number;
  login_id: string;
  display_name: string;
  password_hash: string;
  failed_logins?: number | null;
  locked_until?: string | null;
  [key: string]: unknown;
}

/** ここで使う会社ファイルの操作（tauri-plugin-sql の Database と同じ使い方） */
export interface LoginDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
}

export type LoginResult = { ok: true; user: LoginUser } | { ok: false; message: string };

/** 止めている終わり（ミリ秒。止めていなければ null） */
export const lockedUntilMs = (user: Pick<LoginUser, "locked_until">): number | null => {
  const ms = user.locked_until ? Date.parse(user.locked_until) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

/** いまログインを止めているか */
export const isLoginLocked = (user: Pick<LoginUser, "locked_until">, now: number) => {
  const until = lockedUntilMs(user);
  return until !== null && until > now;
};

/** 止めている終わりの時刻（このパソコンの時刻。同じ日なら「15:30」、ちがう日なら「11月24日 15:30」） */
export const untilLabel = (ms: number, now: number) => {
  const d = new Date(ms);
  const n = new Date(now);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? time : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
};

/** 止めているときの知らせ */
export const lockedMessage = (until: number, now: number) =>
  `パスワードを${MAX_LOGIN_FAILURES}回続けてまちがえたので、${untilLabel(until, now)}までログインできません。` +
  "急ぐときは、管理者に、システム設定のユーザー管理で「止めたのを解く」を押してもらってください。";

/**
 * ログインする：パスワードを確かめ、続けてまちがえた回数を数え、操作の記録に残す
 * @param verify パスワードを確かめる（アプリでは Rust の Argon2。utils/authUtils.ts の verifyPassword）
 */
export const attemptLogin = async (
  db: LoginDb,
  loginId: string,
  password: string,
  deps: { verify: (password: string, hash: string) => Promise<boolean>; now?: () => number }
): Promise<LoginResult> => {
  const now = (deps.now ?? Date.now)();
  const users = await db.select<LoginUser[]>("SELECT * FROM users WHERE login_id = ? AND status = 'active'", [loginId]);
  const user = users?.[0];
  if (!user) {
    await writeLog(db, "INFO", "auth", "登録されていないログインIDで、ログインしようとしました");
    return { ok: false, message: WRONG_LOGIN };
  }
  const name = logUserName(user);
  const until = lockedUntilMs(user);
  if (until !== null && until > now) {
    await writeLog(db, "INFO", "auth", `ログインを止めているあいだ（${untilLabel(until, now)}まで）に、ログインしようとしました`, name);
    return { ok: false, message: lockedMessage(until, now) };
  }
  if (!(await deps.verify(password, user.password_hash))) {
    const count = (Number(user.failed_logins) || 0) + 1;
    if (count >= MAX_LOGIN_FAILURES) {
      const lockUntil = now + LOGIN_LOCK_MS;
      await db.execute("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?", [new Date(lockUntil).toISOString(), user.id]);
      await writeLog(db, "WARN", "auth", `パスワードを${MAX_LOGIN_FAILURES}回続けてまちがえたので、${untilLabel(lockUntil, now)}までログインを止めました`, name);
      return { ok: false, message: lockedMessage(lockUntil, now) };
    }
    await db.execute("UPDATE users SET failed_logins = ?, locked_until = NULL WHERE id = ?", [count, user.id]);
    await writeLog(db, "INFO", "auth", `パスワードがちがったので、ログインできませんでした（続けて${count}回め）`, name);
    return {
      ok: false,
      message: `${WRONG_LOGIN}（あと${MAX_LOGIN_FAILURES - count}回続けてまちがえると、${LOGIN_LOCK_MINUTES}分ログインできなくなります）`,
    };
  }
  await db.execute("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = DATETIME('now', 'localtime') WHERE id = ?", [user.id]);
  await writeLog(db, "INFO", "auth", "ログインしました", name);
  return { ok: true, user: { ...user, failed_logins: 0, locked_until: null } };
};

/** 管理者が、パスワードのまちがいで止めたログインを解く（操作の記録に残す。使った人は、ログインしている管理者） */
export const unlockLogin = async (db: LoginDb, target: { id: number; login_id: string; display_name: string }) => {
  await db.execute("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", [target.id]);
  await writeLog(db, "INFO", "auth", `${logUserName(target)}の、パスワードのまちがいで止めていたログインを解きました`);
};
