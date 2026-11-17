/**
 * 給与明細書・賞与明細書の1人分（確定したときに残した内訳から。utils/payReports.ts）
 * 「明細書・一覧表」の画面で、全員分を1人1枚に並べて印刷する
 */
import type { CSSProperties } from "react";
import type { LedgerLine } from "../../utils/legalBooks";
import { hoursLabel, type PayDocPerson } from "../../utils/payReports";
import { yen } from "./reportStyles";

interface Props {
  kind: "salary" | "bonus";
  companyName: string;
  person: PayDocPerson;
  /** 「2026年11月分」「冬季賞与」 */
  heading: string;
  /** 支給日（YYYY-MM-DD。わからなければ空） */
  payDate: string;
}

const dateLabel = (d: string) => (d ? `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "");

export default function PaySlipSheet({ kind, companyName, person, heading, payDate }: Props) {
  const l = person.ledger;
  const totalEarnings = l ? l.totalEarnings : person.totalEarnings;
  const totalDeductions = l ? l.totalDeductions : person.totalDeductions;
  const netPay = l ? l.netPay : person.netPay;
  const yearEnd = l?.yearEndSettlement ?? 0;
  const lines = (rows: LedgerLine[], empty: string) =>
    rows.length === 0
      ? <tr><td style={cell} colSpan={2}>{empty}</td></tr>
      : rows.map((r, i) => (
        <tr key={`${r.name}-${i}`}>
          <td style={cell}>{r.name}</td>
          <td style={{ ...cellNum, color: r.amount < 0 ? "#b91c1c" : undefined }}>{r.amount < 0 ? `－${yen(-r.amount)}` : yen(r.amount)}</td>
        </tr>
      ));

  return (
    <div className="page" style={sheet}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: "#475569" }}>社員番号 {person.staffId}{person.branchName ? `　${person.branchName}` : ""}</div>
          <div style={{ fontSize: 17, borderBottom: "1.5px solid #000", paddingRight: 40, marginTop: 2 }}>{person.name} 様</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div style={{ fontWeight: "bold" }}>{companyName}</div>
          <div>{heading}</div>
          {payDate && <div>支給日 {dateLabel(payDate)}</div>}
          {l?.periodStart && l.periodEnd && <div style={{ fontSize: 11, color: "#475569" }}>計算期間 {dateLabel(l.periodStart)}〜{dateLabel(l.periodEnd)}</div>}
        </div>
      </div>
      <h2 style={{ textAlign: "center", fontSize: 18, letterSpacing: "0.4em", margin: "10px 0 12px" }}>{kind === "salary" ? "給与明細書" : "賞与明細書"}</h2>

      {kind === "salary" && l && (
        <table style={{ ...grid, marginBottom: 10 }}>
          <thead>
            <tr>{["出勤日数", "労働時間", "時間外労働", "休日労働", "深夜労働"].map((h) => <th key={h} style={head}>{h}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              <td style={cellCenter}>{l.workDays} 日</td>
              <td style={cellCenter}>{hoursLabel(l.workHours)}</td>
              <td style={cellCenter}>{hoursLabel(l.overtimeHours)}</td>
              <td style={cellCenter}>{hoursLabel(l.holidayHours)}</td>
              <td style={cellCenter}>{hoursLabel(l.nightHours)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {l ? (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <table style={{ ...grid, flex: 1 }}>
            <thead><tr><th style={head} colSpan={2}>支給</th></tr></thead>
            <tbody>
              {lines(l.earnings, "なし")}
              <tr><td style={{ ...cell, fontWeight: "bold" }}>支給合計</td><td style={{ ...cellNum, fontWeight: "bold" }}>{yen(totalEarnings)}</td></tr>
            </tbody>
          </table>
          <table style={{ ...grid, flex: 1 }}>
            <thead><tr><th style={head} colSpan={2}>控除</th></tr></thead>
            <tbody>
              {lines(l.deductions, "なし")}
              <tr><td style={{ ...cell, fontWeight: "bold" }}>控除合計</td><td style={{ ...cellNum, fontWeight: "bold" }}>{yen(totalDeductions)}</td></tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#92400e", margin: "8px 0" }}>
          この{kind === "salary" ? "給与" : "賞与"}は、内訳を残す前に確定したので、合計だけを出しています（確定し直すと内訳が残ります）。
        </div>
      )}

      {l?.inKind && l.inKind.length > 0 && (
        <table style={{ ...grid, marginTop: 10 }}>
          <thead><tr><th style={head} colSpan={2}>現物で払った報酬（差引支給額には入れていません）</th></tr></thead>
          <tbody>{lines(l.inKind, "なし")}</tbody>
        </table>
      )}

      <table style={{ ...grid, marginTop: 10 }}>
        <tbody>
          <tr><td style={cell}>支給合計</td><td style={cellNum}>{yen(totalEarnings)}</td></tr>
          <tr><td style={cell}>控除合計</td><td style={cellNum}>{yen(totalDeductions)}</td></tr>
          {yearEnd !== 0 && (
            <tr>
              <td style={cell}>{yearEnd > 0 ? "年末調整の還付額" : "年末調整の徴収額"}</td>
              <td style={cellNum}>{yearEnd > 0 ? yen(yearEnd) : `－${yen(-yearEnd)}`}</td>
            </tr>
          )}
          <tr>
            <td style={{ ...cell, fontWeight: "bold", fontSize: 14 }}>差引支給額</td>
            <td style={{ ...cellNum, fontWeight: "bold", fontSize: 14 }}>{yen(netPay)} 円</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const sheet: CSSProperties = { backgroundColor: "white", padding: "16px 20px", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 16, color: "#111827" };
const grid: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const head: CSSProperties = { border: "1px solid #94a3b8", backgroundColor: "#f1f5f9", padding: "4px 6px", fontSize: 11, textAlign: "center" };
const cell: CSSProperties = { border: "1px solid #cbd5e1", padding: "4px 6px" };
const cellNum: CSSProperties = { ...cell, textAlign: "right", whiteSpace: "nowrap" };
const cellCenter: CSSProperties = { ...cell, textAlign: "center" };
