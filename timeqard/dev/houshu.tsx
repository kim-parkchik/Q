/**
 * Q の年4回以上払う賞与（健康保険・厚生年金保険の「賞与に係る報酬」。src/utils/shoyoHoushu.ts）を、見本の値で画面に出す
 * （開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/houshu.html を開く
 * 会社：株式会社健保産業（東京都。末日締め翌月25日払い）。四半期ごとの賞与（第1〜第4四半期賞与。名前は違うが同じ性質）を、
 *   2025年9月25日・12月25日・2026年3月25日・6月25日に払った（どれも「年4回以上払う賞与の1回」の印を付けて確定済み）
 *   社会 公一さん：日本年金機構「算定基礎届の記入・提出ガイドブック（令和8年度）」のケース⑦と同じ
 *     （賞与 120,000・380,000・150,000・250,000円 ＝ 900,000円 ÷ 12 ＝ 75,000円。4〜6月の報酬 270,000円に足して 345,000円。
 *       平均 345,000円 → 標準報酬月額 340,000円。備考「賞与９．１２．３．６月　７５，０００円」）
 *   四半 期子さん：賞与 180,000円 × 4回 ＝ 720,000円 ÷ 12 ＝ 60,000円。4月に払った3月分から昇給（基本給 280,000 → 330,000円。通勤手当 15,000円）
 *     → 月変（7月改定）：3か月の 345,000円に 60,000円を足して 405,000円 → 410,000円（従前 360,000円から2等級上がる）。
 *       足さないと（「うち賞与（月額）」を0にすると）345,000円 → 340,000円で、昇給したのに従前より1等級低く、「差が1等級以下」で対象にならない
 * 1. 賞与の画面：2026年9月25日の第2四半期賞与（印あり・未確定）は、2026年の定時決定の期間に払うので報酬。社会保険料は0円、雇用保険料と所得税はかかる。
 *    2026年7月10日の夏季賞与（印なし）は賞与（社会保険料がかかる）
 * 2. 算定基礎（2026年度）：「年4回以上払う賞与」の欄（4回・報酬）と、社会さんの「うち賞与（月額）」75,000円・算定基礎届
 * 3. 月変（2026年）：四半さんの4月の昇給（うち賞与 60,000円を足して判定）
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import BonusManager from "../../src/features/payroll/BonusManager";
import SanteiManager from "../../src/features/payroll/SanteiManager";
import ZuijiManager from "../../src/features/payroll/ZuijiManager";

// ── Tauri の代わり（保存の窓は開かず、保存したバイトを残す。確かめの窓は「はい」） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any, options: any) => {
    if (cmd === "plugin:dialog|save") return `/tmp/${args?.options?.defaultPath ?? "SHFD0006.CSV"}`;
    if (cmd === "plugin:fs|write_file") {
      (window as any).__savedFile = { bytes: args instanceof Uint8Array ? args : new Uint8Array(args), headers: options?.headers };
      return null;
    }
    if (cmd.startsWith("plugin:dialog|")) {
      const b = args?.buttons;
      if (b?.OkCancelCustom) return b.OkCancelCustom[0];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? "Yes" : b === "OkCancel" ? "Ok" : true;
    }
    return null;
  },
  transformCallback: () => 0,
};

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
/** 2025年7月から2026年10月までの支給月 */
const PAY_MONTHS = Array.from({ length: 16 }, (_, i) => ({ year: i < 6 ? 2025 : 2026, month: ((6 + i) % 12) + 1 }));
const history = (...entries: [string, number, string, number?][]) =>
  JSON.stringify(entries.map(([from, amount, reason, bonus]) => (bonus ? { from, amount, reason, bonus } : { from, amount, reason })));
const person = (o: Record<string, unknown>) => ({
  wage_type: "monthly", scheduled_work_hours: 8, join_date: "2015-04-01", social_insurance_group_id: 1, payroll_group_id: 1, branch_id: 1,
  calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri", dependents: 0, commute_type: "monthly", commute_amount: 15000,
  is_employment_ins_eligible: 1, status: "active", ...o,
});

const staffList: any[] = [
  person({ id: "2014", name: "社会 公一", furigana: "シャカイ コウイチ", birthday: "1984-06-19", pension_num: "32", base_wage: 255000,
    standard_remuneration: 260000, standard_remuneration_history: history(["", 260000, "shutoku"], ["2025-09", 260000, "teiji"]) }),
  person({ id: "2015", name: "四半 期子", furigana: "シハン キコ", birthday: "1990-10-01", pension_num: "33", base_wage: 330000,
    standard_remuneration: 360000, standard_remuneration_history: history(["", 360000, "shutoku"], ["2025-09", 360000, "teiji", 60000]) }),
];

/** 支給月ごとの [総支給, 基本給]（翌月払いなので、4月に払う給与から昇給した3月分） */
const payOf = (staffId: string, k: string): [number, number] =>
  staffId === "2014" ? [270000, 255000] : k < "2026-04" ? [295000, 280000] : [345000, 330000];
const salaries = staffList.flatMap((s) => PAY_MONTHS.map((m) => {
  const [total, base] = payOf(s.id, ym(m.year, m.month));
  return {
    staff_id: s.id, target_year: m.year, target_month: m.month, total_earnings: total, non_remuneration: 0, in_kind: 0, in_kind_detail: null,
    absence_deduction: 0, unpaid_leave_deduction: 0, prescribed_work_days: 21, leave_paid_days: null,
    applied_base_wage: base, fixed_overtime_allowance: 0, non_fixed_earnings: total - base - 15000,
    taxable_amount: total - 15000, social_ins_total: 40000,
  };
}));

// ── 賞与 ──
const bonusSettings: any[] = [
  { id: 1, name: "第2四半期賞与", target_year: 2025, target_month: 9, payment_date: "2025-09-25", is_closed: 1, shaho_houshu: 1 },
  { id: 2, name: "第3四半期賞与", target_year: 2025, target_month: 12, payment_date: "2025-12-25", is_closed: 1, shaho_houshu: 1 },
  { id: 3, name: "第4四半期賞与", target_year: 2026, target_month: 3, payment_date: "2026-03-25", is_closed: 1, shaho_houshu: 1 },
  { id: 4, name: "第1四半期賞与", target_year: 2026, target_month: 6, payment_date: "2026-06-25", is_closed: 1, shaho_houshu: 1 },
  { id: 5, name: "夏季賞与", target_year: 2026, target_month: 7, payment_date: "2026-07-10", is_closed: 0, shaho_houshu: 0 },
  { id: 6, name: "第2四半期賞与", target_year: 2026, target_month: 9, payment_date: "2026-09-25", is_closed: 0, shaho_houshu: 1 },
];
/** 確定した賞与（社会さん：ガイドブックのケース⑦の額。四半さん：180,000円ずつ）。確定したときは、まだ賞与として扱った */
const bonusResults: any[] = [
  ...[[1, 120000], [2, 380000], [3, 150000], [4, 250000]].map(([id, amount]) => ({ bonus_setting_id: id, staff_id: "2014", total_earnings: amount, in_kind: 0, shaho_houshu: 0 })),
  ...[1, 2, 3, 4].map((id) => ({ bonus_setting_id: id, staff_id: "2015", total_earnings: 180000, in_kind: 0, shaho_houshu: 0 })),
];
/** 入れた額（夏季賞与と、2026年9月の第2四半期賞与） */
const bonusValues: Record<number, Record<string, number>> = { 5: { "2014": 300000, "2015": 300000 }, 6: { "2014": 150000, "2015": 180000 } };
const bonusSaved: Record<string, unknown>[] = [];

const store = {
  company: {
    id: 1, name: "株式会社健保産業", zip_code: "168-8505", address: "東京都杉並区高井戸3-5-24", phone: "03-2345-6789",
    representative: "健保 良一", shaho_office_symbol: "57-ケマ", shaho_office_number: "12345", shaho_media_seq: 23,
    week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law", shoyo_houshu: null as string | null,
  },
};
(window as any).__houshuStore = { store, staffList, bonusSettings, bonusSaved };

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    // 会社・拠点・給与規定グループ・健康保険の保険者
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT shoyo_houshu FROM company WHERE id = 1")) return [{ shoyo_houshu: store.company.shoyo_houshu }];
    if (q.startsWith("SELECT * FROM branches") || q.startsWith("SELECT id, name, prefecture, health_ins_num FROM branches")) return [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
    if (q.startsWith("SELECT prefecture FROM branches WHERE id = 1")) return [{ prefecture: "東京都" }];
    if (q.startsWith("SELECT * FROM payroll_groups")) return [{ id: 1, name: "本社", closing_day: 99, is_next_month: 1, payment_day: 25 }];
    if (q.startsWith("SELECT id, closing_day, is_next_month FROM payroll_groups")) return [{ id: 1, closing_day: 99, is_next_month: 1 }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) return [{ id: 1, name: "協会けんぽ", type: "kyokai" }];
    if (q.startsWith("SELECT group_id, from_month")) return [];
    // 給与・勤怠（算定基礎・月変）
    if (q.includes("FROM salary_results WHERE (target_year = ? AND target_month >= 7) OR (target_year = ? AND target_month <= 6)")) {
      return salaries.filter((s) => (s.target_year === params[0] && s.target_month >= 7) || (s.target_year === params[1] && s.target_month <= 6));
    }
    if (q.includes("FROM salary_results WHERE (target_year * 12 + target_month) BETWEEN ? AND ?")) {
      return salaries.filter((s) => s.target_year * 12 + s.target_month >= params[0] && s.target_year * 12 + s.target_month <= params[1]);
    }
    if (q.startsWith("SELECT staff_id, work_date, work_type, work_hours, leave_paid FROM attendance")) return [];
    if (q.includes("(taxable_amount - social_ins_total) as tax_base")) {
      return salaries.filter((s) => s.target_year === params[0] && s.target_month === params[1]).map((s) => ({ staff_id: s.staff_id, tax_base: s.taxable_amount - s.social_ins_total }));
    }
    // 賞与の画面
    if (q.startsWith("SELECT * FROM bonus_settings")) return [...bonusSettings].sort((a, b) => b.payment_date.localeCompare(a.payment_date));
    if (q.startsWith("SELECT * FROM bonus_item_master")) return [{ id: 1, name: "基本賞与", type: "earning", is_default_active: 1, in_kind: 0 }];
    if (q.startsWith("SELECT item_id FROM bonus_setting_items")) return [{ item_id: 1 }];
    if (q.startsWith("SELECT staff_id, item_id, amount FROM bonus_staff_values")) {
      return Object.entries(bonusValues[params[0]] ?? {}).map(([staff_id, amount]) => ({ staff_id, item_id: 1, amount }));
    }
    if (q.startsWith("SELECT MAX(shaho_houshu) AS h, COUNT(*) AS n FROM bonus_results")) {
      const mine = bonusSaved.filter((r) => r.bonus_setting_id === params[0]);
      return [{ h: mine.length > 0 ? Math.max(...mine.map((r) => Number(r.shaho_houshu))) : null, n: mine.length }];
    }
    if (q.startsWith("SELECT COUNT(*) AS n FROM bonus_results")) return [{ n: bonusSaved.filter((r) => r.bonus_setting_id === params[0]).length }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM bonus_settings WHERE shaho_houshu = 1")) return [{ n: bonusSettings.filter((s) => s.shaho_houshu === 1).length }];
    // 年4回以上払う賞与（算定基礎・月変）
    if (q.startsWith("SELECT id, name, payment_date, shaho_houshu, is_closed FROM bonus_settings")) {
      const onlyMarked = q.includes("shaho_houshu = 1");
      return bonusSettings.filter((s) => s.payment_date >= params[0] && s.payment_date <= params[1] && (!onlyMarked || s.shaho_houshu === 1));
    }
    if (q.startsWith("SELECT r.bonus_setting_id, r.staff_id, r.total_earnings, r.in_kind FROM bonus_results r")) {
      return bonusResults.filter((r) => {
        const s = bonusSettings.find((x) => x.id === r.bonus_setting_id);
        return s && s.shaho_houshu === 1 && s.payment_date >= params[0] && s.payment_date <= params[1];
      });
    }
    if (q.includes("FROM bonus_settings s JOIN bonus_staff_values v") || q.includes("FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id WHERE s.payment_date BETWEEN")) return [];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET shoyo_houshu = ? WHERE id = 1")) store.company.shoyo_houshu = params[0];
    else if (q.startsWith("UPDATE staff SET standard_remuneration_history")) {
      const s = staffList.find((x) => x.id === params[2]);
      if (s) Object.assign(s, { standard_remuneration_history: params[0], standard_remuneration: params[1] });
    } else if (q.startsWith("UPDATE bonus_settings SET name = ?")) {
      const s = bonusSettings.find((x) => x.id === params[5]);
      if (s) Object.assign(s, { name: params[0], target_year: params[1], target_month: params[2], payment_date: params[3], shaho_houshu: params[4] });
    } else if (q.startsWith("INSERT OR REPLACE INTO bonus_staff_values")) {
      (bonusValues[params[0]] ??= {})[params[1]] = params[3];
    } else if (!q.startsWith("INSERT INTO app_logs")) console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
  async executeBatch(statements: { sql: string; values?: unknown[] }[]) {
    for (const st of statements) {
      const sql = st.sql.replace(/\s+/g, " ");
      const m = /INSERT INTO bonus_results \(([^)]*)\)/.exec(sql);
      if (m) {
        const cols = m[1].split(",").map((c) => c.trim());
        bonusSaved.push(Object.fromEntries(cols.map((c, i) => [c, st.values?.[i]])));
      }
      if (sql.startsWith("DELETE FROM bonus_results WHERE bonus_setting_id = ?")) {
        for (let i = bonusSaved.length - 1; i >= 0; i--) if (bonusSaved[i].bonus_setting_id === st.values?.[0]) bonusSaved.splice(i, 1);
      }
      if (sql.startsWith("UPDATE bonus_settings SET is_closed = 1 WHERE id = ?")) {
        const s = bonusSettings.find((x) => x.id === st.values?.[0]);
        if (s) s.is_closed = 1;
      }
    }
    return statements.map(() => ({ rowsAffected: 1, lastInsertId: 1 }));
  },
};

function Page() {
  const [list, setList] = useState(staffList);
  const [tab, setTab] = useState<"bonus" | "santei" | "zuiji">("bonus");
  const refresh = () => setList(staffList.map((s) => ({ ...s })));
  const tabButton = (key: "bonus" | "santei" | "zuiji", label: string) => (
    <button id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: tab === key ? "#2563eb" : "#e2e8f0", color: tab === key ? "white" : "#334155" }}>
      {label}
    </button>
  );
  return (
    <div style={{ padding: 20 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabButton("bonus", "1. 賞与")}
        {tabButton("santei", "2. 算定基礎（定時決定）")}
        {tabButton("zuiji", "3. 月変（随時改定）")}
      </div>
      {tab === "bonus" && <BonusManager db={fakeDb as any} staffList={list} />}
      {tab === "santei" && <SanteiManager db={fakeDb as any} staffList={list} onDataChange={refresh} />}
      {tab === "zuiji" && <ZuijiManager db={fakeDb as any} staffList={list} onDataChange={refresh} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <MessageDialogProvider>
      <MyNumberUnlockProvider>
        <Page />
      </MyNumberUnlockProvider>
    </MessageDialogProvider>
  </ToastProvider>,
);
