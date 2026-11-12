/**
 * 管理の画面の「ブラウザ版」（timeqard/DESIGN.md の 10）
 *
 * ・ブラウザ版を使うか・ポート・各自のパソコンで開くアドレス
 * ・会社専用の証明書（名前・指紋・ファイルに保存）
 * ・従業員のパスワード（はじめのパスワードを作る・消す。渡すための紙を印刷する）
 * ・ログインの記録
 */
import { useEffect, useState } from "react";
import { jstDate, jstIso, jstTime, timeLabel } from "../../shared/timeqard";
import { confirm, saveCaCertificate, webStart, webStatus, webStop, type WebStatus } from "./platform";
import {
  ADMIN_LOGIN_ID,
  loadStaff,
  loadWebAccounts,
  loadWebLogins,
  setSetting,
  type KioskDb,
  type KioskSettings,
  type KioskStaff,
  type WebAccount,
  type WebLogin,
} from "./store";
import { accountState, accountStateLabel, LOGIN_RESULT_LABELS, type WebApi } from "./webApi";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "./passwordRules";
import PasswordSlip, { type Slip } from "./PasswordSlip";

interface Props {
  db: KioskDb;
  settings: KioskSettings;
  onChanged: () => Promise<void>;
  api: WebApi;
  webProblem: string;
  onWebProblem: (text: string) => void;
}

type Message = { tone: "ok" | "ng"; text: string } | null;

/** ブラウザ版を始める（会社専用の証明書を初めて作るときの名前に、会社名と今日の日付を使う） */
export const startWebServer = (settings: KioskSettings) => webStart(settings.webPort, settings.companyName, jstDate(Date.now()));

export default function WebAdmin({ db, settings, onChanged, api, webProblem, onWebProblem }: Props) {
  const [status, setStatus] = useState<WebStatus | null>(null);
  const [port, setPort] = useState(String(settings.webPort));
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [accounts, setAccounts] = useState<Map<string, WebAccount>>(new Map());
  const [logins, setLogins] = useState<WebLogin[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [typing, setTyping] = useState<KioskStaff | null>(null);
  const [typed, setTyped] = useState("");
  const mark = settings.companyMark ?? "";
  const now = Date.now();

  const refresh = async () => {
    try {
      setStatus(await webStatus());
    } catch (e) {
      console.warn("ブラウザ版の状態を読めませんでした", e);
    }
    if (!mark) return;
    setStaff((await loadStaff(db, mark)).filter((s) => s.inFile).sort((a, b) => a.id.localeCompare(b.id, "ja", { numeric: true })));
    setAccounts(new Map((await loadWebAccounts(db, mark)).map((a) => [a.staffId, a])));
    setLogins(await loadWebLogins(db, mark, 30));
  };
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: "ng", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const start = async (s: KioskSettings) => {
    try {
      setStatus(await startWebServer(s));
      onWebProblem("");
    } catch (e) {
      onWebProblem(String(e));
      throw e;
    }
  };

  const toggle = (on: boolean) =>
    run(async () => {
      await setSetting(db, "web_enabled", on ? "1" : "0");
      await onChanged();
      if (on) {
        await start({ ...settings, webEnabled: true });
        setMessage({ tone: "ok", text: "ブラウザ版を始めました。" });
      } else {
        await webStop();
        onWebProblem("");
        setMessage({ tone: "ok", text: "ブラウザ版を止めました（各自のパソコンからは押せません）。" });
      }
    });

  const changePort = () =>
    run(async () => {
      const n = Number(port);
      if (!/^\d+$/.test(port) || n < 1024 || n > 65535) throw new Error("ポートは 1024 から 65535 の番号にしてください。");
      await setSetting(db, "web_port", String(n));
      await onChanged();
      if (settings.webEnabled) await start({ ...settings, webPort: n });
      setMessage({ tone: "ok", text: `ポートを ${n} にしました。` });
    });

  const issue = (person: KioskStaff, password = "") =>
    run(async () => {
      const a = accounts.get(person.id);
      if (a && !(await confirm(`${person.name}さんの、いまのパスワードは使えなくなります。はじめのパスワードを作り直しますか？`, "はじめのパスワードを作る", "作る", "やめる"))) {
        return;
      }
      const r = await api.issueInitialPassword(person.id, password);
      setTyping(null);
      setTyped("");
      setSlip({ companyName: settings.companyName, staffId: r.staffId, name: r.name, password: r.password, expiresLabel: r.expiresLabel, urls: status?.urls ?? [] });
    });

  const clear = (person: KioskStaff) =>
    run(async () => {
      if (!(await confirm(`${person.name}さんのパスワードを消しますか？\nブラウザでは押せなくなります（入口のパソコンでは押せます）。`, "パスワードを消す", "消す", "やめる"))) return;
      const r = await api.clearPassword(person.id);
      setMessage({ tone: "ok", text: r.message });
    });

  const saveCa = () =>
    run(async () => {
      const saved = await saveCaCertificate();
      if (saved) setMessage({ tone: "ok", text: `「${saved.name}」を保存しました。各自のパソコンで開いて、入れてください（入れ方は下に書いてあります）。` });
    });

  const names = new Map(staff.map((s) => [s.id, s.name]));
  const typedProblem = typing && typed ? passwordProblem(typed, typing.id) : null;

  return (
    <>
      <div className="card">
        <h3>ブラウザ版（各自のパソコンのブラウザから押す）</h3>
        <p>
          この入口のパソコンの TimeQard がサーバーになり、同じネットワーク（社内の LAN・Wi-Fi）の中のパソコンのブラウザから、
          スタッフID とパスワードでログインして押せます。インターネットからはつながりません。
        </p>
        <label className="check">
          <input type="checkbox" checked={settings.webEnabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} /> 各自のパソコンのブラウザから押せるようにする
        </label>
        <div className="field">
          <label>ポート（初めは 8443）</label>
          <input type="text" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.trim())} style={{ width: 120 }} />{" "}
          <button className="btn gray" disabled={busy || port === String(settings.webPort)} onClick={changePort}>ポートを変える</button>
        </div>
        {webProblem && <div className="notice ng" style={{ width: "100%", fontSize: 15 }}>ブラウザ版を始められませんでした：{webProblem}</div>}
        {settings.webEnabled && status?.running && (
          <>
            <p style={{ marginBottom: 4 }}>動いています。各自のパソコンのブラウザで、次のアドレスを開きます。</p>
            {status.urls.length > 0 ? (
              <ul className="urls">
                {status.urls.map((u) => <li key={u}>{u}</li>)}
              </ul>
            ) : (
              <div className="notice warn" style={{ width: "100%", fontSize: 15 }}>
                このパソコンの、社内のネットワークのアドレスがわかりません。ネットワークにつながっているか確かめてください。
              </div>
            )}
          </>
        )}
        <ul className="muted small-list">
          <li>初めて始めるとき、パソコンに「ネットワークへの接続を許可するか」と聞かれたら、許可してください（社内のネットワークだけで足ります）。</li>
          <li>このパソコンのアドレスが変わると、各自のパソコンで開くアドレスも変わります。ルーターの設定で、このパソコンのアドレスを固定してください。</li>
          <li>入口のパソコンの TimeQard を閉じているあいだは、ブラウザからも押せません。</li>
          <li>来客用の Wi-Fi など、つないだ機器どうしが見えない設定のネットワークからは、つながりません。</li>
        </ul>
        {message && <div className={`notice ${message.tone}`} style={{ width: "100%", whiteSpace: "pre-wrap", fontSize: 15 }}>{message.text}</div>}
      </div>

      <div className="card">
        <h3>会社専用の証明書</h3>
        <p>
          ブラウザとのやりとりを暗号にするための証明書です。ブラウザ版を初めて始めたときに、TimeQard がこの会社のためだけに作りました。
          各自のパソコンに1回だけ入れます（入れないと、開くたびにブラウザが注意の画面を出します）。
          この証明書は、社内のアドレスのページにしか使えないようにしてあります。
        </p>
        {status?.caName ? (
          <table style={{ width: "auto" }}>
            <tbody>
              <tr><td>名前</td><td>{status.caName}</td></tr>
              <tr><td>指紋（SHA-256）</td><td className="mono small">{status.sha256}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">ブラウザ版を始めると、名前と指紋が出ます。</p>
        )}
        <button className="btn" disabled={busy} onClick={saveCa}>証明書をファイルに保存する（USB メモリなど）</button>
        <p className="muted" style={{ fontSize: 14 }}>
          入れ方：各自のパソコンで、保存したファイル（TimeQard-CA.cer）を開き、Windows は「信頼されたルート証明機関」に、Mac は「常に信頼」にして入れます。
          Firefox は、Firefox の設定から別に入れます。くわしくは、ブラウザ版のページの「このパソコンに証明書を入れる」に書いてあります
          （そのページからもダウンロードできます）。入れるときは、上の指紋と同じかを見比べてください。
        </p>
      </div>

      <div className="card">
        <h3>従業員のパスワード（ブラウザ版）</h3>
        <p>
          人ごとに、はじめのパスワードを作って、紙などで本人に渡します（期限は7日）。
          本人が初めてログインしたときに、自分だけのパスワード（{MIN_PASSWORD_LENGTH}文字以上）に変えるまで、押せません。
          忘れた人・まちがいが続いて使えなくなった人には、はじめのパスワードを作り直します。パスワードは TimeQard に残さず、確かめ用の値だけを残します。
        </p>
        <table>
          <thead>
            <tr><th>ID</th><th>名前</th><th>パスワード</th><th></th></tr>
          </thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={4} className="muted">従業員がいません。</td></tr>}
            {staff.map((s) => {
              const a = accounts.get(s.id);
              const st = accountState(a, now);
              return (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.name}</td>
                  <td style={{ color: st === "set" ? undefined : st === "none" ? "#78909c" : "#b26a00" }}>{accountStateLabel(a, now)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn small" disabled={busy} onClick={() => issue(s)}>{a ? "作り直す" : "はじめのパスワードを作る"}</button>{" "}
                    <button className="btn small gray" disabled={busy} onClick={() => { setTyping(s); setTyped(""); }}>自分で決める</button>{" "}
                    {a && <button className="btn small gray" disabled={busy} onClick={() => clear(s)}>消す</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>ログインの記録（新しいものから30件）</h3>
        <table>
          <thead><tr><th>日時</th><th>名前（ID）</th><th>こと</th><th>パソコンのアドレス</th></tr></thead>
          <tbody>
            {logins.length === 0 && <tr><td colSpan={4} className="muted">まだありません。</td></tr>}
            {logins.map((l) => (
              <tr key={l.id} style={{ color: l.result === "ok" || l.result === "changed" ? undefined : l.result === "issued" || l.result === "cleared" ? "#455a64" : "#c62828" }}>
                <td>{jstIso(l.at).slice(0, 10)} {timeLabel(jstTime(l.at))}</td>
                <td>{l.staffId === ADMIN_LOGIN_ID ? "管理者" : `${names.get(l.staffId) ?? ""}（${l.staffId}）`}</td>
                <td>{LOGIN_RESULT_LABELS[l.result] ?? l.result}</td>
                <td className="mono">{l.clientIp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {typing && (
        <div className="modal-back">
          <div className="modal" style={{ width: "min(560px, 94vw)" }}>
            <h2>はじめのパスワードを自分で決める（{typing.name}さん）</h2>
            <p style={{ fontSize: 15 }}>
              {MIN_PASSWORD_LENGTH}文字以上。スタッフID と同じもの・ほかの人のはじめのパスワードと同じものは使えません。
              ふつうは「はじめのパスワードを作る」（ばらばらな8文字）を使ってください。
            </p>
            <div className="field">
              <label>はじめのパスワード</label>
              <input type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ width: "100%" }} />
            </div>
            {typedProblem && <div className="error-text">{typedProblem}</div>}
            <div className="buttons">
              <button className="plain-btn" onClick={() => setTyping(null)}>やめる</button>
              <button className="mid-btn k-entry" disabled={busy || !typed || !!typedProblem} onClick={() => issue(typing, typed)}>作る</button>
            </div>
          </div>
        </div>
      )}

      {slip && (
        <div className="modal-back">
          <div className="modal" style={{ width: "min(640px, 94vw)" }}>
            <PasswordSlip slip={slip} />
            <p className="muted" style={{ fontSize: 14 }}>
              この画面を閉じると、はじめのパスワードは二度と出せません（TimeQard には残していません）。印刷するか、書き写してから閉じてください。
            </p>
            <div className="buttons">
              <button className="plain-btn" onClick={() => window.print()}>印刷する</button>
              <button className="mid-btn k-entry" onClick={() => setSlip(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
