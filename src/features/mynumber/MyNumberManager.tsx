/**
 * マイナンバー（個人番号）の画面
 * 本人と、年末調整の申告書に入れた家族（配偶者・扶養親族）の番号を登録する。番号はふだん隠し、「表示」を押したときだけ見せる。
 * 扱えるのは事務取扱担当者の印がある人だけ（システム設定で管理者が付ける）。きまりと出典は utils/myNumber.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatMyNumber, MASKED_MY_NUMBER, type MyNumberEntry, type MyNumberStaffRow } from "../../utils/myNumber";
import type { MyNumberUser } from "./myNumberStore";
import { useMyNumberManager } from "./useMyNumberManager";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
}

type Z = ReturnType<typeof useMyNumberManager>;

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const note: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: "normal", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12, color: "#1e293b", padding: "8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" };
const input: React.CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, fontFamily: "monospace", width: 170 };
const button: React.CSSProperties = { padding: "4px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12, color: "#475569" };

const dateJa = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return y ? `${y}年${m}月${day}日` : d;
};

/** 見せてから、自動で隠すまでの秒数 */
const REVEAL_SECONDS = 30;

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
      </td>
    </tr>
  );
}

export default function MyNumberManager({ db, staffList, currentUser }: Props) {
  const z = useMyNumberManager(db, staffList, currentUser);

  if (z.access === null) return <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>確かめています…</div>;
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
          <br />・番号はふだん隠しています。「表示」を押すと{REVEAL_SECONDS}秒だけ見せます。表示・登録・直す・消すは、下の記録に残ります（記録に番号は書きません）。
          <br />・12桁目（検査用数字）を確かめてから登録します（総務省令 平成26年第85号 第5条）。
          <br />・家族は、年末調整の画面で申告書に入れた配偶者・扶養親族が出ます。氏名と生年月日で同じ人とみなすので、年が変わっても登録し直す必要はありません。
          <br />・退職した人の番号も、扶養控除等申告書などの保存期間（扶養控除等申告書は、提出期限の年の翌年1月10日の翌日から7年。所得税法施行規則76条の3）が
          過ぎるまでは残し、過ぎたらできるだけ早く消します（個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」）。
          消しても、それより前に作った会社ファイルのバックアップには残ります。
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 10, fontSize: 13, color: "#1e293b" }}>
          <div>登録済み：<b>{registered}件</b></div>
          {selfMissing > 0 && <div style={{ color: "#b45309" }}>⚠ 本人の番号が未登録（在籍している人）：{selfMissing}人</div>}
        </div>
      </div>

      {z.rows.map((row) => (
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
    </div>
  );
}
