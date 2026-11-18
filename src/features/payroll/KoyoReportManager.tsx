/**
 * 「雇用保険の届書」の画面：資格取得届・資格喪失届（離職証明書）・転勤届・個人番号登録届の電子申請用ファイル（ハローワークに出す
 * CSV形式届書ファイル）を、雇用保険適用事業所ごと・届書ごとに作って保存する。離職証明書の内容（賃金の欄・離職理由）は印刷できる。
 * 届書の中身は utils/koyoReport.ts、状態は useKoyoReportManager.ts
 */
import { useEffect, useState } from "react";
import { KOYO_FILE_NAMES, KOYO_SPEC_VERSION } from "../../constants/koyoTodoke";
import { KOYO_FORM_TITLES } from "../../utils/koyoCsv";
import { parseKoyoInfo, REASON_OPTIONS } from "../../utils/koyoInfo";
import { formatWareki } from "../../utils/wareki";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { MyNumberToggle, button, card, controls, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, table, td, th, title } from "./ShahoFilePanel";
import { KOYO_MODE_LABELS, koyoLossDateOf, useKoyoReportManager, type KoyoMode } from "./useKoyoReportManager";
import { WageCertificateTable } from "./WageCertificateTable";
import GaikokujinReportPanel from "./GaikokujinReportPanel";

const PRINT_ID = "koyo-print";

export default function KoyoReportManager({ db, staffList, currentUser }: { db: any; staffList: any[]; currentUser: MyNumberUser | null }) {
  const m = useKoyoReportManager(db, staffList, currentUser);
  const [show, setShow] = useState<string | null>(null);
  const [gaikoku, setGaikoku] = useState(false);
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);
  const monthMode = m.mode === "shutoku" || m.mode === "soshitsu";
  const certRows = m.rows.filter((r) => r.form === "rishoku" && r.cert);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{shahoPrintStyle(PRINT_ID, true)}</style>
      <div style={card} className="no-print">
        <h2 style={title}>雇用保険の届書</h2>
        <p style={note}>
          ハローワークに電子申請（e-Gov）で出す届書のファイル（CSV形式届書ファイル）を作ります。資格取得届は雇用した月の翌月10日まで、
          資格喪失届は離職日の翌々日から10日以内、転勤届は転勤した日の翌日から10日以内に出します。離職票の交付を希望する人と59歳以上の人は、
          離職証明書（賃金の欄・離職理由）も書いた資格喪失届にします（離職者に内容を確かめてもらい、確認書を添えます）。
        </p>
        <div style={controls}>
          <div style={{ display: "flex", gap: 4 }}>
            {(Object.keys(KOYO_MODE_LABELS) as KoyoMode[]).map((k) => (
              <button key={k} onClick={() => { setGaikoku(false); m.setMode(k); }} style={button(!gaikoku && m.mode === k ? "#2563eb" : "#94a3b8")}>{KOYO_MODE_LABELS[k]}</button>
            ))}
            <button onClick={() => setGaikoku(true)} style={button(gaikoku ? "#2563eb" : "#94a3b8")}>外国人雇用状況届出書</button>
          </div>
          {!gaikoku && monthMode && (
            <label style={fieldStyle}>
              <span style={labelStyle}>{m.mode === "shutoku" ? "資格を取得した月" : "離職した月"}</span>
              <input type="month" value={m.month} onChange={(e) => m.setMonth(e.target.value)} style={input} />
            </label>
          )}
          {!gaikoku && <MyNumberToggle my={m.my} />}
        </div>
        {m.loadError && <div style={{ color: "#b91c1c", fontSize: 12 }}>⚠ 読み込めませんでした：{m.loadError}</div>}
      </div>
      {gaikoku ? (
        <div id={PRINT_ID} style={{ display: "flex", flexDirection: "column", gap: 16 }}><GaikokujinReportPanel db={db} staffList={staffList} /></div>
      ) : (<>

      <div style={card} className="no-print">
        <h3 style={{ ...title, fontSize: 14 }}>届ける人（{m.rows.length}人）</h3>
        {m.rows.length === 0 ? (
          <div style={small}>
            {m.mode === "shutoku" ? "この月に雇用保険の資格を取得した人はいません（入社日・従業員の画面の「雇用保険の届書に書くこと」の資格取得日）。"
              : m.mode === "soshitsu" ? "この月に離職した雇用保険の被保険者はいません（退職日・死亡日）。"
              : m.mode === "tenkin" ? "届け出ていない転勤はありません（従業員の画面の「転勤」）。"
              : "マイナンバーを登録してあって、ハローワークにまだ届けていない被保険者はいません（事務取扱担当者だけが見られます）。"}
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>届ける</th>
                <th style={th}>氏名</th>
                <th style={th}>届書</th>
                <th style={th}>{m.mode === "shutoku" ? "資格取得日" : m.mode === "soshitsu" ? "離職日" : m.mode === "tenkin" ? "転勤した日" : ""}</th>
                <th style={th}>提出期限</th>
                <th style={th}>直すところ・知らせ</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.key}>
                  <td style={td}><input type="checkbox" checked={m.isIncluded(r)} onChange={(e) => m.setIncluded(r.key, e.target.checked)} /></td>
                  <td style={td}>{r.name}{r.myNumber && <div style={small}>マイナンバーを書く</div>}</td>
                  <td style={td}>{r.form === "rishoku" ? "離職票交付あり（離職証明書）" : r.form === "soshitsu" ? "離職票交付なし" : KOYO_FORM_TITLES[r.form].replace("雇用保険被保険者", "").replace("雇用保険", "")}</td>
                  <td style={td}>{r.date ? formatWareki(r.date) : ""}</td>
                  <td style={td}>{r.deadline ? formatWareki(r.deadline) : ""}</td>
                  <td style={{ ...td, fontSize: 11, lineHeight: 1.5 }}>
                    {r.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
                    {r.notes.map((x) => <div key={x} style={{ color: "#475569" }}>・{x}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {m.groups.length > 0 && (
        <div style={card} className="no-print">
          <h3 style={{ ...title, fontSize: 14 }}>電子申請用のファイル</h3>
          <div style={controls}>
            <label style={fieldStyle}>
              <span style={labelStyle}>ＦＤ通番（前の番号の次。999 の次は 1）</span>
              <input type="number" min={1} max={999} value={m.mediaNumber} onChange={(e) => m.setMediaNumber(Number(e.target.value) || 0)} style={{ ...input, width: 90 }} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>作成年月日</span>
              <input type="date" value={m.createdOn} onChange={(e) => m.setCreatedOn(e.target.value)} style={input} />
            </label>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={m.xmlReturn} onChange={(e) => m.setXmlReturn(e.target.checked)} /> 通知書を XML でも受け取る
            </label>
          </div>
          {m.fileProblems.map((p) => <div key={p} style={{ color: "#b91c1c", fontSize: 12 }}>・{p}</div>)}
          {m.groups.map((g) => {
            const key = `${g.place.key}:${g.form}`;
            const lines = show === key ? m.preview(g) : null;
            const count = g.rows.filter(m.isIncluded).length;
            return (
              <div key={key} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8, marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: "bold" }}>{g.place.name}：{KOYO_FORM_TITLES[g.form]}（{count}人・{KOYO_FILE_NAMES[g.form]}）</div>
                {g.officeProblems.map((p) => <div key={p} style={{ color: "#b91c1c", fontSize: 12 }}>・事業所：{p}</div>)}
                <div style={{ ...controls, marginTop: 6 }}>
                  <button onClick={() => m.save(g)} disabled={count === 0} style={button(count > 0 ? "#16a34a" : "#94a3b8")}>ファイルを保存（{KOYO_FILE_NAMES[g.form]}）</button>
                  <button onClick={() => setShow(show === key ? null : key)} style={button("#475569")}>{show === key ? "中身を閉じる" : "中身を見る"}</button>
                </div>
                {lines && (
                  <pre style={{ fontSize: 11, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, overflowX: "auto", maxHeight: 300 }}>
                    {lines.join("\n")}
                  </pre>
                )}
              </div>
            );
          })}
          <div style={{ ...small, marginTop: 8 }}>
            ファイルの形は、厚生労働省「ＣＳＶ形式届書作成仕様書（電子申請）（雇用保険適用関係届書）」{KOYO_SPEC_VERSION}による。
            e-Gov で、届書ごとの「連記式」の手続きを選び、このファイルを添えて申請します。
          </div>
        </div>
      )}

      {certRows.length > 0 && (
        <div style={card} id={PRINT_ID}>
          <div className="no-print" style={{ ...controls, justifyContent: "space-between" }}>
            <h3 style={{ ...title, fontSize: 14, margin: 0 }}>離職証明書の内容</h3>
            <button onClick={() => setPrintRequest((k) => k + 1)} style={button("#2563eb")}>印刷する</button>
          </div>
          {certRows.map((r) => {
            const s = staffList.find((x) => String(x.id) === r.staffId);
            const info = parseKoyoInfo(s?.koyo_info);
            const reason = REASON_OPTIONS.find((o) => o.key === info.loss.reason);
            return (
              <div key={r.key} style={{ marginBottom: 20, breakInside: "avoid" }}>
                <div style={{ fontSize: 14, fontWeight: "bold", margin: "8px 0 4px" }}>雇用保険被保険者離職証明書（{r.name}・離職日 {formatWareki(koyoLossDateOf(s))}）</div>
                <WageCertificateTable cert={r.cert!} noteOverrides={info.loss.rowNotes} />
                <table style={{ ...table, marginTop: 6 }}>
                  <tbody>
                    <tr><th style={{ ...th, width: "28%" }}>⑦ 離職理由</th><td style={td}>{reason ? `${reason.key} ${reason.title}` : "（選んでいない）"}</td></tr>
                    <tr><th style={th}>具体的事情記載欄（事業主用）</th><td style={td}>{info.loss.circumstances}</td></tr>
                    <tr><th style={th}>⑭ 賃金に関する特記事項</th><td style={td}>{info.loss.wageNote}</td></tr>
                    <tr><th style={th}>⑯ 離職者の判断（異議）</th><td style={td}>{info.loss.objection === "0" ? "有り" : info.loss.objection === "1" ? "無し" : "（離職者に確かめる）"}{info.loss.signature ? `　氏名 ${info.loss.signature}` : ""}</td></tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
      </>)}
    </div>
  );
}
