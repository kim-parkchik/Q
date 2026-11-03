/**
 * マイナンバーの鍵を開ける窓（パスワードを入れる）と、番号を読むときの入口
 * 給与支払報告書の CSV・印刷や、マイナンバーの画面の「表示」「登録」で、鍵が閉じていれば開ける窓を出す。
 * 鍵の開け閉めは myNumberVault.ts、暗号のしくみと出典は utils/myNumberCrypto.ts
 *
 * ■ 使い方
 *   const unlock = useMyNumberUnlock();
 *   const numbers = await unlock.readNumbers(db, user, staffIds);   // やめたら null
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Lock } from "lucide-react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useMessageDialog } from "../../components/MessageDialog";
import type { OpenKeys } from "../../utils/myNumberCrypto";
import { countMyNumbers, hasMyNumberAccess, loadMyNumbers, type MyNumberUser } from "./myNumberStore";
import { loadKeyRecord, subscribeVault, unlockVault, vaultExpiresAt, vaultKeys, vaultVersion, VAULT_IDLE_MINUTES } from "./myNumberVault";

interface UnlockApi {
  /** 開いた鍵（閉じていれば窓を出す。やめた・扱えない・暗号化を始めていないときは null） */
  ensureKeys: (db: Database, user: MyNumberUser | null) => Promise<OpenKeys | null>;
  /** 登録した番号を読む（1件もなければ鍵は開けずに {}。やめたら null） */
  readNumbers: (db: Database, user: MyNumberUser | null, staffIds?: string[]) => Promise<Record<string, Record<string, string>> | null>;
}

interface Request {
  db: Database;
  user: MyNumberUser | null;
  resolve: (keys: OpenKeys | null) => void;
}

const UnlockContext = createContext<UnlockApi | null>(null);

export function MyNumberUnlockProvider({ children }: { children: ReactNode }) {
  const dialog = useMessageDialog();
  const [request, setRequest] = useState<Request | null>(null);
  // 窓を出している間に、ほかからも頼まれたら、同じ窓の答えを返す
  const pending = useRef<Promise<OpenKeys | null> | null>(null);

  const ensureKeys = useCallback(async (db: Database, user: MyNumberUser | null) => {
    if (!(await hasMyNumberAccess(db, user))) {
      await dialog.warning("マイナンバーを扱える印がありません（管理者がシステム設定で付けます）");
      return null;
    }
    const keys = vaultKeys(db);
    if (keys) return keys;
    if (!(await loadKeyRecord(db))) {
      await dialog.warning("マイナンバーの暗号化をまだ始めていません。「マイナンバー」の画面で、パスワードを決めてください。");
      return null;
    }
    pending.current ??= new Promise<OpenKeys | null>((resolve) => setRequest({ db, user, resolve })).finally(() => {
      pending.current = null;
    });
    return pending.current;
  }, [dialog]);

  const readNumbers = useCallback(async (db: Database, user: MyNumberUser | null, staffIds?: string[]) => {
    if ((await countMyNumbers(db)) === 0) return {};
    const keys = await ensureKeys(db, user);
    return keys ? loadMyNumbers(db, keys, staffIds) : null;
  }, [ensureKeys]);

  const api = useMemo<UnlockApi>(() => ({ ensureKeys, readNumbers }), [ensureKeys, readNumbers]);
  const finish = (keys: OpenKeys | null) => {
    request?.resolve(keys);
    setRequest(null);
  };

  return (
    <UnlockContext.Provider value={api}>
      {children}
      {request && <UnlockDialog request={request} onDone={finish} />}
    </UnlockContext.Provider>
  );
}

/** 鍵を開ける窓・番号を読む入口（MyNumberUnlockProvider の内側で使う） */
export function useMyNumberUnlock(): UnlockApi {
  const ctx = useContext(UnlockContext);
  if (!ctx) throw new Error("useMyNumberUnlock は MyNumberUnlockProvider の内側で使ってください");
  return ctx;
}

/** 鍵が開いているか・自動で閉じるまでの分（開け閉めすると描き直す） */
export function useVaultState(db: Database | null) {
  useSyncExternalStore(subscribeVault, vaultVersion);
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = db ? vaultExpiresAt(db) : null;
  useEffect(() => {
    if (expiresAt === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15 * 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return {
    open: expiresAt !== null && expiresAt > now,
    minutesLeft: expiresAt === null ? 0 : Math.max(1, Math.ceil((expiresAt - now) / 60000)),
  };
}

function UnlockDialog({ request, onDone }: { request: Request; onDone: (keys: OpenKeys | null) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onDone(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onDone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      if (await unlockVault(request.db, request.user, password)) {
        onDone(vaultKeys(request.db));
        return;
      }
      setError("パスワードが違います。");
      setPassword("");
    } catch (err) {
      console.error(err);
      setError(`鍵を開けられませんでした。${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="q-unlock-title" style={box}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={iconWrap}><Lock size={24} color="#2563eb" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="q-unlock-title" style={{ fontSize: 16, fontWeight: "bold", color: "#1e293b", marginBottom: 6 }}>マイナンバーの鍵を開ける</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
              マイナンバーの暗号化のパスワードを入れてください。使わなくなってから{VAULT_IDLE_MINUTES}分で、自動で閉じます。
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              disabled={busy}
              style={{ marginTop: 12, width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14 }}
            />
            {error && <div style={{ marginTop: 6, fontSize: 12, color: "#e74c3c" }}>{error}</div>}
            <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
              パスワードを忘れたときは、「マイナンバー」の画面の「パスワードを忘れたとき」から、回復用キーで開けられます。
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={() => onDone(null)} disabled={busy} style={{ ...btn, background: "#fff", color: "#475569", border: "1px solid #cbd5e1" }}>やめる</button>
          <button type="submit" disabled={busy || !password} style={{ ...btn, background: busy || !password ? "#93c5fd" : "#2563eb", color: "#fff", border: "none" }}>
            {busy ? "確かめています…" : "開ける"}
          </button>
        </div>
      </form>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, backgroundColor: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
};
const box: React.CSSProperties = {
  width: 440, maxWidth: "calc(100vw - 40px)", backgroundColor: "white", borderRadius: 12, padding: "22px 24px 18px",
  boxShadow: "0 20px 50px rgba(0,0,0,0.25)", borderTop: "6px solid #2563eb",
};
const iconWrap: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", backgroundColor: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const btn: React.CSSProperties = { borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: "bold", cursor: "pointer" };
