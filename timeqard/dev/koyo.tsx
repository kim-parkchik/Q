/**
 * Q の雇用保険の届書（資格取得届・資格喪失届と離職証明書・転勤届・個人番号登録届）・給付の書類・労働保険の年度更新・
 * 会社設定の「雇用保険・労働保険」・従業員の画面の「雇用保険の届書に書くこと」を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/koyo.html を開く
 * 会社：雇用サービス株式会社（東京都。社会保険の事業所整理記号 01-コヨウ・事業所番号 456。雇用保険適用事業所番号 1301-123456-7・
 *   飯田橋。前のＦＤ通番 011。労働保険番号 13101123456000・労災は 98 卸売業・小売業、飲食店又は宿泊業）
 * 拠点：1 本店（東京都）／2 大阪支店（雇用保険適用事業所番号 2701-654321-0・梅田。別の労働保険番号 27101654321000・94 その他の各種事業）
 * 給与：末日締め・翌月25日払い。月給の人は欠勤控除をする（日給月給）
 * マイナンバー：事務取扱担当者でログインしている。鍵のパスワードは「mihon-password-2026」
 * ■ 資格取得届（2026年11月）：雇用 新人（11月4日入社・月給25万円・通勤1.2万円・事務的職業・自己就職・マイナンバーあり）、
 *   外国 新人（11月10日入社・時給1,300円・週30時間・有期契約・ベトナム・技術・人文知識・国際業務）
 * ■ 資格喪失届（2026年11月）：退職 一郎（11月15日に自己都合で退職・月給30万円・離職票を希望 → 離職証明書）、
 *   定年 次郎（11月30日に60歳の定年で退職・日給1.2万円 → 59歳以上なので離職証明書）
 * ■ 転勤届：転勤 太郎（11月1日に本店から大阪支店へ）
 * ■ 個人番号登録届：番号 未届（マイナンバーを登録してあり、ハローワークにまだ届けていない）
 * ■ 給付の書類：育休 花子（産前産後休業 4月7日〜6月1日に続けて、6月2日から育児休業）、高年 太郎（2025年5月に60歳）
 * ■ 年度更新（令和7年度）：本店の人の2025年4月分〜2026年3月分の給与と、2025年7月・12月の賞与（パートは臨時労働者、役員は入れない）
 * 「…を保存」で保存の窓の代わりに、保存したバイトを window.__savedFiles に足す
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import dayjs from "dayjs";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import KoyoReportManager from "../../src/features/payroll/KoyoReportManager";
import KoyoBenefitManager from "../../src/features/payroll/KoyoBenefitManager";
import NendoKoshinManager from "../../src/features/payroll/NendoKoshinManager";
import LaborInsuranceTab from "../../src/features/settings/company/LaborInsuranceTab";
import KoyoSection from "../../src/features/settings/staff/KoyoSection";
import ForeignSection from "../../src/features/settings/staff/ForeignSection";
import { parseForeignInfo, type ForeignInfo } from "../../src/utils/foreignInfo";
import { createKeys, encryptNumber, type DeriveKey } from "../../src/utils/myNumberCrypto";
import { parseKoyoInfo, type KoyoInfo } from "../../src/utils/koyoInfo";

const PASSWORD = "mihon-password-2026";
const deriveKey: DeriveKey = async (password, salt) => {
  const bytes = new Uint8Array([...new TextEncoder().encode(password), ...salt]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
};

const saved: { name: string; bytes: Uint8Array }[] = [];
(window as any).__savedFiles = saved;
let lastSavePath = "";
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd === "plugin:dialog|save") {
      lastSavePath = String(args?.options?.defaultPath ?? "/tmp/koyo.csv");
      return lastSavePath;
    }
    if (cmd === "plugin:fs|write_file") {
      saved.push({ name: lastSavePath.split("/").pop() ?? "", bytes: args instanceof Uint8Array ? args : new Uint8Array(args) });
      return null;
    }
    if (cmd === "derive_key") return Array.from(await deriveKey(args.password, new Uint8Array(args.salt), {} as any));
    if (cmd === "plugin:path|resolve_directory") return "/docs";
    if (cmd === "plugin:path|join") return (args?.paths ?? []).join("/");
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

const info = (o: Partial<KoyoInfo>) => JSON.stringify({ ...parseKoyoInfo(null), ...o });
const person = (o: Record<string, unknown>) => ({
  payroll_group_id: 1, branch_id: 1, wage_type: "monthly", gender: "male", is_employment_ins_eligible: 1, is_executive: 0,
  scheduled_work_hours: 8, calendar_pattern_id: 1, work_days: "mon,tue,wed,thu,fri", zip_code: "120-8580",
  address: "東京都杉並区高井戸西3-5-24", phone: "090-1234-5678", join_date: "2019-04-01", base_wage: 300000, ...o,
});

const staffList: any[] = [
  person({ id: "8001", name: "雇用　新人", furigana: "コヨウ シンジン", birthday: "2003-04-10", join_date: "2026-11-04", base_wage: 250000,
    commute_type: "monthly", commute_amount: 12000, koyo_info: info({ occupation: "03", route: "2" }) }),
  person({ id: "8002", name: "グエン　バン　アン", furigana: "グエン バン アン", birthday: "1998-08-20", join_date: "2026-11-10", wage_type: "hourly",
    base_wage: 1300, scheduled_work_hours: 6, calendar_pattern_id: 0,
    koyo_info: info({
      occupation: "08", route: "1", contract: { has: true, start: "2026-11-10", end: "2027-11-09", renewal: "有" },
    }), foreign_info: JSON.stringify({ romaji: "NGUYEN VAN AN", nationality: "ベトナム", status: "35", statusText: "", periodEnd: "2029-03-31", permission: "無", card: "AB12345678CD", dispatch: "非該当", checkedOn: "2026-10-05" }) }),
  person({ id: "8003", name: "退職　一郎", furigana: "タイショク イチロウ", birthday: "1985-06-15", employment_ins_num: "1301-111111-1",
    retirement_date: "2026-11-15", retirement_reason: "一身上の都合による退職",
    koyo_info: info({ numberReported: true, loss: { cause: "", certificate: true, replacement: "無", causeText: "", reason: "5(2)", details: {},
      circumstances: "転職のため本人の申出により退職", wageNote: "", objection: "1", signature: "退職　一郎" } }) }),
  person({ id: "8004", name: "定年　次郎", furigana: "テイネン ジロウ", birthday: "1966-11-25", employment_ins_num: "1301-222222-2", wage_type: "daily",
    base_wage: 12000, retirement_date: "2026-11-30", retirement_reason: "定年退職",
    koyo_info: info({ numberReported: true, loss: { cause: "2", certificate: null, replacement: "有", causeText: "60歳定年による退職", reason: "2",
      details: { "選択２（定年年齢）": "60", "選択２（定年後の継続雇用）": "1" }, circumstances: "就業規則の定年（60歳）による退職。継続雇用を希望しなかった", wageNote: "",
      objection: "", signature: "" } }) }),
  person({ id: "8005", name: "転勤　太郎", furigana: "テンキン タロウ", birthday: "1980-02-02", employment_ins_num: "1301-333333-3", branch_id: 2,
    koyo_info: info({ numberReported: true, transfers: [{ on: "2026-11-01", from: 1, to: 2 }] }) }),
  person({ id: "8006", name: "番号　未届", furigana: "バンゴウ ミトドケ", birthday: "1975-12-12", employment_ins_num: "1301-444444-4", gender: "female" }),
  person({ id: "8007", name: "育休　花子", furigana: "イクキュウ ハナコ", birthday: "1993-07-07", gender: "female", employment_ins_num: "1301-555555-5",
    koyo_info: info({ numberReported: true }),
    leave_periods: JSON.stringify([
      { type: "maternity", start: "2026-04-07", end: "2026-06-01", dueDate: "2026-05-18", birthDate: "2026-04-06" },
      { type: "childcare", start: "2026-06-02", end: "2027-04-05", childName: "育休　陽", childKana: "イクキュウ ヒナタ", childBirthday: "2026-04-06" },
    ]) }),
  person({ id: "8008", name: "高年　太郎", furigana: "コウネン タロウ", birthday: "1965-05-10", employment_ins_num: "1301-666666-6", koyo_info: info({ numberReported: true }) }),
  person({ id: "8009", name: "パート　臨時", furigana: "パート リンジ", birthday: "2000-01-01", wage_type: "hourly", base_wage: 1200, is_employment_ins_eligible: 0 }),
  person({ id: "8010", name: "役員　一人", furigana: "ヤクイン ヒトリ", birthday: "1970-01-01", is_executive: 1, is_employment_ins_eligible: 0, base_wage: 600000 }),
];

const store = {
  company: {
    id: 1, name: "雇用サービス株式会社", zip_code: "100-0001", address: "東京都千代田区千代田1-1", phone: "03-1234-5678",
    representative: "雇用　良一", shaho_office_symbol: "01-コヨウ", shaho_office_number: "456", labor_ins_num: "13101123456000",
    koyo_office_number: "1301-123456-7", koyo_hello_work: "飯田橋", koyo_media_seq: 11, rousai_business: "98", rousai_rate: null as number | null,
    nendo_koshin: null as string | null, default_emp_ins_type: "general",
  },
  branches: [
    { id: 1, name: "本店", prefecture: "東京都", zip_code: "100-0001", address: "東京都千代田区千代田1-1", phone: "03-1234-5678", labor_ins_num: null, koyo_office_number: null, koyo_hello_work: null, rousai_business: null, rousai_rate: null },
    { id: 2, name: "大阪支店", prefecture: "大阪府", zip_code: "530-0001", address: "大阪府大阪市北区梅田1-1", phone: "06-1111-2222", labor_ins_num: "27101654321000",
      koyo_office_number: "2701-654321-0", koyo_hello_work: "梅田", rousai_business: "94", rousai_rate: null },
  ] as any[],
  keys: null as any,
  numbers: [] as { staff_id: string; person: string; name: string; relation: string; number: string }[],
  logs: [] as { category: string; message: string }[],
};

// ── 確定した給与と勤怠（見本） ──
const fmt = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
const salaries: any[] = [];
const attendance: any[] = [];
const workers = staffList.filter((s) => !["8001", "8002"].includes(s.id));
for (const s of workers) {
  const leaves = s.leave_periods ? JSON.parse(s.leave_periods) : [];
  const onLeave = (d: string) => leaves.some((l: any) => d >= l.start && d <= l.end);
  const end = s.retirement_date ?? "2026-10-31";
  for (let d = dayjs("2024-04-01"); !d.isAfter(dayjs(end), "day"); d = d.add(1, "day")) {
    if (d.day() === 0 || d.day() === 6 || onLeave(fmt(d))) continue;
    attendance.push({ staff_id: s.id, work_date: fmt(d), work_type: "normal", work_hours: s.scheduled_work_hours, is_finalized: 1 });
  }
  for (let m = dayjs("2024-04-01"); !m.isAfter(dayjs(end), "month"); m = m.add(1, "month")) {
    const pStart = fmt(m.startOf("month"));
    const pEnd = fmt(m.endOf("month"));
    const to = end < pEnd ? end : pEnd;
    const days = attendance.filter((a) => a.staff_id === s.id && a.work_date >= pStart && a.work_date <= to).length;
    const leaveDays = leaves.length > 0 ? [...Array(m.daysInMonth())].filter((_, i) => onLeave(fmt(m.date(i + 1)))).length : 0;
    let earnings: { name: string; amount: number }[];
    if (s.wage_type === "monthly") {
      const ratio = leaveDays > 0 ? Math.max(0, (m.daysInMonth() - leaveDays) / m.daysInMonth()) : to < pEnd ? 0.5 : 1;
      earnings = [{ name: "基本給", amount: Math.round(s.base_wage * ratio) }, { name: "時間外手当", amount: ratio > 0 ? 20000 : 0 }, { name: "通勤手当", amount: ratio > 0 ? 10000 : 0 }];
    } else if (s.wage_type === "daily") {
      earnings = [{ name: "日給", amount: s.base_wage * days }, { name: "時間外手当", amount: 15000 }, { name: "通勤手当", amount: 8000 }];
    } else {
      earnings = [{ name: "時給分", amount: s.base_wage * s.scheduled_work_hours * days }];
    }
    const total = earnings.reduce((t, e) => t + e.amount, 0);
    if (total === 0) continue;
    const pay = m.add(1, "month");
    salaries.push({
      staff_id: s.id, target_year: pay.year(), target_month: pay.month() + 1, total_earnings: total, non_remuneration: 0, in_kind_emp: 0,
      emp_insurance: s.is_employment_ins_eligible ? Math.round(total * 0.0055) : 0,
      ledger: JSON.stringify({ periodStart: pStart, periodEnd: pEnd, workDays: days, workHours: 0, overtimeHours: 0, holidayHours: 0, nightHours: 0, earnings, deductions: [] }),
    });
  }
}
const bonuses = [
  { staff_id: "8003", total_earnings: 400000, emp_insurance: 2200, payment_date: "2025-07-10", target_year: 2025, target_month: 7 },
  { staff_id: "8006", total_earnings: 350000, emp_insurance: 1925, payment_date: "2025-07-10", target_year: 2025, target_month: 7 },
  { staff_id: "8003", total_earnings: 450000, emp_insurance: 2475, payment_date: "2025-12-10", target_year: 2025, target_month: 12 },
  { staff_id: "8006", total_earnings: 380000, emp_insurance: 2090, payment_date: "2025-12-10", target_year: 2025, target_month: 12 },
];
(window as any).__koyoStore = { store, staffList, saved, salaries, attendance };

/** マイナンバー（見本） */
const setupMyNumbers = async () => {
  const { record, keys } = await createKeys(PASSWORD, deriveKey);
  store.keys = record;
  const list: [string, string][] = [["8001", "123456789018"], ["8003", "234567890123"], ["8006", "345678901236"]];
  for (const [staffId, number] of list) {
    store.numbers.push({ staff_id: staffId, person: "self", name: "", relation: "", number: await encryptNumber(keys, number, staffId, "self") });
  }
};

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT * FROM branches ORDER BY id ASC")) return store.branches;
    if (q.startsWith("SELECT * FROM payroll_groups")) return [{ id: 1, name: "標準", closing_day: 99, is_next_month: 1, payment_day: 25, absence_deduction_method: "workdays" }];
    if (q.startsWith("SELECT v.staff_id, v.amount, m.type, m.category, m.average_wage")) return [];
    if (q.startsWith("SELECT target_year, target_month, ledger, total_earnings")) return salaries.filter((s) => s.staff_id === params[0]);
    if (q.startsWith("SELECT work_date, work_type, work_hours")) return attendance.filter((a) => a.staff_id === params[0] && a.work_date >= params[1] && a.work_date <= params[2]);
    if (q.startsWith("SELECT holiday_date FROM holiday_master")) return [];
    if (q.startsWith("SELECT work_date, is_holiday FROM company_calendar")) return [];
    if (q.startsWith("SELECT staff_id, target_year, target_month, total_earnings, non_remuneration, in_kind_emp, emp_insurance, ledger")) {
      return salaries.filter((s) => s.target_year * 100 + s.target_month >= params[0] && s.target_year * 100 + s.target_month <= params[1]);
    }
    if (q.startsWith("SELECT r.staff_id, r.total_earnings, r.emp_insurance, s.payment_date")) return bonuses;
    if (q.startsWith("SELECT my_number_access FROM users")) return [{ my_number_access: 1 }];
    if (q.startsWith("SELECT staff_id, person, name, relation FROM my_numbers")) return store.numbers.map(({ number, ...rest }) => rest);
    if (q.startsWith("SELECT COUNT(*) AS n FROM my_numbers")) return [{ n: store.numbers.length }];
    if (q.startsWith("SELECT staff_id, person, number FROM my_numbers")) return store.numbers.map(({ staff_id, person, number }) => ({ staff_id, person, number }));
    if (q.startsWith("SELECT kdf, salt, wrapped_by_password")) {
      const r = store.keys;
      return [{ kdf: JSON.stringify(r.kdf), salt: r.salt, wrapped_by_password: r.wrappedByPassword, recovery_salt: r.recoverySalt, wrapped_by_recovery: r.wrappedByRecovery }];
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET koyo_media_seq")) store.company.koyo_media_seq = Number(params[0]);
    else if (q.startsWith("UPDATE company SET nendo_koshin")) store.company.nendo_koshin = String(params[0]);
    else if (q.startsWith("UPDATE company SET koyo_office_number")) {
      Object.assign(store.company, { koyo_office_number: params[0], koyo_hello_work: params[1], rousai_business: params[2], rousai_rate: params[3] });
    } else if (q.startsWith("UPDATE branches SET koyo_office_number")) {
      Object.assign(store.branches.find((b) => b.id === Number(params[4]))!, { koyo_office_number: params[0], koyo_hello_work: params[1], rousai_business: params[2], rousai_rate: params[3] });
    } else if (q.startsWith("UPDATE staff SET koyo_info = ? WHERE id = ?")) {
      const s = staffList.find((x) => x.id === params[1]);
      if (s) s.koyo_info = params[0];
    } else if (q.startsWith("INSERT INTO app_logs") || q.startsWith("INSERT INTO my_number_logs")) {
      store.logs.push({ category: String(params[2] ?? ""), message: String(params[3] ?? params.join(" ")) });
    } else console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

const user = { id: 1, login_id: "tanto", display_name: "事務 担当" };

/** 従業員の画面の「雇用保険の届書に書くこと」だけを出す（見本：定年 次郎さん） */
function KoyoEditor() {
  const s = staffList.find((x) => x.id === "8004");
  const [value, setValue] = useState<KoyoInfo>(parseKoyoInfo(s.koyo_info));
  // 在留資格の情報の欄（見本：外国人の方。在留期間の満了日を近くして、知らせを出す）
  const [foreign, setForeign] = useState<ForeignInfo | null>({ ...parseForeignInfo(staffList.find((x) => x.foreign_info)?.foreign_info)!, periodEnd: "2027-01-31" });
  const cm: any = {
    targetKoyoInfo: value, setTargetKoyoInfo: setValue, targetIsEmploymentInsEligible: 1, targetWageType: s.wage_type, targetWage: s.base_wage,
    targetDailyHours: 8, targetWorkDays: s.work_days, targetPatternId: 1, targetCommuteType: "none", targetCommuteAmount: 0,
    targetRetirementDate: s.retirement_date, targetDeathDate: "", targetBirthday: s.birthday, targetRetirementReason: s.retirement_reason,
    targetBranchId: 1, branches: store.branches,
  };
  return (
    <div style={{ backgroundColor: "white", padding: 20, borderRadius: 12, maxWidth: 900 }}>
      <ForeignSection cm={{ targetForeignInfo: foreign, setTargetForeignInfo: setForeign } as any} />
      <pre id="foreign-json" style={{ fontSize: 10, whiteSpace: "pre-wrap", color: "#64748b" }}>{JSON.stringify(foreign)}</pre>
      <KoyoSection cm={cm} />
      <pre id="koyo-json" style={{ fontSize: 10, whiteSpace: "pre-wrap", color: "#64748b" }}>{JSON.stringify({ reason: value.loss.reason, details: value.loss.details })}</pre>
    </div>
  );
}

type Tab = "koyo" | "kyufu" | "nendo" | "settings" | "staff";
const TABS: [Tab, string][] = [["koyo", "雇用保険の届書"], ["kyufu", "雇用保険の給付の書類"], ["nendo", "労働保険の年度更新"], ["settings", "会社設定（雇用保険・労働保険）"], ["staff", "従業員の画面（雇用保険）"]];

function Page() {
  const [tab, setTab] = useState<Tab>("koyo");
  return (
    <div style={{ padding: 20 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => (
          <button key={key} id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: tab === key ? "#2563eb" : "#e2e8f0", color: tab === key ? "white" : "#334155" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "koyo" && <KoyoReportManager db={fakeDb as any} staffList={staffList} currentUser={user} />}
      {tab === "kyufu" && <KoyoBenefitManager db={fakeDb as any} staffList={staffList} />}
      {tab === "nendo" && <NendoKoshinManager db={fakeDb as any} staffList={staffList} />}
      {tab === "settings" && <LaborInsuranceTab db={fakeDb as any} />}
      {tab === "staff" && <KoyoEditor />}
    </div>
  );
}

setupMyNumbers().then(() => {
  createRoot(document.getElementById("root")!).render(
    <MessageDialogProvider>
      <ToastProvider>
        <MyNumberUnlockProvider>
          <Page />
        </MyNumberUnlockProvider>
      </ToastProvider>
    </MessageDialogProvider>,
  );
});
