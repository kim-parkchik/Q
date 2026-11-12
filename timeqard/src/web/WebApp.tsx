/**
 * ブラウザ版の画面（従業員）：ログイン → （はじめはパスワードを変える）→ 押す・押し忘れの申し出・自分の記録
 *
 * ・ログインは毎回。押したら、ログアウトになる（1分のあいだは、取り消しだけできる）。
 * ・5分のあいだ何もしなければ、ログアウトになる（入口のパソコンの側でも、同じ長さで切る）。
 * ・時刻は、入口のパソコンの時計を出す（このパソコンの時計は使わない）。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  addDays,
  jstDate,
  jstDateLabel,
  jstMs,
  jstParts,
  jstTime,
  NO_BREAK_LABEL,
  PUNCH_LABELS,
  REQUEST_REASONS,
  requestKindLabel,
  shortDateLabel,
  timeLabel,
  type PunchKind,
  type RequestKind,
} from "../../../shared/timeqard";
import type { WebHome, WebLogin, WebRecorded, WebRecords } from "../webApi";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordProblem } from "../passwordRules";
import { useNow } from "../useNow";
import { ApiError, call, errorText } from "./api";
import AdminApp from "./AdminApp";
import CertGuide from "./CertGuide";

/** 何もしなければログアウトにするまでの長さ（入口のパソコンの側と同じ） */
const IDLE_MS = 5 * 60 * 1000;
/** 申し出られる日（今日から、この日数前まで。入口のパソコンの側と同じ） */
const REQUEST_DAYS_BACK = 31;

type View = "login" | "change" | "home" | "done" | "request" | "records" | "password" | "admin" | "cert";

interface Notice {
  tone: "ok" | "ng" | "warn";
  text: string;
}

interface Recorded {
  target: "punch" | "request";
  message: string;
  ticket: string;
  until: number;
  cancelled?: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ログアウトになっていたので、ログインの画面に戻した（わけは、もう画面に出してある） */
class LoggedOut extends Error {}

export default function WebApp() {
  const [view, setView] = useState<View>("login");
  const [companyName, setCompanyName] = useState("");
  const [helloError, setHelloError] = useState("");
  const [home, setHome] = useState<WebHome | null>(null);
  const [mustChangeName, setMustChangeName] = useState<{ staffId: string; name: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null);
  const lastCall = useRef(Date.now());
  const now = useNow() + offset;

  useEffect(() => {
    call<{ companyName: string }>("hello")
      .then((r) => {
        setCompanyName(r.companyName);
        document.title = `${r.companyName}：TimeQard（ブラウザで押す）`;
      })
      .catch((e) => setHelloError(errorText(e)));
  }, []);

  const toLogin = (n: Notice | null) => {
    token.current = null;
    setHome(null);
    setMustChangeName(null);
    setNotice(n);
    setView("login");
  };

  /** ログインしてから頼む（ログアウトになっていたら、ログインの画面に戻す） */
  const ask = async <T,>(action: string, body: object = {}): Promise<T> => {
    try {
      const r = await call<T>(action, { ...body, token: token.current });
      lastCall.current = Date.now();
      return r;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.data.loggedOut === true)) {
        toLogin({ tone: "warn", text: e.message });
        throw new LoggedOut(e.message);
      }
      throw e;
    }
  };

  const showHome = (h: WebHome) => {
    setHome(h);
    setOffset(h.now - Date.now());
  };

  // 何もしなければ、ログアウトにする（押したあとの画面は、取り消せる1分が過ぎてしばらくしたら、ログインの画面に戻す）
  useEffect(() => {
    if (view === "done" && recorded && now - recorded.until > 60_000) {
      setRecorded(null);
      toLogin(null);
      return;
    }
    if (!token.current || view === "login" || view === "done" || view === "admin" || view === "cert") return;
    if (Date.now() - lastCall.current > IDLE_MS) {
      void call("logout", { token: token.current }).catch(() => undefined);
      toLogin({ tone: "warn", text: "しばらく何もしなかったので、ログアウトしました。" });
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = async (n: Notice | null = null) => {
    const t = token.current;
    toLogin(n);
    if (t) await call("logout", { token: t }).catch(() => undefined);
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof LoggedOut)) setNotice({ tone: "ng", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const onLogin = (staffId: string, password: string) =>
    run(async () => {
      setNotice(null);
      setRecorded(null);
      const r = await call<WebLogin>("login", { staffId, password });
      token.current = r.token;
      lastCall.current = Date.now();
      if (r.mustChange) {
        setMustChangeName({ staffId: r.staffId, name: r.name });
        setView("change");
        return;
      }
      showHome(r);
      setView("home");
    });

  const punch = (kind: PunchKind) =>
    run(async () => {
      setNotice(null);
      const r = await ask<WebRecorded>("punch", { kind });
      token.current = null;
      setHome(null);
      setRecorded({ target: "punch", message: r.message, ticket: r.cancelTicket, until: r.cancelUntil });
      setView("done");
    });

  const cancel = () =>
    run(async () => {
      if (!recorded) return;
      const r = await call<{ message: string }>("cancel", { ticket: recorded.ticket });
      setRecorded({ ...recorded, cancelled: true, message: r.message });
      if (recorded.target === "request" && token.current) showHome(await ask<WebHome>("status"));
    });

  const refresh = () =>
    run(async () => {
      showHome(await ask<WebHome>("status"));
    });

  if (view === "admin") return <AdminApp companyName={companyName} onExit={() => toLogin(null)} />;
  if (view === "cert") return <CertGuide onBack={() => setView("login")} />;

  const header = (
    <div className="w-header">
      <div className="w-company">{companyName || "TimeQard"}</div>
      {home && <div className="w-who">{home.name}さん</div>}
      {mustChangeName && !home && <div className="w-who">{mustChangeName.name}さん</div>}
      {token.current && (
        <button className="w-header-btn" onClick={() => logout()}>ログアウト</button>
      )}
    </div>
  );

  const clock = (
    <div className="w-clock">
      <span className="w-date">{jstDateLabel(now)}</span>{" "}
      <span className="w-time">
        {jstParts(now).hour}:{pad2(jstParts(now).minute)}
        <small>:{pad2(jstParts(now).second)}</small>
      </span>
    </div>
  );

  const noticeBox = notice && <div className={`w-notice ${notice.tone}`}>{notice.text}</div>;

  return (
    <div className="w-page">
      {header}
      <main className="w-main">
        {view === "login" && (
          <LoginView busy={busy} helloError={helloError} notice={noticeBox} onLogin={onLogin} onAdmin={() => setView("admin")} onCert={() => setView("cert")} />
        )}

        {view === "change" && (
          <PasswordView
            forced={!home}
            staffId={home?.staffId ?? mustChangeName?.staffId ?? ""}
            busy={busy}
            notice={noticeBox}
            onSubmit={(current, next) =>
              run(async () => {
                setNotice(null);
                const r = await ask<WebHome & { message: string }>("change_password", { current, next });
                setMustChangeName(null);
                showHome(r);
                setNotice({ tone: "ok", text: r.message });
                setView("home");
              })
            }
            onCancel={() => (home ? setView("home") : logout())}
          />
        )}

        {view === "home" && home && (
          <>
            {clock}
            <p className="w-muted w-center">時刻は、入口のパソコンの時計で記録します。</p>
            {noticeBox}
            {recorded && recorded.target === "request" && (
              <RecordedBox recorded={recorded} now={now} busy={busy} onCancel={cancel} />
            )}
            <HomeView home={home} busy={busy} now={now} onPunch={punch} />
            <div className="w-actions">
              <button className="w-btn plain" disabled={busy || !!home.requestBlock} onClick={() => { setNotice(null); setRecorded(null); setView("request"); }}>
                押し忘れを申し出る
              </button>
              <button className="w-btn plain" disabled={busy} onClick={() => { setNotice(null); setView("records"); }}>自分の記録を見る</button>
              <button className="w-btn plain" disabled={busy} onClick={() => { setNotice(null); setView("change"); }}>パスワードを変える</button>
              <button className="w-btn plain" disabled={busy} onClick={refresh}>読み直す</button>
            </div>
          </>
        )}

        {view === "done" && recorded && (
          <div className="w-card w-center">
            <div className={`w-done ${recorded.cancelled ? "warn" : "ok"}`}>{recorded.message}</div>
            {!recorded.cancelled && <RecordedBox recorded={recorded} now={now} busy={busy} onCancel={cancel} hideMessage />}
            {noticeBox}
            <p>ログアウトしました。続けて押すときは、もう一度ログインしてください。</p>
            <button className="w-btn" onClick={() => { setRecorded(null); toLogin(null); }}>ログインの画面に戻る</button>
          </div>
        )}

        {view === "request" && home && (
          <RequestView
            home={home}
            now={now}
            busy={busy}
            notice={noticeBox}
            onSubmit={(input) =>
              run(async () => {
                setNotice(null);
                const r = await ask<WebRecorded>("request", input);
                setRecorded({ target: "request", message: r.message, ticket: r.cancelTicket, until: r.cancelUntil });
                showHome(await ask<WebHome>("status"));
                setView("home");
              })
            }
            onCancel={() => { setNotice(null); setView("home"); }}
          />
        )}

        {view === "records" && home && <RecordsView now={now} ask={ask} onBack={() => setView("home")} />}
      </main>
    </div>
  );
}

function LoginView(props: {
  busy: boolean;
  helloError: string;
  notice: ReactNode;
  onLogin: (staffId: string, password: string) => void;
  onAdmin: () => void;
  onCert: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!staffId.trim() || !password) return;
    props.onLogin(staffId, password);
    setPassword("");
  };
  return (
    <div className="w-card w-narrow">
      <h1>ブラウザで押す</h1>
      {props.helloError && <div className="w-notice ng">{props.helloError}</div>}
      {props.notice}
      <form onSubmit={submit}>
        <div className="w-field">
          <label htmlFor="staff-id">スタッフID</label>
          <input id="staff-id" value={staffId} onChange={(e) => setStaffId(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus />
        </div>
        <div className="w-field">
          <label htmlFor="password">パスワード</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </div>
        <button className="w-btn wide" type="submit" disabled={props.busy || !staffId.trim() || !password}>
          {props.busy ? "確かめています…" : "ログイン"}
        </button>
      </form>
      <p className="w-muted">ログインしたままにはなりません。押したら、ログアウトになります。パスワードを忘れたときは、管理者に、はじめのパスワードを作り直してもらってください。</p>
      <div className="w-links">
        <button className="w-link" onClick={props.onCert}>このパソコンに、会社専用の証明書を入れる</button>
        <button className="w-link" onClick={props.onAdmin}>管理者の方（管理のパスワードで入る）</button>
      </div>
    </div>
  );
}

function PasswordView(props: {
  forced: boolean;
  staffId: string;
  busy: boolean;
  notice: ReactNode;
  onSubmit: (current: string, next: string) => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const problem = a ? passwordProblem(a, props.staffId) : null;
  const ready = !problem && a !== "" && a === b && (props.forced || current !== "") && !props.busy;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) props.onSubmit(current, a);
  };
  return (
    <div className="w-card w-narrow">
      <h1>{props.forced ? "はじめに、自分だけのパスワードに変えてください" : "パスワードを変える"}</h1>
      {props.forced && <p>管理者から受け取ったはじめのパスワードは、変えるまでのあいだだけ使えます。変えるまで、押せません。</p>}
      {props.notice}
      <form onSubmit={submit}>
        {!props.forced && (
          <div className="w-field">
            <label htmlFor="current">いまのパスワード</label>
            <input id="current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="off" />
          </div>
        )}
        <div className="w-field">
          <label htmlFor="next">新しいパスワード（{MIN_PASSWORD_LENGTH}文字以上）</label>
          <input id="next" type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" maxLength={MAX_PASSWORD_LENGTH * 2} />
        </div>
        <div className="w-field">
          <label htmlFor="again">もう一度</label>
          <input id="again" type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />
        </div>
        {problem && <div className="w-error">{problem}</div>}
        {a && b && a !== b && <div className="w-error">2つのパスワードがちがいます。</div>}
        <ul className="w-rules">
          <li>{MIN_PASSWORD_LENGTH}文字以上（{MAX_PASSWORD_LENGTH}文字まで）。長いほど、当てられにくくなります。</li>
          <li>スタッフID と同じもの・同じ文字ばかり・「12345678」のような並びは使えません。</li>
          <li>ほかの人に教えないでください。ほかのサイトと同じパスワードにしないでください。</li>
        </ul>
        <div className="w-actions">
          <button type="button" className="w-btn plain" onClick={props.onCancel}>{props.forced ? "ログアウト" : "やめる"}</button>
          <button type="submit" className="w-btn" disabled={!ready}>変える</button>
        </div>
      </form>
    </div>
  );
}

function HomeView(props: { home: WebHome; busy: boolean; now: number; onPunch: (kind: PunchKind) => void }) {
  const { home } = props;
  const [others, setOthers] = useState(false);
  const blocked = !!home.block;
  return (
    <div className="w-card">
      <div>
        <span className="w-name">{home.name}さん</span>
        <span className="w-state">{home.stateLabel}</span>
      </div>
      <div className="w-muted">スタッフID {home.staffId}</div>
      <div className="w-today">
        今日の打刻：{home.today.length === 0 ? "まだありません" : home.today.map((x) => `${PUNCH_LABELS[x.kind]} ${timeLabel(x.time)}`).join("・")}
      </div>
      {home.block && <div className="w-notice ng">{home.block}</div>}
      <div className="w-actions">
        <button className={`w-big k-${home.suggested}`} disabled={props.busy || blocked} onClick={() => props.onPunch(home.suggested)}>
          {PUNCH_LABELS[home.suggested]}
        </button>
        {!others && home.kinds.length > 1 && (
          <button className="w-btn plain" onClick={() => setOthers(true)}>そのほか</button>
        )}
      </div>
      {others && (
        <div className="w-actions">
          {home.kinds.filter((k) => k !== home.suggested).map((k) => (
            <button key={k} className={`w-mid k-${k}`} disabled={props.busy || blocked} onClick={() => props.onPunch(k)}>{PUNCH_LABELS[k]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordedBox(props: { recorded: Recorded; now: number; busy: boolean; onCancel: () => void; hideMessage?: boolean }) {
  const { recorded } = props;
  const left = Math.max(0, Math.ceil((recorded.until - props.now) / 1000));
  if (recorded.cancelled) return props.hideMessage ? null : <div className="w-notice warn">{recorded.message}</div>;
  return (
    <div className={props.hideMessage ? "w-cancel" : "w-notice ok w-cancel"}>
      {!props.hideMessage && <span>{recorded.message}</span>}
      {left > 0 && (
        <button className="w-btn plain small" disabled={props.busy} onClick={props.onCancel}>
          取り消す（あと{Math.min(60, left)}秒）
        </button>
      )}
    </div>
  );
}

function RequestView(props: {
  home: WebHome;
  now: number;
  busy: boolean;
  notice: ReactNode;
  onSubmit: (input: { date: string; kind: RequestKind; time: string; reason: string; note: string }) => void;
  onCancel: () => void;
}) {
  const today = jstDate(props.now);
  const dates = useMemo(() => Array.from({ length: REQUEST_DAYS_BACK + 1 }, (_, i) => addDays(today, -i)), [today]);
  const start = jstParts(props.now);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<RequestKind | null>(null);
  const [hour, setHour] = useState(pad2(start.hour));
  const [minute, setMinute] = useState(pad2(start.minute));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const noBreak = kind === "no_break";
  const time = `${hour}:${minute}`;
  const future = !noBreak && jstMs(date, time) > props.now;
  const needNote = !noBreak && reason === "そのほか" && note.trim() === "";
  const ready = kind !== null && (noBreak || reason !== "") && !future && !needNote && !props.busy;
  const submit = () => {
    if (!ready || kind === null) return;
    props.onSubmit(noBreak ? { date, kind, time: "", reason: NO_BREAK_LABEL, note } : { date, kind, time, reason, note });
  };
  return (
    <div className="w-card">
      <h1>押し忘れを申し出る</h1>
      <p>押し忘れた・押し間違えた時刻や、休憩を取れなかった日を、担当者に伝えます。押した打刻は消えません。担当者が確かめてから直します。</p>
      {props.notice}
      <div className="w-field">
        <label htmlFor="req-date">日</label>
        <select id="req-date" value={date} onChange={(e) => setDate(e.target.value)}>
          {dates.map((d, i) => (
            <option key={d} value={d}>
              {jstDateLabel(jstMs(d, "12:00"))}
              {i === 0 ? "（今日）" : i === 1 ? "（きのう）" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="w-field">
        <label>種類</label>
        <div className="w-choice">
          {props.home.kinds.map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{PUNCH_LABELS[k]}</button>
          ))}
          <button className={noBreak ? "on" : ""} onClick={() => setKind("no_break")}>{NO_BREAK_LABEL}</button>
        </div>
      </div>
      {noBreak ? (
        <p className="w-muted">その日は休憩を取れなかったことを伝えます（時刻はいりません）。担当者が確かめて、休憩を引かずに計算します。</p>
      ) : (
        <>
          <div className="w-field">
            <label htmlFor="req-hour">時刻</label>
            <select id="req-hour" value={hour} onChange={(e) => setHour(e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => pad2(h)).map((h) => <option key={h} value={h}>{Number(h)}時</option>)}
            </select>{" "}
            <select aria-label="分" value={minute} onChange={(e) => setMinute(e.target.value)}>
              {Array.from({ length: 60 }, (_, m) => pad2(m)).map((m) => <option key={m} value={m}>{m}分</option>)}
            </select>
            {future && <div className="w-error">これからの時刻は申し出られません。</div>}
          </div>
          <div className="w-field">
            <label>理由</label>
            <div className="w-choice">
              {REQUEST_REASONS.map((r) => (
                <button key={r} className={reason === r ? "on" : ""} onClick={() => setReason(r)}>{r}</button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="w-field">
        <label htmlFor="req-note">{noBreak ? "わけ（なくてもよい）" : `ひとこと${reason === "そのほか" ? "（書いてください）" : "（なくてもよい）"}`}</label>
        <input id="req-note" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder={noBreak ? "たとえば：来客が続いて取れなかった" : "たとえば：会議が長引いて、押すのを忘れた"} />
      </div>
      <div className="w-actions">
        <button className="w-btn plain" onClick={props.onCancel}>やめる</button>
        <button className="w-btn" disabled={!ready} onClick={submit}>{props.busy ? "送っています…" : "申し出る"}</button>
      </div>
    </div>
  );
}

const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

function RecordsView(props: { now: number; ask: <T>(action: string, body?: object) => Promise<T>; onBack: () => void }) {
  const p = jstParts(props.now);
  const months = useMemo(
    () =>
      Array.from({ length: 13 }, (_, i) => {
        const m = p.year * 12 + (p.month - 1) - i;
        return `${Math.floor(m / 12)}-${pad2((m % 12) + 1)}`;
      }),
    [p.year, p.month]
  );
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<WebRecords | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    props.ask<WebRecords>("records", { month }).then(setData).catch((e) => setError(errorText(e)));
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const span = (a: string, b: string) => (a || b ? `${a ? timeLabel(a) : "?"}〜${b ? timeLabel(b) : "?"}` : "");
  return (
    <div className="w-card">
      <h1>自分の記録</h1>
      <div className="w-field">
        <label htmlFor="month">月</label>
        <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>
      <p className="w-muted">
        入口のパソコン・ブラウザで押した打刻を、1日1行にまとめたものです（取り消した打刻は入りません）。申し出は、担当者が確かめてから、給与の勤怠に入ります。
      </p>
      {error && <div className="w-notice ng">{error}</div>}
      {!data && !error && <p>読んでいます…</p>}
      {data && (
        <>
          <div className="w-table-wrap">
            <table className="w-table">
              <thead>
                <tr><th>日</th><th>出勤</th><th>退勤</th><th>休憩</th><th>外出</th><th>申し出</th><th>注意</th></tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={7} className="w-muted">この月の打刻・申し出はありません。</td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.date}>
                    <td className="w-nowrap">{jstDateLabel(jstMs(r.date, "12:00"))}</td>
                    <td>{timeLabel(r.times.entry)}</td>
                    <td>{timeLabel(r.times.exit)}</td>
                    <td className="w-nowrap">{span(r.times.break_start, r.times.break_end)}</td>
                    <td className="w-nowrap">{span(r.times.out, r.times.return)}</td>
                    <td>
                      {[
                        ...(Object.entries(r.requests) as [PunchKind, string][]).map(([k, t]) => `${PUNCH_LABELS[k]} ${timeLabel(t)}`),
                        ...(r.noBreakRequest ? [NO_BREAK_LABEL] : []),
                      ].join("・")}
                    </td>
                    <td className="w-small">{r.notes.join("／")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.requests.length > 0 && (
            <>
              <h2>この月の申し出</h2>
              <div className="w-table-wrap">
                <table className="w-table">
                  <thead><tr><th>申し出た日時</th><th>日</th><th>種類</th><th>時刻</th><th>理由</th></tr></thead>
                  <tbody>
                    {data.requests.map((r, i) => (
                      <tr key={i}>
                        <td className="w-nowrap">{shortDateLabel(jstDate(r.requestedAt))} {timeLabel(jstTime(r.requestedAt))}</td>
                        <td className="w-nowrap">{shortDateLabel(r.date)}</td>
                        <td>{requestKindLabel(r.kind)}</td>
                        <td>{r.time ? timeLabel(r.time) : ""}</td>
                        <td>{r.reason}{r.note ? `（${r.note}）` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <div className="w-actions">
        <button className="w-btn plain" onClick={props.onBack}>戻る</button>
      </div>
    </div>
  );
}
