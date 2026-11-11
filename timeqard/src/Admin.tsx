/**
 * 管理の画面（パスワードつき。くわしくは timeqard/DESIGN.md の 4.4）
 *
 * ・打刻の一覧（見るだけ。直すのは Q）
 * ・CSV の書き出し（Q に取り込む）
 * ・従業員ファイルの読み込み直し
 * ・設定（ボタン・音・画面いっぱい・パソコンを点けたら開く・控え・パスワード）
 * 5分のあいだ何もしなければ、打刻の画面に戻る。
 */
import { useEffect, useRef, useState } from "react";
import {
  companyMarkLabel,
  jstDate,
  jstIso,
  jstParts,
  jstTime,
  monthRange,
  parseIso,
  requestKindLabel,
  safeFileNamePart,
  timeLabel,
  writeTimeQardCsv,
  type TimeQardCsvRow,
} from "../../shared/timeqard";
import { BACKUP_KEEP, backupNow } from "./backup";
import { NewPasswordFields } from "./PasswordDialog";
import { confirm, dataDir, getAutostart, hashPassword, pickFolder, pickTextFile, quitApp, saveCsv, setAutostart, setFullscreen } from "./platform";
import { applyStaffFile, exportRows, loadDayEvents, loadStaff, recordExport, setSetting, type DayEvent, type KioskDb, type KioskSettings, type KioskStaff } from "./store";
import { checkStaffFile } from "./staffFileLoad";

type Tab = "list" | "export" | "staff" | "settings";
const IDLE_MS = 5 * 60 * 1000;

const when = (iso: string | null) => {
  const ms = iso ? parseIso(iso) : null;
  return ms === null ? "—" : `${jstDate(ms)} ${jstTime(ms)}`;
};

export default function Admin(props: { db: KioskDb; settings: KioskSettings; onChanged: () => Promise<void>; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("export");
  const lastAction = useRef(Date.now());
  const onExit = useRef(props.onExit);
  onExit.current = props.onExit;

  useEffect(() => {
    const touch = () => (lastAction.current = Date.now());
    window.addEventListener("mousemove", touch);
    window.addEventListener("keydown", touch);
    const id = window.setInterval(() => {
      if (Date.now() - lastAction.current > IDLE_MS) onExit.current();
    }, 10_000);
    return () => {
      window.removeEventListener("mousemove", touch);
      window.removeEventListener("keydown", touch);
      window.clearInterval(id);
    };
  }, []);

  const tabs: [Tab, string][] = [
    ["export", "CSV の書き出し"],
    ["list", "打刻の一覧"],
    ["staff", "従業員ファイル"],
    ["settings", "設定"],
  ];

  return (
    <div className="admin">
      <div className="header">
        <div className="company">管理：{props.settings.companyName}</div>
        <button onClick={props.onExit}>打刻の画面に戻る</button>
        <button
          onClick={async () => {
            if (await confirm("TimeQard を閉じますか？\n閉じているあいだは、打刻できません。", "TimeQard を閉じる", "閉じる", "やめる")) await quitApp();
          }}
        >
          TimeQard を閉じる
        </button>
      </div>
      <div className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div className="body">
        {tab === "export" && <ExportTab {...props} />}
        {tab === "list" && <ListTab {...props} />}
        {tab === "staff" && <StaffTab {...props} />}
        {tab === "settings" && <SettingsTab {...props} />}
      </div>
    </div>
  );
}

type TabProps = { db: KioskDb; settings: KioskSettings; onChanged: () => Promise<void> };

function ExportTab({ db, settings }: TabProps) {
  const now = Date.now();
  const p = jstParts(now);
  const last = p.month === 1 ? monthRange(p.year - 1, 12) : monthRange(p.year, p.month - 1);
  const thisMonth = monthRange(p.year, p.month);
  const [range, setRange] = useState<"last" | "this" | "custom">("last");
  const [from, setFrom] = useState(last.from);
  const [to, setTo] = useState(last.to);
  const [result, setResult] = useState<{ text: string; tone: "ok" | "ng" } | null>(null);
  const [busy, setBusy] = useState(false);

  const period = range === "last" ? last : range === "this" ? thisMonth : { from, to };

  const run = async () => {
    setResult(null);
    if (!settings.companyMark) return;
    if (period.from > period.to) {
      setResult({ tone: "ng", text: "期間の初めの日が、終わりの日より後になっています。" });
      return;
    }
    setBusy(true);
    try {
      const rows: TimeQardCsvRow[] = await exportRows(db, { companyMark: settings.companyMark, from: period.from, to: period.to, now: Date.now() });
      if (rows.length === 0) {
        setResult({ tone: "ng", text: `${period.from}〜${period.to} の打刻・申し出はありません。` });
        return;
      }
      const fileName = `${safeFileNamePart(settings.companyName)}_打刻_${period.from}〜${period.to}.csv`;
      const saved = await saveCsv(writeTimeQardCsv(rows), fileName);
      if (!saved) return;
      await recordExport(db, { companyMark: settings.companyMark, from: period.from, to: period.to, fileName: saved.name, rowCount: rows.length, at: Date.now() });
      const people = new Set(rows.map((r) => r.staffId)).size;
      const requests = rows.reduce((a, r) => a + Object.keys(r.requests).length + (r.noBreakRequest ? 1 : 0), 0);
      const notes = rows.filter((r) => r.notes.length > 0).length;
      const cardless = rows.filter((r) => r.cardless.length > 0).length;
      setResult({
        tone: "ok",
        text:
          `「${saved.name}」を保存しました（${people}人・${rows.length}日分。申し出 ${requests}件・注意のある日 ${notes}日・ID で押した日 ${cardless}日）。\n` +
          `USB メモリなどで Q のパソコンに運び、Q の「TimeQard（打刻）」の画面か、勤怠の「CSV 取り込み」で取り込んでください。`,
      });
    } catch (e) {
      setResult({ tone: "ng", text: `書き出せませんでした：${e}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>打刻を CSV に書き出す（Q に取り込む）</h3>
      <p>1人1日1行の CSV です。夜勤は、出勤した日の行に入ります。まだ終わっていない勤務は、出勤だけが入ります（あとで書き出し直して取り込めば、退勤も入ります）。同じ期間を何度書き出してもかまいません。</p>
      <div className="choice" style={{ margin: "8px 0" }}>
        <button className={range === "last" ? "on" : ""} onClick={() => setRange("last")}>先月（{last.from}〜{last.to}）</button>
        <button className={range === "this" ? "on" : ""} onClick={() => setRange("this")}>今月（{thisMonth.from}〜{thisMonth.to}）</button>
        <button className={range === "custom" ? "on" : ""} onClick={() => setRange("custom")}>日付で選ぶ</button>
      </div>
      {range === "custom" && (
        <div className="field">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> 〜 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="muted" style={{ fontSize: 13 }}>締め日が月末でない会社は、締め日に合わせて選んでください（例：10月21日〜11月20日）。</div>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={run}>{busy ? "書き出しています…" : "CSV を書き出す"}</button>
      </div>
      {result && <div className={result.tone === "ok" ? "notice ok" : "notice ng"} style={{ width: "100%", whiteSpace: "pre-wrap", fontSize: 15 }}>{result.text}</div>}
    </div>
  );
}

function ListTab({ db, settings }: TabProps) {
  const [date, setDate] = useState(jstDate(Date.now()));
  const [events, setEvents] = useState<DayEvent[]>([]);
  useEffect(() => {
    if (!settings.companyMark || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    loadDayEvents(db, settings.companyMark, date).then(setEvents).catch((e) => console.error(e));
  }, [db, settings.companyMark, date]);

  return (
    <div className="card">
      <h3>打刻の一覧（見るだけ）</h3>
      <p>その日に押した打刻と、その日の分の申し出です。取り消した打刻も残っています。直すのは、Q に取り込んでから、Q の勤怠の画面でします。</p>
      <div className="field">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr><th>名前（ID）</th><th>押した時刻</th><th>種類</th><th>どうやって</th><th>そのほか</th></tr>
        </thead>
        <tbody>
          {events.length === 0 && <tr><td colSpan={5} className="muted">この日の打刻はありません。</td></tr>}
          {events.map((e) => (
            <tr key={`${e.type}-${e.id}`} style={{ color: e.cancelled ? "#90a4ae" : undefined }}>
              <td>{e.name}（{e.staffId}）</td>
              <td>{timeLabel(jstTime(e.at))}</td>
              <td>
                {e.type === "request" ? (
                  <><span className="tag req">申し出</span> {requestKindLabel(e.kind)}{e.requestTime ? ` ${timeLabel(e.requestTime)}` : ""}</>
                ) : requestKindLabel(e.kind)}
              </td>
              <td>{e.method === "id" ? <span className="tag id">ID</span> : "カード"}</td>
              <td>
                {e.cancelled && <span className="tag cancel">取り消し</span>}
                {e.type === "request" && ` ${e.reason}${e.note ? `（${e.note}）` : ""}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffTab({ db, settings, onChanged }: TabProps) {
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "ng" } | null>(null);
  const reloadStaff = () => {
    if (settings.companyMark) loadStaff(db, settings.companyMark).then(setStaff).catch(console.error);
  };
  useEffect(reloadStaff, [db, settings.companyMark]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setMessage(null);
    try {
      const picked = await pickTextFile("従業員ファイル", ["json"]);
      if (!picked) return;
      const check = checkStaffFile(picked.text, settings);
      if (check.kind === "error") {
        setMessage({ tone: "ng", text: check.message });
        return;
      }
      if (check.kind === "confirm") {
        const ok = await confirm(check.message, check.switching ? "会社を切り替える" : "古い従業員ファイル", check.switching ? "切り替える" : "読み込む", "やめる");
        if (!ok) return;
      }
      const r = await applyStaffFile(db, check.file, jstIso(Date.now()));
      await onChanged();
      setMessage({
        tone: "ok",
        text: `読み込みました（${r.total}人。新しく入った人 ${r.added}人・一覧から外れた人 ${r.removed}人）。USB メモリの従業員ファイルは消してください。`,
      });
      reloadStaff();
    } catch (e) {
      setMessage({ tone: "ng", text: `読み込めませんでした：${e}` });
    }
  };

  const inFile = staff.filter((s) => s.inFile).sort((a, b) => a.id.localeCompare(b.id, "ja", { numeric: true }));
  return (
    <>
      <div className="card">
        <h3>従業員ファイル</h3>
        <table style={{ width: "auto" }}>
          <tbody>
            <tr><td>会社</td><td>{settings.companyName}</td></tr>
            <tr><td>会社の印</td><td style={{ fontFamily: "monospace" }}>{settings.companyMark ? companyMarkLabel(settings.companyMark) : "—"}</td></tr>
            <tr><td>Q で書き出した日時</td><td>{when(settings.staffFileExportedAt)}</td></tr>
            <tr><td>入っている人</td><td>{inFile.length}人</td></tr>
          </tbody>
        </table>
        <p>入社・退職・カードの作り直しのあとは、Q で書き出し直した従業員ファイルを読み込んでください（作り直す前のカードは、読み込むと使えなくなります）。</p>
        <button className="btn" onClick={load}>従業員ファイルを読み込む</button>
        {message && <div className={`notice ${message.tone}`} style={{ width: "100%", whiteSpace: "pre-wrap", fontSize: 15 }}>{message.text}</div>}
      </div>
      <div className="card">
        <h3>入っている人</h3>
        <table>
          <thead><tr><th>ID</th><th>名前</th><th>入社日</th><th>退職日</th><th>カード</th></tr></thead>
          <tbody>
            {inFile.map((s) => (
              <tr key={s.id}><td>{s.id}</td><td>{s.name}</td><td>{s.joinDate ?? ""}</td><td>{s.retirementDate ?? ""}</td><td>{s.cardHashes.length > 0 ? "あり" : <span className="muted">なし（ID で押す）</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SettingsTab({ db, settings, onChanged }: TabProps) {
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [dir, setDir] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "ng" } | null>(null);

  useEffect(() => {
    getAutostart().then(setAutostartState).catch(() => setAutostartState(null));
    dataDir().then(setDir).catch(() => setDir(""));
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((ds) => setCameras(ds.filter((d) => d.kind === "videoinput")))
      .catch(() => setCameras([]));
  }, []);

  const flag = async (key: string, value: boolean) => {
    await setSetting(db, key, value ? "1" : "0");
    if (key === "fullscreen") await setFullscreen(value);
    await onChanged();
  };

  const toggleAutostart = async (on: boolean) => {
    try {
      await setAutostart(on);
      setAutostartState(await getAutostart());
    } catch (e) {
      setMessage({ tone: "ng", text: `パソコンを点けたら開く設定を変えられませんでした：${e}` });
    }
  };

  const chooseBackupDir = async () => {
    const path = await pickFolder("控えを作るフォルダ（USB メモリなど）");
    if (!path) return;
    await setSetting(db, "backup_dir", path);
    await onChanged();
  };

  const backup = async () => {
    setMessage(null);
    try {
      const path = await backupNow(db, settings.backupDir);
      setMessage({ tone: "ok", text: `控えを作りました：${path}` });
    } catch (e) {
      setMessage({ tone: "ng", text: `控えを作れませんでした（フォルダ・USB メモリを確かめてください）：${e}` });
    }
    await onChanged();
  };

  const changePassword = async () => {
    if (!password) return;
    await setSetting(db, "admin_password_hash", await hashPassword(password));
    setMessage({ tone: "ok", text: "管理のパスワードを変えました。" });
    await onChanged();
  };

  return (
    <>
      <div className="card">
        <h3>打刻の画面</h3>
        <label className="check"><input type="checkbox" checked={settings.showBreak} onChange={(e) => flag("show_break", e.target.checked)} /> 休憩のボタン（休憩始・休憩終）を出す</label>
        <label className="check"><input type="checkbox" checked={settings.showOut} onChange={(e) => flag("show_out", e.target.checked)} /> 外出のボタン（外出・戻り）を出す</label>
        <label className="check"><input type="checkbox" checked={settings.sound} onChange={(e) => flag("sound", e.target.checked)} /> 押したときに音を出す</label>
        <label className="check"><input type="checkbox" checked={settings.fullscreen} onChange={(e) => flag("fullscreen", e.target.checked)} /> 画面いっぱいに出す</label>
        <label className="check">
          <input type="checkbox" disabled={autostart === null} checked={autostart === true} onChange={(e) => toggleAutostart(e.target.checked)} /> パソコンを点けたら TimeQard を開く
        </label>
        <p className="muted">休憩のボタンを出さない会社は、Q の側で休憩を決めます。</p>
      </div>

      <div className="card">
        <h3>カメラ</h3>
        <label className="check"><input type="checkbox" checked={settings.camera} onChange={(e) => flag("camera", e.target.checked)} /> パソコンのカメラで、打刻カードの QR コードを読む</label>
        {settings.camera && cameras.length > 1 && (
          <div className="field">
            <label>使うカメラ</label>
            <select
              value={settings.cameraDevice}
              onChange={async (e) => {
                await setSetting(db, "camera_device", e.target.value);
                await onChanged();
              }}
            >
              <option value="">いつものカメラ</option>
              {cameras.map((c, i) => (
                <option key={c.deviceId || i} value={c.deviceId}>{c.label || `カメラ ${i + 1}`}</option>
              ))}
            </select>
          </div>
        )}
        <p className="muted">
          初めて使うときに「カメラを使ってよいか」と聞かれたら、「許可」を押してください。映像は保存せず、どこにも送りません。
          USB の QR コード読み取り機と「ID で押す」は、この設定とは関係なく、いつでも使えます。
        </p>
      </div>

      <div className="card">
        <h3>毎日の控え</h3>
        <p>
          パソコンが壊れたときのために、1日に1回、記録のファイルの写しを作ります（新しいものから{BACKUP_KEEP}個を残します）。
          USB メモリなど、このパソコンとは別の場所にしてください。
        </p>
        <table style={{ width: "auto" }}>
          <tbody>
            <tr><td>控えのフォルダ</td><td>{settings.backupDir || <b style={{ color: "#c62828" }}>まだ決めていません</b>}</td></tr>
            <tr><td>最後に控えを作った日</td><td>{settings.lastBackupDate || "—"}</td></tr>
            {settings.lastBackupError && <tr><td>うまくいかなかったこと</td><td style={{ color: "#c62828" }}>{settings.lastBackupError}</td></tr>}
            <tr><td>記録のファイルの場所</td><td style={{ fontSize: 13 }}>{dir ? `${dir}（timeqard.db）` : "—"}</td></tr>
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button className="btn" onClick={chooseBackupDir}>フォルダを選ぶ</button>
          <button className="btn gray" disabled={!settings.backupDir} onClick={backup}>いま控えを作る</button>
        </div>
      </div>

      <div className="card">
        <h3>管理のパスワードを変える</h3>
        <NewPasswordFields onChange={setPassword} />
        <button className="btn" disabled={!password} onClick={changePassword}>パスワードを変える</button>
      </div>
      {message && <div className={`notice ${message.tone}`} style={{ width: "100%", whiteSpace: "pre-wrap", fontSize: 15 }}>{message.text}</div>}
    </>
  );
}
