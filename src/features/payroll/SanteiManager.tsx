/**
 * 算定基礎（定時決定）
 * 確定した4〜6月の給与から、9月分からの標準報酬月額を計算し、従業員の履歴に登録する。
 * 計算のきまりは utils/santei.ts
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useSanteiManager, type SanteiRow } from "./useSanteiManager";
import { SANTEI_WORKER_KIND_LABELS, type SanteiWorkerKind } from "../../utils/santei";

interface Props {
  db: Database;
  staffList: any[];
  onDataChange: () => void;
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const th: React.CSSProperties = { padding: "8px 6px", fontSize: 12, color: "#64748b", borderBottom: "2px solid #eee", textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 13, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const numInput: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, textAlign: "right" };
const yen = (n: number | null) => (n === null ? "—" : `${n.toLocaleString()}円`);

/** 空欄は null（その月は給与を支払っていない扱い） */
const toNumberOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));

export default function SanteiManager({ db, staffList, onDataChange }: Props) {
  const { year, setYear, isLoading, isSaving, targets, excluded, selectedRows, updateRow, updateMonth, register, rateWarnings } =
    useSanteiManager(db, staffList, onDataChange);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2020 + 2 }, (_, i) => 2020 + i);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {years.map((y) => <option key={y} value={y}>{y}年度の算定（{y}年9月分から）</option>)}
          </select>
          {isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 }}>
          7月1日に社会保険に加入している人について、4・5・6月に支払った給与（確定したもの。通勤手当を含み、賞与は含まない）から、
          9月分から翌年8月分までの標準報酬月額を計算します。支払基礎日数が17日以上の月（短時間労働者は11日以上）の平均を等級表に当てはめます。
          日数と報酬は直せます（遡って支払った昇給の差額などは、引いた額にしてください）。算定基礎届の提出期限は7月10日です。
        </p>
        {rateWarnings.map((w) => <div key={w} style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>⚠ {w}</div>)}
      </div>

      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>登録</th>
                <th style={th}>氏名・区分</th>
                <th style={th}>従前</th>
                {[4, 5, 6].map((m) => <th key={m} style={{ ...th, minWidth: 150 }}>{m}月に支払った給与<br />（日数／報酬）</th>)}
                <th style={th}>平均</th>
                <th style={th}>9月分から</th>
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 && !isLoading && (
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={8}>対象になる人がいません</td></tr>
              )}
              {targets.map((r) => <SanteiTableRow key={r.staff.id} r={r} updateRow={updateRow} updateMonth={updateMonth} />)}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button
            onClick={register}
            disabled={selectedRows.length === 0 || isSaving}
            style={{ padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white", cursor: selectedRows.length === 0 ? "not-allowed" : "pointer", backgroundColor: selectedRows.length === 0 ? "#cbd5e1" : "#2563eb" }}
          >
            {isSaving ? "登録中…" : `選んだ${selectedRows.length}人を ${year}年9月分から履歴に登録`}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#64748b", margin: "8px 0 0 0" }}>
          登録すると、従業員画面の「標準報酬月額」の履歴に「{year}年9月分〜・定時決定」の行が入ります。決定通知書が届いたら、金額が同じか確かめてください。
        </p>
      </div>

      {excluded.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: "#475569", marginBottom: 8 }}>算定基礎届の対象にならない人</div>
          {excluded.map((r) => (
            <div key={r.staff.id} style={{ fontSize: 12, color: "#64748b", padding: "4px 0" }}>
              {r.staff.name}：{r.exclusion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SanteiTableRow({ r, updateRow, updateMonth }: {
  r: SanteiRow;
  updateRow: ReturnType<typeof useSanteiManager>["updateRow"];
  updateMonth: ReturnType<typeof useSanteiManager>["updateMonth"];
}) {
  const { result } = r;
  const changed = result.standard !== r.previous;
  const gradeDiff = result.grade !== null && r.previousGrade !== null ? result.grade - r.previousGrade : null;

  return (
    <tr>
      <td style={td}>
        <input type="checkbox" checked={r.selected} onChange={(e) => updateRow(r.staff.id, { selected: e.target.checked })} />
      </td>
      <td style={td}>
        <div style={{ fontWeight: "bold" }}>{r.staff.name}</div>
        <select
          value={r.kind}
          onChange={(e) => updateRow(r.staff.id, { kind: e.target.value as SanteiWorkerKind })}
          style={{ marginTop: 4, fontSize: 11, padding: "2px 4px", border: "1px solid #ddd", borderRadius: 4, maxWidth: 170 }}
        >
          {(Object.keys(SANTEI_WORKER_KIND_LABELS) as SanteiWorkerKind[]).map((k) => (
            <option key={k} value={k}>{SANTEI_WORKER_KIND_LABELS[k]}</option>
          ))}
        </select>
        {r.unfinalizedMonths.length > 0 && (
          <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>{r.unfinalizedMonths.join("・")}月の給与が未確定</div>
        )}
        {r.registered !== null && (
          <div style={{ fontSize: 11, color: "#16a34a", marginTop: 4 }}>登録済み（{yen(r.registered)}）</div>
        )}
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {yen(r.previous)}
        {r.previousGrade !== null && <div style={{ fontSize: 11, color: "#94a3b8" }}>{r.previousGrade}等級</div>}
      </td>
      {r.months.map((m) => {
        const used = result.usedMonths.includes(m.month);
        return (
          <td key={m.month} style={{ ...td, backgroundColor: used ? "#f0f9ff" : undefined }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="number" min={0} value={m.days ?? ""} placeholder="日数"
                onChange={(e) => updateMonth(r.staff.id, m.month, { days: toNumberOrNull(e.target.value) })}
                style={{ ...numInput, width: 46 }}
              />
              <input
                type="number" min={0} value={m.amount ?? ""} placeholder="報酬"
                onChange={(e) => updateMonth(r.staff.id, m.month, { amount: toNumberOrNull(e.target.value) })}
                style={numInput}
              />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: m.partialJoin ? "#b45309" : "#94a3b8", marginTop: 4 }}>
              <input type="checkbox" checked={m.partialJoin} onChange={(e) => updateMonth(r.staff.id, m.month, { partialJoin: e.target.checked })} />
              途中入社で日割り
            </label>
            {!used && m.amount !== null && <div style={{ fontSize: 11, color: "#94a3b8" }}>平均に入れない</div>}
          </td>
        );
      })}
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {result.average === null ? (
          <span style={{ fontSize: 12, color: "#94a3b8" }}>使える月なし</span>
        ) : (
          <>
            {yen(result.average)}
            {result.method === "part15" && <div style={{ fontSize: 11, color: "#64748b" }}>15日以上の月で計算</div>}
          </>
        )}
      </td>
      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: "bold", color: changed ? "#2563eb" : "#334155" }}>
        {yen(result.standard)}
        <div style={{ fontSize: 11, fontWeight: "normal", color: "#64748b" }}>
          {result.method === "keep" ? "従前のまま" : `${result.grade}等級`}
          {gradeDiff !== null && gradeDiff !== 0 && `（${gradeDiff > 0 ? "+" : ""}${gradeDiff}）`}
        </div>
      </td>
    </tr>
  );
}
