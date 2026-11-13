/**
 * マイナンバー（個人番号）の画面
 * 本人と、年末調整の申告書に入れた家族（配偶者・扶養親族）の番号を登録する。番号はふだん隠し、「表示」を押したときだけ見せる。
 * 扱えるのは事務取扱担当者の印がある人だけ（システム設定で管理者が付ける）。きまりと出典は utils/myNumber.ts
 * 番号は暗号化して置く。はじめにパスワードを決め、使うときに鍵を開ける（utils/myNumberCrypto.ts・myNumberVault.ts）
 */
import { useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatMyNumber, MASKED_MY_NUMBER, type MyNumberEntry, type MyNumberStaffRow } from "../../utils/myNumber";
import type { MyNumberRetention } from "../../utils/myNumberRetention";
import { PASSWORD_MIN_LENGTH, RECOVERY_KEY_LENGTH } from "../../utils/myNumberCrypto";
import type { MyNumberUser } from "./myNumberStore";
import { VAULT_IDLE_MINUTES } from "./myNumberVault";
import RecoveryKeyDialog from "./RecoveryKeyDialog";
import { useMyNumberManager } from "./useMyNumberManager";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
  /** 開いている会社ファイルの場所（暗号化を始める前のバックアップを探すため） */
  companyPath?: string | null;
  /** 番号を消したとき（メニューの「保存期間が過ぎた番号」の知らせを数え直す） */
  onNumbersChanged?: () => void;
}

type Z = ReturnType<typeof useMyNumberManager>;

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const note: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: "normal", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12, color: "#1e293b", padding: "8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" };
const input: React.CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, fontFamily: "monospace", width: 170 };
const button: React.CSSProperties = { padding: "4px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#475569" };
const mainButton: React.CSSProperties = { padding: "8px 16px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white", cursor: "pointer", backgroundColor: "#2563eb", fontSize: 13 };
const title: React.CSSProperties = { fontSize: 14, fontWeight: "bold", color: "#1e293b" };
const summary: React.CSSProperties = { fontSize: 13, color: "#1e293b", cursor: "pointer", padding: "6px 0" };

const dateJa = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return y ? `${y}年${m}月${day}日` : d;
};

/** 見せてから、自動で隠すまでの秒数 */
const REVEAL_SECONDS = 30;

/** 保存期間の書き方（登録してある番号だけ。在籍している・いちばん新しい申告書に載っている番号は出さない） */
function RetentionNote({ r }: { r: MyNumberRetention | undefined }) {
  if (!r) return null;
  if (r.expired && r.keepUntil) {
    return <div style={{ color: "#dc2626", marginTop: 2 }}>⚠ 保存期間が過ぎています（{dateJa(r.keepUntil)}まで保管：{r.basis}）。できるだけ早く消してください</div>;
  }
  if (r.keepUntil) return <div style={{ color: "#64748b", marginTop: 2 }}>保管：{dateJa(r.keepUntil)}まで（{r.basis}）</div>;
  if (r.unknown) return <div style={{ color: "#b45309", marginTop: 2 }}>{r.basis}</div>;
  return null;
}

function EntryRow({ row, e, z }: { row: MyNumberStaffRow; e: MyNumberEntry; z: Z }) {
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <tr>
      <td style={{ ...td, paddingLeft: e.relation === "本人" ? 8 : 24, whiteSpace: "nowrap" }}>
        <span style={{ color: "#64748b", marginRight: 8 }}>{e.relation}</span>
        {e.relation !== "本人" && <b>{e.name}</b>}
        {e.birthday && <span style={{ color: "#94a3b8", marginLeft: 8, fontSize: 11 }}>{dateJa(e.birthday)}生</span>}
      </td>
      <td style={{ ...td, fontFamily: "monospace", whiteSpace: "nowrap" }}>
        {editing ? (
          <input
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            placeholder="12桁"
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            autoFocus
            style={input}
          />
        ) : e.registered ? (shown ? formatMyNumber(shown) : MASKED_MY_NUMBER) : <span style={{ color: "#94a3b8", fontFamily: "inherit" }}>未登録</span>}
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={{ ...button, color: "#fff", background: "#27ae60", border: "none" }}
              onClick={async () => { if (await z.save(row, e, value)) { setEditing(false); setValue(""); } }}>保存</button>
            <button type="button" style={button} onClick={() => { setEditing(false); setValue(""); }}>やめる</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            {e.registered && (shown
              ? <button type="button" style={button} onClick={() => setShown(null)}>隠す</button>
              : <button type="button" style={button} onClick={async () => setShown(await z.reveal(row, e))}>表示</button>)}
            <button type="button" style={button} onClick={() => { setShown(null); setEditing(true); }}>{e.registered ? "直す" : "登録する"}</button>
            {e.registered && <button type="button" style={{ ...button, color: "#e74c3c" }} onClick={() => z.remove(row, e)}>消す</button>}
          </div>
        )}
      </td>
      <td style={{ ...td, fontSize: 11, color: e.orphan ? "#b45309" : "#94a3b8" }}>
        {e.orphan
          ? "年末調整の申告書に見当たりません（氏名・生年月日が変わった、扶養から外れたなど）。要らなければ消してください"
          : e.years.length > 0 ? `申告書：${e.years.map((y) => `${y}年分`).join("・")}` : ""}
        {e.registered && !e.orphan && <RetentionNote r={z.retention.byStaff[row.staffId]?.[e.key]} />}
        {e.registered && e.orphan && z.retention.byStaff[row.staffId]?.[e.key]?.keepUntil && <RetentionNote r={z.retention.byStaff[row.staffId]?.[e.key]} />}
      </td>
    </tr>
  );
}

/** パスワードの欄（文字数を出す。決まりは15文字以上） */
function PasswordField({ label, value, onChange, autoComplete, count = true }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; count?: boolean }) {
  const length = [...value.normalize("NFKC")].length;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
      <span>
        {label}
        {count && value && <span style={{ marginLeft: 8, color: length < PASSWORD_MIN_LENGTH ? "#b45309" : "#27ae60" }}>{length}文字</span>}
      </span>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} style={{ ...input, width: 260, fontFamily: "inherit" }} />
    </label>
  );
}

/** はじめに：パスワードを決めて暗号化を始める */
function SetupCard({ z, plainCount }: { z: Z; plainCount: number }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <div style={{ ...card, borderLeft: "4px solid #2563eb" }}>
      <div style={title}>はじめに：マイナンバーを暗号化するパスワードを決める</div>
      <p style={note}>
        マイナンバーは、パスワードから作る鍵で暗号化して置きます。会社ファイル（.qp）やバックアップ（.qb）が持ち出されても、番号を読めないようにするためです
        （個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」（別添1）技術的安全管理措置：データの暗号化又はパスワードによる保護）。
        <br />・パスワードは{PASSWORD_MIN_LENGTH}文字以上です。英数字を混ぜるなどのきまりはありません。短い言葉をいくつかつなげると、長くても覚えやすくなります。
        Q のログインのパスワードとは別のものにしてください。
        <br />・決めると、回復用キー（{RECOVERY_KEY_LENGTH}文字）を1回だけ出します。パスワードを忘れても、回復用キーで開けて決め直せます。
        <br />・パスワードと回復用キーの両方をなくすと、番号は戻せません。同ガイドライン（別添2）では、復号の鍵をなくして戻せなくなることも「毀損」に当たります（同じ番号がほかに保管されていれば当たりません）。
        扶養控除等申告書など、番号が書いてある書類は保存期間まで残してください。
        {plainCount > 0 && (
          <>
            <br />・いま登録してある{plainCount}件は、決めたときに暗号化します。それより前に作ったバックアップ（.qb）には、暗号化していない番号が残ります
            （暗号化を始めたあと、この画面で消せます）。
          </>
        )}
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
        <PasswordField label="パスワード" value={password} onChange={setPassword} autoComplete="new-password" />
        <PasswordField label="もう一度（確かめのため）" value={confirm} onChange={setConfirm} autoComplete="new-password" count={false} />
        <button type="button" disabled={z.busy} style={{ ...mainButton, opacity: z.busy ? 0.6 : 1 }}
          onClick={async () => { if (await z.setup(password, confirm)) { setPassword(""); setConfirm(""); } }}>
          {z.busy ? "暗号化しています…" : "暗号化を始める"}
        </button>
      </div>
    </div>
  );
}

/** 暗号化を始める前に作ったバックアップ（暗号化していない番号が入っている）を出し、消せるようにする */
function PlainBackupsCard({ z }: { z: Z }) {
  const b = z.plainBackups;
  if (!b || b.before.length === 0) return null;
  const [date, time] = b.startedAt.split(" ");
  return (
    <div style={{ ...card, borderLeft: "4px solid #f59e0b" }}>
      <div style={title}>暗号化を始める前のバックアップ（{b.before.length}個）</div>
      <p style={note}>
        マイナンバーの暗号化を始めた{dateJa(date)}{time ? ` ${time.slice(0, 5)}` : ""}より前に作った、この会社ファイルのバックアップ（.qb）です。
        そのときに登録していた番号は、暗号化しないまま入っているので、バックアップが持ち出されると読めてしまいます。
        要らなければ消してください（消したバックアップは元に戻せず、その日の会社ファイルにも戻せなくなります）。
        <br />・暗号化を始めてからのバックアップ：{b.after.length}個
        {b.after.length === 0 && "（会社ファイルを閉じると作られます。一度閉じて開き直してから消すと、バックアップがなくなる間ができません）"}
      </p>
      <ul style={{ ...note, margin: "6px 0 0 0", paddingLeft: 20 }}>
        {b.before.map((name) => <li key={name}>{name}</li>)}
      </ul>
      <button type="button" disabled={z.busy}
        style={{ ...mainButton, backgroundColor: "#dc2626", marginTop: 10, opacity: z.busy ? 0.6 : 1 }}
        onClick={z.removePlainBackups}>
        これらのバックアップを消す
      </button>
    </div>
  );
}

/**
 * 保存期間が過ぎた番号（退職した人の本人・家族、扶養から外れた家族）を出し、まとめて消せるようにする
 * 決まりは utils/myNumberRetention.ts（扶養控除等申告書の保存期間：提出期限の年の翌年1月11日から7年）
 */
function ExpiredCard({ z }: { z: Z }) {
  const items = z.retention.expired;
  if (items.length === 0) return null;
  return (
    <div style={{ ...card, borderLeft: "4px solid #dc2626" }}>
      <div style={title}>保存期間が過ぎたマイナンバー（{items.length}件）</div>
      <p style={note}>
        要らなくなり、扶養控除等申告書の保存期間（提出期限の年の翌年1月11日から7年。所得税法施行規則76条の3）が過ぎた番号です。
        できるだけ早く消してください（個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」）。
        消したことは、下の取扱いの記録に残ります（記録に番号は書きません）。消しても、それより前に作った会社ファイルのバックアップには残ります。
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr><th style={th}>従業員</th><th style={th}>人</th><th style={th}>保管する日</th><th style={th}>保存期間</th><th style={th}></th></tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={`${x.row.staffId}:${x.entry.key}`}>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {x.row.name}<span style={{ color: "#94a3b8", marginLeft: 6, fontSize: 11 }}>{x.row.staffId}</span>
                {x.row.retiredOn && <div style={{ fontSize: 11, color: "#b45309" }}>退職（{dateJa(x.row.retiredOn)}）</div>}
              </td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{x.entry.relation}{x.entry.relation !== "本人" && `・${x.entry.name}`}</td>
              <td style={{ ...td, whiteSpace: "nowrap", color: "#dc2626" }}>{x.retention.keepUntil ? `${dateJa(x.retention.keepUntil)}まで` : ""}</td>
              <td style={{ ...td, fontSize: 11, color: "#64748b" }}>{x.retention.basis}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                <button type="button" disabled={z.busy} style={{ ...button, color: "#e74c3c" }} onClick={() => z.remove(x.row, x.entry)}>消す</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={z.busy}
        style={{ ...mainButton, backgroundColor: "#dc2626", marginTop: 10, opacity: z.busy ? 0.6 : 1 }}
        onClick={() => z.removeExpired(items)}>
        {items.length}件をまとめて消す
      </button>
    </div>
  );
}

/** 鍵が開いているか・開け閉め */
function VaultBar({ z }: { z: Z }) {
  const open = z.vault.open;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: 8, background: open ? "#ecfdf5" : "#f1f5f9", fontSize: 13, color: "#1e293b" }}>
      {open ? <LockOpen size={16} color="#27ae60" /> : <Lock size={16} color="#64748b" />}
      <span>
        {open
          ? `鍵は開いています（使わなければ、あと${z.vault.minutesLeft}分ほどで自動で閉じます）`
          : "鍵は閉じています（表示・登録するときや、給与支払報告書でマイナンバーを使うときに、パスワードを聞きます）"}
      </span>
      <button type="button" style={{ ...button, marginLeft: "auto" }} onClick={open ? z.closeVault : z.openVault}>{open ? "閉じる" : "開ける"}</button>
    </div>
  );
}

/** パスワードを変える・回復用キーを作り直す・パスワードを忘れたとき */
function KeySettingsCard({ z }: { z: Z }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [nextConfirm, setNextConfirm] = useState("");
  const [renewPassword, setRenewPassword] = useState("");
  const [key, setKey] = useState("");
  const [recoverPassword, setRecoverPassword] = useState("");
  const [recoverConfirm, setRecoverConfirm] = useState("");
  const row: React.CSSProperties = { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", margin: "6px 0 12px 0" };
  const go: React.CSSProperties = { ...mainButton, opacity: z.busy ? 0.6 : 1 };
  return (
    <div style={card}>
      <div style={title}>パスワードと回復用キー</div>
      <details>
        <summary style={summary}>パスワードを変える</summary>
        <div style={row}>
          <PasswordField label="今のパスワード" value={current} onChange={setCurrent} autoComplete="current-password" count={false} />
          <PasswordField label="新しいパスワード" value={next} onChange={setNext} autoComplete="new-password" />
          <PasswordField label="もう一度（確かめのため）" value={nextConfirm} onChange={setNextConfirm} autoComplete="new-password" count={false} />
          <button type="button" disabled={z.busy} style={go}
            onClick={async () => { if (await z.changePassword(current, next, nextConfirm)) { setCurrent(""); setNext(""); setNextConfirm(""); } }}>変える</button>
        </div>
      </details>
      <details>
        <summary style={summary}>回復用キーを作り直す（紙をなくした・見られたかもしれないとき）</summary>
        <p style={{ ...note, marginTop: 0 }}>作り直すと、前の回復用キーは使えなくなります。</p>
        <div style={row}>
          <PasswordField label="パスワード" value={renewPassword} onChange={setRenewPassword} autoComplete="current-password" count={false} />
          <button type="button" disabled={z.busy} style={go}
            onClick={async () => { if (await z.renewRecovery(renewPassword)) setRenewPassword(""); }}>作り直す</button>
        </div>
      </details>
      <details>
        <summary style={summary}>パスワードを忘れたとき（回復用キーで開ける）</summary>
        <p style={{ ...note, marginTop: 0 }}>
          しまってある回復用キーを入れて、新しいパスワードを決めます。開けたら、回復用キーも新しく作り直します（打ち込むときに見られたかもしれないので、前の紙は使えなくなります）。
        </p>
        <div style={row}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
            回復用キー（{RECOVERY_KEY_LENGTH}文字。空白はあってもなくても）
            <input value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} style={{ ...input, width: 560 }} />
          </label>
        </div>
        <div style={row}>
          <PasswordField label="新しいパスワード" value={recoverPassword} onChange={setRecoverPassword} autoComplete="new-password" />
          <PasswordField label="もう一度（確かめのため）" value={recoverConfirm} onChange={setRecoverConfirm} autoComplete="new-password" count={false} />
          <button type="button" disabled={z.busy} style={go}
            onClick={async () => { if (await z.recover(key, recoverPassword, recoverConfirm)) { setKey(""); setRecoverPassword(""); setRecoverConfirm(""); } }}>開けて決め直す</button>
        </div>
      </details>
    </div>
  );
}

export default function MyNumberManager({ db, staffList, currentUser, companyPath = null, onNumbersChanged }: Props) {
  const z = useMyNumberManager(db, staffList, currentUser, companyPath, onNumbersChanged);

  if (z.access === null || (z.access && z.setUp === null)) return <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>確かめています…</div>;
  if (!z.access) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: "bold", color: "#1e293b" }}>マイナンバー</div>
          <p style={note}>
            マイナンバーは、事務取扱担当者の印があるユーザーだけが扱えます。管理者が「システム設定」のユーザーの一覧で印を付けます。
          </p>
        </div>
      </div>
    );
  }

  const registered = z.rows.reduce((n, r) => n + r.entries.filter((e) => e.registered).length, 0);
  const selfMissing = z.rows.filter((r) => !r.retiredOn && !r.entries[0].registered).length;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: "#1e293b" }}>マイナンバー（個人番号）</div>
        <p style={note}>
          ・源泉徴収票・給与支払報告書など、法律で決まった事務（個人番号関係事務）だけに使います。給与支払報告書の CSV には、ここで登録した番号を書きます。
          <br />・本人から受け取るときは、マイナンバーカードを見せてもらうなどして本人確認をします（番号法16条）。
          家族の番号は、従業員が扶養控除等申告書に書いて出します（所得税法194条1項）。
          {z.setUp && (
            <>
              <br />・番号は暗号化して置いています。表示・登録するときや、給与支払報告書の CSV・印刷でマイナンバーを使うときに、パスワードで鍵を開けます。
              使わなくなってから{VAULT_IDLE_MINUTES}分で、自動で閉じます。
            </>
          )}
          <br />・番号はふだん隠しています。「表示」を押すと{REVEAL_SECONDS}秒だけ見せます。表示・登録・直す・消すと、鍵の開け閉めは、下の記録に残ります（記録に番号は書きません）。
          <br />・12桁目（検査用数字）を確かめてから登録します（総務省令 平成26年第85号 第5条）。
          <br />・家族は、年末調整の画面で申告書に入れた配偶者・扶養親族が出ます。氏名と生年月日で同じ人とみなすので、年が変わっても登録し直す必要はありません。
          <br />・退職した人の番号も、扶養控除等申告書などの保存期間（扶養控除等申告書は、提出期限の年の翌年1月10日の翌日から7年。所得税法施行規則76条の3）が
          過ぎるまでは残し、過ぎたらできるだけ早く消します（個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」）。
          消しても、それより前に作った会社ファイルのバックアップには残ります。
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 10, fontSize: 13, color: "#1e293b" }}>
          <div>登録済み：<b>{registered}件</b></div>
          {z.setUp && selfMissing > 0 && <div style={{ color: "#b45309" }}>⚠ 本人の番号が未登録（在籍している人）：{selfMissing}人</div>}
          {z.retention.expired.length > 0 && <div style={{ color: "#dc2626" }}>⚠ 保存期間が過ぎた番号：{z.retention.expired.length}件</div>}
        </div>
        {z.setUp && <VaultBar z={z} />}
      </div>

      {!z.setUp && <SetupCard z={z} plainCount={registered} />}

      <ExpiredCard z={z} />

      {z.setUp && <PlainBackupsCard z={z} />}

      {z.setUp && z.rows.map((row) => (
        <div key={row.staffId} style={card}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: "bold", color: "#1e293b" }}>{row.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>従業員ID {row.staffId}</div>
            {row.retiredOn && <div style={{ fontSize: 11, color: "#b45309" }}>退職（{dateJa(row.retiredOn)}）</div>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 300 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 210 }} />
              <col />
            </colgroup>
            <thead>
              <tr><th style={th}>人</th><th style={th}>マイナンバー</th><th style={th}>操作</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {row.entries.map((e) => <EntryRow key={e.key} row={row} e={e} z={z} />)}
            </tbody>
          </table>
        </div>
      ))}

      {z.setUp && <KeySettingsCard z={z} />}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: "bold", color: "#1e293b" }}>取扱いの記録（新しい順・100件まで）</div>
        {z.logs.length === 0 ? (
          <p style={note}>まだ記録はありません。</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <thead><tr><th style={th}>日時</th><th style={th}>した人</th><th style={th}>内容</th></tr></thead>
            <tbody>
              {z.logs.map((l, i) => (
                <tr key={i}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "#64748b" }}>{new Date(l.at).toLocaleString("ja-JP")}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{l.user}</td>
                  <td style={td}>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {z.recoveryKey && (
        <RecoveryKeyDialog recoveryKey={z.recoveryKey} companyName={z.companyName} userName={currentUser?.display_name ?? ""} onClose={z.closeRecoveryKey} />
      )}
    </div>
  );
}
