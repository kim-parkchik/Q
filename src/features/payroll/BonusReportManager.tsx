/**
 * 「賞与支払届」の画面（健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届）
 * 確定した賞与を選ぶと、届書の内容（被保険者整理番号・氏名・生年月日・支払年月日・賞与額・備考）を出し、
 * 電子申請用のファイル（SHFD0006.CSV）を保存したり、印刷したりできる（紙の届書に書き写すとき）。
 * 賞与支払予定月に賞与を払わなかったときの「賞与不支給報告書」に書く内容も出す（BonusNonPaymentSection）。
 * 決まりと作り方は utils/bonusReport.ts・utils/bonusNonPayment.ts・utils/shahoCsv.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { formatWareki } from "../../utils/wareki";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { useBonusReportManager } from "./useBonusReportManager";
import { BonusNonPaymentSection } from "./BonusNonPaymentSection";
import {
  MyNumberToggle, ShahoFilePanel, ShahoOfficeTable, UnionFilePanel, card, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, table, td, th, title,
} from "./ShahoFilePanel";

interface Props {
  db: Database;
  currentUser?: MyNumberUser | null;
}

const yen = (n: number) => `${n.toLocaleString()}円`;
const BONUS_PRINT = "bonus-report-print";
const NON_PAYMENT_PRINT = "fushikyu-report-print";

export default function BonusReportManager({ db, currentUser = null }: Props) {
  const z = useBonusReportManager(db, currentUser);
  const r = z.report;
  // 印刷するのは、賞与支払届か賞与不支給報告書のどちらか（印刷のときだけ、その部分を出す）
  const [printTarget, setPrintTarget] = useState(BONUS_PRINT);
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);
  const printIt = (id: string) => { setPrintTarget(id); setPrintRequest((n) => n + 1); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <style>{shahoPrintStyle(printTarget, printTarget === BONUS_PRINT)}</style>
      <div style={card} className="no-print">
        <h3 style={title}>賞与支払届（健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届）</h3>
        <p style={note}>
          被保険者に賞与を払ったら、払った日から5日以内に、事務センター（年金事務所）に出します（年4回以上払う賞与は、標準報酬月額に入れるので出しません。
          賞与の画面で「年4回以上払う賞与の1回」の印を付け、社会保険の報酬として扱って確定した賞与は、ここに書きません）。
          確定した賞与を選ぶと、その賞与を払った人の届書の内容を作ります（同じ月に、その前にも賞与を払った人は、前の分と合わせて届け出ます。
          そのあと同じ月にまた払ったら、その賞与を選んで、もう一度合わせて届け出ます）。
          電子申請（e-Gov など）では、下の「電子申請用のファイルを保存」で作る SHFD0006.CSV を添付します（ファイル名は変えないでください）。
          紙で出すときは、年金機構から届いた届書に、下の一覧を書き写すか、印刷して確かめてください。
          賞与を払う予定の月に、だれにも払わなかったときは、下の「賞与不支給報告書」を出します。
        </p>
        <ShahoFilePanel
          file={z.file} dataLines={z.dataLines} blocked={z.selected ? z.blocked : []} label={`賞与支払届 ${z.label}`}
          count={r?.rows.length ?? 0} onPrint={() => printIt(BONUS_PRINT)} canPrint={!!r && r.rows.length > 0} onSave={z.save}
        >
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
          {z.my.access && <MyNumberToggle my={z.my} who="70歳以上被用者" />}
        </ShahoFilePanel>
        {!z.my.access && <MyNumberToggle my={z.my} />}
        <UnionFilePanel file={z.file} insurers={z.insurers} rows={r?.rows ?? []} label={`賞与支払届 ${z.label}`} onSaved={() => z.reloadInsurers()} />
        {z.deadline && <div style={{ fontSize: 13, fontWeight: "bold", color: "#b45309", marginTop: 6 }}>提出期限：{formatWareki(z.deadline)}（{z.deadline}。賞与を払った日から5日以内）</div>}
        {z.loadError && <div style={{ color: "#b91c1c", fontSize: 12 }}>⚠ 読み込めませんでした：{z.loadError}</div>}
        {z.unfinalizedSameMonth.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
            ⚠ 同じ月にこの賞与より前に払う賞与で、まだ確定していないもの（{z.unfinalizedSameMonth.map((s) => s.name).join("・")}）は入れていません。
            同じ月に払った賞与は合わせて届け出るので、確定してから作り直してください。
          </div>
        )}
      </div>

      {r && (
        <div id={BONUS_PRINT} style={card}>
          <h3 style={title}>
            健康保険・厚生年金保険 被保険者賞与支払届／厚生年金保険 70歳以上被用者賞与支払届
            <span style={{ fontSize: 12, fontWeight: "normal", marginLeft: 8 }}>{z.label}</span>
          </h3>
          <ShahoOfficeTable office={z.file.office.values} />
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
                  <th style={th}>⑦個人番号・基礎年金番号<br />（70歳以上被用者）</th>
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
                    <td style={td}>{row.myNumber ? "マイナンバー" : row.values[15] ? `${row.values[15]}-${row.values[16]}` : ""}</td>
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
            ㋑現物には、賞与の支給項目で「現物で渡す」にした項目（自社製品など）の額を書き、㋐通貨はそれを除いた額です。
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

      <BonusNonPaymentSection z={z} printId={NON_PAYMENT_PRINT} onPrint={() => printIt(NON_PAYMENT_PRINT)} />
    </div>
  );
}
