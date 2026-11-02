/**
 * 算定基礎（定時決定）
 * 確定した4〜6月の給与から、9月分からの標準報酬月額を計算し、従業員の履歴に登録する。
 * 前年7月〜当年6月の平均と2等級以上の差がある人は、年間報酬の平均で申し立てることもできる。
 * 計算のきまりは utils/santei.ts（年間平均は utils/santeiAnnual.ts）
 */
import { useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useSanteiManager, type SanteiRow } from "./useSanteiManager";
import { SANTEI_WORKER_KIND_LABELS, type SanteiWorkerKind } from "../../utils/santei";
import { ANNUAL_STATUS_LABELS, ymOf, type AnnualStatus } from "../../utils/santeiAnnual";

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
const linkButton: React.CSSProperties = { marginTop: 4, padding: 0, border: "none", background: "none", color: "#2563eb", fontSize: 11, cursor: "pointer", textDecoration: "underline" };

/** 年間平均の欄に出す短い理由 */
const ANNUAL_SHORT_LABELS: Record<AnnualStatus, string> = {
  target: "",
  small: "差が1等級以下",
  keep: "4〜6月に使える月なし",
  no_earlier: "前年7月〜3月に使える月なし",
};

/** 空欄は null（その月は給与を支払っていない扱い） */
const toNumberOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));

export default function SanteiManager({ db, staffList, onDataChange }: Props) {
  const { year, setYear, isLoading, isSaving, targets, excluded, selectedRows, updateRow, updateMonth, updateEarlierMonth, register, rateWarnings } =
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
        <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.7 }}>
          「年間平均」の欄は、前年7月〜当年6月の1年間の平均です。4〜6月の平均と2等級以上の差があり、その差が仕事の性質上毎年出るもの
          （毎年4〜6月が繁忙期・閑散期など）で、本人が同意したときは、年間報酬の平均で決めるよう申し立てられます。
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
                <th style={th}>年間平均</th>
                <th style={th}>9月分から</th>
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 && !isLoading && (
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={9}>対象になる人がいません</td></tr>
              )}
              {targets.map((r) => (
                <SanteiTableRow key={r.staff.id} r={r} year={year} updateRow={updateRow} updateMonth={updateMonth} updateEarlierMonth={updateEarlierMonth} />
              ))}
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

function SanteiTableRow({ r, year, updateRow, updateMonth, updateEarlierMonth }: {
  r: SanteiRow;
  year: number;
  updateRow: ReturnType<typeof useSanteiManager>["updateRow"];
  updateMonth: ReturnType<typeof useSanteiManager>["updateMonth"];
  updateEarlierMonth: ReturnType<typeof useSanteiManager>["updateEarlierMonth"];
}) {
  const [open, setOpen] = useState(false);
  const { result, annual, decided } = r;
  const changed = decided.standard !== r.previous;
  const gradeDiff = decided.grade !== null && r.previousGrade !== null ? decided.grade - r.previousGrade : null;

  return (
    <>
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
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {annual.average !== null && (
          <>
            {yen(annual.average)}
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {yen(annual.standard)}・{annual.grade}等級
            </div>
          </>
        )}
        {annual.status === "target" ? (
          <>
            <div style={{ fontSize: 11, color: "#b45309" }}>
              4〜6月と{Math.abs(annual.gradeDiff!)}等級の差
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#334155", marginTop: 4 }}>
              <input type="checkbox" checked={r.annualRequested} onChange={(e) => updateRow(r.staff.id, { annualRequested: e.target.checked })} />
              年間平均で申し立てる
            </label>
          </>
        ) : (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{ANNUAL_SHORT_LABELS[annual.status]}</div>
        )}
        <button type="button" onClick={() => setOpen(!open)} style={linkButton}>
          {open ? "12か月を閉じる" : "12か月を見る"}
        </button>
      </td>
      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: "bold", color: changed ? "#2563eb" : "#334155" }}>
        {yen(decided.standard)}
        <div style={{ fontSize: 11, fontWeight: "normal", color: "#64748b" }}>
          {!decided.byAnnual && result.method === "keep" ? "従前のまま" : `${decided.grade}等級`}
          {gradeDiff !== null && gradeDiff !== 0 && `（${gradeDiff > 0 ? "+" : ""}${gradeDiff}）`}
        </div>
        {decided.byAnnual && <div style={{ fontSize: 11, fontWeight: "normal", color: "#b45309" }}>年間平均で決定</div>}
      </td>
    </tr>
    {open && (
      <tr>
        <td colSpan={9} style={{ padding: "6px 6px 16px 6px", borderBottom: "1px solid #f1f5f9", backgroundColor: "#f8fafc" }}>
          <AnnualPanel r={r} year={year} updateEarlierMonth={updateEarlierMonth} />
        </td>
      </tr>
    )}
    </>
  );
}

/** 前年7月〜当年6月の12か月と、4〜6月の平均との比べ（算定基礎届の様式2に書く数字） */
function AnnualPanel({ r, year, updateEarlierMonth }: {
  r: SanteiRow;
  year: number;
  updateEarlierMonth: ReturnType<typeof useSanteiManager>["updateEarlierMonth"];
}) {
  const { result, annual } = r;
  const box: React.CSSProperties = { width: 150, padding: 6, border: "1px solid #e2e8f0", borderRadius: 6, backgroundColor: "white" };
  const label = (y: number, m: number) => `${y}年${m}月`;
  const usedCount = annual.usedMonths.length;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: "bold", color: "#475569", margin: "4px 0 8px 0" }}>
        前年7月〜当年6月に支払った給与（日数／報酬）
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.earlierMonths.map((m) => {
          const used = annual.usedMonths.includes(ymOf(m.year, m.month));
          return (
            <div key={`${m.year}-${m.month}`} style={{ ...box, backgroundColor: used ? "#f0f9ff" : "white" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label(m.year, m.month)}</div>
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  type="number" min={0} value={m.days ?? ""} placeholder="日数" disabled={m.notInsured}
                  onChange={(e) => updateEarlierMonth(r.staff.id, m.year, m.month, { days: toNumberOrNull(e.target.value) })}
                  style={{ ...numInput, width: 42 }}
                />
                <input
                  type="number" min={0} value={m.amount ?? ""} placeholder="報酬" disabled={m.notInsured}
                  onChange={(e) => updateEarlierMonth(r.staff.id, m.year, m.month, { amount: toNumberOrNull(e.target.value) })}
                  style={numInput}
                />
              </div>
              {m.notInsured ? (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>入社前・社会保険に未加入</div>
              ) : (
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: m.partialJoin ? "#b45309" : "#94a3b8", marginTop: 4 }}>
                  <input type="checkbox" checked={m.partialJoin} onChange={(e) => updateEarlierMonth(r.staff.id, m.year, m.month, { partialJoin: e.target.checked })} />
                  途中入社で日割り
                </label>
              )}
              {!m.notInsured && m.unfinalized && m.amount === null && <div style={{ fontSize: 11, color: "#b45309" }}>給与が未確定</div>}
              {!used && !m.notInsured && m.amount !== null && <div style={{ fontSize: 11, color: "#94a3b8" }}>平均に入れない</div>}
            </div>
          );
        })}
        {r.months.map((m) => {
          const used = annual.usedMonths.includes(ymOf(year, m.month));
          return (
            <div key={m.month} style={{ ...box, backgroundColor: used ? "#f0f9ff" : "white" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label(year, m.month)}</div>
              <div style={{ fontSize: 12 }}>{m.days ?? "—"}日／{yen(m.amount)}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                {used ? "上の行で直せます" : m.amount !== null ? "平均に入れない" : "給与なし"}
              </div>
            </div>
          );
        })}
      </div>

      <table style={{ borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
        <tbody>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>前年7月〜当年6月</td>
            <td style={{ padding: "3px 0" }}>
              {annual.average === null ? "—" : (
                <>合計 {yen(annual.total)} ÷ {usedCount}か月 ＝ 平均 {yen(annual.average)} → 標準報酬月額 <b>{yen(annual.standard)}</b>（{annual.grade}等級）</>
              )}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "3px 10px 3px 0", color: "#64748b" }}>当年4〜6月</td>
            <td style={{ padding: "3px 0" }}>
              {result.average === null ? "—" : (
                <>合計 {yen(result.total)} ÷ {result.usedMonths.length}か月 ＝ 平均 {yen(result.average)} → 標準報酬月額 <b>{yen(result.standard)}</b>（{result.grade}等級）</>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, marginTop: 6, color: annual.status === "target" ? "#b45309" : "#64748b", fontWeight: annual.status === "target" ? "bold" : "normal" }}>
        {ANNUAL_STATUS_LABELS[annual.status]}
        {annual.gradeDiff !== null && `（等級の差：${Math.abs(annual.gradeDiff)}）`}
      </div>
      <p style={{ fontSize: 11, color: "#64748b", margin: "8px 0 0 0", lineHeight: 1.7 }}>
        平均に入れるのは、支払基礎日数が{annual.minDays}日以上の月です。月の途中に入社した月と、社会保険に入る前の月は入れません。
        低額の休職給・ストライキの賃金カット・一時帰休の休業手当を受けた月は、報酬を空欄にしてください。
        前年6月分以前の給与の遅配分は引き、本来の給与の一部が当年7月以後に支払われた月は空欄にしてください。
        上限・下限の等級は、表の外にもう1つ等級があるものとして差を数えます（1等級の差でも対象になることがあります）。
      </p>
      {annual.status === "target" && (
        <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.7 }}>
          年間平均で決められるのは、この差が仕事の性質上毎年出る見込みで、本人が同意したときだけです。その年だけの一時的な繁忙などは対象になりません。
          前の年度の算定を開くと、前の年にも同じような差があったか確かめられます。
          申し立てるときは、算定基礎届の備考欄で「年間平均」とし、（様式1）年間報酬の平均で算定することの申立書と、
          （様式2）保険者算定申立に係る例年の状況、標準報酬月額の比較及び被保険者の同意等を付けます（日本年金機構のホームページにあります）。
          同意は毎年もらいます。
        </p>
      )}
    </div>
  );
}
