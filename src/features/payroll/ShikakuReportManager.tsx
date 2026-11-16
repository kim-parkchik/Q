/**
 * 「資格取得届・喪失届」の画面
 * ・健康保険・厚生年金保険 被保険者資格取得届／厚生年金保険 70歳以上被用者該当届（選んだ月に資格を取得した人）
 * ・健康保険・厚生年金保険 被保険者資格喪失届／厚生年金保険 70歳以上被用者不該当届（選んだ月に退職した・亡くなった人と、
 *   健康保険だけの資格を失った人（75歳の誕生日・後期高齢者医療の障害認定））
 * 届書の内容を出し、電子申請用のファイル（年金事務所に出す SHFD0006.CSV。健康保険組合の人は、組合に出す KPFD0006.CSV も）を
 * 保存したり、印刷したりできる。決まりと作り方は utils/shikakuReport.ts・utils/unionReport.ts・utils/shahoCsv.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatWareki } from "../../utils/wareki";
import { MY_NUMBER_PLACEHOLDER } from "../../utils/shahoCsv";
import { isHealthOnlyLoss, type ShutokuRow, type SoshitsuRow } from "../../utils/shikakuReport";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { SHIKAKU_LABELS, useShikakuReportManager, type ShikakuMode } from "./useShikakuReportManager";
import { PrintFormSheet } from "./PrintFormSheet";
import {
  ShahoFilePanel, ShahoOfficeTable, UnionFilePanel, card, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, table, td, th, title,
} from "./ShahoFilePanel";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
}

const PRINT_ID = "shikaku-report-print";
const yen = (v: string) => (v ? `${Number(v).toLocaleString()}円` : "");
const numberText = (values: string[], myIndex: number, basic: [number, number]) =>
  values[myIndex] === MY_NUMBER_PLACEHOLDER ? "マイナンバー" : values[basic[0]] ? `基礎年金番号 ${values[basic[0]]}-${values[basic[1]]}` : "（なし）";
const flags = (items: [boolean, string][]) => items.filter(([on]) => on).map(([, t]) => t).join("・") || "—";
const smallInput = { ...input, padding: "3px 6px", fontSize: 12 };

export default function ShikakuReportManager({ db, staffList, currentUser }: Props) {
  const z = useShikakuReportManager(db, staffList, currentUser);
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);
  const rows = z.mode === "shutoku" ? z.shutokuRows : z.soshitsuRows;
  const modeSelect = (
    <label style={fieldStyle}>
      <span style={labelStyle}>届書</span>
      <select value={z.mode} onChange={(e) => z.setMode(e.target.value as ShikakuMode)} style={input}>
        <option value="shutoku">資格取得届（入社した・加入した人）</option>
        <option value="soshitsu">資格喪失届（退職した・亡くなった人、75歳になった人など）</option>
        <option value="age70">70歳到達届（70歳になった人。紙・e-Gov の画面で出す）</option>
      </select>
    </label>
  );
  const monthInput = (
    <label style={fieldStyle}>
      <span style={labelStyle}>{z.mode === "shutoku" ? "資格を取得した月" : z.mode === "soshitsu" ? "資格を失った月" : "70歳に達する月（誕生日の前日がある月）"}</span>
      <input type="month" value={z.month} onChange={(e) => e.target.value && z.setMonth(e.target.value)} style={input} />
    </label>
  );

  if (z.mode === "age70") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1300, margin: "0 auto" }}>
        <style>{shahoPrintStyle(PRINT_ID, false)}</style>
        <div style={card} className="no-print">
          <h3 style={title}>70歳到達届（厚生年金保険 被保険者資格喪失届／厚生年金保険 70歳以上被用者該当届）</h3>
          <p style={note}>
            厚生年金に入っている従業員が70歳に達した日（誕生日の前日）に、厚生年金の資格を失い、70歳以上被用者になります（健康保険は続きます）。
            70歳到達日の標準報酬月額相当額（その日の報酬月額を等級表に当てはめた額）が、前日の標準報酬月額と違う人だけ、70歳到達日から5日以内に届けます
            （同じ人は、年金機構が処理するので届けは要りません）。この届書は電子申請用のファイルの形がないので、下の内容を紙の届書に書き写すか、e-Gov の画面で入れます。
            報酬月額は、月給の人は基本給＋固定残業代＋通勤手当を、現物は「現物で払う報酬」などからの見込みを初めに入れています（直せます）。
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            {modeSelect}
            {monthInput}
            <button onClick={() => setPrintRequest((n) => n + 1)} disabled={z.age70Forms.length === 0}
              style={{ padding: "8px 14px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", cursor: "pointer", backgroundColor: z.age70Forms.length > 0 ? "#2563eb" : "#94a3b8" }}>
              印刷する
            </button>
            {z.my.access && (
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
                <input type="checkbox" checked={z.my.use} onChange={(e) => z.my.setUse(e.target.checked)} />
                マイナンバーを書く（届書には手で書きます。印刷しません）
              </label>
            )}
          </div>
          {z.age70Forms.length > 0 && (
            <table style={{ ...table, marginTop: 10 }}>
              <thead><tr><th style={th}>氏名</th><th style={th}>提出日</th><th style={th}>70歳到達日の報酬月額（通貨・現物）</th><th style={th}>備考</th><th style={th}>届けが要るか</th></tr></thead>
              <tbody>
                {z.age70Forms.map(({ staff: s, edit: e, wage, inKind, form }) => (
                  <tr key={s.id}>
                    <td style={td}>{s.name}<div style={small}>{formatWareki(form.reachedOn)}に70歳</div></td>
                    <td style={td}><input type="date" value={e.submittedOn} onChange={(ev) => z.updateAge70(s, { submittedOn: ev.target.value })} style={smallInput} /></td>
                    <td style={td}>
                      <input type="number" min={0} value={wage ?? ""} placeholder="円" onChange={(ev) => z.updateAge70(s, { wage: ev.target.value === "" ? null : Math.max(0, Math.trunc(Number(ev.target.value))) })} style={{ ...smallInput, width: 110 }} />
                      <span style={small}> 現物 </span>
                      <input type="number" min={0} value={inKind} onChange={(ev) => z.updateAge70(s, { inKind: ev.target.value === "" ? null : Math.max(0, Math.trunc(Number(ev.target.value))) })} style={{ ...smallInput, width: 90 }} />
                    </td>
                    <td style={td}>
                      <label style={{ fontSize: 12 }}><input type="checkbox" checked={e.shortTime} onChange={(ev) => z.updateAge70(s, { shortTime: ev.target.checked })} /> 短時間労働者</label>
                      <input type="text" value={e.remarks} placeholder="その他" onChange={(ev) => z.updateAge70(s, { remarks: ev.target.value })} style={{ ...smallInput, width: 140, marginLeft: 6 }} />
                    </td>
                    <td style={td}>{form.needed === null ? "—" : form.needed ? <b style={{ color: "#b45309" }}>要る</b> : <span style={{ color: "#16a34a" }}>要らない</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div id={PRINT_ID} style={card}>
          <h3 style={title}>70歳到達届の内容（{z.month.replace("-", "年")}月に70歳に達する人）</h3>
          {z.age70Forms.length === 0
            ? <div style={small}>この月に70歳に達する厚生年金の被保険者はいません（従業員の画面の生年月日から探します）。</div>
            : z.age70Forms.map(({ form }) => <PrintFormSheet key={form.key} form={form} office={z.file.office.values} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1300, margin: "0 auto" }}>
      <style>{shahoPrintStyle(PRINT_ID, true)}</style>
      <div style={card} className="no-print">
        <h3 style={title}>資格取得届・資格喪失届（健康保険・厚生年金保険。70歳以上被用者該当届・不該当届）</h3>
        <p style={note}>
          従業員が社会保険に入ったら「資格取得届」を、退職した・亡くなったら「資格喪失届」を、事実発生から5日以内に事務センター（年金事務所）に出します
          （資格喪失日は、退職日・死亡日の翌日です）。届書には、マイナンバーか基礎年金番号を必ず書きます（どちらもない届書は返されます）。
          マイナンバーを書かない人の資格取得届には、住所（郵便番号・フリガナ）も書きます。
          資格取得届の報酬月額は、資格取得時の決定（月給は月の額、時給・日給は同じ仕事の人の報酬などから。残業代などの見込みも入れる）の額を入れてください。
          現物（社宅・食事・定期券など）は、従業員の画面の「現物で払う報酬」と、定期券などで渡す通勤手当から1か月分の見込みを出しています。
          健康保険組合の人は、健康保険組合にも出します（下の「健康保険組合に出すファイル」）。
          70歳以上の人は、70歳以上被用者該当届・不該当届も兼ねます（75歳以上の人と、健康保険組合・国民健康保険組合の70歳以上の人は、年金事務所には70歳以上被用者の届だけを出します）。
        </p>
        <ShahoFilePanel
          file={z.file} dataLines={z.dataLines} blocked={z.blocked} label={z.label} count={z.toOffice.length}
          onPrint={() => setPrintRequest((n) => n + 1)} canPrint={rows.length > 0} onSave={z.save}
        >
          {modeSelect}
          {monthInput}
          {z.my.access && (
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
              <input type="checkbox" checked={z.my.use} onChange={(e) => z.my.setUse(e.target.checked)} />
              マイナンバーを書く（登録してある人。保存するときだけ番号を読みます）
            </label>
          )}
        </ShahoFilePanel>
        {!z.my.access && (
          <div style={{ ...small, marginTop: 4 }}>マイナンバーは、事務取扱担当者だけが届書に書けます。いまは基礎年金番号で届けます。</div>
        )}
        <UnionFilePanel
          file={z.file} insurers={z.insurers} label={z.label} blocked={z.included.length === 0 ? ["届ける人を選んでください"] : []}
          rows={z.included} resolve={z.my.resolve} onSaved={z.onUnionSaved}
        />
      </div>

      <div id={PRINT_ID} style={card}>
        <h3 style={title}>{SHIKAKU_LABELS[z.mode]}の内容（{z.month.replace("-", "年")}月）</h3>
        <ShahoOfficeTable office={z.file.office.values} />
        {rows.length === 0 ? (
          <div style={small}>
            {z.mode === "shutoku"
              ? "この月に資格を取得した社会保険の加入者はいません（従業員の画面の入社日と、標準報酬月額の履歴から探します）。"
              : "この月に退職した・亡くなった・75歳になった・後期高齢者医療の障害認定を受けた社会保険の加入者はいません（従業員の画面の退職日・死亡の年月日・生年月日・障害認定の日から探します）。"}
          </div>
        ) : z.mode === "shutoku" ? (
          <table style={table}>
            <thead>
              <tr>
                <th style={th} className="no-print">届ける</th>
                <th style={th}>氏名（フリガナ）・生年月日</th>
                <th style={th}>資格取得日</th>
                <th style={th}>報酬月額（通貨・現物）</th>
                <th style={th}>マイナンバー・基礎年金番号・住所</th>
                <th style={th}>被扶養者・資格確認書・備考</th>
                <th style={th} className="no-print">確かめること</th>
              </tr>
            </thead>
            <tbody>
              {z.shutokuRows.map(({ edit: e, row: r, fromHistory, inKind }) => {
                const s = staffList.find((x) => String(x.id) === r.staffId);
                return (
                  <tr key={r.staffId} style={{ opacity: e.include ? 1 : 0.5 }}>
                    <td style={td} className="no-print"><input type="checkbox" checked={e.include} onChange={(ev) => z.updateShutoku(s, { include: ev.target.checked })} /></td>
                    <td style={td}>{r.name}（{r.kana || "フリガナなし"}）<br /><span style={small}>{r.birthday ? formatWareki(r.birthday) : "生年月日なし"}{r.over70 ? "・70歳以上" : ""}</span></td>
                    <td style={td}>
                      <input type="date" className="no-print" value={e.acquiredOn} onChange={(ev) => z.updateShutoku(s, { acquiredOn: ev.target.value })} style={smallInput} />
                      <span className="print-only">{e.acquiredOn ? formatWareki(e.acquiredOn) : ""}</span>
                      {fromHistory && <div style={small} className="no-print">（標準報酬月額の履歴から。日を確かめてください）</div>}
                      <div style={small}>期限 {r.deadline ? formatWareki(r.deadline) : "—"}</div>
                    </td>
                    <td style={td}>
                      <input type="number" className="no-print" value={e.wage ?? ""} placeholder="円" onChange={(ev) => z.updateShutoku(s, { wage: ev.target.value === "" ? null : Math.max(0, Math.trunc(Number(ev.target.value))) })} style={{ ...smallInput, width: 110 }} />
                      {/* 現物（社宅・食事・定期券など）：空にすると、従業員の画面の「現物で払う報酬」からの見込みに戻る */}
                      <div className="no-print" style={{ ...small, marginTop: 2 }}>
                        現物 <input type="number" min={0} value={e.inKind ?? inKind} title="社宅・食事・定期券など（従業員の画面の「現物で払う報酬」と、定期券などで渡す通勤手当からの見込み。直せます。空にすると見込みに戻ります）"
                          onChange={(ev) => z.updateShutoku(s, { inKind: ev.target.value === "" ? null : Math.max(0, Math.trunc(Number(ev.target.value))) })} style={{ ...smallInput, width: 90 }} />
                      </div>
                      <span className="print-only">{yen(r.values[22])}{Number(r.values[21]) > 0 && `（うち現物 ${yen(r.values[21])}）`}</span>
                    </td>
                    <td style={td}>
                      {numberText(r.values, 12, [15, 16])}
                      {r.values[29] && <div style={small}>〒{r.values[29]}-{r.values[30]} {r.values[32] || r.values[31]}</div>}
                    </td>
                    <td style={td}>
                      <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                        {([["dependents", "被扶養者あり（被扶養者（異動）届も出す）"], ["certificate", "資格確認書の発行が必要"], ["shortTime", "短時間労働者"], ["rehired", "退職後の継続再雇用"]] as const).map(([key, text]) => (
                          <label key={key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <input type="checkbox" checked={e[key]} onChange={(ev) => z.updateShutoku(s, { [key]: ev.target.checked })} />{text}
                          </label>
                        ))}
                        <input type="text" value={e.remarks} placeholder="備考（その他）" onChange={(ev) => z.updateShutoku(s, { remarks: ev.target.value })} style={{ ...smallInput, width: 220 }} />
                      </div>
                      <span className="print-only">
                        {flags([[r.values[19] === "1", "被扶養者あり"], [r.values[34] === "1", "資格確認書の発行"], [e.shortTime, "短時間労働者"], [e.rehired, "退職後の継続再雇用"], [r.over70, "70歳以上被用者該当"], [r.values[33] === "1", "70歳以上被用者届のみ"]])}
                        {r.values[28] ? `・${r.values[28]}` : ""}
                      </span>
                    </td>
                    <td style={td} className="no-print"><Checks row={r} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th} className="no-print">届ける</th>
                <th style={th}>整理番号・氏名（フリガナ）・生年月日</th>
                <th style={th}>喪失の原因・資格喪失日</th>
                <th style={th}>マイナンバー・基礎年金番号</th>
                <th style={th}>資格確認書の回収（添付・返不能）</th>
                <th style={th}>備考</th>
                <th style={th} className="no-print">確かめること</th>
              </tr>
            </thead>
            <tbody>
              {z.soshitsuRows.map(({ key, edit: e, row: r }) => {
                const count = (v: string) => (v === "" ? null : Math.max(0, Math.trunc(Number(v))));
                const healthOnly = isHealthOnlyLoss(r.cause);
                return (
                  <tr key={key} style={{ opacity: e.include ? 1 : 0.5 }}>
                    <td style={td} className="no-print"><input type="checkbox" checked={e.include} onChange={(ev) => z.updateSoshitsu(key, { include: ev.target.checked })} /></td>
                    <td style={td}>{r.pensionNumber || "—"}　{r.name}（{r.kana || "フリガナなし"}）<br /><span style={small}>{r.birthday ? formatWareki(r.birthday) : "生年月日なし"}{r.over70 ? "・70歳以上被用者" : ""}</span></td>
                    <td style={td}>
                      {healthOnly
                        ? <>{r.cause}（健康保険のみ喪失）{!r.toOffice && <div style={small}>（健康保険組合にだけ出す）</div>}</>
                        : <>{r.cause}（{r.cause === "死亡" ? "死亡日" : "退職日"} {formatWareki(r.eventDate)}）</>}<br />
                      資格喪失日 {formatWareki(r.lostOn)}<div style={small}>期限 {r.deadline ? formatWareki(r.deadline) : "—"}</div>
                    </td>
                    <td style={td}>{numberText(r.values, 10, [11, 12])}</td>
                    <td style={td}>
                      <span className="no-print" style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                        添付 <input type="number" min={0} value={e.returned ?? ""} onChange={(ev) => z.updateSoshitsu(key, { returned: count(ev.target.value) })} style={{ ...smallInput, width: 56 }} />
                        返不能 <input type="number" min={0} value={e.unreturned ?? ""} onChange={(ev) => z.updateSoshitsu(key, { unreturned: count(ev.target.value) })} style={{ ...smallInput, width: 56 }} />枚
                      </span>
                      <span className="print-only">添付 {e.returned ?? "—"}枚・返不能 {e.unreturned ?? "—"}枚</span>
                    </td>
                    <td style={td}>
                      <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                        {!healthOnly && (
                          <label style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <input type="checkbox" checked={e.rehired} onChange={(ev) => z.updateSoshitsu(key, { rehired: ev.target.checked })} />退職後の継続再雇用
                          </label>
                        )}
                        <input type="text" value={e.remarks} placeholder="備考（転勤・資格取得届提出中など）" onChange={(ev) => z.updateSoshitsu(key, { remarks: ev.target.value })} style={{ ...smallInput, width: 220 }} />
                      </div>
                      <span className="print-only">
                        {flags([[r.values[18] === "1", "二以上事業所勤務者"], [r.values[19] === "1", "退職後の継続再雇用"], [r.values[23] === "1", "70歳不該当"], [r.over70Only, "70歳以上被用者届のみ"]])}
                        {r.values[20] ? `・${r.values[20]}` : ""}
                      </span>
                    </td>
                    <td style={td} className="no-print"><Checks row={r} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** 直すところ（赤）と知らせ（灰色）。健康保険組合に出す行の直すところも出す */
function Checks({ row }: { row: ShutokuRow | SoshitsuRow }) {
  const problems = [...row.problems, ...(row.union?.problems ?? [])];
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5 }}>
      {problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
      {row.notes.map((n) => <div key={n} style={{ color: "#475569" }}>・{n}</div>)}
      {row.union && (!("toOffice" in row) || row.toOffice) && <div style={{ color: "#475569" }}>・{row.union.insurerName}にも出します</div>}
      {problems.length === 0 && row.notes.length === 0 && !row.union && <span style={{ color: "#16a34a" }}>OK</span>}
    </div>
  );
}
