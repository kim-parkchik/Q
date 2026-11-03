/**
 * 住民税の取り込み（eLTAX で受け取る特別徴収税額通知（特別徴収義務者用）の CSV から、年度の12か月の額を入れる）
 * 読み方・結び付け方は utils/residentTaxNotice.ts、年度の12か月は utils/residentTax.ts
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { localGovLabel } from "../../utils/localGov";
import { fiscalYearLabel } from "../../utils/residentTax";
import { defaultNoticeFiscalYear, useResidentTaxImportManager, type ImportRow } from "./useResidentTaxImportManager";

interface Props {
  db: Database;
  staffList: any[];
  onDataChange: () => Promise<void> | void;
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const note: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: "normal", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12, color: "#1e293b", padding: "8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };
const yen = (n: number) => n.toLocaleString();

const STATUS_LABEL = { new: "新しく入れる", changed: "額が変わる", same: "いまと同じ" } as const;

/** 7月分〜5月分が同じ額なら「各 ○円」、違えば「月ごとに違う」 */
const restLabel = (amounts: number[]) => {
  const rest = amounts.slice(1);
  return rest.every((a) => a === rest[0]) ? `各 ${yen(rest[0])}` : "月ごとに違う";
};

function Row({ r, staffList, choose, toggle }: { r: ImportRow; staffList: any[]; choose: (k: string, id: string) => void; toggle: (k: string, on: boolean) => void }) {
  const rec = r.record;
  return (
    <tr style={{ opacity: r.staff ? 1 : 0.75 }}>
      <td style={td}>
        <input type="checkbox" checked={r.checked} disabled={!r.staff} onChange={(e) => toggle(r.key, e.target.checked)} />
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <div style={{ fontWeight: "bold" }}>{rec.name}</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{localGovLabel(r.municipality) || rec.code}</div>
      </td>
      <td style={td}>
        <select value={r.staffId} onChange={(e) => choose(r.key, e.target.value)} style={{ padding: "5px 6px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, maxWidth: 190 }}>
          <option value="">（取り込まない）</option>
          {staffList.map((s) => <option key={s.id} value={String(s.id)}>{s.name}（{s.id}）</option>)}
        </select>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, whiteSpace: "nowrap" }}>
          {r.match.how === "number" && r.staffId === r.match.staffId ? "受給者番号で見つけました"
            : r.match.how === "name" && r.staffId === r.match.staffId ? "氏名で見つけました"
            : r.match.candidates.length > 1 && !r.staffId ? "同じ氏名の人が複数います。選んでください"
            : !r.staffId ? "見つかりません。選んでください" : "選んだ人"}
        </div>
      </td>
      <td style={num}>{yen(rec.annual)}</td>
      <td style={num}>{yen(rec.amounts[0])}</td>
      <td style={num}>{restLabel(rec.amounts)}</td>
      <td style={{ ...td, whiteSpace: "nowrap", color: r.status === "same" ? "#94a3b8" : r.status === "changed" ? "#b45309" : "#1e293b" }}>
        {r.status ? STATUS_LABEL[r.status] : ""}
        {rec.changeMonth && <div style={{ fontSize: 11, color: "#64748b" }}>変更の通知（{rec.changeMonth}月）{rec.remarks && `：${rec.remarks}`}</div>}
      </td>
      <td style={{ ...td, fontSize: 11, color: "#b45309", lineHeight: 1.6 }}>
        {r.notes.map((n) => <div key={n}>⚠ {n}</div>)}
      </td>
    </tr>
  );
}

export default function ResidentTaxImportManager({ db, staffList, onDataChange }: Props) {
  const z = useResidentTaxImportManager(db, staffList, onDataChange);
  const base = defaultNoticeFiscalYear();
  const years = [base - 1, base, base + 1];
  const targets = z.rows.filter((r) => r.checked);

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select value={z.fiscalYear} onChange={(e) => z.setFiscalYear(Number(e.target.value))} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {years.map((y) => <option key={y} value={y}>{fiscalYearLabel(y)}（{y}年6月分〜{y + 1}年5月分）</option>)}
          </select>
          <button type="button" onClick={z.pickFiles}
            style={{ padding: "9px 18px", border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: "bold", color: "#334155" }}>
            CSV を選ぶ
          </button>
        </div>
        <p style={note}>
          市区町村から eLTAX で届く「特別徴収税額通知（特別徴収義務者用）」の CSV を読み、従業員の住民税（年度の12か月の額）に入れます。
          <br />・CSV は、eLTAX の PCdesk（WEB版）の「処分通知等」→「特徴税通（特徴義務者用）の照会・出力」で書き出します。ZIP で出てくるので、開いて中の CSV を選んでください。
          PCdesk（DL版）で書き出した CSV も読めます（文字コードは UTF-8・Shift-JIS のどちらでもかまいません）。いくつかの CSV を一度に選べます。
          <br />・形式は、地方税共同機構「処分通知等（税額通知）CSVレイアウト仕様書（総務省通知形式）」です。年度は CSV に書かれていないので、上で選んでください。
          <br />・従業員とは、受給者番号（給与支払報告書の CSV に Q が書いた従業員ID）で結び付けます。合わないときは氏名で探し、見つからなければ選んでください。
          <br />・従業員の画面の市区町村が空なら、通知の市区町村を入れます。給与支払報告書の画面の指定番号が空なら、通知の指定番号を入れます。
          <br />・変更の通知（変更月があるもの）も、同じように取り込めます。その年度の12か月を通知の額にします。確定した給与明細の住民税は変わりません。
          <br />・通知に書いてあるマイナンバーは読みません。
        </p>
      </div>

      {z.errors.length > 0 && (
        <div style={{ ...card, fontSize: 12, color: "#b45309", lineHeight: 1.7 }}>
          <div style={{ fontWeight: "bold" }}>読めなかった行</div>
          {z.errors.map((e) => <div key={e}>⚠ {e}</div>)}
        </div>
      )}

      {z.rows.length > 0 && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: "bold", color: "#1e293b" }}>読んだ通知：{z.rows.length}人</div>
            <button type="button" onClick={z.apply} disabled={targets.length === 0}
              style={{
                padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white",
                cursor: targets.length === 0 ? "not-allowed" : "pointer", backgroundColor: targets.length === 0 ? "#94a3b8" : "#27ae60",
              }}>
              {targets.length}人の住民税を入れる（{fiscalYearLabel(z.fiscalYear)}）
            </button>
          </div>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>入れる</th>
                  <th style={th}>通知の氏名・市区町村</th>
                  <th style={th}>従業員</th>
                  <th style={{ ...th, textAlign: "right" }}>年税額</th>
                  <th style={{ ...th, textAlign: "right" }}>6月分</th>
                  <th style={{ ...th, textAlign: "right" }}>7月分〜5月分</th>
                  <th style={th}>いまの額と比べて</th>
                  <th style={th}>注意</th>
                </tr>
              </thead>
              <tbody>
                {z.rows.map((r) => <Row key={r.key} r={r} staffList={staffList} choose={z.choose} toggle={z.toggle} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
