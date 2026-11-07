/**
 * 「TimeQard（打刻）」の画面（くわしくは timeqard/DESIGN.md の 5.1）
 *
 * 1. TimeQard を手に入れる（ダウンロードのページ・入れ方）
 * 2. 打刻カードを作る・印刷する
 * 3. 従業員ファイルを書き出す（書き出し直しが要るときは知らせる）
 * 4. 打刻を取り込む（勤怠の「CSV 取り込み」と同じもの）
 * 5. 使い方の流れ
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { Download, IdCard, FileOutput, FileDown, ListOrdered, Printer, RefreshCcw } from "lucide-react";
import { companyMarkLabel, jstDate, parseIso, jstTime } from "../../../shared/timeqard";
import { modernIconBtnStyle } from "../../styles/styles";
import AttendanceImportButton from "../attendance/AttendanceImportButton";
import CardPrintSheet, { TimeQardCard } from "./CardPrintSheet";
import { useTimeQardManager } from "./useTimeQardManager";

interface Props {
  db: any;
  staffList: any[];
  currentUser: { display_name?: string } | null;
}

const card: CSSProperties = { background: "#fff", borderRadius: 10, padding: "18px 22px", marginBottom: 18, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" };
const th: CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #ddd", background: "#f5f7fa", fontSize: 12, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #eee", fontSize: 13 };
const note: CSSProperties = { fontSize: 12, color: "#666", lineHeight: 1.7, margin: "6px 0" };

function Block({ no, title, icon, children }: { no: number; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section style={card}>
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
        <span style={{ background: "#0055A4", color: "#fff", borderRadius: 12, width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{no}</span>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

const dateTimeLabel = (iso: string | null) => {
  const ms = iso ? parseIso(iso) : null;
  return ms === null ? "" : `${jstDate(ms)} ${jstTime(ms)}`;
};

export default function TimeQardManager({ db, staffList, currentUser }: Props) {
  const m = useTimeQardManager({ db, staffList, currentUser });
  const [cutLine, setCutLine] = useState(true);
  const mark = m.settings?.companyMark ?? "";
  const sample = m.people.find((p) => p.card);

  return (
    <div style={{ maxWidth: 1100 }}>
      <p style={{ ...note, fontSize: 13, marginBottom: 16 }}>
        TimeQard（タイムカード）は、入口などに置いたパソコン1台で、従業員が出勤・退勤などを押すソフトです。Q とは別のソフトで、インターネットにつながなくても動きます。
        押した記録は CSV にして、この画面か勤怠の「CSV 取り込み」で取り込みます。打刻用のパソコンには、給与やマイナンバーは入りません。
      </p>

      <Block no={1} title="TimeQard を手に入れる" icon={<Download size={18} />}>
        <p style={note}>ダウンロードのページから、入口のパソコンの種類に合うものを入れてください。打刻用のパソコンがインターネットにつながっていなければ、このパソコンでダウンロードして、USB メモリで運びます。</p>
        <ul style={{ ...note, paddingLeft: 20 }}>
          <li><b>Windows 10・11</b>：「…_x64-setup.exe」。署名をしていないので、「Windows によって PC が保護されました」と出たら、「詳細情報」→「実行」を押します。</li>
          <li><b>Mac（macOS 10.15 以上）</b>：「…_universal.dmg」。開いて TimeQard を「アプリケーション」に入れます。初めて開くときに止められたら、「システム設定」→「プライバシーとセキュリティ」の下の「このまま開く」を押します。</li>
          <li><b>Ubuntu 22.04 以上</b>：「…_amd64.deb」を開いて入れます（または「…_amd64.AppImage」に実行の許可を付けて開きます）。</li>
          <li>Windows 7・8.1 では動きません。Windows 11 にできない古いパソコンは、Ubuntu を入れて使えます。</li>
        </ul>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...modernIconBtnStyle("#0055A4"), margin: 0, padding: "6px 14px" }} onClick={m.openDownloadPage}>
            <Download size={16} style={{ marginRight: 6 }} /> ダウンロードのページを開く
          </button>
          <button style={{ ...modernIconBtnStyle("#7f8c8d"), padding: "6px 14px" }} onClick={m.openGuide}>くわしい入れ方を開く</button>
        </div>
      </Block>

      <Block no={2} title="打刻カードを作る・印刷する" icon={<IdCard size={18} />}>
        <p style={note}>
          QR コードの打刻カードを、名刺の大きさで印刷して配ります（A4 の名刺用紙に10枚）。QR コードの中身は、スタッフID ではなく、カードごとに作る推測できない番号です。
          カードをなくしたら「作り直す」を押します。前のカードは、作り直したあとの従業員ファイルを TimeQard に読み込むと使えなくなります。
          <br />
          カードを貸したり、写真に撮ってコピーしたりすれば、ほかの人でも押せます（紙のタイムカードと同じくらいの守りです）。カードを忘れた日は、TimeQard でスタッフID を入れて押せます（Q に取り込むときに一覧に出ます）。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
          <button disabled={m.busy || m.withoutCard.length === 0} style={{ ...modernIconBtnStyle(m.withoutCard.length ? "#27ae60" : "#bdc3c7"), margin: 0, padding: "6px 14px" }} onClick={m.createMissingCards}>
            <IdCard size={16} style={{ marginRight: 6 }} /> カードのない人のカードを作る（{m.withoutCard.length}人）
          </button>
          <button style={{ ...modernIconBtnStyle("#34495e"), padding: "6px 14px" }} onClick={m.selectAll}>カードのある人を全員選ぶ</button>
          <button style={{ ...modernIconBtnStyle("#7f8c8d"), padding: "6px 14px" }} onClick={m.clearSelection}>選ぶのをやめる</button>
          <button disabled={m.printTargets.length === 0} style={{ ...modernIconBtnStyle(m.printTargets.length ? "#0055A4" : "#bdc3c7"), padding: "6px 14px" }} onClick={m.printCards}>
            <Printer size={16} style={{ marginRight: 6 }} /> 選んだ人のカードを印刷する（{m.printTargets.length}枚）
          </button>
          <label style={{ fontSize: 12, color: "#555", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={cutLine} onChange={(e) => setCutLine(e.target.checked)} /> 切り取り線を付ける（ふつうの紙に刷るとき）
          </label>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 520px", maxHeight: 420, overflowY: "auto", border: "1px solid #eee", borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr><th style={th}>印刷</th><th style={th}>ID</th><th style={th}>名前</th><th style={th}>カード</th><th style={th}></th></tr>
              </thead>
              <tbody>
                {m.people.length === 0 && (
                  <tr><td style={td} colSpan={5}>在籍している従業員がいません。</td></tr>
                )}
                {m.people.map((p) => (
                  <tr key={p.id}>
                    <td style={td}><input type="checkbox" disabled={!p.card} checked={m.selected.has(p.id) && !!p.card} onChange={() => m.toggle(p.id)} /></td>
                    <td style={td}>{p.id}</td>
                    <td style={td}>
                      {p.name}
                      {p.joinDate && p.joinDate > jstDate(Date.now()) && <span style={{ fontSize: 11, color: "#2980b9", marginLeft: 6 }}>{p.joinDate} 入社</span>}
                      {p.retirementDate && <span style={{ fontSize: 11, color: "#c0392b", marginLeft: 6 }}>{p.retirementDate} 退職</span>}
                    </td>
                    <td style={td}>{p.card ? `${dateTimeLabel(p.card.issuedAt).slice(0, 10)} に作った` : <span style={{ color: "#c0392b" }}>未発行</span>}</td>
                    <td style={td}>
                      {p.card && (
                        <button disabled={m.busy} style={{ ...modernIconBtnStyle("#e67e22"), margin: 0 }} onClick={() => m.recreateCard(p)}>
                          <RefreshCcw size={12} style={{ marginRight: 4 }} /> 作り直す
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sample && mark && (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>カードの見本（{sample.name}さん）</div>
              <div style={{ border: "1px solid #ddd", display: "inline-block" }}>
                <TimeQardCard companyName={m.companyName} companyMark={mark} person={sample} cutLine={false} />
              </div>
            </div>
          )}
        </div>
      </Block>

      <Block no={3} title="従業員ファイルを書き出す" icon={<FileOutput size={18} />}>
        <p style={note}>
          TimeQard に読み込む、従業員の一覧です。入るのは、スタッフID・名前・入社日・退職日・カードの確かめ用の値だけです（給与・マイナンバー・住所・生年月日などは入りません）。
          入社・退職・カードの作り直しのあとは、書き出し直して、TimeQard に読み込んでください。
        </p>
        <table style={{ borderCollapse: "collapse", margin: "8px 0" }}>
          <tbody>
            <tr><td style={td}>会社の印</td><td style={{ ...td, fontFamily: "monospace", fontSize: 14 }}>{mark ? companyMarkLabel(mark) : "まだありません（最初に書き出すか、カードを作るときに作ります）"}</td></tr>
            <tr><td style={td}>最後に書き出した日時</td><td style={td}>{m.settings?.lastExportAt ? dateTimeLabel(m.settings.lastExportAt) : "まだ書き出していません"}</td></tr>
            <tr><td style={td}>入る人</td><td style={td}>{m.people.length}人（カードのない人 {m.withoutCard.length}人）</td></tr>
          </tbody>
        </table>
        {m.changed === true && (
          <div style={{ background: "#fdecea", color: "#c0392b", borderRadius: 6, padding: "10px 14px", fontSize: 13, margin: "8px 0", fontWeight: "bold" }}>
            前に書き出したあとに、従業員（入社・退職・名前）かカードか会社名が変わりました。書き出し直して、TimeQard に読み込んでください。
          </div>
        )}
        {m.changed === false && (
          <div style={{ background: "#eafaf1", color: "#1e8449", borderRadius: 6, padding: "10px 14px", fontSize: 13, margin: "8px 0" }}>
            前に書き出したときから、変わっていません。
          </div>
        )}
        <button disabled={m.busy} style={{ ...modernIconBtnStyle("#0055A4"), margin: 0, padding: "6px 14px" }} onClick={m.exportStaffFile}>
          <FileOutput size={16} style={{ marginRight: 6 }} /> 従業員ファイルを書き出す
        </button>
        <p style={note}>名前が入っているので、USB メモリで運んで TimeQard に読み込んだら、USB メモリからは消してください。</p>
      </Block>

      <Block no={4} title="打刻を取り込む" icon={<FileDown size={18} />}>
        <p style={note}>
          TimeQard の「管理」→「CSV を書き出す」で書き出したファイルを選びます。取り込む前に、まとめ（入れる日数・ほかの会社の打刻ではないか・Q にない ID・カードなしで押した打刻・注意・押し忘れの申し出）を出します。
          確定した日は上書きしません。同じ期間を何度取り込んでも大丈夫です。
        </p>
        <AttendanceImportButton db={db} staffList={staffList} userName={currentUser?.display_name} style={{ margin: 0, padding: "6px 14px" }} />
      </Block>

      <Block no={5} title="使い方の流れ" icon={<ListOrdered size={18} />}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>順番</th><th style={th}>どこで</th><th style={th}>すること</th></tr></thead>
          <tbody>
            {[
              ["①", "Q", "この画面の「ダウンロードのページを開く」から TimeQard を手に入れ、入口のパソコンに入れる"],
              ["②", "Q", "打刻カードを作って印刷し、従業員に配る"],
              ["③", "Q → TimeQard", "従業員ファイルを書き出し、USB メモリで運んで TimeQard に読み込む（最初と、入社・退職・カードの作り直しのとき）"],
              ["④", "TimeQard", "毎日、従業員がカードをかざして（または ID を入れて）押す。押し忘れは、その場で申し出る"],
              ["⑤", "TimeQard → Q", "締めのあと、TimeQard の「管理」で打刻を CSV に書き出し、USB メモリで運ぶ"],
              ["⑥", "Q", "この画面か、勤怠の「CSV 取り込み」で取り込む（まとめを確かめてから入れる）"],
              ["⑦", "Q", "勤怠の画面で確かめて直し、確定する。そのあと給与計算"],
            ].map(([no, where, what]) => (
              <tr key={no}><td style={td}>{no}</td><td style={{ ...td, whiteSpace: "nowrap" }}>{where}</td><td style={td}>{what}</td></tr>
            ))}
          </tbody>
        </table>
      </Block>

      {mark && <CardPrintSheet companyName={m.companyName} companyMark={mark} people={m.printTargets} cutLine={cutLine} />}
    </div>
  );
}
