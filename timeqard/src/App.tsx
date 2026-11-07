/**
 * TimeQard の画面の切り替え（最初の設定・打刻の画面・管理の画面）と、閉じるとき・毎日の控え
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { jstIso, type StaffFile } from "../../shared/timeqard";
import Admin from "./Admin";
import Kiosk from "./Kiosk";
import PasswordDialog, { NewPasswordFields } from "./PasswordDialog";
import Setup from "./Setup";
import { backupIfDue } from "./backup";
import { hashPassword, onCloseRequested, openKioskDb, pickTextFile, quitApp, setFullscreen } from "./platform";
import { applyStaffFile, lastPunchMs, loadSettings, loadStaff, prepareDb, setSetting, type KioskDb, type KioskSettings, type KioskStaff } from "./store";
import { checkStaffFileForReset } from "./staffFileLoad";

type Ask = null | "admin" | "close";

export default function App() {
  const [db, setDb] = useState<KioskDb | null>(null);
  const [settings, setSettings] = useState<KioskSettings | null>(null);
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [lastPunch, setLastPunch] = useState<number | null>(null);
  const [fatal, setFatal] = useState("");
  const [mode, setMode] = useState<"kiosk" | "admin">("kiosk");
  const [ask, setAsk] = useState<Ask>(null);
  const [reset, setReset] = useState<{ file: StaffFile; after: Ask } | null>(null);
  const [resetError, setResetError] = useState("");
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const settingsRef = useRef<KioskSettings | null>(null);
  settingsRef.current = settings;

  const reload = useCallback(async (d: KioskDb | null) => {
    if (!d) return;
    const s = await loadSettings(d);
    setSettings(s);
    setStaff(s.companyMark ? await loadStaff(d, s.companyMark) : []);
    setLastPunch(await lastPunchMs(d));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await openKioskDb();
        await prepareDb(d);
        setDb(d);
        const s = await loadSettings(d);
        if (s.fullscreen) await setFullscreen(true);
        await reload(d);
      } catch (e) {
        setFatal(String(e));
      }
    })();
  }, [reload]);

  // 閉じるボタン（Alt+F4・⌘Q も）：管理のパスワードを聞いてから閉じる（パスワードを決める前なら、そのまま閉じる）
  useEffect(() => {
    const unlisten = onCloseRequested(() => {
      if (!settingsRef.current?.adminPasswordHash) void quitApp();
      else setAsk("close");
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // 毎日の控え（起動したときと、10分ごとに、今日の控えがまだなら作る）
  useEffect(() => {
    if (!db) return;
    const run = async () => {
      try {
        const s = await loadSettings(db);
        if (await backupIfDue(db, s)) await reload(db);
      } catch (e) {
        console.warn("控えを作れませんでした", e);
        await reload(db);
      }
    };
    void run();
    const id = window.setInterval(run, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [db, reload]);

  /** パスワードを忘れたとき：Q で書き出した、いまより新しい従業員ファイルを読み込むと、決め直せる */
  const startReset = async () => {
    if (!settings) return;
    setResetError("");
    try {
      const picked = await pickTextFile("従業員ファイル", ["json"]);
      if (!picked) return;
      const check = checkStaffFileForReset(picked.text, settings);
      if (!check.ok) {
        setResetError(check.message);
        setReset(null);
        return;
      }
      setReset({ file: check.file, after: ask });
      setAsk(null);
    } catch (e) {
      setResetError(`読み込めませんでした：${e}`);
    }
  };

  const finishReset = async () => {
    if (!db || !reset || !newPassword) return;
    await setSetting(db, "admin_password_hash", await hashPassword(newPassword));
    await applyStaffFile(db, reset.file, jstIso(Date.now()));
    const after = reset.after;
    setReset(null);
    setNewPassword(null);
    await reload(db);
    if (after === "close") await quitApp();
    else setMode("admin");
  };

  if (fatal) {
    return (
      <div className="setup">
        <h1>TimeQard を開けませんでした</h1>
        <p className="error-text">{fatal}</p>
      </div>
    );
  }
  if (!db || !settings) return <div className="setup"><p>起動しています…</p></div>;
  if (!settings.adminPasswordHash || !settings.companyMark) return <Setup db={db} settings={settings} onDone={() => reload(db)} />;

  return (
    <>
      {mode === "admin" ? (
        <Admin db={db} settings={settings} onChanged={() => reload(db)} onExit={() => setMode("kiosk")} />
      ) : (
        <Kiosk db={db} settings={settings} staff={staff} lastPunch={lastPunch} onChanged={() => reload(db)} onAdmin={() => setAsk("admin")} />
      )}

      {ask && (
        <PasswordDialog
          title={ask === "admin" ? "管理の画面を開く" : "TimeQard を閉じる"}
          hash={settings.adminPasswordHash}
          onOk={() => {
            const what = ask;
            setAsk(null);
            if (what === "close") void quitApp();
            else setMode("admin");
          }}
          onCancel={() => {
            setAsk(null);
            setResetError("");
          }}
          onForgot={startReset}
        />
      )}
      {resetError && (
        <div className="modal-back">
          <div className="modal">
            <h2>パスワードを決め直せません</h2>
            <p className="error-text">{resetError}</p>
            <div className="buttons"><button className="plain-btn" onClick={() => setResetError("")}>閉じる</button></div>
          </div>
        </div>
      )}
      {reset && (
        <div className="modal-back">
          <div className="modal">
            <h2>管理のパスワードを決め直す</h2>
            <p>新しい従業員ファイル（{reset.file.companyName}・{reset.file.staff.length}人）を読み込み、パスワードを決め直します。</p>
            <NewPasswordFields onChange={setNewPassword} />
            <div className="buttons">
              <button className="plain-btn" onClick={() => setReset(null)}>やめる</button>
              <button className="mid-btn k-entry" disabled={!newPassword} onClick={finishReset}>決め直す</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
