/**
 * 賃金の証明の欄（離職証明書の「離職の日以前の賃金支払状況等」⑧〜⑬。休業開始時賃金月額証明書・六十歳到達時等賃金証明書も同じ形）
 * 左に ⑧ 被保険者期間算定対象期間と ⑨ 基礎日数、右に ⑩ 賃金支払対象期間・⑪ 基礎日数・⑫ 賃金額（A・B・計）・⑬ 備考を、
 * 上から同じ行に並べる（1行目の終わりは「離職日」）。計算は utils/wageCertificate.ts
 * ・短期雇用特例被保険者は、⑧を B 欄（暦月。1行目は「離職月」）で出す
 * ・離職証明書の1枚に書けるのは25行まで。26行目からは「続紙」として、見出しを付けて続けて出す
 */
import type { WageCertResult } from "../../utils/wageCertificate";
import { md } from "../../utils/wageCertificate";
import { small, table, td, th } from "./ShahoFilePanel";

const yen = (n: number) => (n > 0 ? n.toLocaleString() : "");
/** 離職証明書の1枚に書ける賃金の欄の行（電子申請のファイルも25行まで） */
const CERT_ROWS_PER_SHEET = 25;

export function WageCertificateTable({ cert, endLabel = "離職日", noteOverrides }: {
  cert: WageCertResult;
  /** 1行目の終わり（離職証明書は「離職日」、休業開始時賃金月額証明書は「休業開始日の前日」） */
  endLabel?: string;
  /** 手で直した備考（行の番号（1から） → 字） */
  noteOverrides?: Record<string, string>;
}) {
  const n = Math.max(cert.insured.length, cert.wages.length);
  return (
    <div>
      <table style={{ ...table, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={th} colSpan={2}>⑧ 被保険者期間算定対象期間（{endLabel}の翌日 {cert.nextDay ? md(cert.nextDay) : ""}）</th>
            <th style={th} colSpan={2}>⑩ 賃金支払対象期間</th>
            <th style={th} colSpan={3}>⑫ 賃金額</th>
            <th style={th} rowSpan={2}>⑬ 備考</th>
          </tr>
          <tr>
            <th style={th}>期間</th>
            <th style={th}>⑨ 基礎日数</th>
            <th style={th}>期間</th>
            <th style={th}>⑪ 基礎日数</th>
            <th style={th}>A</th>
            <th style={th}>B</th>
            <th style={th}>計</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const ins = cert.insured[i];
            const w = cert.wages[i];
            const note = noteOverrides?.[String(i + 1)] ?? [ins?.note, w?.note].filter(Boolean).join(" ");
            const period = !ins ? "" : ins.month ? (i === 0 ? `離職月（${ins.month}月）` : `B ${ins.month}月`) : `${md(ins.from)}〜${i === 0 ? endLabel : md(ins.to)}`;
            return [
              i === CERT_ROWS_PER_SHEET && (
                <tr key={`c${i}`}><td style={{ ...td, fontWeight: "bold", backgroundColor: "#f1f5f9" }} colSpan={8}>続紙（{CERT_ROWS_PER_SHEET + 1}行目から）</td></tr>
              ),
              <tr key={i}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{period}</td>
                <td style={{ ...td, textAlign: "right" }}>{ins ? `${ins.days}日` : ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{w ? `${md(w.from)}〜${i === 0 ? endLabel : md(w.to)}` : ""}</td>
                <td style={{ ...td, textAlign: "right" }}>{w ? `${w.days}日` : ""}</td>
                <td style={{ ...td, textAlign: "right" }}>{w ? yen(w.a) : ""}</td>
                <td style={{ ...td, textAlign: "right" }}>{w ? yen(w.b) : ""}</td>
                <td style={{ ...td, textAlign: "right" }}>{w ? yen(w.total) : ""}</td>
                <td style={td}>{note}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <div style={{ ...small, marginTop: 4 }}>
        ⑨が11日以上の完全月 {cert.fullMonths}か月・⑪が11日以上の完全月 {cert.fullWageMonths}か月
      </div>
      {(cert.problems.length > 0 || cert.notes.length > 0) && (
        <div className="no-print" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
          {cert.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
          {cert.notes.map((x) => <div key={x} style={{ color: "#475569" }}>・{x}</div>)}
        </div>
      )}
    </div>
  );
}
