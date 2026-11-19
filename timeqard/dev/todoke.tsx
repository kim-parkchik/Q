/**
 * Q の「算定基礎（定時決定）」と「月変（随時改定）」の画面（src/features/payroll/SanteiManager.tsx・ZuijiManager.tsx）を、
 * 見本の値で画面に出す（開発用。配るものには入らない）。算定基礎届・月額変更届の電子申請用ファイルと印刷を確かめる
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/todoke.html を開く
 * 会社：株式会社健保産業（東京都。事業所整理記号 57-ケマ。前に作ったファイルの媒体通番は 023）。末日締め翌月25日払い
 *   山田さん：ふつうの人（4〜6月に31万円）
 *   佐藤さん：2026年3月10日に入社（4月に払った3月分は日割り → 途中入社で修正平均額）
 *   鈴木さん：1956年4月10日生まれ（4月9日に70歳。ガイドブックのケース⑥と同じ額 → 70歳算定基礎月 06）。7月に昇給（10月改定の月変）
 *   田中さん：4月に昇給し、4月の給与に3月分の差額2万円が入っている（「うち遡及分」に2万円を入れると、算定基礎届の遡及支払額と修正平均額。
 *            月変の画面でも入れると、2等級差が1等級差になる）
 *   髙橋さん：時給のパート（16・15・16日 → 区分を「短時間就労者（パート）」にすると15日以上の月で平均）・二以上事業所勤務者
 *   小林さん：健康保険組合の人（年金事務所の届書には健保の従前の標準報酬月額を書かない。組合に出すファイル（KPFD0006.CSV）には書く。
 *            見本健康保険組合の事業所番号 00001・被保険者等番号 26・前の媒体通番 004）
 *   中村さん：76歳（70歳以上被用者算定基礎届のみ。整理番号なし・基礎年金番号 0123-012345）
 *   加藤さん：整理番号がない・フリガナにスペースがない（直すところがあるので、チェックを外すとファイルを作れる）
 *   伊藤さん：6月15日に入社（算定基礎届の対象外）／渡辺さん：7月改定の月変を登録済み（対象外）
 *   山本さん：6月に降給（9月改定の月変 → 算定基礎届ではチェックを外す）
 *   吉田さん：社宅（東京・16畳・家賃なし）に住んでいる（4〜6月の報酬に現物 45,280円 → 算定基礎届の⑫現物）
 *   松本さん：6月11日に社宅（同じ）に入った。7月に払う6月分は日割り（30,186円）、8月に払う7月分から1か月分（45,280円）
 *            → 1か月分そろった8月が変動月（現物 0 → 45,280円）。8〜10月の平均 295,280円で、従前 26万円から2等級上がり、11月改定
 * 「電子申請用のファイルを保存」で保存の窓の代わりに、保存したバイトを window.__savedFile に入れる
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
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
const history = (...entries: [string, number, string][]) => JSON.stringify(entries.map(([from, amount, reason]) => ({ from, amount, reason })));
const person = (o: Record<string, unknown>) => ({
  join_date: "2015-04-01", social_insurance_group_id: 1, payroll_group_id: 1, wage_type: "monthly", ...o,
});

const staffList: any[] = [
  person({ id: "2001", name: "山田 太郎", furigana: "ヤマダ タロウ", birthday: "1985-04-10", pension_num: "3", base_wage: 280000,
    standard_remuneration: 300000, standard_remuneration_history: history(["", 300000, "shutoku"], ["2025-09", 300000, "teiji"]) }),
  person({ id: "2002", name: "佐藤 花子", furigana: "サトウ ハナコ", birthday: "1992-08-20", pension_num: "21", join_date: "2026-03-10", base_wage: 300000,
    standard_remuneration: 300000, standard_remuneration_history: history(["", 300000, "shutoku"]) }),
  person({ id: "2003", name: "鈴木 一郎", furigana: "スズキ イチロウ", birthday: "1956-04-10", pension_num: "8", basic_pension_number: "1234-567890", base_wage: 300000,
    standard_remuneration: 320000, standard_remuneration_history: history(["", 320000, "shutoku"], ["2025-09", 320000, "teiji"]) }),
  person({ id: "2004", name: "田中 次郎", furigana: "タナカ ジロウ", birthday: "1975-01-15", pension_num: "12", base_wage: 267000,
    standard_remuneration: 240000, standard_remuneration_history: history(["", 240000, "shutoku"], ["2025-09", 240000, "teiji"]) }),
  person({ id: "2005", name: "髙橋 三郎", furigana: "タカハシ サブロウ", birthday: "1980-06-30", pension_num: "15", wage_type: "hourly", base_wage: 1300, multi_office: 1,
    standard_remuneration: 118000, standard_remuneration_history: history(["", 118000, "shutoku"], ["2025-09", 118000, "teiji"]) }),
  person({ id: "2006", name: "小林 健康", furigana: "コバヤシ ケンコウ", birthday: "1988-02-02", pension_num: "30", social_insurance_group_id: 2, health_ins_num: "26", base_wage: 265000,
    standard_remuneration: 260000, standard_remuneration_history: history(["", 260000, "shutoku"], ["2025-09", 260000, "teiji"]) }),
  person({ id: "2007", name: "中村 長寿", furigana: "ナカムラ チョウジュ", birthday: "1950-03-01", pension_num: "", basic_pension_number: "0123-012345", base_wage: 200000,
    standard_remuneration: 200000, standard_remuneration_history: history(["", 200000, "shutoku"], ["2025-09", 200000, "teiji"]) }),
  person({ id: "2008", name: "加藤 番号なし", furigana: "カトウバンゴウナシ", birthday: "1995-05-05", pension_num: "", base_wage: 250000,
    standard_remuneration: 250000, standard_remuneration_history: history(["", 250000, "shutoku"]) }),
  person({ id: "2009", name: "伊藤 新人", furigana: "イトウ シンジン", birthday: "2000-01-01", pension_num: "40", join_date: "2026-06-15", base_wage: 220000,
    standard_remuneration: 220000, standard_remuneration_history: history(["", 220000, "shutoku"]) }),
  person({ id: "2010", name: "渡辺 月変", furigana: "ワタナベ ゲッペン", birthday: "1983-03-03", pension_num: "41", base_wage: 340000,
    standard_remuneration: 340000, standard_remuneration_history: history(["", 300000, "shutoku"], ["2025-09", 300000, "teiji"], ["2026-07", 340000, "zuiji"]) }),
  person({ id: "2011", name: "山本 降給", furigana: "ヤマモト コウキュウ", birthday: "1979-11-11", pension_num: "44", base_wage: 260000,
    standard_remuneration: 340000, standard_remuneration_history: history(["", 340000, "shutoku"], ["2025-09", 340000, "teiji"]) }),
  person({ id: "2012", name: "吉田 社宅", furigana: "ヨシダ シャタク", birthday: "1987-07-07", pension_num: "45", base_wage: 250000,
    standard_remuneration: 300000, standard_remuneration_history: history(["", 300000, "shutoku"], ["2025-09", 300000, "teiji"]) }),
  person({ id: "2013", name: "松本 入居", furigana: "マツモト ニュウキョ", birthday: "1991-09-09", pension_num: "46", base_wage: 250000,
    standard_remuneration: 260000, standard_remuneration_history: history(["", 260000, "shutoku"], ["2025-09", 260000, "teiji"]) }),
];

/** 支給月ごとの総支給額と基本給（[総支給, 基本給]。書いていない月は、その人のいつもの額） */
const pay: Record<string, { usual: [number, number]; months?: Record<string, [number, number]>; from?: string }> = {
  "2001": { usual: [310000, 280000] },
  "2002": { usual: [300000, 300000], from: "2026-04", months: { "2026-04": [232258, 300000] } },
  "2003": { usual: [300000, 300000], months: { "2026-04": [326500, 300000], "2026-05": [284550, 300000], "2026-06": [282140, 300000],
    "2026-07": [400000, 380000], "2026-08": [400000, 380000], "2026-09": [400000, 380000], "2026-10": [400000, 380000] } },
  "2004": { usual: [267000, 267000], months: Object.fromEntries([
    ...PAY_MONTHS.filter((p) => ym(p.year, p.month) < "2026-04").map((p) => [ym(p.year, p.month), [250000, 250000]]),
    ["2026-04", [287000, 267000]],
  ]) },
  "2005": { usual: [120000, 1300], months: { "2026-04": [124800, 1300], "2026-05": [117000, 1300], "2026-06": [124800, 1300] } },
  "2006": { usual: [265000, 265000] },
  "2007": { usual: [200000, 200000] },
  "2008": { usual: [250000, 250000] },
  "2009": { usual: [220000, 220000], from: "2026-07" },
  "2010": { usual: [350000, 340000], months: Object.fromEntries(PAY_MONTHS.filter((p) => ym(p.year, p.month) < "2026-04").map((p) => [ym(p.year, p.month), [310000, 300000]])) },
  "2011": { usual: [270000, 260000], months: Object.fromEntries(PAY_MONTHS.filter((p) => ym(p.year, p.month) < "2026-06").map((p) => [ym(p.year, p.month), [350000, 330000]])) },
  "2012": { usual: [250000, 250000] },
  "2013": { usual: [250000, 250000] },
};
/** 現物（社宅）の記録：支給月 → [現物の額, 1か月分の固定的な額, 1か月分そろっているか]（翌月払いなので、前の月の分。null は現物なし） */
const inKindRecords: Record<string, (payMonth: string) => [number, number, boolean] | null> = {
  "2012": () => [45280, 45280, true],
  "2013": (k) => (k < "2026-07" ? null : k === "2026-07" ? [30186, 45280, false] : [45280, 45280, true]),
};
const inKindColumns = (staffId: string, year: number, month: number) => {
  const v = inKindRecords[staffId]?.(ym(year, month));
  if (!v) return { in_kind: 0, in_kind_detail: null };
  const prev = month === 1 ? ym(year - 1, 12) : ym(year, month - 1);
  return {
    in_kind: v[0],
    in_kind_detail: JSON.stringify({
      month: prev, settled: v[2], fixed: { monthly: v[1], daily: 0 },
      lines: [{ name: "社宅", kind: "housing", amount: v[0], taxable: 0, emp: 0, detail: "1畳 2,830円 × 16畳" }],
    }),
  };
};
const salaries = Object.entries(pay).flatMap(([staffId, p]) => PAY_MONTHS
  .filter((m) => !p.from || ym(m.year, m.month) >= p.from)
  .map((m) => {
    const [total, base] = p.months?.[ym(m.year, m.month)] ?? p.usual;
    return {
      staff_id: staffId, target_year: m.year, target_month: m.month, total_earnings: total, non_remuneration: 0,
      absence_deduction: 0, unpaid_leave_deduction: 0, prescribed_work_days: 21, leave_paid_days: null,
      applied_base_wage: base, fixed_overtime_allowance: 0, non_fixed_earnings: staffId === "2005" ? 0 : Math.max(0, total - base),
      ...inKindColumns(staffId, m.year, m.month),
    };
  }));

/** 髙橋さん（時給）の勤怠：3月16日・4月15日・5月16日（4・5・6月に払う給与の分）。そのほかの月は18日 */
const attendance: any[] = [];
for (const [y, m, days] of [[2025, 6, 18], [2025, 7, 18], [2025, 8, 18], [2025, 9, 18], [2025, 10, 18], [2025, 11, 18], [2025, 12, 18], [2026, 1, 18], [2026, 2, 18], [2026, 3, 16], [2026, 4, 15], [2026, 5, 16], [2026, 6, 18], [2026, 7, 18], [2026, 8, 18], [2026, 9, 18]] as const) {
  for (let d = 1; d <= days; d++) attendance.push({ staff_id: "2005", work_date: `${ym(y, m)}-${String(d).padStart(2, "0")}`, work_type: "normal", work_hours: 6, leave_paid: null });
}

const store = {
  company: {
    id: 1, name: "株式会社健保産業", zip_code: "168-8505", address: "東京都杉並区高井戸3-5-24", phone: "03-2345-6789",
    representative: "健保 良一", shaho_office_symbol: "57-ケマ", shaho_office_number: "12345", shaho_media_seq: 23,
  },
  /** 見本健康保険組合の事業所番号と、組合に出すファイルの前の媒体通番 */
  union: { office: "00001", seq: 4 },
};
(window as any).__todokeStore = { store, staffList, salaries };

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT id, name, prefecture, health_ins_num FROM branches")) return [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
    if (q.startsWith("SELECT prefecture FROM branches WHERE id = 1")) return [{ prefecture: "東京都" }];
    if (q.startsWith("SELECT * FROM payroll_groups")) return [{ id: 1, name: "本社", closing_day: 99, is_next_month: 1, payment_day: 25 }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) {
      return [{ id: 1, name: "協会けんぽ", type: "kyokai" }, { id: 2, name: "見本健康保険組合", type: "union", union_office_number: store.union.office, union_media_seq: store.union.seq }];
    }
    if (q.startsWith("SELECT group_id, from_month")) return [];
    if (q.includes("FROM salary_results WHERE (target_year = ? AND target_month >= 7) OR (target_year = ? AND target_month <= 6)")) {
      return salaries.filter((s) => (s.target_year === params[0] && s.target_month >= 7) || (s.target_year === params[1] && s.target_month <= 6));
    }
    if (q.includes("FROM salary_results WHERE (target_year * 12 + target_month) BETWEEN ? AND ?")) {
      return salaries.filter((s) => s.target_year * 12 + s.target_month >= params[0] && s.target_year * 12 + s.target_month <= params[1]);
    }
    if (q.startsWith("SELECT staff_id, work_date, work_type, work_hours, leave_paid FROM attendance")) {
      return attendance.filter((a) => a.work_date >= params[0] && a.work_date <= params[1]);
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET shaho_media_seq")) store.company.shaho_media_seq = Number(params[0]);
    else if (q.startsWith("UPDATE social_insurance_groups SET union_media_seq = ? WHERE id = ?")) store.union.seq = Number(params[0]);
    else if (q.startsWith("UPDATE staff SET standard_remuneration_history")) {
      const s = staffList.find((x) => x.id === params[2]);
      if (s) Object.assign(s, { standard_remuneration_history: params[0], standard_remuneration: params[1] });
    } else if (!q.startsWith("INSERT INTO app_logs")) console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

function Page() {
  const [list, setList] = useState(staffList);
  const [tab, setTab] = useState<"santei" | "zuiji">("santei");
  const refresh = () => setList(staffList.map((s) => ({ ...s })));
  const tabButton = (key: "santei" | "zuiji", label: string) => (
    <button id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: tab === key ? "#2563eb" : "#e2e8f0", color: tab === key ? "white" : "#334155" }}>
      {label}
    </button>
  );
  return (
    <div style={{ padding: 20 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabButton("santei", "算定基礎（定時決定）")}
        {tabButton("zuiji", "月変（随時改定）")}
      </div>
      {tab === "santei"
        ? <SanteiManager db={fakeDb as any} staffList={list} onDataChange={refresh} />
        : <ZuijiManager db={fakeDb as any} staffList={list} onDataChange={refresh} />}
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
