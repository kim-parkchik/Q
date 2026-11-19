/**
 * Q の社会保険の届書（被扶養者（異動）届・3号関係届、健康保険だけの資格喪失・70歳到達届、育休の内訳と組合に出す申出書、
 * 休業終了時の月額変更届・養育期間の特例・住所や氏名の変更届の印刷）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/fuyou.html を開く
 * 会社：健保サービス株式会社（東京都。事業所整理記号 01-ケイト・事業所番号 123。前に作ったファイルの媒体通番は 030）
 * 社会保険規定：1 協会けんぽ／2 見本健康保険組合（事業所番号 00001）
 * マイナンバー：事務取扱担当者でログインしている。鍵のパスワードは「mihon-password-2026」
 * ■ 被扶養者（異動）届（今日は 2026年11月16日として見る）
 *   年金 正明（協会けんぽ・マイナンバーあり）：妻 年金 久美（11月7日に婚姻。マイナンバーあり）と子 年金 一郎（11月1日生まれ）を被扶養者に
 *     → 該当の1行（配偶者と、その他の被扶養者1）。第3号被保険者の届けを兼ねる
 *   厚年 三郎（協会けんぽ・基礎年金番号）：子3人（11月10日に離職した親と同居など）→ 該当の2行（2人と1人）
 *   健保 組合（健康保険組合）：妻（11月3日に婚姻・28歳）と子 → 年金事務所には妻の3号関係届だけ。2人とも組合の様式の一覧に
 *   就職 配偶（協会けんぽ）：届け出ている妻が11月1日に就職して外れた → 非該当
 *   改名 子供（協会けんぽ）：届け出ている子の氏名を直した → 変更（備考に変更前の氏名）
 * ■ 資格喪失届（2026年11月）：後期 太郎（協会けんぽ・11月10日に75歳）・後期 組合（健康保険組合・11月12日に75歳。組合にだけ）・
 *   障害 認定（66歳・11月5日に後期高齢者医療の障害認定）
 * ■ 70歳到達届（2026年11月）：七十 到達（11月9日生まれ → 11月8日に70歳。月給25万円・前の標準報酬月額 30万円 → 届けが要る）
 * ■ 産休・育休の申出書：分割 育休（10月1日〜7日と10月15日〜21日の産後パパ育休 → 1つの申出書に内訳）・組合 育休（健康保険組合）
 * ■ 休業終了時改定：終了 育休（7月31日に育休を終え、8〜10月の給与が下がった → 届書の内容を出す）
 * ■ 養育期間の特例：終了 育休の子（養育特例開始年月日 8月1日）
 * 「…を保存」で保存の窓の代わりに、保存したバイトを window.__savedFiles に足す
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import FuyouReportManager from "../../src/features/payroll/FuyouReportManager";
import ShikakuReportManager from "../../src/features/payroll/ShikakuReportManager";
import LeaveReportManager from "../../src/features/payroll/LeaveReportManager";
import LeaveEndRevisionManager from "../../src/features/payroll/LeaveEndRevisionManager";
import YouikuTokureiManager from "../../src/features/payroll/YouikuTokureiManager";
import HenkoReportManager from "../../src/features/payroll/HenkoReportManager";
import HealthDependentsSection from "../../src/features/settings/staff/HealthDependentsSection";
import { createKeys, encryptNumber, type DeriveKey } from "../../src/utils/myNumberCrypto";
import { emptyDependent, markedReported, type HealthDependent } from "../../src/utils/healthDependents";
import { familyKey } from "../../src/utils/myNumber";

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
      lastSavePath = String(args?.options?.defaultPath ?? "/tmp/SHFD0006.CSV");
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

const history = (...entries: [string, number][]) => JSON.stringify(entries.map(([from, amount]) => ({ from, amount, reason: "shutoku" })));
const person = (o: Record<string, unknown>) => ({
  social_insurance_group_id: 1, payroll_group_id: 1, wage_type: "monthly", gender: "male", standard_remuneration: 300000,
  standard_remuneration_history: history(["", 300000]), join_date: "2015-04-01", base_wage: 300000,
  zip_code: "120-8580", address: "東京都杉並区高井戸西3-5-24", address_kana: "トウキョウト スギナミク タカイドニシ 3-5-24", ...o,
});
const dep = (spouse: boolean, id: string, o: Partial<HealthDependent>): HealthDependent => ({
  ...emptyDependent(spouse, id), zip: "120-8580", address: "東京都杉並区高井戸西3-5-24", ...o,
});
const deps = (...list: HealthDependent[]) => JSON.stringify(list);
const kumi = dep(true, "kumi", { relation: "妻", name: "年金　久美", kana: "ネンキン クミ", birthday: "1990-03-26", gender: "female", job: "無職", income: 0, from: "2026-11-07", reason: "婚姻",
  phone: "03-3456-7890", phoneKind: "自宅", relationChecked: true });
const ichiro = dep(false, "ichiro", { relation: "実子・養子", name: "年金　一郎", kana: "ネンキン イチロウ", birthday: "2026-11-01", gender: "male", job: "小・中学生以下", income: 0, from: "2026-11-01", reason: "出生", relationChecked: true });
const leaves = (...list: Record<string, unknown>[]) => JSON.stringify(list);

const staffList: any[] = [
  // 被扶養者（異動）届
  person({ id: "7001", name: "年金　正明", furigana: "ネンキン マサアキ", birthday: "1988-10-10", pension_num: "10", health_dependents: deps(kumi, ichiro) }),
  person({ id: "7002", name: "厚年　三郎", furigana: "コウネン サブロウ", birthday: "1960-04-04", pension_num: "12", basic_pension_number: "1234-567890",
    health_dependents: deps(
      dep(false, "a", { relation: "父母・養父母", name: "厚年　太一", kana: "コウネン タイチ", birthday: "1935-01-05", gender: "male", job: "年金受給者", income: 800000, from: "2026-11-10", reason: "離職" }),
      dep(false, "b", { relation: "父母・養父母", name: "厚年　花代", kana: "コウネン ハナヨ", birthday: "1938-06-06", gender: "female", job: "無職", income: 600000, from: "2026-11-10", reason: "同居" }),
      dep(false, "c", { relation: "その他", relationNote: "叔母", name: "厚年　千代", kana: "コウネン チヨ", birthday: "1958-02-02", gender: "female", job: "無職", income: 0, from: "2026-11-10", reason: "同居" }),
    ) }),
  person({ id: "7003", name: "健保　組合", furigana: "ケンポ クミアイ", birthday: "1990-05-05", pension_num: "15", social_insurance_group_id: 2, health_ins_num: "88", basic_pension_number: "2345678901",
    health_dependents: deps(
      dep(true, "u1", { relation: "妻", name: "健保　由美", kana: "ケンポ ユミ", birthday: "1998-08-08", gender: "female", job: "パート", income: 900000, from: "2026-11-03", reason: "婚姻", basicPensionNumber: "3456789012" }),
      dep(false, "u2", { relation: "実子・養子", name: "健保　陸", kana: "ケンポ リク", birthday: "2020-01-01", gender: "male", job: "小・中学生以下", income: 0, from: "2026-11-03", reason: "その他", reasonNote: "婚姻による連れ子" }),
    ) }),
  person({ id: "7004", name: "就職　配偶", furigana: "シュウショク ハイグウ", birthday: "1985-07-07", pension_num: "16", basic_pension_number: "4567890123",
    health_dependents: deps({ ...dep(true, "s1", { relation: "妻", name: "就職　恵", kana: "シュウショク メグミ", birthday: "1987-09-09", gender: "female", job: "無職", income: 0, from: "2020-04-01", reason: "婚姻" }),
      reported: markedReported(dep(true, "s1", { name: "就職　恵", kana: "シュウショク メグミ", birthday: "1987-09-09", gender: "female" })), until: "2026-11-01", endReason: "就職・収入増加" }) }),
  person({ id: "7005", name: "改名　子供", furigana: "カイメイ コドモ", birthday: "1980-01-01", pension_num: "17", basic_pension_number: "5678901234",
    health_dependents: deps({ ...dep(false, "k1", { relation: "実子・養子", name: "改名　新子", kana: "カイメイ シンコ", birthday: "2010-05-05", gender: "female", job: "小・中学生以下", income: 0, from: "2010-05-05", reason: "出生" }),
      reported: markedReported(dep(false, "k1", { name: "旧姓　新子", kana: "キュウセイ シンコ", birthday: "2010-05-05", gender: "female" })) }) }),
  // 資格喪失届（健康保険だけ）と70歳到達届（2026年11月）
  person({ id: "7101", name: "後期　太郎", furigana: "コウキ タロウ", birthday: "1951-11-10", pension_num: "20", basic_pension_number: "6789012345" }),
  person({ id: "7102", name: "後期　組合", furigana: "コウキ クミアイ", birthday: "1951-11-12", pension_num: "21", social_insurance_group_id: 2, health_ins_num: "99", basic_pension_number: "7890123456" }),
  person({ id: "7103", name: "障害　認定", furigana: "ショウガイ ニンテイ", birthday: "1960-03-03", pension_num: "22", basic_pension_number: "8901234567", kouki_date: "2026-11-05" }),
  person({ id: "7104", name: "七十　到達", furigana: "ナナジュウ トウタツ", birthday: "1956-11-09", pension_num: "23", basic_pension_number: "9012345678", base_wage: 250000 }),
  // 産休・育休の申出書
  person({ id: "7201", name: "分割　育休", furigana: "ブンカツ イクキュウ", birthday: "1992-02-02", pension_num: "30", basic_pension_number: "0123456789",
    leave_periods: leaves(
      { type: "childcare", start: "2026-10-01", end: "2026-10-07", childName: "分割　陽", childKana: "ブンカツ ヨウ", childBirthday: "2026-09-25" },
      { type: "childcare", start: "2026-10-15", end: "2026-10-21", childName: "分割　陽", childKana: "ブンカツ ヨウ", childBirthday: "2026-09-25" },
    ) }),
  person({ id: "7202", name: "組合　育休", furigana: "クミアイ イクキュウ", birthday: "1991-03-03", gender: "female", pension_num: "31", social_insurance_group_id: 2, health_ins_num: "77",
    basic_pension_number: "1122334455",
    leave_periods: leaves({ type: "childcare", start: "2026-10-01", end: "2027-09-30", childName: "組合　光", childKana: "クミアイ ヒカリ", childBirthday: "2026-08-01" }) }),
  // 休業終了時改定・養育期間の特例
  person({ id: "7301", name: "終了　育休", furigana: "シュウリョウ イクキュウ", birthday: "1990-06-06", gender: "female", pension_num: "40", basic_pension_number: "2233445566",
    phone: "03-1111-2222",
    leave_periods: leaves({ type: "childcare", start: "2025-10-01", end: "2026-07-31", childName: "終了　蓮", childKana: "シュウリョウ レン", childBirthday: "2025-08-01" }),
    youiku_tokurei: JSON.stringify([{ childName: "終了　蓮", childBirthday: "2025-08-01", start: "2026-08-01", appliedOn: "", endDate: "", basisOverride: null }]) }),
];

const store = {
  company: {
    id: 1, name: "健保サービス株式会社", zip_code: "100-0000", address: "東京都千代田区霞が関1-2-2", phone: "03-1234-5678",
    representative: "健保 良一", shaho_office_symbol: "01-ケイト", shaho_office_number: "123", shaho_media_seq: 30,
  },
  groups: [
    { id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null as string | null, union_media_seq: 0 },
    { id: 2, name: "見本健康保険組合", type: "union", union_office_number: "00001" as string | null, union_media_seq: 4 },
  ],
  keys: null as any,
  numbers: [] as { staff_id: string; person: string; name: string; relation: string; number: string }[],
  logs: [] as { category: string; message: string }[],
};
(window as any).__fuyouStore = { store, staffList, saved };

/** マイナンバー（見本。年金 正明さんと妻・子） */
const setupMyNumbers = async () => {
  const { record, keys } = await createKeys(PASSWORD, deriveKey);
  store.keys = record;
  const list: [string, string, string, string][] = [
    ["7001", "self", "", "123456708900"],
    ["7001", familyKey("年金　久美", "1990-03-26"), "年金　久美", "123456078900"],
    ["7001", familyKey("年金　一郎", "2026-11-01"), "年金　一郎", "234567890123"],
  ];
  for (const [staffId, who, name, number] of list) {
    store.numbers.push({ staff_id: staffId, person: who, name, relation: who === "self" ? "" : "家族", number: await encryptNumber(keys, number, staffId, who) });
  }
};

/** 休業終了時改定の見本：終了 育休さんの、8〜10月に払った給与（短時間勤務で下がった） */
const salaries = [8, 9, 10].map((m) => ({
  staff_id: "7301", target_year: 2026, target_month: m, total_earnings: 240000, non_remuneration: 0, in_kind: 0, in_kind_detail: null,
  applied_base_wage: 240000, absence_deduction: 0, unpaid_leave_deduction: 0, prescribed_work_days: 21, leave_paid_days: null,
}));

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM company WHERE id = 1")) return [store.company];
    if (q.startsWith("SELECT id, name, prefecture, health_ins_num FROM branches")) return [{ id: 1, name: "本店", prefecture: "東京都", health_ins_num: "" }];
    if (q.startsWith("SELECT prefecture FROM branches WHERE id = 1")) return [{ prefecture: "東京都" }];
    if (q.startsWith("SELECT id, name, prefecture FROM branches")) return [{ id: 1, name: "本店", prefecture: "東京都" }];
    if (q.startsWith("SELECT id, name, type, union_office_number, union_media_seq FROM social_insurance_groups")) return store.groups;
    if (q.startsWith("SELECT group_id, from_month")) return [];
    if (q.startsWith("SELECT my_number_access FROM users")) return [{ my_number_access: 1 }];
    if (q.startsWith("SELECT staff_id, person, name, relation FROM my_numbers")) return store.numbers.map(({ number, ...rest }) => rest);
    if (q.startsWith("SELECT COUNT(*) AS n FROM my_numbers")) return [{ n: store.numbers.length }];
    if (q.startsWith("SELECT staff_id, person, number FROM my_numbers")) return store.numbers.map(({ staff_id, person, number }) => ({ staff_id, person, number }));
    if (q.startsWith("SELECT kdf, salt, wrapped_by_password")) {
      const r = store.keys;
      return [{ kdf: JSON.stringify(r.kdf), salt: r.salt, wrapped_by_password: r.wrappedByPassword, recovery_salt: r.recoverySalt, wrapped_by_recovery: r.wrappedByRecovery }];
    }
    if (q.startsWith("SELECT * FROM payroll_groups")) return [{ id: 1, name: "標準", closing_day: 99, is_next_month: 1, payment_day: 25 }];
    if (q.startsWith("SELECT staff_id, target_year, target_month, total_earnings")) return salaries;
    if (q.startsWith("SELECT staff_id, work_date")) return [];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET shaho_media_seq")) store.company.shaho_media_seq = Number(params[0]);
    else if (q.startsWith("UPDATE social_insurance_groups SET union_media_seq = ? WHERE id = ?")) {
      store.groups.find((g) => g.id === Number(params[1]))!.union_media_seq = Number(params[0]);
    } else if (q.startsWith("UPDATE staff SET health_dependents = ? WHERE id = ?")) {
      const s = staffList.find((x) => x.id === params[1]);
      if (s) s.health_dependents = params[0];
    } else if (q.startsWith("UPDATE staff SET leave_periods = ? WHERE id = ?")) {
      const s = staffList.find((x) => x.id === params[1]);
      if (s) s.leave_periods = params[0];
    } else if (q.startsWith("UPDATE staff SET youiku_tokurei = ? WHERE id = ?")) {
      const s = staffList.find((x) => x.id === params[1]);
      if (s) s.youiku_tokurei = params[0];
    } else if (q.startsWith("INSERT INTO app_logs")) {
      store.logs.push({ category: String(params[2]), message: String(params[3]) });
    } else console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

const user = { id: 1, login_id: "tanto", display_name: "事務 担当" };

/** 従業員の画面の「健康保険の被扶養者」だけを出す（見本：年金 正明さん） */
function DependentsEditor() {
  const [list, setList] = useState(JSON.parse(staffList[0].health_dependents) as HealthDependent[]);
  const cm: any = { targetHealthDependents: list, setTargetHealthDependents: setList, targetZip: "120-8580", targetAddress: "東京都杉並区高井戸西3-5-24" };
  return (
    <div style={{ backgroundColor: "white", padding: 20, borderRadius: 12, maxWidth: 900 }}>
      <HealthDependentsSection cm={cm} />
      <pre id="dependents-json" style={{ fontSize: 10, whiteSpace: "pre-wrap", color: "#64748b" }}>{JSON.stringify(list.map((d) => ({ name: d.name, until: d.until, reported: d.reported?.kind ?? null })))}</pre>
    </div>
  );
}

type Tab = "fuyou" | "dependents" | "shikaku" | "menjo" | "kyugyo" | "youiku" | "henko";
const TABS: [Tab, string][] = [
  ["fuyou", "被扶養者（異動）届"], ["dependents", "従業員の画面（被扶養者）"], ["shikaku", "資格喪失届・70歳到達届"], ["menjo", "産休・育休の申出書"],
  ["kyugyo", "休業終了時改定"], ["youiku", "養育期間の特例"], ["henko", "住所・氏名の変更届"],
];

function Page() {
  const [list, setList] = useState(staffList);
  const [tab, setTab] = useState<Tab>("fuyou");
  const refresh = () => setList(staffList.map((s) => ({ ...s })));
  return (
    <div style={{ padding: 20 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([key, label]) => (
          <button key={key} id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: tab === key ? "#2563eb" : "#e2e8f0", color: tab === key ? "white" : "#334155" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "fuyou" && <FuyouReportManager db={fakeDb as any} staffList={list} currentUser={user} onDataChange={refresh} />}
      {tab === "dependents" && <DependentsEditor />}
      {tab === "shikaku" && <ShikakuReportManager db={fakeDb as any} staffList={list} currentUser={user} />}
      {tab === "menjo" && <LeaveReportManager db={fakeDb as any} staffList={list} currentUser={user} onDataChange={refresh} />}
      {tab === "kyugyo" && <LeaveEndRevisionManager db={fakeDb as any} staffList={list} onDataChange={refresh} />}
      {tab === "youiku" && <YouikuTokureiManager db={fakeDb as any} staffList={list} onDataChange={refresh} />}
      {tab === "henko" && <HenkoReportManager db={fakeDb as any} staffList={list} />}
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
