/**
 * 最初の設定（くわしくは timeqard/DESIGN.md の 4.4）
 * 1. 管理のパスワードを決める
 * 2. Q で書き出した従業員ファイルを読み込む
 */
import { useState } from "react";
import { jstIso } from "../../shared/timeqard";
import { NewPasswordFields } from "./PasswordDialog";
import { hashPassword, pickTextFile } from "./platform";
import { applyStaffFile, setSetting, type KioskDb, type KioskSettings } from "./store";
import { checkStaffFile } from "./staffFileLoad";

export default function Setup(props: { db: KioskDb; settings: KioskSettings; onDone: () => Promise<void> }) {
  const { db, settings } = props;
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needPassword = !settings.adminPasswordHash;

  const savePassword = async () => {
    if (!password) return;
    setBusy(true);
    try {
      await setSetting(db, "admin_password_hash", await hashPassword(password));
      await props.onDone();
    } catch (e) {
      setError(`パスワードを残せませんでした：${e}`);
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async () => {
    setError("");
    setBusy(true);
    try {
      const picked = await pickTextFile("従業員ファイル", ["json"]);
      if (!picked) return;
      const check = checkStaffFile(picked.text, settings);
      if (check.kind === "error") {
        setError(check.message);
        return;
      }
      await applyStaffFile(db, check.file, jstIso(Date.now()));
      await props.onDone();
    } catch (e) {
      setError(`読み込めませんでした：${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <h1>TimeQard の最初の設定</h1>
      <p>TimeQard（タイムカード）は、入口などに置いたこのパソコンで、従業員が出勤・退勤などを押すソフトです。押した記録は、このパソコンの中だけに残り、どこにも送りません。</p>

      <div className="step" style={{ opacity: needPassword ? 1 : 0.6 }}>
        <h2>1. 管理のパスワードを決める{needPassword ? "" : "（済み）"}</h2>
        {needPassword ? (
          <>
            <p>
              管理の画面（打刻の CSV の書き出し・従業員ファイルの読み込み・設定）を開くときと、TimeQard を閉じるときに使います。
              担当者だけが知っているパスワードにしてください。忘れたときは、Q で書き出した新しい従業員ファイルを読み込むと、決め直せます。
            </p>
            <NewPasswordFields onChange={setPassword} />
            <button className="mid-btn k-entry" disabled={!password || busy} onClick={savePassword}>このパスワードにする</button>
          </>
        ) : (
          <p className="muted">パスワードを決めました。</p>
        )}
      </div>

      <div className="step" style={{ opacity: needPassword ? 0.5 : 1 }}>
        <h2>2. 従業員ファイルを読み込む</h2>
        <p>
          Q の「TimeQard（打刻）」の画面で「従業員ファイルを書き出す」を押し、できたファイル（「○○株式会社_TimeQard従業員_2026-11-07.json」のような名前）を、
          USB メモリなどでこのパソコンに運んで選んでください。入っているのは、スタッフID・名前・入社日・退職日・カードの確かめ用の値だけです。
        </p>
        <button className="mid-btn k-entry" disabled={needPassword || busy} onClick={loadFile}>従業員ファイルを選ぶ</button>
        <p className="muted">読み込んだら、USB メモリの従業員ファイルは消してください（名前が入っているため）。</p>
      </div>

      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
