/**
 * 「産休・育休の申出書」の画面
 * ・健康保険・厚生年金保険 産前産後休業取得者申出書／変更（終了）届
 * ・健康保険・厚生年金保険 育児休業等取得者申出書（新規・延長）／終了届
 * 従業員の画面の「休業・休職」に入れた期間から届書の内容を作り、電子申請用のファイル（SHFD0006.CSV）を保存したり、印刷したりできる。
 * ファイルを保存したら、届け出た内容を期間に残し、あとで期間を直したら、出す届書（変更・延長・終了）を出す。
 * 決まりと作り方は utils/leaveReport.ts・utils/shahoCsv.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatWareki } from "../../utils/wareki";
import { MY_NUMBER_PLACEHOLDER } from "../../utils/shahoCsv";
import { papaLeaveWorkDays } from "../../utils/leaveExemption";
import { baseHoursOf } from "../../utils/scheduledHours";
import { isSameMonthLeave, type ChildcareReported, type MaternityReported } from "../../utils/leaveReport";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { LEAVE_REPORT_LABELS, useLeaveReportManager, type LeaveReportMode } from "./useLeaveReportManager";
import { ShahoFilePanel, ShahoOfficeTable, card, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, table, td, th, title } from "./ShahoFilePanel";

interface Props {
  db: Database;
  staffList: any[];
  currentUser: MyNumberUser | null;
  onDataChange: () => Promise<void> | void;
}

const PRINT_ID = "leave-report-print";
const w = (d: string | undefined | null) => (d ? formatWareki(d) : "—");
const smallInput = { ...input, padding: "3px 6px", fontSize: 12 };

export default function LeaveReportManager({ db, staffList, currentUser, onDataChange }: Props) {
  const z = useLeaveReportManager(db, staffList, currentUser, onDataChange);
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);
  const maternity = z.mode === "sankyu";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1300, margin: "0 auto" }}>
      <style>{shahoPrintStyle(PRINT_ID, true)}</style>
      <div style={card} className="no-print">
        <h3 style={title}>産休・育休の申出書（社会保険料の免除）</h3>
        <p style={note}>
          産前産後休業・育児休業等（産後パパ育休を含む）を取った人の社会保険料を免除してもらうために、休業の期間中か、終了日から1か月以内に、
          事務センター（年金事務所）に申出書を出します（開始日より前は、電子申請で受け付けません）。
          従業員の画面の「休業・休職」に入れた期間（産休は出産予定日・出産日、育休は子の氏名・生年月日も）から作ります。
          ファイルを保存すると、届け出た内容を期間に残します。出産予定日の前に申出して違う日に出産したとき・期間が変わったとき（産休の変更）、
          育休を延ばすとき（延長）、予定より早く終わったとき（終了）は、従業員の画面で期間を直すと、ここに出す届書が出ます。
          健康保険組合の人は、組合にも組合の決まりで出してください（この申出書は、組合に出すファイルの形がありません）。
        </p>
        {!maternity && (
          <p style={note}>
            開始日と終了日の翌日が同じ月の育休は、育児休業等取得日数と就業予定日数を書きます。就業予定日数は、従業員の画面の育児休業の行に入れた
            「産後パパ育休で働かせる時間」を1日の所定労働時間で割った数（小数点以下切り捨て）で、産後パパ育休でなければ0日です。
            育児休業等取得日数は、開始日から終了日までの日数から就業予定日数を差し引いた日数で、14日以上なければ保険料は免除されません（申出書の記入方法）。
          </p>
        )}
        <ShahoFilePanel
          file={z.file} dataLines={z.dataLines} blocked={z.blocked} label={z.label} count={z.included.length}
          onPrint={() => setPrintRequest((n) => n + 1)} canPrint={z.rows.length > 0} onSave={z.save}
        >
          <label style={fieldStyle}>
            <span style={labelStyle}>届書</span>
            <select value={z.mode} onChange={(e) => z.setMode(e.target.value as LeaveReportMode)} style={input}>
              <option value="sankyu">{LEAVE_REPORT_LABELS.sankyu}</option>
              <option value="ikukyu">{LEAVE_REPORT_LABELS.ikukyu}</option>
            </select>
          </label>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
            <input type="checkbox" checked={z.onlyPending} onChange={(e) => z.setOnlyPending(e.target.checked)} />
            届け出るものだけ（届けた内容のままの期間は出さない）
          </label>
          {z.my.access && (
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
              <input type="checkbox" checked={z.my.use} onChange={(e) => z.my.setUse(e.target.checked)} />
              マイナンバーを書く
            </label>
          )}
        </ShahoFilePanel>
        {!z.my.access && <div style={{ ...small, marginTop: 4 }}>マイナンバーは、事務取扱担当者だけが届書に書けます。いまは基礎年金番号で届けます。</div>}
      </div>

      <div id={PRINT_ID} style={card}>
        <h3 style={title}>{z.label}の内容</h3>
        <ShahoOfficeTable office={z.file.office.values} />
        {z.rows.length === 0 ? (
          <div style={small}>
            {z.total === 0
              ? `従業員の画面の「休業・休職」に、${maternity ? "産前産後休業" : "育児休業"}の期間を入れると、ここに出ます。`
              : "届け出るものはありません（すべて届けた内容のままです。「届け出るものだけ」を外すと、すべての期間を出します）。"}
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th} className="no-print">届ける</th>
                <th style={th}>整理番号・氏名・生年月日</th>
                <th style={th}>届書</th>
                <th style={th}>{maternity ? "出産予定日・出産日・期間" : "養育する子・期間"}</th>
                <th style={th}>申出のときに届けた内容（変更・延長・終了）</th>
                <th style={th}>マイナンバー・基礎年金番号</th>
                <th style={th}>備考</th>
                <th style={th} className="no-print">確かめること</th>
              </tr>
            </thead>
            <tbody>
              {z.rows.map((item) => {
                const { key, staff, leave, group, suggest, edit: e, row: r } = item;
                const set = (patch: Parameters<typeof z.update>[1]) => z.update(item, patch);
                const rep = e.reported as MaternityReported & ChildcareReported;
                const setRep = (patch: Partial<MaternityReported & ChildcareReported>) => set({ reported: { ...e.reported, ...patch } });
                return (
                  <tr key={key} style={{ opacity: e.include ? 1 : 0.5 }}>
                    <td style={td} className="no-print"><input type="checkbox" checked={e.include} onChange={(ev) => set({ include: ev.target.checked })} /></td>
                    <td style={td}>{r.values[4] || "—"}　{r.name}<br /><span style={small}>{w(staff.birthday)}</span></td>
                    <td style={td}>
                      <select className="no-print" value={e.kind} onChange={(ev) => set({ kind: ev.target.value })} style={smallInput}>
                        {Object.entries(z.kindLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                      <span className="print-only">{z.kindLabels[e.kind]}</span>
                      <div style={small}>
                        {(group ? group.every((g) => g.leave.reported) : leave.reported)
                          ? `届けた日 ${w(leave.reported?.on)}（${z.kindLabels[leave.reported?.kind ?? ""] ?? leave.reported?.kind}）` : "まだ届けていない"}
                        {suggest === null && "・届けた内容のまま"}
                      </div>
                      <div style={small}>期限 {r.deadline ? w(r.deadline) : "—"}</div>
                    </td>
                    <td style={td}>
                      {maternity ? (
                        <>
                          出産予定日 {w(leave.dueDate)}{leave.multiple ? "（多胎）" : ""}<br />
                          出産日 {w(leave.birthDate)}<br />
                          {w(leave.start)} 〜 {w(r.end)}
                        </>
                      ) : group ? (
                        <>
                          {leave.childName || leave.childKana || "（子の氏名なし）"}（{w(leave.childBirthday)}生{leave.adopted ? "・実子以外" : ""}）<br />
                          <span style={small}>同じ月に{group.length}回（育休等取得内訳）</span>
                          {group.map((g, i) => (
                            <div key={g.index} style={{ fontSize: 12 }}>
                              {i + 1}回目 {w(g.leave.start)} 〜 {w(g.leave.end)}
                              {g.leave.papaLeave && <>・産後パパ育休（就業予定日数 {papaLeaveWorkDays(g.leave, baseHoursOf(staff)) ?? "—"}日）</>}
                            </div>
                          ))}
                          {r.values[24] && <div style={{ fontSize: 12 }}>取得日数 合計 {r.values[24]}日・就業予定日数 合計 {r.values[25]}日</div>}
                        </>
                      ) : (
                        <>
                          {leave.childName || leave.childKana || "（子の氏名なし）"}（{w(leave.childBirthday)}生{leave.adopted ? "・実子以外" : ""}）<br />
                          {w(leave.start)} 〜 {w(leave.end)}{leave.papaLeave ? "・産後パパ育休" : ""}{leave.papaMama ? "・パパママ育休プラス" : ""}
                          {r.values[24] && (
                            <div style={{ fontSize: 12 }}>
                              取得日数 {r.values[24]}日・就業予定日数 {r.values[25]}日
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={td}>
                      {e.kind === "apply" ? <span style={small}>（申出）</span> : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                          {maternity && (
                            <label>出産予定日 <input type="date" className="no-print" value={rep.dueDate ?? ""} onChange={(ev) => setRep({ dueDate: ev.target.value })} style={smallInput} /><span className="print-only">{w(rep.dueDate)}</span></label>
                          )}
                          <label>開始日 <input type="date" className="no-print" value={rep.start ?? ""} onChange={(ev) => setRep({ start: ev.target.value })} style={smallInput} /><span className="print-only">{w(rep.start)}</span></label>
                          <label>終了予定日 <input type="date" className="no-print" value={rep.end ?? ""} onChange={(ev) => setRep({ end: ev.target.value })} style={smallInput} /><span className="print-only">{w(rep.end)}</span></label>
                          {maternity && (
                            <label className="no-print"><input type="checkbox" checked={rep.multiple === true} onChange={(ev) => setRep({ multiple: ev.target.checked })} />多胎</label>
                          )}
                          {!maternity && !group && isSameMonthLeave(rep.start, rep.end) && (
                            <label title="申出のときに届けた就業予定日数（空なら、いまの期間の就業予定日数を書きます）">
                              就業予定日数{" "}
                              <input type="number" min={0} max={16} className="no-print" value={rep.workDays ?? ""}
                                placeholder={String(papaLeaveWorkDays(leave, baseHoursOf(staff)) ?? "")}
                                onChange={(ev) => setRep({ workDays: ev.target.value === "" ? undefined : Math.max(0, Math.trunc(Number(ev.target.value) || 0)) })}
                                style={{ ...smallInput, width: 50 }} />
                              <span className="print-only">{r.values[25]}</span>日
                            </label>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={td}>{r.values[7] === MY_NUMBER_PLACEHOLDER ? "マイナンバー" : r.values[8] ? `基礎年金番号 ${r.values[8]}-${r.values[9]}` : "（なし）"}</td>
                    <td style={td}>
                      <input type="text" className="no-print" value={e.remarks} placeholder="特記事項" onChange={(ev) => set({ remarks: ev.target.value })} style={{ ...smallInput, width: 160 }} />
                      <span className="print-only">{e.remarks}</span>
                    </td>
                    <td style={td} className="no-print">
                      <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                        {r.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
                        {r.notes.map((n) => <div key={n} style={{ color: "#475569" }}>・{n}</div>)}
                        {r.problems.length === 0 && r.notes.length === 0 && <span style={{ color: "#16a34a" }}>OK</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {z.rows.some((r) => r.union && r.edit.include) && (
          <>
            <h4 style={{ ...title, fontSize: 14, marginTop: 16 }}>健康保険組合に出す申出書（組合の様式で。健康保険の保険料の免除）</h4>
            <table style={table}>
              <thead>
                <tr><th style={th}>組合（事業所番号）</th><th style={th}>氏名・被保険者等番号</th><th style={th}>届書</th><th style={th}>期間</th><th style={th}>{maternity ? "出産予定日・出産日" : "養育する子"}</th></tr>
              </thead>
              <tbody>
                {z.rows.filter((r) => r.union && r.edit.include).map(({ key, staff, leave, group, edit: e, row: r, union }) => (
                  <tr key={`union-${key}`}>
                    <td style={td}>{union!.name}（{union!.officeNumber || "事業所番号なし"}）</td>
                    <td style={td}>{r.name}<div style={small}>被保険者等番号 {staff.health_ins_num || "（従業員の画面に入れてください）"}</div></td>
                    <td style={td}>{z.label}・{z.kindLabels[e.kind]}</td>
                    <td style={td}>{w(r.start)} 〜 {w(r.end)}{group ? `（同じ月に${group.length}回）` : ""}</td>
                    <td style={td}>{maternity ? `${w(leave.dueDate)}・${w(leave.birthDate)}` : `${leave.childName || leave.childKana || ""}（${w(leave.childBirthday)}生）`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
