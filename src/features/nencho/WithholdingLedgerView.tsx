/**
 * 給与所得に対する源泉徴収簿の見た目
 * 欄の並びは、国税庁「令和8年分 年末調整のしかた」の設例の源泉徴収簿に合わせる（左：給料・手当等と賞与等、右：年末調整）。
 */
import type { LedgerRow, LedgerTotals, WithholdingLedger } from "../../utils/withholdingLedger";
import { formatWareki } from "../../utils/wareki";

const line = "1px solid #000";
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };
const th: React.CSSProperties = { border: line, fontSize: 8, fontWeight: "normal", padding: "1px 2px", textAlign: "center", lineHeight: 1.2, backgroundColor: "#f5f5f5" };
const td: React.CSSProperties = { border: line, fontSize: 10, padding: "1px 4px", height: 16, lineHeight: 1.3 };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace" };
const ctr: React.CSSProperties = { ...td, textAlign: "center" };
const caption: React.CSSProperties = { fontSize: 10, fontWeight: "bold", margin: "8px 0 2px 0" };

/** 金額（負の数は ▲） */
const yen = (v: number | null | undefined) => (v === null || v === undefined ? "" : v < 0 ? `▲${(-v).toLocaleString()}` : v.toLocaleString());
/** 0 のときは空ける金額（年末調整による過不足税額など） */
const yenOrBlank = (v: number) => (v === 0 ? "" : yen(v));

function RowCells({ r, bonus }: { r: LedgerRow | null; bonus?: boolean }) {
  return (
    <>
      <td style={ctr}>{r?.payDay ? `${r.month}/${r.payDay}` : ""}</td>
      <td style={num}>{yen(r?.gross)}</td>
      <td style={num}>{yen(r?.social)}</td>
      <td style={num}>{yen(r?.afterSocial)}</td>
      <td style={ctr}>{r?.dependents ?? ""}</td>
      {bonus && <td style={num}>{r?.rate !== null && r?.rate !== undefined ? r.rate.toFixed(3) : ""}</td>}
      <td style={num}>{yen(r?.tax)}</td>
      <td style={num}>{r ? yenOrBlank(r.adjustment) : ""}</td>
      <td style={num}>{yen(r?.netTax)}</td>
    </>
  );
}

function TotalCells({ t, bonus, marks }: { t: LedgerTotals; bonus?: boolean; marks: [string, string, string] }) {
  return (
    <tr>
      <td style={{ ...ctr, fontWeight: "bold" }} colSpan={2}>計</td>
      <td style={num}><span style={{ float: "left", fontSize: 8 }}>{marks[0]}</span>{yen(t.gross)}</td>
      <td style={num}><span style={{ float: "left", fontSize: 8 }}>{marks[1]}</span>{yen(t.social)}</td>
      <td style={num}>{yen(t.afterSocial)}</td>
      <td style={td} />
      {bonus && <td style={td} />}
      <td style={num}><span style={{ float: "left", fontSize: 8 }}>{marks[2]}</span>{yen(t.tax)}</td>
      <td style={num}>{yenOrBlank(t.adjustment)}</td>
      <td style={num}>{yen(t.netTax)}</td>
    </tr>
  );
}

function PayTable({ title, bonus, children }: { title: string; bonus?: boolean; children: React.ReactNode }) {
  return (
    <>
      <div style={caption}>{title}</div>
      <table style={table}>
        <colgroup>
          <col style={{ width: "5%" }} /><col style={{ width: "8%" }} />
          <col style={{ width: bonus ? "13%" : "15%" }} /><col style={{ width: "13%" }} /><col style={{ width: bonus ? "13%" : "15%" }} />
          <col style={{ width: "6%" }} />{bonus && <col style={{ width: "8%" }} />}
          <col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>月区分</th><th style={th}>支給月日</th><th style={th}>総支給金額</th><th style={th}>社会保険料等の控除額</th>
            <th style={th}>{bonus ? "社会保険料等控除後の金額" : "社会保険料等控除後の給与等の金額"}</th><th style={th}>扶養親族等の数</th>
            {bonus && <th style={th}>税率（%）</th>}
            <th style={th}>算出税額</th><th style={th}>年末調整による過不足税額</th><th style={th}>差引徴収税額</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </>
  );
}

export default function WithholdingLedgerView({ ledger, staff, branchName }: { ledger: WithholdingLedger; staff: any; branchName: string | null }) {
  const l = ledger;
  const a = l.adjustment;
  const r = a?.result;
  const d = r?.deductions;
  const eligible = !!r?.eligible;
  const reiwa = l.year >= 2019 ? `令和 ${l.year - 2018 === 1 ? "元" : l.year - 2018} 年分` : `${l.year}年分`;

  /** 年末調整の欄の1行 */
  const adj = (no: string, label: string, value: number | null | undefined, opts: { blank?: boolean; note?: string } = {}) => (
    <tr key={no}>
      <td style={{ ...ctr, fontSize: 9 }}>{no}</td>
      <td style={{ ...td, fontSize: 9 }}>{label}{opts.note && <span style={{ fontSize: 8, color: "#444" }}>（{opts.note}）</span>}</td>
      <td style={num}>{opts.blank || value === null || value === undefined ? "" : yen(value)}</td>
    </tr>
  );

  return (
    <div style={{ color: "#000", backgroundColor: "white", fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 24, marginBottom: 6 }}>
        <span style={{ fontSize: 12 }}>{reiwa}</span>
        <span style={{ fontSize: 16, fontWeight: "bold", letterSpacing: 4 }}>給与所得に対する源泉徴収簿</span>
        <span style={{ fontSize: 11, border: line, padding: "0 6px" }}>{l.taxColumn === "otsu" ? "乙欄" : "甲欄"}</span>
      </div>

      {/* 受給者 */}
      <table style={table}>
        <colgroup><col style={{ width: "7%" }} /><col style={{ width: "18%" }} /><col style={{ width: "7%" }} /><col style={{ width: "22%" }} /><col style={{ width: "7%" }} /><col style={{ width: "39%" }} /></colgroup>
        <tbody>
          <tr>
            <th style={th}>所属</th><td style={td}>{branchName ?? ""}</td>
            <th style={th}>氏名</th>
            <td style={td}><div style={{ fontSize: 8 }}>{staff.furigana ?? ""}</div>{staff.name}</td>
            <th style={th}>住所</th><td style={td}>{staff.address ?? ""}</td>
          </tr>
          <tr>
            <th style={th}>整理番号</th><td style={td}>{staff.id}</td>
            <th style={th}>生年月日</th><td style={td}>{formatWareki(staff.birthday)}</td>
            <th style={th}>扶養控除等申告書</th><td style={td}>{l.taxColumn === "otsu" ? "無" : "有"}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "62% 1fr", gap: 10, alignItems: "start" }}>
        {/* 左：給料・手当等・賞与等・扶養控除等の申告 */}
        <div>
          <PayTable title="給料・手当等">
            {l.salaryRows.map((row, i) => (
              <tr key={i}><td style={ctr}>{i + 1}</td><RowCells r={row} /></tr>
            ))}
            <TotalCells t={l.salaryTotal} marks={["①", "②", "③"]} />
          </PayTable>

          <PayTable title="賞与等" bonus>
            {l.bonusRows.length === 0 && (
              <tr><td style={ctr} /><RowCells r={null} bonus /></tr>
            )}
            {l.bonusRows.map((row, i) => (
              <tr key={i}><td style={ctr}>{row.month}</td><RowCells r={row} bonus /></tr>
            ))}
            <TotalCells t={l.bonusTotal} bonus marks={["④", "⑤", "⑥"]} />
          </PayTable>

          {l.carryOver && (
            <>
              <div style={caption}>前年の年末調整に基づき繰り越した過不足税額</div>
              <table style={table}>
                <tbody>
                  <tr>
                    <th style={th}>過不足税額（{l.carryOver.amount >= 0 ? "還付" : "徴収"}）</th><td style={num}>{yen(Math.abs(l.carryOver.amount))}</td>
                    <th style={th}>1月に還付又は徴収した税額</th><td style={num}>{yen(Math.abs(l.carryOver.settledInJanuary))}</td>
                    <th style={th}>差引残高</th><td style={num}>{yen(Math.abs(l.carryOver.balance))}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          <div style={caption}>扶養控除等の申告・各種控除額</div>
          <table style={table}>
            <colgroup><col style={{ width: "46%" }} /><col style={{ width: "14%" }} /><col style={{ width: "20%" }} /><col style={{ width: "20%" }} /></colgroup>
            <thead>
              <tr><th style={th}>区分</th><th style={th}>人数</th><th style={th}>1人当たり（万円）</th><th style={th}>合計（万円）</th></tr>
            </thead>
            <tbody>
              {(l.dependentLines ?? []).map((x) => (
                <tr key={x.label}>
                  <td style={{ ...td, fontSize: 9 }}>{x.label}</td>
                  <td style={ctr}>{x.count > 0 ? x.count : ""}</td>
                  <td style={num}>{x.perPersonMan}</td>
                  <td style={num}>{x.count > 0 ? x.totalMan : ""}</td>
                </tr>
              ))}
              {l.dependentLines && (
                <tr>
                  <td style={{ ...td, fontSize: 9 }} colSpan={3}>合計（⑲に書く金額）</td>
                  <td style={num}>{l.dependentLines.reduce((s, x) => s + x.totalMan, 0)}</td>
                </tr>
              )}
              {!l.dependentLines && (
                <tr><td style={{ ...td, fontSize: 9, color: "#444" }} colSpan={4}>年末調整をしない人・年末調整を保存していない人は書きません</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 右：年末調整 */}
        <div>
          <div style={caption}>年末調整</div>
          <table style={table}>
            <colgroup><col style={{ width: "9%" }} /><col style={{ width: "61%" }} /><col style={{ width: "30%" }} /></colgroup>
            <tbody>
              {adj("①", "給料・手当等（金額）", a?.salaryAmount, { note: a?.previousJob ? "前の勤め先の分を含む" : undefined })}
              {adj("③", "給料・手当等（税額）", a?.salaryTax)}
              {adj("④", "賞与等（金額）", a?.bonusAmount)}
              {adj("⑥", "賞与等（税額）", a?.bonusTax)}
              {adj("⑦", "計（金額）", a ? a.salaryAmount + a.bonusAmount : null)}
              {adj("⑧", "計（税額）", a ? a.salaryTax + a.bonusTax : null)}
              {adj("⑨", "給与所得控除後の給与等の金額", r?.employmentIncome)}
              {adj("⑩", "所得金額調整控除額", r?.incomeAdjustment)}
              {adj("⑪", "給与所得控除後の給与等の金額（調整控除後）", r?.employmentIncomeAdjusted)}
              {adj("⑫", "社会保険料等控除額（給与等からの控除分 ②＋⑤）", a?.socialFromPay)}
              {adj("⑬", "申告による社会保険料の控除分", a?.socialDeclared)}
              {adj("⑭", "申告による小規模企業共済等掛金の控除分", a?.smallBusiness)}
              {adj("⑮", "生命保険料の控除額", d?.lifeInsurance)}
              {adj("⑯", "地震保険料の控除額", d?.earthquake)}
              {adj("⑰", "配偶者（特別）控除額", d ? d.spouse + d.spouseSpecial : null)}
              {adj("⑱", "特定親族特別控除額", d?.specificRelative)}
              {adj("⑲", "扶養控除額及び障害者等の控除額の合計額", d?.dependentsAndOthers)}
              {adj("⑳", "基礎控除額", d?.basic)}
              {adj("㉑", "所得控除額の合計額", d?.total)}
              {adj("㉒", "差引課税給与所得金額（1,000円未満切捨て）", r?.taxableIncome, { blank: !eligible })}
              {adj("㉓", "算出所得税額", r?.calculatedTax, { blank: !eligible })}
              {adj("㉔", "（特定増改築等）住宅借入金等特別控除額", r?.housingLoanCredit, { blank: !eligible })}
              {adj("㉕", "年調所得税額（㉓－㉔）", r?.annualIncomeTax, { blank: !eligible })}
              {adj("㉖", "年調年税額（㉕×102.1%、100円未満切捨て）", r?.annualTax, { blank: !eligible })}
              {adj("㉗", `差引超過額又は不足額（㉖－⑧）${a?.differenceKind === "excess" ? "：超過額" : a?.differenceKind === "shortage" ? "：不足額" : ""}`, a?.difference, { blank: !eligible })}
              {adj("㉘", "本年最後の給与から徴収する税額に充当する金額", a?.appliedToLastPay, { blank: !eligible })}
              {adj("㉙", "未払給与に係る未徴収の税額に充当する金額", a?.appliedToUnpaid, { blank: !eligible })}
              {adj("㉚", "差引還付する金額（㉗－㉘－㉙）", a?.refund, { blank: !eligible })}
              {adj("㉛", "同上のうち 本年中に還付する金額", a?.refundThisYear, { blank: !eligible })}
              {adj("㉜", "同上のうち 翌年において還付する金額", a?.refundNextYear, { blank: !eligible })}
              {adj("㉝", "本年最後の給与から徴収する金額", a?.collectThisYear, { blank: !eligible })}
              {adj("㉞", "翌年に繰り越して徴収する金額", a?.collectNextYear, { blank: !eligible })}
            </tbody>
          </table>
          <table style={{ ...table, marginTop: 4 }}>
            <colgroup><col style={{ width: "70%" }} /><col style={{ width: "30%" }} /></colgroup>
            <tbody>
              <tr><td style={{ ...td, fontSize: 9 }}>所得金額調整控除の適用</td><td style={ctr}>{a ? (r!.incomeAdjustment > 0 ? "有" : "無") : ""}</td></tr>
              <tr><td style={{ ...td, fontSize: 9 }}>配偶者の合計所得金額</td><td style={num}>{a ? yen(a.spouseTotalIncome) : ""}</td></tr>
              <tr><td style={{ ...td, fontSize: 9 }}>旧長期損害保険料支払額</td><td style={num}>{a ? yen(a.oldLongTerm) : ""}</td></tr>
              <tr><td style={{ ...td, fontSize: 9 }}>⑫のうち小規模企業共済等掛金の金額</td><td style={num}>{a ? "0" : ""}</td></tr>
              <tr><td style={{ ...td, fontSize: 9 }}>⑬のうち国民年金保険料等の金額</td><td style={num}>{a ? yen(a.nationalPension) : ""}</td></tr>
              {a?.previousJob && (
                <tr>
                  <td style={{ ...td, fontSize: 9 }} colSpan={2}>
                    前の勤め先の分：給与 {yen(a.previousJob.salary)}円・税額 {yen(a.previousJob.withheldTax)}円・社会保険料 {yen(a.previousJob.socialInsurance)}円（①・③・⑫に含む）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
