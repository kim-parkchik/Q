/**
 * 「賞与支払届」の画面（健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届）
 * 確定した賞与を選ぶと、届書の内容（被保険者整理番号・氏名・生年月日・支払年月日・賞与額・備考）を出し、
 * 電子申請用のファイル（SHFD0006.CSV）を保存したり、印刷したりできる（紙の届書に書き写すとき）。
 * 決まりと作り方は utils/bonusReport.ts・utils/shahoCsv.ts
 */
import { useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatWareki } from "../../utils/wareki";
import { SHAHO_SPEC_VERSION } from "../../constants/shahoTodoke";
import { useBonusReportManager } from "./useBonusReportManager";

interface Props {
  db: Database;
}

const yen = (n: number) => `${n.toLocaleString()}円`;

export default function BonusReportManager({ db }: Props) {
  const z = useBonusReportManager(db);
  const [showFile, setShowFile] = useState(false);
  const r = z.report;
  const o = z.office.values;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <style>{PRINT_STYLE}</style>
      <div style={card} className="no-print">
        <h3 style={title}>賞与支払届（健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届）</h3>
        <p style={note}>
          被保険者に賞与を払ったら、払った日から5日以内に、事務センター（年金事務所）に出します（年4回以上払う賞与は、標準報酬月額に入れるので出しません）。
          確定した賞与を選ぶと、その賞与を払った人の届書の内容を作ります（同じ月に、その前にも賞与を払った人は、前の分と合わせて届け出ます。
          そのあと同じ月にまた払ったら、その賞与を選んで、もう一度合わせて届け出ます）。
          電子申請（e-Gov など）では、下の「電子申請用のファイルを保存」で作る SHFD0006.CSV を添付します（ファイル名は変えないでください）。
          紙で出すときは、年金機構から届いた届書に、下の一覧を書き写すか、印刷して確かめてください。
          賞与を払う予定の月に、だれにも払わなかったときは、「賞与不支給報告書」を出します（この画面では作りません）。
        </p>
        <div style={controls}>
          <label style={fieldStyle}>
            <span style={labelStyle}>賞与</span>
            <select value={z.selectedId ?? ""} onChange={(e) => z.setSelectedId(e.target.value ? Number(e.target.value) : null)} style={{ ...input, minWidth: 280 }}>
              <option value="">選んでください</option>
              {z.settings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.payment_date ? `${s.payment_date} 支給` : "支給日なし"}・{Number(s.finalized) > 0 ? "確定済み" : "未確定"}）
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>媒体通番（前の番号の次。999 の次は 1）</span>
            <input type="number" min={1} max={999} value={z.mediaNumber} onChange={(e) => z.setMediaNumber(Number(e.target.value) || 0)} style={{ ...input, width: 90 }} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>作成年月日</span>
            <input type="date" value={z.createdOn} onChange={(e) => z.setCreatedOn(e.target.value)} style={input} />
          </label>
          <button onClick={z.exportFile} disabled={z.blocked.length > 0} style={button(z.blocked.length > 0 ? "#94a3b8" : "#16a34a")}>
            電子申請用のファイルを保存（SHFD0006.CSV）
          </button>
          <button onClick={() => window.print()} disabled={!r || r.rows.length === 0} style={button("#2563eb")}>印刷する</button>
          <button onClick={() => setShowFile((v) => !v)} disabled={!z.fileLines} style={button(z.fileLines ? "#475569" : "#94a3b8")}>
            {showFile ? "中身を閉じる" : "中身を見る"}
          </button>
        </div>
        {showFile && z.fileLines && (
          <pre style={{ fontSize: 12, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, overflowX: "auto", margin: "0 0 8px" }}>
            {z.fileLines.join("\n")}
          </pre>
        )}
        {z.deadline && <div style={{ fontSize: 13, fontWeight: "bold", color: "#b45309" }}>提出期限：{formatWareki(z.deadline)}（{z.deadline}。賞与を払った日から5日以内）</div>}
        {z.loadError && <div style={{ color: "#b91c1c", fontSize: 12 }}>⚠ 読み込めませんでした：{z.loadError}</div>}
        {z.blocked.length > 0 && z.selected && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", lineHeight: 1.6 }}>
            <b>電子申請用のファイルを作る前に、直すところがあります：</b>
            {z.blocked.map((b) => <div key={b}>・{b}</div>)}
          </div>
        )}
        {z.unfinalizedSameMonth.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
            ⚠ 同じ月にこの賞与より前に払う賞与で、まだ確定していないもの（{z.unfinalizedSameMonth.map((s) => s.name).join("・")}）は入れていません。
            同じ月に払った賞与は合わせて届け出るので、確定してから作り直してください。
          </div>
        )}
        <div style={{ ...small, marginTop: 6 }}>電子申請用のファイルの形は、厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」{SHAHO_SPEC_VERSION}による。</div>
      </div>

      {r && (
        <div id="bonus-report-print" style={card}>
          <h3 style={title}>
            健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届
            <span style={{ fontSize: 12, fontWeight: "normal", marginLeft: 8 }}>{z.label}</span>
          </h3>
          <table style={{ ...table, marginBottom: 12 }}>
            <tbody>
              <tr>
                <th style={th}>事業所整理記号</th><td style={td}>{o[1] && o[2] ? `${o[1]}-${o[2]}（都道府県コード ${o[0] || "?"}）` : "（会社設定で入れてください）"}</td>
                <th style={th}>事業所番号</th><td style={td}>{o[3] || "（会社設定で入れてください）"}</td>
              </tr>
              <tr>
                <th style={th}>事業所所在地</th><td style={td}>〒{o[4]}-{o[5]} {o[6]}</td>
                <th style={th}>電話番号</th><td style={td}>{o[9]}-{o[10]}-{o[11]}</td>
              </tr>
              <tr>
                <th style={th}>事業所名称</th><td style={td}>{o[7]}</td>
                <th style={th}>事業主氏名</th><td style={td}>{o[8]}</td>
              </tr>
            </tbody>
          </table>
          {r.rows.length === 0 ? (
            <div style={small}>届け出る人がいません。</div>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>①被保険者<br />整理番号</th>
                  <th style={th}>②被保険者氏名</th>
                  <th style={th}>③生年月日</th>
                  <th style={th}>④賞与支払年月日</th>
                  <th style={th}>⑤賞与支払額<br />㋐通貨・㋑現物</th>
                  <th style={th}>⑥賞与額<br />（千円未満切り捨て）</th>
                  <th style={th}>⑦基礎年金番号<br />（70歳以上被用者）</th>
                  <th style={th}>⑧備考</th>
                  <th style={th} className="no-print">確かめること</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.staffId} style={row.problems.length > 0 ? { backgroundColor: "#fef2f2" } : undefined}>
                    <td style={{ ...td, textAlign: "right" }}>{row.pensionNumber || (row.over70Only ? "（書かない）" : "")}</td>
                    <td style={td}>{row.name}<div style={small}>{row.kana}</div></td>
                    <td style={td}>{row.values[7] && `${row.values[7]}-${row.values[8]}`}<div style={small}>{formatWareki(row.birthday)}</div></td>
                    <td style={td}>{formatWareki(row.paymentDate)}</td>
                    <td style={{ ...td, textAlign: "right" }}>㋐ {yen(row.currency)}<br />㋑ {yen(row.inKind)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: "bold" }}>{(row.total / 1000).toLocaleString()},000円</td>
                    <td style={td}>{row.values[15] ? `${row.values[15]}-${row.values[16]}` : ""}</td>
                    <td style={td}>
                      {[
                        row.over70 ? "1. 70歳以上被用者" : "",
                        row.multiOffice ? "2. 二以上勤務" : "",
                        row.firstPaymentDay ? `3. 同一月内の賞与合算（初回支払日：${Number(row.firstPaymentDay)}日）` : "",
                        row.over70Only ? "（70歳以上被用者届のみ）" : "",
                      ].filter(Boolean).map((t) => <div key={t}>{t}</div>)}
                    </td>
                    <td style={td} className="no-print">
                      {row.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>⚠ {p}</div>)}
                      {row.notes.map((n) => <div key={n} style={{ color: "#475569" }}>{n}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={td} colSpan={4}>{r.rows.length}人</td>
                  <td style={{ ...td, textAlign: "right" }}>{yen(r.rows.reduce((s, x) => s + x.currency + x.inKind, 0))}</td>
                  <td style={{ ...td, textAlign: "right" }}>{yen(r.rows.reduce((s, x) => s + x.total, 0))}</td>
                  <td style={td} colSpan={2}></td>
                  <td style={td} className="no-print"></td>
                </tr>
              </tfoot>
            </table>
          )}
          <div style={{ ...small, marginTop: 8 }}>
            ⑥賞与額は、㋐と㋑の合計から1,000円未満を切り捨てた額です（標準賞与額。健康保険は年度の累計573万円、厚生年金は1か月150万円が上限ですが、上限は年金機構が当てはめるので、届書には切り捨てた額を書きます）。
            現物で払った賞与は、Q ではないものとしています。
          </div>
        </div>
      )}

      {r && r.skipped.length > 0 && (
        <div style={card} className="no-print">
          <h3 style={title}>届け出ない人</h3>
          <table style={table}>
            <tbody>
              {r.skipped.map((s) => (
                <tr key={s.staffId}><td style={td}>{s.name}</td><td style={td}>{s.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 印刷するときは、届書の内容だけを出す（A4 横） */
const PRINT_STYLE = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { background: white !important; }
  body * { visibility: hidden !important; }
  #bonus-report-print, #bonus-report-print * { visibility: visible !important; }
  #bonus-report-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
  .no-print { display: none !important; }
}
`;

const card: CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 4px 6px rgba(0,0,0,0.05)" };
const controls: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 8 };
const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const labelStyle: CSSProperties = { fontSize: 12, color: "#64748b" };
const input: CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
const title: CSSProperties = { fontSize: 16, margin: "0 0 8px" };
const note: CSSProperties = { fontSize: 12, color: "#475569", lineHeight: 1.7, margin: "0 0 10px" };
const small: CSSProperties = { fontSize: 11, color: "#64748b" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const th: CSSProperties = { border: "1px solid #cbd5e1", padding: "4px 6px", backgroundColor: "#f1f5f9", fontWeight: "bold", textAlign: "left", whiteSpace: "nowrap" };
const td: CSSProperties = { border: "1px solid #cbd5e1", padding: "4px 6px", verticalAlign: "top" };
const button = (color: string): CSSProperties => ({ padding: "8px 14px", backgroundColor: color, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 });
