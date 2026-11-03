/**
 * 年末調整（令和8年分から）
 * 左：従業員の一覧（対象かどうか・保存した過不足額）、右：申告書の内容の入力と、年税額・過不足額
 */
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { NENCHO_YEARS, settleOptions, useNenchoManager, type NenchoStaffRow } from "./useNenchoManager";
import NenchoDeclarationForm from "./NenchoDeclarationForm";
import NenchoResultPanel from "./NenchoResultPanel";
import { toTaxColumn } from "../../utils/incomeTax";

interface Props {
  db: Database;
  staffList: any[];
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 16, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const yen = (n: number) => `${n.toLocaleString()}円`;

export default function NenchoManager({ db, staffList }: Props) {
  const z = useNenchoManager(db, staffList);

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select value={z.year} onChange={(e) => z.setYear(Number(e.target.value))} style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }}>
            {NENCHO_YEARS.map((y) => <option key={y} value={y}>{y}年分（令和{y - 2018}年分）</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 }}>
          従業員から提出された申告書の内容を入れると、その年に確定した給与・賞与の合計から年税額を計算し、源泉徴収した税額との過不足を出します。
          計算は国税庁「令和8年分 年末調整のしかた」の表と計算式によります（令和8年度税制改正の基礎控除の引上げなどを含みます）。
          令和7年分以前は、表を用意していないため計算できません。源泉徴収票は「源泉徴収票」の画面で作ります。
          <br />過不足額の精算の手順：①その年最後（12月）の給与を、いつもどおり確定する → ②ここで申告書を入れて保存する →
          ③12月の給与明細を開き直すと過不足額（還付・徴収）が載るので、もう一度確定する（12月の給与の税額計算を省略しない方法）。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
        {/* 従業員の一覧 */}
        <div style={{ ...card, padding: 8 }}>
          {z.rows.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", padding: 8 }}>{z.year}年に在籍した人がいません</div>}
          {z.rows.map((r) => {
            const active = z.selected && String(z.selected.staff.id) === String(r.staff.id);
            const diff = r.saved?.result?.difference;
            return (
              <button
                key={r.staff.id}
                onClick={() => z.select(String(r.staff.id))}
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 6, padding: "8px 10px", marginBottom: 2,
                  cursor: "pointer", backgroundColor: active ? "#eff6ff" : "transparent",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: "bold", color: r.exclusion ? "#94a3b8" : "#1e293b" }}>{r.staff.name}</div>
                <div style={{ fontSize: 11, color: r.exclusion ? "#94a3b8" : diff === undefined ? "#b45309" : "#64748b" }}>
                  {r.exclusion ? (r.saved ? "対象外・申告書あり" : "対象外")
                    : diff === undefined ? "未入力"
                    : diff >= 0 ? `還付 ${yen(diff)}` : `徴収 ${yen(-diff)}`}
                  {r.saved && !r.exclusion && <span style={{ color: statusColor(r) }}>・{statusLabel(r)}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* 選んだ人 */}
        {!z.selected ? (
          <div style={{ ...card, color: "#94a3b8", fontSize: 13 }}>左の一覧から従業員を選んでください。</div>
        ) : z.selected.exclusion && ["kou", "otsu"].includes(toTaxColumn(z.selected.staff.tax_column)) && z.master && z.draft ? (
          // 年末調整をしない甲欄の人（年の途中で退職した人など）：扶養控除等申告書の内容だけを入れる（源泉徴収票の配偶者・扶養親族の欄に書く）
          // 乙欄の人：従たる給与についての扶養控除等申告書の内容（源泉徴収票の「従」の欄に書く）
          <div style={card}>
            {toTaxColumn(z.selected.staff.tax_column) === "otsu" ? (
              <>
                <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 6 }}>{z.selected.staff.name}さん（{z.year}年分）：従たる給与についての扶養控除等申告書の内容</div>
                <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 6px 0" }}>※ {z.selected.exclusion}</p>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0", lineHeight: 1.7 }}>
                  乙欄の人が「従たる給与についての扶養控除等（異動）申告書」を出していれば、この給与で控除する源泉控除対象配偶者・源泉控除対象親族を、
                  源泉徴収票・給与支払報告書の「従有」と人数の「従」の欄、氏名の欄に書きます（所得税法195条、国税庁「法定調書の作成と提出の手引」）。
                  出していない人は、入れる必要はありません。乙欄の税額は、従業員の画面の扶養人数（扶養親族等1人につき1,610円引く）で計算します。
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 6 }}>{z.selected.staff.name}さん（{z.year}年分）：扶養控除等申告書の内容</div>
                <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 6px 0" }}>※ {z.selected.exclusion}</p>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0", lineHeight: 1.7 }}>
                  年末調整をしない人の源泉徴収票・給与支払報告書にも、出してもらった「給与所得者の扶養控除等（異動）申告書」の記載に応じて、
                  源泉控除対象配偶者・控除対象扶養親族等の人数と氏名、16歳未満の扶養親族、障害者の人数を書きます（国税庁「法定調書の作成と提出の手引」）。
                  申告書の内容を入れて保存してください（年末調整の計算はしません）。
                </p>
              </>
            )}
            <NenchoDeclarationForm year={z.year} master={z.master} draft={z.draft} setDraft={z.setDraft} totals={z.selected.totals} sourceOnly
              secondary={toTaxColumn(z.selected.staff.tax_column) === "otsu"} />
            {z.errors.map((e) => <div key={e} style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>{e}</div>)}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <button
                onClick={z.saveSource}
                disabled={z.isSaving || z.errors.length > 0}
                style={{
                  padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white",
                  cursor: z.errors.length > 0 ? "not-allowed" : "pointer", backgroundColor: z.errors.length > 0 ? "#cbd5e1" : "#2563eb",
                }}
              >
                {z.isSaving ? "保存中…" : "申告書の内容を保存"}
              </button>
              {z.selected.saved && <span style={{ fontSize: 11, color: "#64748b" }}>最後に保存：{z.selected.saved.updatedAt}</span>}
            </div>
          </div>
        ) : z.selected.exclusion ? (
          <div style={{ ...card, fontSize: 13, color: "#b45309" }}>{z.selected.staff.name}さん：{z.selected.exclusion}</div>
        ) : z.master && z.draft && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 10 }}>{z.selected.staff.name}さん（{z.year}年分）</div>
              {z.selected.note && <p style={{ fontSize: 12, color: "#b45309", margin: "0 0 10px 0" }}>※ {z.selected.note}</p>}
              <NenchoDeclarationForm year={z.year} master={z.master} draft={z.draft} setDraft={z.setDraft} totals={z.selected.totals} />
            </div>
            <div style={{ ...card, position: "sticky", top: 16 }}>
              {z.result && <NenchoResultPanel r={z.result} />}
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 2 }}>過不足額を精算する給与</label>
                <select
                  value={`${z.settle.year}-${z.settle.month}`}
                  onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); z.setSettle({ year: y, month: m }); }}
                  style={{ width: "100%", padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
                >
                  {settleOptions(z.year).map((o) => <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.year}年{o.month}月に支払う給与</option>)}
                </select>
              </div>
              {z.selected.saved && (
                <div style={{ fontSize: 12, marginTop: 8, color: statusColor(z.selected), lineHeight: 1.6 }}>
                  {statusMessage(z.selected)}
                </div>
              )}
              {z.errors.map((e) => <div key={e} style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>{e}</div>)}
              <button
                onClick={z.save}
                disabled={z.isSaving || z.errors.length > 0}
                style={{
                  width: "100%", marginTop: 12, padding: "10px", border: "none", borderRadius: 8, fontWeight: "bold", color: "white",
                  cursor: z.errors.length > 0 ? "not-allowed" : "pointer", backgroundColor: z.errors.length > 0 ? "#cbd5e1" : "#2563eb",
                }}
              >
                {z.isSaving ? "保存中…" : "申告書の内容と計算結果を保存"}
              </button>
              {z.selected.saved && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, textAlign: "center" }}>最後に保存：{z.selected.saved.updatedAt}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 一覧に出す、精算の状況 */
const statusLabel = (r: NenchoStaffRow) =>
  r.stale ? "計算し直しが必要" : r.settlement === "done" ? "精算済み" : r.settlement === "redo" ? "明細の確定し直しが必要" : "精算前";

const statusColor = (r: NenchoStaffRow) =>
  r.stale || r.settlement === "redo" ? "#b91c1c" : r.settlement === "done" ? "#16a34a" : "#b45309";

/** 選んだ人の、精算の状況と次にすること */
const statusMessage = (r: NenchoStaffRow) => {
  const s = r.saved!;
  const when = `${s.settleYear}年${s.settleMonth}月に支払う給与`;
  if (r.stale) return "⚠ 保存した後に、確定した給与・賞与が変わりました。内容を確かめて、もう一度保存してください。";
  if (r.settlement === "done") return `✓ ${when}で精算済みです（給与明細に過不足額が載っています）。`;
  if (r.settlement === "redo") return `⚠ ${when}は、過不足額を載せずに確定されています。給与明細を開き直して、もう一度確定してください。`;
  return `${when}を確定すると、給与明細に過不足額が載ります。`;
};
