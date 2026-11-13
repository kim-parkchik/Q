/**
 * Q の「社会保険規定」タブ（健康保険組合・国保組合）と、その規定で計算した給与の社会保険料を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/insurer.html を開く
 * ・会社設定の「社会保険規定」タブ（src/features/settings/company/SocialInsuranceTab.tsx）：会社ファイルの代わりに、ページの中の表（fakeDb）に保存する
 * ・下の表：見本の3人（協会けんぽ・健康保険組合・国保組合。46歳・標準報酬月額 30万円）の2026年6月分の給与の社会保険料（src/utils/calcSalary.ts）。
 *   組合の料率を直すと、計算が変わる。料率を消すと「料率がない（確定できない）」になる
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import SocialInsuranceTab from "../../src/features/settings/company/SocialInsuranceTab";
import { calculateSalary } from "../../src/utils/calcSalary";
import { insurerOf, loadHealthInsurers, type HealthInsurer } from "../../src/utils/healthInsurer";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd.startsWith("plugin:dialog|")) {
      console.info("確かめ（自動で「はい」）:", args?.message);
      const b = args?.buttons;
      if (b?.OkCancelCustom) return b.OkCancelCustom[0];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? "Yes" : b === "OkCancel" ? "Ok" : true;
    }
    return null;
  },
  transformCallback: () => 0,
};

// ── 会社ファイルの代わり（ページの中の表） ──
const store = {
  groups: [
    { id: 1, name: "全国健康保険協会（協会けんぽ）", type: "kyokai", is_active: 1 },
    { id: 2, name: "確かめ健康保険組合", type: "union", is_active: 1 },
    { id: 3, name: "確かめ建設国民健康保険組合", type: "kokuho", is_active: 1 },
  ] as { id: number; name: string; type: string; is_active: number }[],
  rates: [
    { group_id: 2, from_month: "2025-04", health_rate: 4.4, care_rate: 0.8, child_support_rate: 0 },
    { group_id: 2, from_month: "2026-04", health_rate: 4.5, care_rate: 0.8, child_support_rate: 0.115 },
  ] as { group_id: number; from_month: string; health_rate: number; care_rate: number; child_support_rate: number }[],
  staff: [
    { id: "1001", name: "山田 太郎（協会けんぽ・東京）", social_insurance_group_id: 1, kokuho_premium: 0 },
    { id: "1002", name: "佐藤 花子（健康保険組合）", social_insurance_group_id: 2, kokuho_premium: 0 },
    { id: "1003", name: "鈴木 一郎（国保組合・月額 23,000円）", social_insurance_group_id: 3, kokuho_premium: 23000 },
  ],
};
(window as any).__insurerStore = store; // 確かめのとき、ページの外から中身を見る
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** executeBatch の文を、ページの中の表に当てはめる */
const run = (sql: string, params: unknown[]) => {
  const q = sql.replace(/\s+/g, " ").trim();
  if (q.startsWith("UPDATE social_insurance_groups SET name = ?, type = ? WHERE id = ?")) {
    const [name, type, id] = params as [string, string, number];
    Object.assign(store.groups.find((g) => g.id === Number(id))!, { name, type });
  } else if (q.startsWith("UPDATE social_insurance_groups SET is_active = ? WHERE id = ?")) {
    const [active, id] = params as [number, number];
    store.groups.find((g) => g.id === Number(id))!.is_active = Number(active);
  } else if (q.startsWith("DELETE FROM social_insurance_group_rates WHERE group_id = ?")) {
    store.rates = store.rates.filter((r) => r.group_id !== Number(params[0]));
  } else if (q.startsWith("INSERT INTO social_insurance_groups (name, type, is_active)")) {
    const [name, type] = params as [string, string];
    store.groups.push({ id: Math.max(...store.groups.map((g) => g.id)) + 1, name, type, is_active: 1 });
  } else if (q.startsWith("INSERT INTO social_insurance_group_rates")) {
    const usesMax = q.includes("(SELECT MAX(id) FROM social_insurance_groups)");
    const values = [...params] as any[];
    const groupId = usesMax ? Math.max(...store.groups.map((g) => g.id)) : Number(values.shift());
    const [from_month, health_rate, care_rate, child_support_rate] = values;
    if (store.rates.some((r) => r.group_id === groupId && r.from_month === from_month)) throw new Error("UNIQUE constraint failed");
    store.rates.push({ group_id: groupId, from_month, health_rate, care_rate, child_support_rate });
  } else if (!q.startsWith("INSERT INTO app_logs")) {
    console.warn("fakeDb: 知らない EXECUTE", q, params);
  }
};

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT id, name, type FROM social_insurance_groups")) return store.groups.map(({ id, name, type }) => ({ id, name, type }));
    if (q.startsWith("SELECT id, is_active FROM social_insurance_groups")) return store.groups.map(({ id, is_active }) => ({ id, is_active }));
    if (q.startsWith("SELECT group_id, from_month")) {
      return [...store.rates].sort((a, b) => a.group_id - b.group_id || a.from_month.localeCompare(b.from_month));
    }
    if (q.startsWith("SELECT social_insurance_group_id AS id, COUNT(*) AS n")) {
      const ids = [...new Set(store.staff.map((s) => s.social_insurance_group_id))];
      return ids.map((id) => {
        const list = store.staff.filter((s) => s.social_insurance_group_id === id);
        return { id, n: list.length, p: list.filter((s) => s.kokuho_premium > 0).length };
      });
    }
    if (q.startsWith("SELECT COUNT(*) AS n FROM staff WHERE social_insurance_group_id = ?")) {
      return [{ n: store.staff.filter((s) => s.social_insurance_group_id === Number(params[0])).length }];
    }
    if (q.startsWith("SELECT prefecture FROM branches")) return [{ prefecture: "東京都" }];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    run(sql, params);
    notify();
    return { rowsAffected: 1 };
  },
  /** utils/dbBatch.ts の executeBatch（1つのまとまりで実行する。途中で失敗したら、前の中身に戻す） */
  async executeBatch(statements: { sql: string; values?: unknown[] }[]) {
    const before = JSON.stringify(store);
    try {
      for (const s of statements) run(s.sql, s.values ?? []);
    } catch (e) {
      Object.assign(store, JSON.parse(before));
      throw e;
    }
    notify();
    return statements.map(() => ({ rowsAffected: 1, lastInsertId: 0 }));
  },
};

/** 46歳・月給30万円・標準報酬月額30万円（介護保険の対象） */
const base = { wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, commute_type: "none", commute_amount: 0, standard_remuneration: 300000, birthday: "1980-06-15" };
const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };
const yen = (n: number) => `${n.toLocaleString()}円`;

function Results() {
  const [insurers, setInsurers] = useState<Map<number, HealthInsurer>>(new Map());
  useEffect(() => {
    const load = () => { loadHealthInsurers(fakeDb).then(setInsurers); };
    load();
    listeners.add(load);
    return () => { listeners.delete(load); };
  }, []);
  return (
    <table id="results" style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "white", fontSize: 13 }}>
      <thead>
        <tr style={{ backgroundColor: "#f8fafc" }}>
          {["名前", "健康保険料", "介護保険料", "子ども・子育て支援金", "国保組合の保険料", "厚生年金", "所得税", "知らせ"].map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {store.staff.map((s) => {
          const r = calculateSalary(
            { ...base, ...s },
            [],
            { allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [], healthInsurer: insurerOf(insurers, s.social_insurance_group_id) },
            2026, 6, company,
          );
          return (
            <tr key={s.id}>
              <td style={td}>{s.name}</td>
              <td style={td}>{yen(r.healthInsurance)}</td>
              <td style={td}>{yen(r.nursingInsurance)}</td>
              <td style={td}>{yen(r.childSupport)}</td>
              <td style={td}>{yen(r.kokuhoPremium)}</td>
              <td style={td}>{yen(r.welfarePension)}</td>
              <td style={td}>{yen(r.incomeTax)}</td>
              <td style={{ ...td, color: r.insurerRateMissing ? "#b91c1c" : "#64748b" }}>
                {r.insurerRateMissing ? "⚠ 組合の6月分の料率がない（確定できない）" : r.unionRate ? `${r.unionRate.from} からの料率` : "-"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9" };

function Page() {
  return (
    <ToastProvider>
      <MessageDialogProvider>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          <h2>会社設定の「社会保険規定」</h2>
          <SocialInsuranceTab db={fakeDb as any} />
          <h2 style={{ marginTop: 30 }}>2026年6月分の給与の社会保険料（46歳・標準報酬月額 30万円）</h2>
          <Results />
        </div>
      </MessageDialogProvider>
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
