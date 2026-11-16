/**
 * 「被扶養者（異動）届」の画面
 * ・健康保険 被扶養者（異動）届／国民年金第3号被保険者関係届（協会けんぽの被保険者）
 * ・国民年金第3号被保険者関係届（健康保険組合・国民健康保険組合の被保険者の配偶者）
 * 従業員の画面の「健康保険の被扶養者」から、届け出るもの（該当・非該当・変更）の届書の内容を出し、電子申請用のファイル
 * （SHFD0006.CSV）を保存したり、印刷したりできる。健康保険組合の人の被扶養者の届けは、組合の様式で組合に出す（ここでは内容を出すだけ）。
 * 決まりと作り方は utils/fuyouReport.ts・utils/healthDependents.ts・utils/shahoCsv.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatWareki } from "../../utils/wareki";
import { MY_NUMBER_PLACEHOLDER } from "../../utils/shahoCsv";
import { changeRemarks } from "../../utils/fuyouReport";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { useFuyouReportManager } from "./useFuyouReportManager";
import { MyNumberToggle, ShahoFilePanel, ShahoOfficeTable, card, note, shahoPrintStyle, small, table, td, th, title, input } from "./ShahoFilePanel";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
  onDataChange: () => Promise<void> | void;
}

const PRINT_ID = "fuyou-report-print";
const w = (d: string | undefined | null) => (d ? formatWareki(d) : "—");
const yen = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString()}円`);
const smallInput = { ...input, padding: "3px 6px", fontSize: 12 };

export default function FuyouReportManager({ db, staffList, currentUser, onDataChange }: Props) {
  const z = useFuyouReportManager(db, staffList, currentUser, onDataChange);
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1300, margin: "0 auto" }}>
      <style>{shahoPrintStyle(PRINT_ID, true)}</style>
      <div style={card} className="no-print">
        <h3 style={title}>被扶養者（異動）届・国民年金第3号被保険者関係届（健康保険）</h3>
        <p style={note}>
          従業員の家族を健康保険の被扶養者にしたとき（該当）・外れたとき（非該当）・氏名などが変わったとき（変更）に、事実発生から5日以内に、
          従業員から届けを受けて事務センター（年金事務所）に出します。家族の情報は、従業員の画面の「健康保険の被扶養者」に入れてください。
          協会けんぽの人の配偶者の届けは、国民年金第3号被保険者関係届も兼ねます（60歳以上などで第3号被保険者にならない配偶者は「扶養届のみ」）。
          健康保険組合・国民健康保険組合の人は、年金事務所には第3号被保険者の配偶者の3号関係届だけを出し、健康保険の被扶養者の届けは組合の様式で組合に出します（下の一覧）。
          収入の証明（課税証明書など）・続柄の書類（戸籍謄本・住民票）・仕送りの証明などは、電子申請では画像（PDF・JPEG）で添えます
          （被保険者と家族のマイナンバーを書き、事業主が続柄を確かめたときは、続柄の書類を省けます。所得税の控除対象配偶者・扶養親族と確かめたときは「事業主確認」に印を付けると、収入の証明を省けます）。
        </p>
        <ShahoFilePanel
          file={z.file} dataLines={z.dataLines} blocked={z.blocked} label={z.label} count={z.included.length}
          onPrint={() => setPrintRequest((n) => n + 1)} canPrint={z.rows.length > 0} onSave={z.save}
        >
          {z.my.access && <MyNumberToggle my={z.my} who="被保険者と家族" />}
        </ShahoFilePanel>
        {!z.my.access && <MyNumberToggle my={z.my} />}
      </div>

      <div id={PRINT_ID} style={card}>
        <h3 style={title}>{z.label}の内容</h3>
        <ShahoOfficeTable office={z.file.office.values} />
        {z.rows.length === 0 ? (
          <div style={small}>届け出るものはありません（従業員の画面の「健康保険の被扶養者」で、届け出ていない人・でなくなった日を入れた人・氏名などを直した人が出ます）。</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th} className="no-print">届ける</th>
                <th style={th}>被保険者</th>
                <th style={th}>届書・異動の別</th>
                <th style={th}>被扶養者</th>
                <th style={th}>受付日・収入など</th>
                <th style={th} className="no-print">確かめること</th>
              </tr>
            </thead>
            <tbody>
              {z.rows.map(({ plan: p, edit: e, row: r }) => (
                <tr key={r.key} style={{ opacity: e.include ? 1 : 0.5 }}>
                  <td style={td} className="no-print"><input type="checkbox" checked={e.include} onChange={(ev) => z.update(r.key, { include: ev.target.checked })} /></td>
                  <td style={td}>
                    {p.staff.pension_num || "—"}　{r.name}<br />
                    <span style={small}>{r.values[13] === MY_NUMBER_PLACEHOLDER || r.values[11] === MY_NUMBER_PLACEHOLDER ? "マイナンバー" : "基礎年金番号"}</span>
                  </td>
                  <td style={td}>
                    {r.form === "fuyou" ? "被扶養者（異動）届" : "国民年金第3号被保険者関係届"}<br />
                    <b>{r.kind}</b>
                    <div style={small}>期限 {r.deadline ? w(r.deadline) : "—（変更はすみやかに）"}</div>
                  </td>
                  <td style={td}>
                    {r.dependents.map((d) => (
                      <div key={d.id} style={{ marginBottom: 4 }}>
                        {d.relation}　{d.name}（{d.kana}）{w(d.birthday)}生
                        <div style={small}>
                          {r.kind === "該当" && <>なった日 {w(d.from)}・{d.reason}{d.reasonNote ? `（${d.reasonNote}）` : ""}・{d.job}・年収 {yen(d.income)}・{d.together ? "同居" : "別居"}</>}
                          {r.kind === "非該当" && <>でなくなった日 {w(d.until)}・{d.endReason}{d.endReasonNote ? `（${d.endReasonNote}）` : ""}{d.deathDate ? `・死亡 ${w(d.deathDate)}` : ""}</>}
                          {r.kind === "変更" && <>{[changeRemarks(d), d.remarks].filter(Boolean).join("　")}</>}
                        </div>
                      </div>
                    ))}
                  </td>
                  <td style={td}>
                    <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
                      <label>受付日 <input type="date" value={e.receivedOn} onChange={(ev) => z.update(r.key, { receivedOn: ev.target.value })} style={smallInput} /></label>
                      {r.kind === "該当" && r.form === "fuyou" && (
                        <>
                          <label><input type="checkbox" checked={e.employerChecked} onChange={(ev) => z.update(r.key, { employerChecked: ev.target.checked })} /> 事業主確認（所得税の控除対象配偶者・扶養親族）</label>
                          <label>被保険者の年収見込み
                            <input type="number" min={0} value={e.staffIncome ?? z.defaultIncome(p.staff) ?? ""} onChange={(ev) => z.update(r.key, { staffIncome: ev.target.value === "" ? null : Math.max(0, Math.floor(Number(ev.target.value))) })} style={{ ...smallInput, width: 110 }} />円
                          </label>
                          {!p.spouse && (
                            <label title="被扶養者でない配偶者がいて、夫婦ともに収入があるとき（年間収入の多い方の被扶養者にする）">配偶者の年収（扶養でない配偶者）
                              <input type="number" min={0} value={e.spouseIncome ?? ""} onChange={(ev) => z.update(r.key, { spouseIncome: ev.target.value === "" ? null : Math.max(0, Math.floor(Number(ev.target.value))) })} style={{ ...smallInput, width: 110 }} />円
                            </label>
                          )}
                        </>
                      )}
                    </div>
                    <span className="print-only">
                      受付日 {w(e.receivedOn)}{r.kind === "該当" && r.form === "fuyou" ? `・被保険者の年収 ${yen(Number(r.values[16]) || null)}${e.employerChecked ? "・事業主確認" : ""}` : ""}
                    </span>
                  </td>
                  <td style={td} className="no-print">
                    <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                      {r.problems.map((x) => <div key={x} style={{ color: "#b91c1c" }}>・{x}</div>)}
                      {r.notes.map((x) => <div key={x} style={{ color: "#475569" }}>・{x}</div>)}
                      {r.problems.length === 0 && r.notes.length === 0 && <span style={{ color: "#16a34a" }}>OK</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {z.unionItems.length > 0 && (
          <>
            <h4 style={{ ...title, fontSize: 14, marginTop: 16 }}>健康保険組合・国民健康保険組合に出す、被扶養者の届け（組合の様式で）</h4>
            <table style={table}>
              <thead>
                <tr><th style={th}>被保険者</th><th style={th}>組合</th><th style={th}>異動</th><th style={th}>被扶養者</th><th style={th}>日・理由</th></tr>
              </thead>
              <tbody>
                {z.unionItems.map((x) => (
                  <tr key={`${x.staff.id}:${x.dependent.id}`}>
                    <td style={td}>{x.staff.name}{x.staff.health_ins_num ? `（被保険者等番号 ${x.staff.health_ins_num}）` : ""}</td>
                    <td style={td}>{x.insurer?.name}</td>
                    <td style={td}>{x.kind}</td>
                    <td style={td}>{x.dependent.relation}　{x.dependent.name}（{x.dependent.kana}）{w(x.dependent.birthday)}生・{x.dependent.together ? "同居" : "別居"}</td>
                    <td style={td}>
                      {x.kind === "該当" ? `なった日 ${w(x.dependent.from)}・${x.dependent.reason}・${x.dependent.job}・年収 ${yen(x.dependent.income)}` : ""}
                      {x.kind === "非該当" ? `でなくなった日 ${w(x.dependent.until)}・${x.dependent.endReason}` : ""}
                      {x.kind === "変更" ? x.dependent.remarks : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ ...small, marginTop: 4 }} className="no-print">
              組合に届けたら、従業員の画面の「健康保険の被扶養者」で「届け出ている」に印を付けてください（第3号被保険者の配偶者の3号関係届は、上の一覧から年金事務所に出します）。
            </div>
          </>
        )}
      </div>
    </div>
  );
}
