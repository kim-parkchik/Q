/**
 * ブラウザ版の管理の画面（管理のパスワードで入る。timeqard/DESIGN.md の 10）
 *
 * ・CSV のダウンロード（Q の勤怠の「CSV 取り込み」で入れる。USB メモリで運ぶ方法も、入口のパソコンに残してある）
 * ・従業員のパスワード（はじめのパスワードを作る・作り直す・消す。渡すための紙を印刷する）
 * ・5回続けてまちがえたら、15分は入れない。5分のあいだ何もしなければ、ログアウトになる。
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { jstParts, monthRange } from "../../../shared/timeqard";
import type { WebAccountRow, WebCsv, WebIssued } from "../webApi";
import PasswordSlip, { type Slip } from "../PasswordSlip";
import { useNow } from "../useNow";
import { ApiError, call, downloadCsv, errorText } from "./api";

const IDLE_MS = 5 * 60 * 1000;

type Tab = "csv" | "passwords";

export default function AdminApp(props: { companyName: string; onExit: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("csv");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const lastCall = useRef(Date.now());
  const now = useNow();

  useEffect(() => {
    if (token && Date.now() - lastCall.current > IDLE_MS) {
      void call("logout", { token }).catch(() => undefined);
      setToken(null);
      setError("しばらく何もしなかったので、ログアウトしました。");
    }
  }, [now, token]);

  const ask = async <T,>(action: string, body: object = {}): Promise<T> => {
    try {
      const r = await call<T>(action, { ...body, token });
      lastCall.current = Date.now();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setError(e.message);
      }
      throw e;
    }
  };

  const login = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await call<{ token: string }>("admin_login", { password });
      lastCall.current = Date.now();
      setToken(r.token);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPassword("");
      setBusy(false);
    }
  };

  const logout = () => {
    if (token) void call("logout", { token }).catch(() => undefined);
    setToken(null);
    props.onExit();
  };

  return (
    <div className="w-page">
      <div className="w-header">
        <div className="w-company">管理：{props.companyName || "TimeQard"}</div>
        {token ? <button className="w-header-btn" onClick={logout}>ログアウト</button> : <button className="w-header-btn" onClick={props.onExit}>戻る</button>}
      </div>
      <main className="w-main">
        {!token ? (
          <div className="w-card w-narrow">
            <h1>管理の画面に入る</h1>
            <p>入口のパソコンの TimeQard の、管理のパスワードを入れます。</p>
            {error && <div className="w-notice ng">{error}</div>}
            <form onSubmit={login}>
              <div className="w-field">
                <label htmlFor="admin-password">管理のパスワード</label>
                <input id="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoFocus />
              </div>
              <button className="w-btn wide" type="submit" disabled={busy || !password}>{busy ? "確かめています…" : "入る"}</button>
            </form>
            <p className="w-muted">5回続けてまちがえると、15分はブラウザからは入れません（入口のパソコンの管理の画面は使えます）。</p>
          </div>
        ) : (
          <>
            <div className="w-tabs">
              <button className={tab === "csv" ? "on" : ""} onClick={() => setTab("csv")}>CSV のダウンロード</button>
              <button className={tab === "passwords" ? "on" : ""} onClick={() => setTab("passwords")}>従業員のパスワード</button>
            </div>
            {tab === "csv" ? <CsvTab ask={ask} /> : <PasswordsTab ask={ask} companyName={props.companyName} />}
          </>
        )}
      </main>
    </div>
  );
}

type Ask = <T>(action: string, body?: object) => Promise<T>;

function CsvTab({ ask }: { ask: Ask }) {
  const p = jstParts(Date.now());
  const last = p.month === 1 ? monthRange(p.year - 1, 12) : monthRange(p.year, p.month - 1);
  const thisMonth = monthRange(p.year, p.month);
  const [range, setRange] = useState<"last" | "this" | "custom">("last");
  const [from, setFrom] = useState(last.from);
  const [to, setTo] = useState(last.to);
  const [result, setResult] = useState<{ tone: "ok" | "ng"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const period = range === "last" ? last : range === "this" ? thisMonth : { from, to };

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await ask<WebCsv>("admin_csv", period);
      downloadCsv(r.fileName, r.csv);
      setResult({
        tone: "ok",
        text: `「${r.fileName}」をダウンロードしました（${r.summaryText}）。\nQ の「TimeQard（打刻）」の画面か、勤怠の「CSV 取り込み」で取り込んでください。`,
      });
    } catch (e) {
      setResult({ tone: "ng", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-card">
      <h1>打刻を CSV でダウンロードする（Q に取り込む）</h1>
      <p>1人1日1行の CSV です。夜勤は、出勤した日の行に入ります。同じ期間を何度ダウンロードしてもかまいません。</p>
      <div className="w-choice">
        <button className={range === "last" ? "on" : ""} onClick={() => setRange("last")}>先月（{last.from}〜{last.to}）</button>
        <button className={range === "this" ? "on" : ""} onClick={() => setRange("this")}>今月（{thisMonth.from}〜{thisMonth.to}）</button>
        <button className={range === "custom" ? "on" : ""} onClick={() => setRange("custom")}>日付で選ぶ</button>
      </div>
      {range === "custom" && (
        <div className="w-field">
          <input type="date" aria-label="初めの日" value={from} onChange={(e) => setFrom(e.target.value)} /> 〜{" "}
          <input type="date" aria-label="終わりの日" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="w-muted">締め日が月末でない会社は、締め日に合わせて選んでください（例：10月21日〜11月20日）。</div>
        </div>
      )}
      <div className="w-actions">
        <button className="w-btn" disabled={busy} onClick={run}>{busy ? "作っています…" : "CSV をダウンロードする"}</button>
      </div>
      {result && <div className={`w-notice ${result.tone}`} style={{ whiteSpace: "pre-wrap" }}>{result.text}</div>}
    </div>
  );
}

function PasswordsTab({ ask, companyName }: { ask: Ask; companyName: string }) {
  const [rows, setRows] = useState<WebAccountRow[] | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "ng"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);

  const load = async () => {
    try {
      setRows((await ask<{ accounts: WebAccountRow[] }>("admin_accounts")).accounts);
    } catch (e) {
      setMessage({ tone: "ng", text: errorText(e) });
    }
  };
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async (row: WebAccountRow) => {
    if (row.state !== "none" && !window.confirm(`${row.name}さんの、いまのパスワードは使えなくなります。はじめのパスワードを作り直しますか？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await ask<WebIssued>("admin_issue", { staffId: row.staffId });
      setSlip({ companyName, staffId: r.staffId, name: r.name, password: r.password, expiresLabel: r.expiresLabel, urls: [`${window.location.origin}/`] });
      await load();
    } catch (e) {
      setMessage({ tone: "ng", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const clear = async (row: WebAccountRow) => {
    if (!window.confirm(`${row.name}さんのパスワードを消しますか？\nブラウザでは押せなくなります（入口のパソコンでは押せます）。`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await ask<{ message: string }>("admin_clear", { staffId: row.staffId });
      setMessage({ tone: "ok", text: r.message });
      await load();
    } catch (e) {
      setMessage({ tone: "ng", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (slip) {
    return (
      <div className="w-card">
        <PasswordSlip slip={slip} />
        <p className="w-muted">この画面を閉じると、はじめのパスワードは二度と出せません（TimeQard には残していません）。印刷するか、書き写してから閉じてください。</p>
        <div className="w-actions">
          <button className="w-btn plain" onClick={() => window.print()}>印刷する</button>
          <button className="w-btn" onClick={() => setSlip(null)}>閉じる</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-card">
      <h1>従業員のパスワード</h1>
      <p>
        人ごとに、はじめのパスワード（ばらばらな8文字。期限は7日）を作って、紙などで本人に渡します。本人が初めてログインしたときに、自分だけのパスワードに変えるまで、押せません。
        忘れた人・まちがいが続いて使えなくなった人には、作り直します。自分で決めたはじめのパスワードを使うときは、入口のパソコンの管理の画面で作ります。
      </p>
      {message && <div className={`w-notice ${message.tone}`}>{message.text}</div>}
      {!rows ? (
        <p>読んでいます…</p>
      ) : (
        <div className="w-table-wrap">
          <table className="w-table">
            <thead><tr><th>ID</th><th>名前</th><th>パスワード</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="w-muted">従業員がいません。</td></tr>}
              {rows.map((r) => (
                <tr key={r.staffId}>
                  <td>{r.staffId}</td>
                  <td className="w-nowrap">{r.name}</td>
                  <td className={r.state === "set" ? "" : "w-attention"}>{r.stateLabel}</td>
                  <td className="w-nowrap">
                    <button className="w-btn small" disabled={busy} onClick={() => issue(r)}>{r.state === "none" ? "はじめのパスワードを作る" : "作り直す"}</button>{" "}
                    {r.state !== "none" && <button className="w-btn plain small" disabled={busy} onClick={() => clear(r)}>消す</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
