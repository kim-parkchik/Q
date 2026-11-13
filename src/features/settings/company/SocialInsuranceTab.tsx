/**
 * 「社会保険規定」タブ：健康保険の保険者（協会けんぽ・健康保険組合・国民健康保険組合）を決める（計算は utils/healthInsurer.ts）
 *
 * ・協会けんぽ：料率は都道府県ごとに Q が持っている（拠点の都道府県で決まる）。ここでは今月の料率を見るだけ
 * ・健康保険組合：組合から知らされた本人負担の料率（健康保険・介護保険・子ども・子育て支援金）を「何年何月分から」と一緒に入れる。
 *   料率が変わったら、新しい行を足す（前の月の分は前の料率で計算する）
 * ・国民健康保険組合：料率はない。保険料は、従業員の画面で人ごとに月額を入れる
 * 従業員ごとにどの規定かは、従業員の画面の「適用する社保規定」で選ぶ
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { Pencil, PlusCircle, RotateCcw, Trash2, X } from "lucide-react";
import * as Master from "../../../constants";
import { useToast } from "../../../components/Toast";
import { useMessageDialog } from "../../../components/MessageDialog";
import { writeLog } from "../../../utils/logUtils";
import { executeBatch, type SqlStatement } from "../../../utils/dbBatch";
import {
  INSURER_TYPE_LABELS, describeUnionRate, loadHealthInsurers, monthLabel, ratePercent, unionRateFor,
  type HealthInsurer, type InsurerType, type UnionRate,
} from "../../../utils/healthInsurer";
import { addBoxStyle, btnStyle, editBtnStyle, inputStyle, miniLabelStyle, tabContentStyle } from "../CompanyManager.styles";

interface Props {
  db: Database;
}

interface Group extends HealthInsurer {
  active: boolean;
}

/** 料率の行（入力中は文字のまま持つ） */
interface RateRow {
  key: number;
  from: string;
  health: string;
  care: string;
  childSupport: string;
}

interface FormState {
  name: string;
  type: InsurerType;
  rates: RateRow[];
}

/** 本人負担の料率の上限（%。健康保険組合の一般保険料率は全体で13%まで。入れ間違いを止める目安） */
const MAX_RATE = 15;

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** その月に国が示している子ども・子育て支援金率の本人負担分（令和8年4月分より前は 0） */
const defaultChildSupport = (from: string): string => {
  const [y, m] = from.split("-").map(Number);
  if (!y || !m) return "0";
  const ins = Master.getInsuranceMaster(y, m);
  return Master.isChildSupportMonth(ins, y, m) && ins.CHILD_SUPPORT_RATE ? String(ins.CHILD_SUPPORT_RATE[0]) : "0";
};

let rowKey = 0;
const toRow = (r: UnionRate): RateRow => ({ key: ++rowKey, from: r.from, health: String(r.health), care: String(r.care), childSupport: String(r.childSupport) });

const EMPTY_FORM: FormState = { name: "", type: "union", rates: [] };

export default function SocialInsuranceTab({ db }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [groups, setGroups] = useState<Group[]>([]);
  const [staffCounts, setStaffCounts] = useState<Record<number, { all: number; withPremium: number }>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showInactive, setShowInactive] = useState(false);
  const [previewPref, setPreviewPref] = useState("東京");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const insurers = await loadHealthInsurers(db);
      const rows = (await db.select("SELECT id, is_active FROM social_insurance_groups ORDER BY id")) as { id: number; is_active: number }[];
      const active = new Map(rows.map((r) => [Number(r.id), Number(r.is_active ?? 1) !== 0]));
      setGroups([...insurers.values()].map((g) => ({ ...g, active: active.get(g.id) ?? true })));
      const counts = (await db.select(
        `SELECT social_insurance_group_id AS id, COUNT(*) AS n, SUM(CASE WHEN COALESCE(kokuho_premium, 0) > 0 THEN 1 ELSE 0 END) AS p
         FROM staff WHERE COALESCE(status, 'active') <> 'retired' AND social_insurance_group_id IS NOT NULL GROUP BY social_insurance_group_id`,
      )) as { id: number; n: number; p: number }[];
      setStaffCounts(Object.fromEntries(counts.map((c) => [Number(c.id), { all: Number(c.n) || 0, withPremium: Number(c.p) || 0 }])));
      const branch = (await db.select("SELECT prefecture FROM branches ORDER BY id LIMIT 1")) as { prefecture?: string | null }[];
      const pref = Master.toKenpoPrefName(branch?.[0]?.prefecture);
      if (pref) setPreviewPref(pref);
    } catch (e) {
      console.error(e);
      dialog.error(`社会保険規定を読み込めませんでした。\n${e}`);
    }
  }, [db]);

  useEffect(() => { reload(); }, [reload]);

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const startEdit = (g: Group) => {
    setEditingId(g.id);
    setForm({ name: g.name, type: g.type, rates: g.rates.map(toRow) });
  };

  const addRate = () => setForm((f) => {
    const last = f.rates[f.rates.length - 1];
    const from = thisMonth();
    return {
      ...f,
      rates: [...f.rates, { key: ++rowKey, from, health: last?.health ?? "", care: last?.care ?? "", childSupport: defaultChildSupport(from) }],
    };
  });
  const setRate = (key: number, patch: Partial<RateRow>) =>
    setForm((f) => ({ ...f, rates: f.rates.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const removeRate = (key: number) => setForm((f) => ({ ...f, rates: f.rates.filter((r) => r.key !== key) }));

  /** 入れた料率を確かめて、保存する形にする（だめなら知らせる文） */
  const parseRates = (rows: RateRow[]): UnionRate[] | string => {
    if (rows.length === 0) return "組合から知らされた料率を、1つ以上入れてください（「料率を足す」）。";
    const seen = new Set<string>();
    const result: UnionRate[] = [];
    for (const r of rows) {
      if (!/^\d{4}-\d{2}$/.test(r.from)) return "料率の「何年何月分から」を入れてください。";
      if (seen.has(r.from)) return `${monthLabel(r.from)}からの料率が2つあります。1つにしてください。`;
      seen.add(r.from);
      const nums = [r.health, r.care, r.childSupport].map((v) => (v.trim() === "" ? 0 : Number(v)));
      if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > MAX_RATE)) {
        return `${monthLabel(r.from)}からの料率は、0〜${MAX_RATE}（%）の数で入れてください（本人負担の%。千分率（‰）なら10で割ります）。`;
      }
      if (nums[0] <= 0) return `${monthLabel(r.from)}からの健康保険の料率を入れてください。`;
      result.push({ from: r.from, health: nums[0], care: nums[1], childSupport: nums[2] });
    }
    return result.sort((a, b) => a.from.localeCompare(b.from));
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) return dialog.warning("規定の名前を入れてください（例：○○健康保険組合）。");
    const isKyokai = editingId !== null && groups.find((g) => g.id === editingId)?.type === "kyokai";
    const type: InsurerType = isKyokai ? "kyokai" : form.type;
    const rates = type === "union" ? parseRates(form.rates) : [];
    if (typeof rates === "string") return dialog.warning(rates);
    if (busy) return;
    setBusy(true);
    try {
      const statements: SqlStatement[] = [];
      // 新しい規定の番号は、同じまとまりの中で足した規定の番号（いちばん大きい番号）
      const groupIdSql = editingId !== null ? "?" : "(SELECT MAX(id) FROM social_insurance_groups)";
      if (editingId !== null) {
        statements.push({ sql: "UPDATE social_insurance_groups SET name = ?, type = ? WHERE id = ?", values: [name, type, editingId] });
        statements.push({ sql: "DELETE FROM social_insurance_group_rates WHERE group_id = ?", values: [editingId] });
      } else {
        statements.push({ sql: "INSERT INTO social_insurance_groups (name, type, is_active) VALUES (?, ?, 1)", values: [name, type] });
      }
      for (const r of rates) {
        statements.push({
          sql: `INSERT INTO social_insurance_group_rates (group_id, from_month, health_rate, care_rate, child_support_rate) VALUES (${groupIdSql}, ?, ?, ?, ?)`,
          values: [...(editingId !== null ? [editingId] : []), r.from, r.health, r.care, r.childSupport],
        });
      }
      await executeBatch(db, statements);
      await writeLog(db, "INFO", "salary", `社会保険規定「${name}」（${INSURER_TYPE_LABELS[type]}）を${editingId !== null ? "直しました" : "足しました"}`
        + (rates.length > 0 ? `。料率：${rates.map(describeUnionRate).join("／")}` : ""));
      toast.success(editingId !== null ? `「${name}」を保存しました` : `「${name}」を足しました`);
      resetForm();
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (g: Group) => {
    if (g.active) {
      const usage = staffCounts[g.id]?.all ?? 0;
      const used = (await db.select("SELECT COUNT(*) AS n FROM staff WHERE social_insurance_group_id = ?", [g.id])) as { n: number }[];
      if (usage > 0 || Number(used?.[0]?.n) > 0) {
        return dialog.warning(`「${g.name}」は従業員が使っているので、やめられません。先に、従業員の画面で別の規定にしてください。`);
      }
      const ok = await ask(`「${g.name}」をやめますか？（従業員の画面で選べなくなります。あとで戻せます）`, { title: "確認", kind: "warning" });
      if (!ok) return;
    }
    try {
      await db.execute("UPDATE social_insurance_groups SET is_active = ? WHERE id = ?", [g.active ? 0 : 1, g.id]);
      await writeLog(db, "INFO", "salary", `社会保険規定「${g.name}」を${g.active ? "やめました" : "戻しました"}`);
      toast.success(g.active ? `「${g.name}」をやめました` : `「${g.name}」を戻しました`);
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`変えられませんでした。\n${e}`);
    }
  };

  // 協会けんぽの今月の料率（見るだけ）
  const now = new Date();
  const ins = Master.getInsuranceMaster(now.getFullYear(), now.getMonth() + 1);
  const kenpo = ins.KENPO_RATES[previewPref];
  const childNow = Master.isChildSupportMonth(ins, now.getFullYear(), now.getMonth() + 1) && ins.CHILD_SUPPORT_RATE ? ins.CHILD_SUPPORT_RATE[1] : null;
  const editingKyokai = editingId !== null && groups.find((g) => g.id === editingId)?.type === "kyokai";
  const today = thisMonth();

  const summary = (g: Group) => {
    if (g.type === "kyokai") return <span style={{ color: "#0288d1" }}>都道府県（拠点の都道府県）の料率で計算します</span>;
    if (g.type === "kokuho") {
      const c = staffCounts[g.id];
      return (
        <span>
          健康保険料・介護保険料・子ども・子育て支援金はかかりません。保険料は従業員の画面で人ごとに月額を入れます
          {c && c.all > 0 && (
            <span style={{ color: c.withPremium < c.all ? "#b45309" : "#64748b" }}>（{c.all}人のうち、月額を入れた人 {c.withPremium}人）</span>
          )}
        </span>
      );
    }
    const current = unionRateFor(g.rates, Number(today.slice(0, 4)), Number(today.slice(5, 7)));
    if (g.rates.length === 0) return <span style={{ color: "#c53030" }}>料率が入っていません（健康保険料を計算できません）</span>;
    return (
      <span>
        {current ? describeUnionRate(current) : <span style={{ color: "#c53030" }}>今月の分の料率がありません（{monthLabel(g.rates[0].from)}から入っています）</span>}
        {g.rates.length > 1 && <span style={{ color: "#94a3b8" }}>（ほかに {g.rates.length - 1}件の料率）</span>}
      </span>
    );
  };

  const active = groups.filter((g) => g.active);
  const inactive = groups.filter((g) => !g.active);

  return (
    <section style={tabContentStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: "25px" }}>
        {/* 左：規定の一覧 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={note}>
            従業員ごとに、健康保険がどこか（協会けんぽ・健康保険組合・国民健康保険組合）を、従業員の画面の「適用する社保規定」で選びます。
            厚生年金の料率は、どの規定の人も同じです（全国で同じ）。
          </div>
          {active.map((g) => (
            <div key={g.id} style={card(editingId === g.id)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                  {g.name}
                  <span style={badge(g.type)}>{INSURER_TYPE_LABELS[g.type]}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px", lineHeight: 1.6 }}>{summary(g)}</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => startEdit(g)} style={editBtnStyle}><Pencil size={14} /> 編集</button>
                {g.type !== "kyokai" && (
                  <button onClick={() => toggleActive(g)} style={{ ...editBtnStyle, color: "#e74c3c" }} title="やめる（従業員の画面で選べなくする）"><X size={14} /></button>
                )}
              </div>
            </div>
          ))}
          {inactive.length > 0 && (
            <div>
              <button onClick={() => setShowInactive(!showInactive)} style={{ fontSize: "12px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>
                {showInactive ? "▲ やめた規定を隠す" : `▼ やめた規定を見る（${inactive.length}件）`}
              </button>
              {showInactive && inactive.map((g) => (
                <div key={g.id} style={{ ...card(false), opacity: 0.6, marginTop: "8px" }}>
                  <span style={{ flex: 1, fontSize: "13px", color: "#64748b" }}>{g.name}（{INSURER_TYPE_LABELS[g.type]}・やめた）</span>
                  <button onClick={() => toggleActive(g)} style={{ ...editBtnStyle, color: "#27ae60" }}><RotateCcw size={12} /> 戻す</button>
                </div>
              ))}
            </div>
          )}

          {/* 協会けんぽの今月の料率（見るだけ） */}
          <div style={{ ...card(false), flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ fontWeight: "bold", fontSize: "13px", marginBottom: "8px" }}>
              協会けんぽの料率（{ins.MASTER_YEAR}年{ins.MASTER_MONTH}月分から。全体の料率で、本人負担はこの半分）
            </div>
            <select value={previewPref} onChange={(e) => setPreviewPref(e.target.value)} style={{ ...inputStyle, height: "32px", fontSize: "13px", marginBottom: "8px" }}>
              {Object.keys(ins.KENPO_RATES).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", fontSize: "13px" }}>
              <span style={{ color: "#64748b" }}>健康保険（{previewPref}）</span><b>{kenpo ? ratePercent(kenpo[1]) : "-"}</b>
              <span style={{ color: "#64748b" }}>介護保険（40〜64歳。全国で同じ）</span><b>{ratePercent(ins.KENPO_CARE_RATE[1])}</b>
              {childNow !== null && (<><span style={{ color: "#64748b" }}>子ども・子育て支援金（全国で同じ）</span><b>{ratePercent(childNow)}</b></>)}
              <span style={{ color: "#64748b" }}>厚生年金（全国で同じ）</span><b>{ratePercent(ins.PENSION_RATE[1])}</b>
            </div>
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "6px" }}>
              協会けんぽの料率は、協会けんぽの公式の保険料額表から Q が持っています。給与では、従業員の拠点の都道府県の料率を使います。
            </div>
          </div>
        </div>

        {/* 右：足す・直す */}
        <div style={{ ...addBoxStyle, border: editingId !== null ? "2px solid #f1c40f" : "1px dashed #cbd5e1" }}>
          <h4 style={{ margin: "0 0 15px 0", display: "flex", alignItems: "center", gap: "8px" }}>
            {editingId !== null ? <Pencil size={20} color="#f1c40f" /> : <PlusCircle size={20} color="#3498db" />}
            {editingId !== null ? "規定を直す" : "規定を足す"}
          </h4>

          <label style={miniLabelStyle}>名前</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{ ...inputStyle, marginBottom: "12px" }}
            placeholder={form.type === "kokuho" ? "例：○○建設国民健康保険組合" : "例：○○健康保険組合"}
          />

          {!editingKyokai && (
            <div style={{ marginBottom: "12px" }}>
              <label style={miniLabelStyle}>種類</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as InsurerType }))} style={inputStyle}>
                <option value="union">健康保険組合</option>
                <option value="kokuho">国民健康保険組合（建設国保など）</option>
              </select>
            </div>
          )}

          {editingKyokai && <div style={note}>協会けんぽの料率は Q が持っているので、ここでは名前だけ直せます。</div>}

          {!editingKyokai && form.type === "union" && (
            <div style={{ marginBottom: "12px" }}>
              <label style={miniLabelStyle}>料率（本人負担の%。組合から知らされたとおり）</label>
              {form.rates.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr auto", gap: "4px", fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>
                  <span>何年何月分から</span><span>健康保険</span><span>介護保険</span><span>子ども・子育て支援金</span><span />
                </div>
              )}
              {form.rates.map((r) => (
                <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr auto", gap: "4px", marginBottom: "4px", alignItems: "center" }}>
                  <input type="month" value={r.from} onChange={(e) => setRate(r.key, { from: e.target.value })} style={small} aria-label="何年何月分から" />
                  <input type="number" step="0.001" min={0} value={r.health} onChange={(e) => setRate(r.key, { health: e.target.value })} style={small} aria-label="健康保険（本人負担の%）" />
                  <input type="number" step="0.001" min={0} value={r.care} onChange={(e) => setRate(r.key, { care: e.target.value })} style={small} aria-label="介護保険（本人負担の%）" />
                  <input type="number" step="0.001" min={0} value={r.childSupport} onChange={(e) => setRate(r.key, { childSupport: e.target.value })} style={small} aria-label="子ども・子育て支援金（本人負担の%）" />
                  <button onClick={() => removeRate(r.key)} style={{ ...editBtnStyle, color: "#e74c3c" }} title="この料率を消す"><Trash2 size={14} /></button>
                </div>
              ))}
              <button onClick={addRate} style={{ ...editBtnStyle, marginTop: "4px" }}><PlusCircle size={14} /> 料率を足す</button>
              <div style={{ ...note, marginTop: "8px", marginBottom: 0 }}>
                全体の料率ではなく、従業員が負担する分の%を入れます（組合は規約で会社の負担を半分より多くできるため。健康保険法162条）。
                千分率（‰）で知らされたら、10で割って%にします（例：45‰ → 4.5%）。
                料率が変わったら、新しい行を足します（前の月の分は、前の料率で計算します）。
                子ども・子育て支援金は令和8年4月分からで、令和8年度は国が示した率が全体で0.23%（本人負担 0.115%）です。
                介護保険は40〜64歳の人だけにかかります。
              </div>
            </div>
          )}

          {!editingKyokai && form.type === "kokuho" && (
            <div style={note}>
              国民健康保険組合の人は、健康保険（協会けんぽ・健康保険組合）に入っていないので、健康保険料・介護保険料・子ども・子育て支援金は計算しません。
              国保組合の保険料（家族の人数などで決まる額）は、従業員の画面で人ごとに月額を入れ、毎月の給与から引きます（賞与からは引きません）。
              厚生年金は、標準報酬月額を入れた人にかかります。
            </div>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={save} disabled={busy || !form.name.trim()}
              style={{ ...btnStyle, flex: 1, backgroundColor: busy || !form.name.trim() ? "#bdc3c7" : "#3498db" }}>
              {editingId !== null ? "保存する" : "足す"}
            </button>
            {editingId !== null && <button onClick={resetForm} style={{ ...btnStyle, width: "80px", backgroundColor: "#95a5a6" }}>やめる</button>}
          </div>
        </div>
      </div>
    </section>
  );
}

const note: CSSProperties = { fontSize: "12px", color: "#475569", backgroundColor: "#f1f5f9", borderRadius: "8px", padding: "10px 12px", lineHeight: 1.6, marginBottom: "12px" };
const small: CSSProperties = { ...inputStyle, height: "32px", fontSize: "13px", padding: "0 6px", minWidth: 0 };
const card = (editing: boolean): CSSProperties => ({
  backgroundColor: "white", padding: "15px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)",
  display: "flex", alignItems: "center", gap: "12px", border: editing ? "2px solid #f1c40f" : "1px solid transparent",
});
const badge = (type: InsurerType): CSSProperties => ({
  fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
  backgroundColor: type === "kyokai" ? "#e1f5fe" : type === "union" ? "#ede9fe" : "#fef3c7",
  color: type === "kyokai" ? "#0288d1" : type === "union" ? "#6d28d9" : "#b45309",
});
