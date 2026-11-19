/**
 * Q の「現物で払う報酬」（社宅・寮・食事・自社製品・定期券など。src/utils/genbutsu.ts）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/genbutsu.html を開く
 * ・従業員の画面の「現物で払う報酬」（src/features/settings/staff/InKindSection.tsx）と通勤手当の「定期券などを現物で渡す」
 *   （EmploymentSection.tsx）：選んだ人の行を変えると、下の給与明細と表が変わる
 * ・給与明細（src/features/payroll/PayStubModal.tsx）：2026年11月支給（末締め・当月払い。11月分の現物）。「給与確定」で残す列を window.__saved に入れる
 * 見本の5人（月給30万円・東京の本店。平日20日に8時間ずつ働いた）
 *   山田さん：社宅（令和8年9月分までは16畳、10月分からは総面積40平方メートル。家賃2万円）＋ 定期券（月1万5千円）を現物で渡す
 *            → 1,330円 × 40㎡ ＝ 53,200円 − 20,000円 ＝ 33,200円 ＋ 15,000円
 *   佐藤さん：寮の食事（毎日3食。食費1万円。所得税がかかる額 3千円）→ 25,500円 − 10,000円 ＝ 15,500円
 *   鈴木さん：自社製品（時価1万円）＋ 社員食堂の昼食（出勤した日ごと。本人1日100円）→ 10,000円 ＋ 300円 × 20日 − 2,000円
 *   田中さん：北海道の支店の社宅（総面積51平方メートル）→ 530円 × 51㎡ ＝ 27,030円（一覧表の Q&A の例）
 *            健康保険料は、札幌支店が本店の適用事業所にまとめて入っているので東京の料率（「札幌支店を別の適用事業所にする」に印を
 *            付けると、拠点に社会保険番号が入り、北海道の料率になる）。現物の価額は、どちらでも働く場所（北海道）の価額
 *   高橋さん：社宅の畳数だけ入れて、総面積がない（令和8年10月分からの価額を出せないので、確定できない）
 * ・賞与の画面（src/features/payroll/BonusManager.tsx）：2026年12月10日の冬季賞与。支給項目「自社製品」を現物で渡す項目にしてある
 *   山田さん：基本賞与40万円＋自社製品3万円 → 標準賞与額 43万円・差引支給額は自社製品を除いた額。「確定」で残す列を window.__bonusSaved に入れる
 *   佐藤さん：基本賞与30万円だけ
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import PayStubModal from "../../src/features/payroll/PayStubModal";
import BonusManager from "../../src/features/payroll/BonusManager";
import InKindSection from "../../src/features/settings/staff/InKindSection";
import EmploymentSection from "../../src/features/settings/staff/EmploymentSection";
import { calculateSalary } from "../../src/utils/calcSalary";
import { parseCommuteSetting, stringifyCommuteSetting, type CommuteSetting } from "../../src/utils/commuteAllowance";
import { parseInKind, stringifyInKind, type InKindEntry } from "../../src/utils/genbutsu";
import { salaryLedgerOf, wageLedgerRows } from "../../src/utils/legalBooks";
import { toKenpoPrefName } from "../../src/constants/prefectures";
import { kenpoPrefectureOf } from "../../src/utils/branchPrefecture";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
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
// 確定したときの知らせ（alert）は止めずに残す
(window as any).__alerts = [];
window.alert = (message?: unknown) => { (window as any).__alerts.push(String(message)); console.info("知らせ:", message); };

const pad = (n: number) => String(n).padStart(2, "0");
/** 2026年11月の平日（11月3日の文化の日を除く20日）に8時間ずつ */
const WORK_DAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${pad(i + 1)}`)
  .filter((d) => { const w = new Date(`${d}T00:00:00`).getDay(); return w >= 1 && w <= 5 && d !== "2026-11-03"; });
const attendanceOf = () => WORK_DAYS.map((d) => ({ work_date: d, work_hours: 8, night_hours: 0, work_type: "normal", is_finalized: 1 }));

const branches = [{ id: 1, name: "本店", prefecture: "東京都" }, { id: 2, name: "札幌支店", prefecture: "北海道" }];
const person = (o: Record<string, unknown>) => ({
  wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, standard_remuneration: 300000, birthday: "1985-04-10", join_date: "2015-04-01",
  social_insurance_group_id: 1, payroll_group_id: 1, branch_id: 1, calendar_pattern_id: 0, work_days: "mon,tue,wed,thu,fri",
  dependents: 0, commute_type: "none", commute_amount: 0, is_employment_ins_eligible: 1, status: "active", ...o,
});
const entries = (list: Partial<InKindEntry>[]) => JSON.stringify(list);
const initialStaff: any[] = [
  person({
    id: "3001", name: "山田 太郎", commute_type: "monthly", commute_amount: 15000, commute_setting: JSON.stringify({ method: "transit", inKind: true }),
    in_kind: entries([{ kind: "housing", name: "社宅", start: "2025-04-01", tatami: 16, area: 40, sharers: 1, selfPay: 20000 }]),
  }),
  person({ id: "3002", name: "佐藤 花子", in_kind: entries([{ kind: "meal", name: "寮の食事", start: "2024-04-01", mealPattern: "month", selfPay: 10000, taxable: 3000 }]) }),
  person({
    id: "3003", name: "鈴木 一郎",
    in_kind: entries([
      { kind: "other", name: "自社製品", start: "2026-01-01", value: 10000 },
      { kind: "meal", name: "社員食堂の昼食", start: "2026-01-01", mealPattern: "workday", lunch: true, selfPay: 100 },
    ]),
  }),
  person({ id: "3004", name: "田中 次郎", branch_id: 2, in_kind: entries([{ kind: "housing", name: "社宅", start: "2026-01-01", tatami: 20, area: 51, sharers: 1 }]) }),
  person({ id: "3005", name: "高橋 三郎", in_kind: entries([{ kind: "housing", name: "社宅", start: "2026-01-01", tatami: 16 }]) }),
];

// ── 会社ファイルの代わり（給与明細が読むもの） ──
const saved: Record<string, unknown>[] = [];
(window as any).__saved = saved;
const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT COUNT(*) AS n FROM salary_results")) return [{ n: saved.some((s) => s.staff_id === params[0]) ? 1 : 0 }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) {
      return [{ id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null, union_media_seq: 0 }];
    }
    if (q.startsWith("SELECT tax_calc_method")) {
      return [{ tax_calc_method: "table", social_ins_collection: "current", is_next_month: 0, proration_method: "none", leave_proration_method: "workdays", absence_deduction_method: "workdays", tardy_deduction_method: "none", flex_rule: null }];
    }
    if (q.startsWith("SELECT payment_day FROM payroll_groups")) return [{ payment_day: 25 }];
    if (q.startsWith("SELECT closing_day, is_next_month")) return [{ closing_day: 99, is_next_month: 0, shutdown_allowance_rate: 60 }];
    // 給与項目・組合の料率・年末調整・定額減税・祝日・会社カレンダー・前の計算期間の勤怠などは、ない
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const m = /INSERT INTO salary_results \(([^)]*)\)/.exec(sql.replace(/\s+/g, " "));
    if (m) {
      const cols = m[1].split(",").map((c) => c.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      const at = saved.findIndex((s) => s.staff_id === row.staff_id);
      if (at >= 0) saved.splice(at, 1);
      saved.push(row);
    }
    return { rowsAffected: 1 };
  },
};
const company = { week_start_day: 0, round_overtime: "round", round_social_ins: "currency_law", round_emp_ins: "currency_law" };

// ── 賞与の画面が読むもの（2026年12月10日の冬季賞与。「自社製品」は現物で渡す支給項目） ──
const bonusValues: Record<string, Record<number, number>> = { "3001": { 1: 400000, 2: 30000 }, "3002": { 1: 300000 } };
const bonusSaved: Record<string, unknown>[] = [];
(window as any).__bonusSaved = bonusSaved;
const bonusDb = {
  async select(sql: string, _params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM bonus_settings")) {
      return [{ id: 1, name: "冬季賞与", target_year: 2026, target_month: 12, payment_date: "2026-12-10", is_closed: bonusSaved.length > 0 ? 1 : 0 }];
    }
    if (q.startsWith("SELECT * FROM bonus_item_master")) {
      return [{ id: 1, name: "基本賞与", type: "earning", is_default_active: 1, in_kind: 0 }, { id: 2, name: "自社製品", type: "earning", is_default_active: 1, in_kind: 1 }];
    }
    if (q.startsWith("SELECT item_id FROM bonus_setting_items")) return [{ item_id: 1 }, { item_id: 2 }];
    if (q.startsWith("SELECT staff_id, item_id, amount FROM bonus_staff_values")) {
      return Object.entries(bonusValues).flatMap(([staff_id, v]) => Object.entries(v).map(([item_id, amount]) => ({ staff_id, item_id: Number(item_id), amount })));
    }
    if (q.includes("(taxable_amount - social_ins_total) as tax_base")) return [{ staff_id: "3001", tax_base: 250000 }, { staff_id: "3002", tax_base: 250000 }];
    if (q.startsWith("SELECT * FROM branches")) return branches;
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) return [{ id: 1, name: "協会けんぽ", type: "kyokai" }];
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [company];
    if (q.startsWith("SELECT id, closing_day, is_next_month FROM payroll_groups")) return [{ id: 1, closing_day: 99, is_next_month: 0 }];
    if (q.startsWith("SELECT COUNT(*) AS n FROM bonus_results")) return [{ n: bonusSaved.length }];
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    if (sql.includes("INSERT OR REPLACE INTO bonus_staff_values")) (bonusValues[params[1]] ??= {})[params[2]] = params[3];
    return { rowsAffected: 1 };
  },
  async executeBatch(statements: { sql: string; values?: unknown[] }[]) {
    for (const st of statements) {
      const m = /INSERT INTO bonus_results \(([^)]*)\)/.exec(st.sql.replace(/\s+/g, " "));
      if (m) {
        const cols = m[1].split(",").map((c) => c.trim());
        bonusSaved.push(Object.fromEntries(cols.map((c, i) => [c, st.values?.[i]])));
      }
    }
    return statements.map(() => ({ rowsAffected: 1, lastInsertId: 1 }));
  },
};
const yen = (n: number) => `${n.toLocaleString()}円`;

function Page() {
  const [staff, setStaff] = useState<any[]>(initialStaff);
  const [selected, setSelected] = useState("3001");
  const [open, setOpen] = useState(true);
  const s = staff.find((x) => x.id === selected)!;
  const patch = (p: Record<string, unknown>) => setStaff((list) => list.map((x) => (x.id === selected ? { ...x, ...p } : x)));
  const prefOf = (x: any) => branches.find((b) => b.id === x.branch_id)?.prefecture ?? "";
  // 札幌支店を、本店とは別の社会保険の適用事業所にする（拠点の「社会保険番号（支店固有の場合）」を入れる）
  const [separate, setSeparate] = useState(false);
  const branchList = useMemo(() => branches.map((b) => (b.id === 2 && separate ? { ...b, health_ins_num: "01-サツ" } : b)), [separate]);
  // 協会けんぽの健康保険料率の都道府県（給与明細の一覧と同じ決め方。utils/branchPrefecture.ts）
  const kenpoOf = (x: any) => kenpoPrefectureOf(branchList, x.branch_id).prefecture ?? "";

  // 従業員の画面の欄（現物で払う報酬・通勤手当）に渡すもの
  const cm: any = {
    targetInKind: parseInKind(s.in_kind), setTargetInKind: (list: InKindEntry[]) => patch({ in_kind: stringifyInKind(list) }),
    branches, targetBranchId: s.branch_id, setTargetBranchId: (v: number) => patch({ branch_id: Number(v) }),
    targetStatus: "active", setTargetStatus: () => {}, targetJoinDate: s.join_date, setTargetJoinDate: () => {},
    targetProbationEnd: "", setTargetProbationEnd: () => {}, targetRetirementDate: "", setTargetRetirementDate: () => {},
    targetCommuteType: s.commute_type, setTargetCommuteType: (v: string) => patch({ commute_type: v }),
    targetCommuteAmount: s.commute_amount, setTargetCommuteAmount: (v: number) => patch({ commute_amount: v }),
    targetCommuteSetting: parseCommuteSetting(s.commute_setting), setTargetCommuteSetting: (v: CommuteSetting) => patch({ commute_setting: stringifyCommuteSetting(v) }),
    payrollGroups: [{ id: 1, name: "全社（末締め当月払い）", fixed_break: null }], targetPayrollGroupId: 1, setTargetPayrollGroupId: () => {},
    targetFixedBreakApply: true, setTargetFixedBreakApply: () => {},
  };

  // 5人の給与（2026年11月支給・11月分の現物）
  const results = useMemo(() => staff.map((x) => ({
    x,
    r: calculateSalary(x, attendanceOf(), {
      allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: kenpoOf(x), workPrefecture: toKenpoPrefName(prefOf(x)) ?? "",
      dependents: 0, customItems: [], period: { start: "2026-11-01", end: "2026-11-30" }, periodWorkDays: 20, employedWorkDays: 20,
    }, 2026, 11, company),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [staff, branchList]);
  const ledgerRows = useMemo(() => {
    const { x, r } = results.find((v) => v.x.id === selected)!;
    return wageLedgerRows([{ label: "11月", kind: "salary", ledger: salaryLedgerOf(r, { wageType: x.wage_type, commuteType: x.commute_type, period: { start: "2026-11-01", end: "2026-11-30" } }) }]);
  }, [results, selected]);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>現物で払う報酬（確かめ用・2026年11月支給）</h1>
      <div>
        人：<select id="who" value={selected} onChange={(e) => { setSelected(e.target.value); setOpen(true); }}>
          {staff.map((x) => <option key={x.id} value={x.id}>{x.name}（{prefOf(x)}）</option>)}
        </select>
        <label style={{ marginLeft: 16 }}>
          <input id="separate" type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
          札幌支店を本店とは別の適用事業所にする（拠点に社会保険番号を入れる）
        </label>
      </div>

      <section>
        <h2 style={{ fontSize: 16 }}>1. 従業員の画面の欄（{s.name}）</h2>
        <div style={{ background: "white", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <EmploymentSection cm={cm} />
          <InKindSection cm={cm} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>2. 5人の給与（11月支給。支給合計・課税対象額・雇用保険料と現物）</h2>
        <table id="salary-table" style={{ background: "white", borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>{["", "支給合計", "現物（社会保険）", "うち課税", "うち雇用保険", "課税対象額", "雇用保険料", "健康保険料", "所得税", "差引支給額", "価額を出せない理由"].map((h) => (
              <th key={h} style={{ border: "1px solid #cbd5e1", padding: 4, background: "#f1f5f9" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {results.map(({ x, r }) => (
              <tr key={x.id} data-id={x.id}>
                <td style={{ border: "1px solid #e2e8f0", padding: 4 }}>{x.name}</td>
                {[r.totalEarnings, r.inKind?.amount ?? 0, r.inKind?.taxable ?? 0, r.inKind?.emp ?? 0, r.taxableAmount, r.empInsurance, r.healthInsurance, r.incomeTax, r.netPay].map((v, i) => (
                  <td key={i} style={{ border: "1px solid #e2e8f0", padding: 4, textAlign: "right" }}>{yen(v)}</td>
                ))}
                <td style={{ border: "1px solid #e2e8f0", padding: 4, color: "#b91c1c" }}>{r.inKind?.problems.join("・") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>3. 賃金台帳の行（{s.name}・11月）</h2>
        <table id="ledger-table" style={{ background: "white", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {ledgerRows.filter((r) => r.kind !== "hours" && r.kind !== "info").map((r) => (
              <tr key={r.label}><td style={{ border: "1px solid #e2e8f0", padding: "2px 8px" }}>{r.label}</td>
                <td style={{ border: "1px solid #e2e8f0", padding: "2px 8px", textAlign: "right" }}>{typeof r.cells[0] === "number" ? yen(r.cells[0]) : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>4. 賞与（冬季賞与・自社製品を現物で渡す）</h2>
        <div id="bonus" style={{ background: "white", borderRadius: 8, padding: 12 }}>
          <BonusManager db={bonusDb as any} staffList={staff.filter((x) => x.id === "3001" || x.id === "3002")} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>5. 給与明細（{s.name}）<button onClick={() => setOpen(true)} style={{ marginLeft: 8 }}>開く</button></h2>
        {/* 明細は画面いっぱいに重ねて出す作りなので、この枠の中に出す（transform の枠の中では fixed がこの枠になる） */}
        <div style={{ position: "relative", transform: "translateZ(0)", height: 1500, overflow: "hidden", borderRadius: 8 }}>
          {open && (
            <PayStubModal
              key={`${s.id}:${s.in_kind}:${s.commute_setting}:${s.commute_amount}:${s.branch_id}:${separate}`}
              db={fakeDb} year={2026} month={11} companySettings={company} onClose={() => setOpen(false)}
              staff={{ ...s, prefecture: prefOf(s), kenpoPrefecture: kenpoOf(s), periodStart: "2026-11-01", periodEnd: "2026-11-30", periodLabel: "11/1〜11/30" }}
              attendanceData={attendanceOf()}
            />
          )}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MessageDialogProvider>
    <ToastProvider>
      <Page />
    </ToastProvider>
  </MessageDialogProvider>,
);
