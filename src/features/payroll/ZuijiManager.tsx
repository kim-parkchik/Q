/**
 * 月変（随時改定）
 * 固定的賃金が変わった月から3か月の給与で、標準報酬月額が2等級以上変わる人を探し、4か月目の分から履歴に登録する。
 * 年間平均額（3か月の固定的賃金の平均 ＋ 12か月の非固定的賃金の平均）と2等級以上の差がある人は、年間平均で申し立てることもできる。
 * 判定のきまりは utils/zuiji.ts（年間平均は utils/zuijiAnnual.ts）
 */
import { useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useZuijiManager, type ZuijiRow } from "./useZuijiManager";
import { ZUIJI_STATUS_LABELS, type ZuijiDirection } from "../../utils/zuiji";
import { ymOf } from "../../utils/santeiAnnual";
import { ZUIJI_ANNUAL_STATUS_LABELS, type ZuijiAnnualStatus } from "../../utils/zuijiAnnual";

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

const linkButton: React.CSSProperties = { marginTop: 4, padding: 0, border: "none", background: "none", color: "#2563eb", fontSize: 11, cursor: "pointer", textDecoration: "underline" };

/** 判定の欄に出す、年間平均の短い結果 */
const ANNUAL_SHORT_LABELS: Record<ZuijiAnnualStatus, string> = {
  target: "年間平均との差が2等級以上",
  keep: "年間平均との差が2等級以上（申し立てると改定しない）",
  small: "年間平均との差は1等級以下",
  not_zuiji: "",
  no_earlier: "年間平均：前の9か月に使える月なし",
  split_missing: "年間平均：非固定的賃金が未入力の月あり",
};

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
          確定した給与の基本給（時給制は時給）か固定残業代が前の月と変わった月を「変動月」として、変動月から3か月の給与（通勤手当を含む）の平均で判定します。
          従前の標準報酬月額と2等級以上の差があり、3か月とも支払基礎日数が17日以上（短時間労働者は11日以上）なら、4か月目の分から改定します。
          固定残業代は、追加・廃止・金額の変更を変動として扱います（このバージョンより前に確定した月の固定残業代はわからないので、その月とは比べません）。
          そのほかの手当・通勤手当の変更や、時給から月給への変更は自動で見つけられないので、下の欄で変動月を指定してください。月額変更届は「速やかに」提出します。
        </p>
        <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.7 }}>
          随時改定に当たる人は、年間平均額（変動月から3か月の固定的賃金の平均 ＋ 変動月の前の9か月と変動月から3か月の非固定的賃金の平均）とも比べます。
          2等級以上の差があり、その差が仕事の性質上毎年出るもの（毎年決まった時期に残業が多いなど）で、本人が同意したときは、年間平均で申し立てられます。
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
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={7}>{z.year}年に基本給・固定残業代が変わった人はいません</td></tr>
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
  const [open, setOpen] = useState(false);
  const j = r.judgement;
  const a = r.annual;
  const [ry, rm] = r.revisionFrom.split("-").map(Number);
  const canRegister = r.decided.standard !== null &&
    (r.decided.byAnnual ? a.status === "target" : j.status === "target" || j.boundaryNote !== null);

  return (
    <>
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
            : [
                r.baseWageBefore !== null && `基本給 ${r.baseWageBefore.toLocaleString()} → ${r.baseWageAfter?.toLocaleString()}円`,
                r.fixedOvertimeBefore !== null && `固定残業代 ${r.fixedOvertimeBefore.toLocaleString()} → ${r.fixedOvertimeAfter?.toLocaleString()}円`,
              ].filter(Boolean).map((t) => <div key={t as string}>{t}</div>)}
        </div>
        {r.note && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4, whiteSpace: "normal", maxWidth: 220 }}>⚠ {r.note}</div>}
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
        {r.decided.noRevision ? (
          <>
            {yen(r.previous)} → <b>改定しない</b>
            <div style={{ fontSize: 11, color: "#b45309" }}>年間平均で申し立てると従前のまま</div>
          </>
        ) : r.decided.byAnnual ? (
          <>
            {yen(r.previous)} → <b>{yen(a.standard)}</b>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {j.previousGrade ?? "—"}等級 → {a.grade ?? "—"}等級
              {a.gradeDiffFromPrevious !== null && `（${a.gradeDiffFromPrevious > 0 ? "+" : ""}${a.gradeDiffFromPrevious}）`}
            </div>
            <div style={{ fontSize: 11, color: "#b45309" }}>年間平均で決定</div>
          </>
        ) : (
          <>
            {yen(r.previous)} → <b>{yen(j.standard)}</b>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {j.previousGrade ?? "—"}等級 → {j.grade ?? "—"}等級
              {j.gradeDiff !== null && `（${j.gradeDiff > 0 ? "+" : ""}${j.gradeDiff}）`}
            </div>
          </>
        )}
      </td>
      <td style={{ ...td, color: STATUS_COLORS[j.status], fontWeight: j.status === "target" ? "bold" : "normal", maxWidth: 220 }}>
        {ZUIJI_STATUS_LABELS[j.status]}
        {j.status === "target" && <div style={{ fontSize: 11, fontWeight: "normal" }}>{ry}年{rm}月分から改定</div>}
        {j.boundaryNote && <div style={{ fontSize: 11, color: "#b45309", fontWeight: "normal" }}>{j.boundaryNote}</div>}
        {r.registered !== null && <div style={{ fontSize: 11, color: "#16a34a", fontWeight: "normal" }}>登録済み（{yen(r.registered)}）</div>}
        {a.status !== "not_zuiji" && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e2e8f0", fontWeight: "normal" }}>
            <div style={{ fontSize: 11, color: a.status === "target" || a.status === "keep" ? "#b45309" : "#64748b" }}>
              {a.average !== null && <>年間平均 {yen(a.average)} → {yen(a.standard)}（{a.grade}等級）<br /></>}
              {ANNUAL_SHORT_LABELS[a.status]}
            </div>
            {(a.status === "target" || a.status === "keep") && (
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#334155", marginTop: 4 }}>
                <input type="checkbox" checked={r.annualRequested} onChange={(e) => z.setAnnualRequested(r.key, e.target.checked)} />
                年間平均で申し立てる
              </label>
            )}
            <button type="button" onClick={() => setOpen(!open)} style={linkButton}>
              {open ? "12か月を閉じる" : "12か月を見る"}
            </button>
          </div>
        )}
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
    {open && a.status !== "not_zuiji" && (
      <tr>
        <td colSpan={7} style={{ padding: "6px 6px 16px 6px", borderBottom: "1px solid #f1f5f9", backgroundColor: "#f8fafc" }}>
          <ZuijiAnnualPanel r={r} z={z} />
        </td>
      </tr>
    )}
    </>
  );
}

/** 年間平均に使う12か月と、3か月の平均との比べ（月額変更届に付ける様式2に書く数字） */
function ZuijiAnnualPanel({ r, z }: { r: ZuijiRow; z: ReturnType<typeof useZuijiManager> }) {
  const a = r.annual;
  const j = r.judgement;
  const box: React.CSSProperties = { width: 160, padding: 6, border: "1px solid #e2e8f0", borderRadius: 6 };
  const small: React.CSSProperties = { fontSize: 11, color: "#94a3b8", marginTop: 4 };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: "bold", color: "#475569", margin: "4px 0 8px 0" }}>
        変動月の前の9か月と、変動月から3か月に支払った給与（日数／報酬／うち非固定的賃金）
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.annualMonths.map((m, i) => {
          const after = i >= 9;
          const used = a.usedMonths.includes(ymOf(m.year, m.month));
          const missing = m.nonFixed === null && !m.notInsured && m.amount !== null;
          return (
            <div key={`${m.year}-${m.month}`} style={{ ...box, backgroundColor: used ? "#f0f9ff" : "white", borderColor: after ? "#93c5fd" : "#e2e8f0" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                {m.year}年{m.month}月{after && `（変動月から${i - 8}か月目）`}
              </div>
              {after ? (
                <div style={{ fontSize: 12 }}>{m.days ?? "—"}日／{yen(m.amount)}</div>
              ) : (
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" min={0} value={m.days ?? ""} placeholder="日数" disabled={m.notInsured}
                    onChange={(e) => z.updateAnnualMonth(r.key, m.year, m.month, { days: toNumberOrNull(e.target.value) })}
                    style={{ ...numInput, width: 42 }} />
                  <input type="number" min={0} value={m.amount ?? ""} placeholder="報酬" disabled={m.notInsured}
                    onChange={(e) => z.updateAnnualMonth(r.key, m.year, m.month, { amount: toNumberOrNull(e.target.value) })}
                    style={numInput} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>非固定</span>
                <input type="number" min={0} value={m.nonFixed ?? ""} placeholder="未入力" disabled={m.notInsured}
                  onChange={(e) => z.updateAnnualMonth(r.key, m.year, m.month, { nonFixed: toNumberOrNull(e.target.value) })}
                  style={{ ...numInput, borderColor: missing ? "#f59e0b" : "#ddd" }} />
              </div>
              {after && m.amount !== null && m.nonFixed !== null && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>固定的賃金 {yen(Math.max(0, m.amount - m.nonFixed))}</div>
              )}
              {m.notInsured ? <div style={small}>入社前・社会保険に未加入</div>
                : m.partialJoin ? <div style={{ ...small, color: "#b45309" }}>途中入社の月（入れない）</div>
                : m.unfinalized && m.amount === null ? <div style={{ ...small, color: "#b45309" }}>給与が未確定</div>
                : missing ? <div style={{ ...small, color: "#b45309" }}>非固定的賃金を入れてください</div>
                : !used && m.amount !== null && a.average !== null ? <div style={small}>平均に入れない</div>
                : null}
            </div>
          );
        })}
      </div>

      <table style={{ borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
        <tbody>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>3か月の固定的賃金</td>
            <td style={{ padding: "3px 0" }}>{a.fixedAverage === null ? "—" : <>合計 {yen(a.fixedTotal)} ÷ 3か月 ＝ 平均 {yen(a.fixedAverage)}</>}</td>
          </tr>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>12か月の非固定的賃金</td>
            <td style={{ padding: "3px 0" }}>{a.nonFixedAverage === null ? "—" : <>合計 {yen(a.nonFixedTotal)} ÷ {a.usedMonths.length}か月 ＝ 平均 {yen(a.nonFixedAverage)}</>}</td>
          </tr>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>年間平均額</td>
            <td style={{ padding: "3px 0" }}>
              {a.average === null ? "—" : <>{yen(a.fixedAverage)} ＋ {yen(a.nonFixedAverage)} ＝ {yen(a.average)} → 標準報酬月額 <b>{yen(a.standard)}</b>（{a.grade}等級）</>}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>3か月の平均（通常）</td>
            <td style={{ padding: "3px 0" }}>{yen(j.average)} → 標準報酬月額 <b>{yen(j.standard)}</b>（{j.grade}等級）</td>
          </tr>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>従前</td>
            <td style={{ padding: "3px 0" }}>{yen(r.previous)}（{j.previousGrade ?? "—"}等級）</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, marginTop: 6, color: a.status === "target" || a.status === "keep" ? "#b45309" : "#64748b", fontWeight: a.status === "target" ? "bold" : "normal" }}>
        {ZUIJI_ANNUAL_STATUS_LABELS[a.status]}
      </div>
      <p style={{ fontSize: 11, color: "#64748b", margin: "8px 0 0 0", lineHeight: 1.7 }}>
        非固定的賃金は、残業代・休日や深夜の手当・皆勤手当など、働いた実績で額が変わるものです（基本給・時給×時間・役職手当・家族手当・住宅手当・通勤手当・固定残業代は固定的賃金）。
        Q では、確定した給与の残業代・休日や深夜の手当・「変動（毎月入力）」の支給項目の合計を初めの値にしています。名称でなく実態で決まるので、違えば直してください。
        非固定的賃金の平均に入れるのは、支払基礎日数が{a.minDays}日以上の月です。月の途中に入社した月と、社会保険に入る前の月は入れません。
        低額の休職給・ストライキの賃金カット・一時帰休の休業手当を受けた月は、報酬を空欄にしてください。
        上限・下限の等級は、表の外にもう1つ等級があるものとして差を数えます。
      </p>
      {(a.status === "target" || a.status === "keep") && (
        <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.7 }}>
          年間平均にできるのは、この差が仕事の性質上毎年出る見込みで、本人が同意したときだけです。
          その年だけの特別な昇給、一時的な繁忙と昇給の重なり、転居による通勤手当の変更、一時帰休の休業手当による改定は対象になりません。
          申し立てるときは、月額変更届の備考欄に「年間平均」と書き、（様式1）年間報酬の平均で算定することの申立書（随時改定用）と、
          （様式2）保険者算定申立に係る例年の状況、標準報酬月額の比較及び被保険者の同意等（随時改定用）を付けます（日本年金機構のホームページにあります）。
        </p>
      )}
    </div>
  );
}
