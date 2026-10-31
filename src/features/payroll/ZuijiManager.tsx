/**
 * 月変（随時改定）
 * 固定的賃金が変わった月から3か月の給与で、標準報酬月額が2等級以上変わる人を探し、4か月目の分から履歴に登録する。
 * 判定のきまりは utils/zuiji.ts
 */
import { useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useZuijiManager, type ZuijiRow } from "./useZuijiManager";
import { ZUIJI_STATUS_LABELS, type ZuijiDirection } from "../../utils/zuiji";

interface Props {
  db: Database;
  staffList: any[];
  onDataChange: () => void;
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const th: React.CSSProperties = { padding: "8px 6px", fontSize: 12, color: "#64748b", borderBottom: "2px solid #eee", textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 13, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const numInput: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, textAlign: "right" };
const select: React.CSSProperties = { padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 };
const yen = (n: number | null) => (n === null ? "—" : `${n.toLocaleString()}円`);
const toNumberOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));

const STATUS_COLORS: Record<string, string> = {
  target: "#2563eb", small: "#64748b", direction: "#64748b", days: "#64748b", pending: "#b45309", not_enrolled: "#94a3b8",
};

export default function ZuijiManager({ db, staffList, onDataChange }: Props) {
  const z = useZuijiManager(db, staffList, onDataChange);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2020 + 2 }, (_, i) => 2020 + i);

  // 変動月を手で指定する欄
  const [manualStaffId, setManualStaffId] = useState("");
  const [manualMonth, setManualMonth] = useState(1);
  const [manualDirection, setManualDirection] = useState<ZuijiDirection>("up");
  const activeStaff = staffList.filter((s) => !s.retirement_date || s.retirement_date >= `${z.year}-01-01`);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select value={z.year} onChange={(e) => z.setYear(Number(e.target.value))} style={select}>
            {years.map((y) => <option key={y} value={y}>{y}年に固定的賃金が変わった人</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 }}>
          確定した給与の基本給（時給制は時給）が前の月と変わった月を「変動月」として、変動月から3か月の給与（通勤手当を含む）の平均で判定します。
          従前の標準報酬月額と2等級以上の差があり、3か月とも支払基礎日数が17日以上（短時間労働者は11日以上）なら、4か月目の分から改定します。
          手当・通勤手当の変更や、時給から月給への変更は自動で見つけられないので、下の欄で変動月を指定してください。月額変更届は「速やかに」提出します。
        </p>
      </div>

      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>氏名</th>
                <th style={th}>変動月</th>
                <th style={{ ...th, minWidth: 360 }}>変動月から3か月の給与（日数／報酬）</th>
                <th style={th}>平均</th>
                <th style={th}>従前 → 改定後</th>
                <th style={th}>判定</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {z.rows.length === 0 && !z.isLoading && (
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={7}>{z.year}年に基本給が変わった人はいません</td></tr>
              )}
              {z.rows.map((r) => <ZuijiTableRow key={r.key} r={r} z={z} />)}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#475569", marginBottom: 8 }}>変動月を指定して確かめる（手当の変更など）</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={manualStaffId} onChange={(e) => setManualStaffId(e.target.value)} style={select}>
            <option value="">従業員を選ぶ</option>
            {activeStaff.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <span style={{ fontSize: 13 }}>{z.year}年</span>
          <select value={manualMonth} onChange={(e) => setManualMonth(Number(e.target.value))} style={select}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}月に支払った給与から</option>)}
          </select>
          <select value={manualDirection} onChange={(e) => setManualDirection(e.target.value as ZuijiDirection)} style={select}>
            <option value="up">固定的賃金が上がった</option>
            <option value="down">固定的賃金が下がった</option>
          </select>
          <button
            disabled={!manualStaffId}
            onClick={() => z.addManual({ staffId: manualStaffId, year: z.year, month: manualMonth, direction: manualDirection })}
            style={{ padding: "7px 14px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", backgroundColor: manualStaffId ? "#2563eb" : "#cbd5e1", cursor: manualStaffId ? "pointer" : "not-allowed" }}
          >
            一覧に加える
          </button>
        </div>
      </div>
    </div>
  );
}

function ZuijiTableRow({ r, z }: { r: ZuijiRow; z: ReturnType<typeof useZuijiManager> }) {
  const j = r.judgement;
  const [ry, rm] = r.revisionFrom.split("-").map(Number);
  const canRegister = j.standard !== null && (j.status === "target" || j.boundaryNote !== null);

  return (
    <tr>
      <td style={td}>
        <div style={{ fontWeight: "bold" }}>{r.staff.name}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", marginTop: 4 }}>
          <input type="checkbox" checked={r.short} onChange={(e) => z.setShort(r.key, e.target.checked)} />
          短時間労働者（11日）
        </label>
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {r.year}年{r.month}月
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {r.manual
            ? `手で指定（${r.direction === "up" ? "上がった" : "下がった"}）`
            : `基本給 ${r.baseWageBefore?.toLocaleString()} → ${r.baseWageAfter?.toLocaleString()}円`}
        </div>
        {r.manual && (
          <button onClick={() => z.removeManual(r.key)} style={{ marginTop: 4, fontSize: 11, border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: 0 }}>
            一覧から外す
          </button>
        )}
      </td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6 }}>
          {r.months.map((m, i) => (
            <div key={i} style={{ flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{m.year}年{m.month}月</div>
              <div style={{ display: "flex", gap: 3 }}>
                <input type="number" min={0} value={m.days ?? ""} placeholder="日数"
                  onChange={(e) => z.updateMonth(r.key, i, { days: toNumberOrNull(e.target.value) })} style={{ ...numInput, width: 40 }} />
                <input type="number" min={0} value={m.amount ?? ""} placeholder="報酬"
                  onChange={(e) => z.updateMonth(r.key, i, { amount: toNumberOrNull(e.target.value) })} style={numInput} />
              </div>
            </div>
          ))}
        </div>
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>{yen(j.average)}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {yen(r.previous)} → <b>{yen(j.standard)}</b>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {j.previousGrade ?? "—"}等級 → {j.grade ?? "—"}等級
          {j.gradeDiff !== null && `（${j.gradeDiff > 0 ? "+" : ""}${j.gradeDiff}）`}
        </div>
      </td>
      <td style={{ ...td, color: STATUS_COLORS[j.status], fontWeight: j.status === "target" ? "bold" : "normal", maxWidth: 220 }}>
        {ZUIJI_STATUS_LABELS[j.status]}
        {j.status === "target" && <div style={{ fontSize: 11, fontWeight: "normal" }}>{ry}年{rm}月分から改定</div>}
        {j.boundaryNote && <div style={{ fontSize: 11, color: "#b45309", fontWeight: "normal" }}>{j.boundaryNote}</div>}
        {r.registered !== null && <div style={{ fontSize: 11, color: "#16a34a", fontWeight: "normal" }}>登録済み（{yen(r.registered)}）</div>}
      </td>
      <td style={td}>
        {canRegister && (
          <button
            onClick={() => z.register(r)}
            disabled={z.savingKey === r.key}
            style={{ padding: "6px 10px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", fontSize: 12, backgroundColor: "#2563eb", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {ry}年{rm}月分から登録
          </button>
        )}
      </td>
    </tr>
  );
}
