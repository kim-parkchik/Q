/**
 * Q の「資格取得・喪失届」と「産休・育休の申出書」の画面（src/features/payroll/ShikakuReportManager.tsx・LeaveReportManager.tsx）を、
 * 見本の値で画面に出す（開発用。配るものには入らない）。電子申請用のファイル・健康保険組合に出すファイル・マイナンバー・印刷を確かめる
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/shikaku.html を開く
 * 会社：健保サービス株式会社（東京都。事業所整理記号 01-ケイト・事業所番号 123。前に作ったファイルの媒体通番は 023）
 * 社会保険規定：1 協会けんぽ／2 見本健康保険組合（事業所番号 00001・前の媒体通番 004）／3 見本建設国保（国民健康保険組合）
 * マイナンバー：事務取扱担当者でログインしている。鍵のパスワードは「mihon-password-2026」（本物と同じ暗号で、番号を暗号化してある）
 * ■ 資格取得届（2026年11月）
 *   青木さん：11月2日入社・月給25万円＋通勤手当1万円・マイナンバーあり（住所は書かない）
 *   石井さん：11月4日入社・時給のパート（報酬月額を入れる）・マイナンバーなし（基礎年金番号と住所を書く）
 *   上田さん：11月1日入社・健康保険組合（組合にも出す。被保険者等番号 123）・マイナンバーあり
 *   江藤さん：11月5日入社・国民健康保険組合（取得区分 6）／大野さん：11月10日入社・76歳（70歳以上被用者該当届のみ）
 *   加藤さん：11月20日入社（今日より後なので、まだ届け出られない）／菊池さん：基礎年金番号も住所のフリガナもない
 *   小松さん：2025年10月に入社し、2026年11月分から加入（標準報酬月額の履歴から、資格取得日を11月1日にする）
 *   島田さん：11月9日入社・月給25万円・社宅（東京・総面積40平方メートル・家賃2万円）と定期券（月1万2千円）を現物で渡す
 *            → 報酬月額の現物の見込みは 53,200円 − 20,000円 ＋ 12,000円 ＝ 45,200円（通貨は25万円）
 * ■ 資格喪失届（2026年10月）
 *   佐々木さん：10月31日退職・マイナンバーあり／鈴木さん：10月20日退職・健康保険組合（被保険者等番号 45）
 *   高田さん：10月31日退職・71歳（70歳不該当）／千葉さん：10月15日に死亡
 * ■ 産休・育休の申出書
 *   中島さん：産休（出産予定日 11月1日・10月28日に出産。出産後の申出）
 *   西田さん：産休（予定日 10月5日で申出済み → 9月28日に出産し、終了日を11月23日に直した → 変更届）
 *   野村さん：産後パパ育休（10月5日〜25日。同じ月なので取得日数・就業予定日数）
 *   浜田さん：育休（申出済み 2026年10月9日まで → 12月1日まで延ばした → 延長）
 *   平野さん：育休（子の氏名・生年月日がない）／役員さん：役員の育休（申出できない）
 * 「…を保存」で保存の窓の代わりに、保存したバイトを window.__savedFiles に足す
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import ShikakuReportManager from "../../src/features/payroll/ShikakuReportManager";
import LeaveReportManager from "../../src/features/payroll/LeaveReportManager";
import { createKeys, encryptNumber, type DeriveKey } from "../../src/utils/myNumberCrypto";

const PASSWORD = "mihon-password-2026";
/** 見本の鍵の作り方（アプリは Rust の Argon2id。ここでは SHA-256 で同じ形の鍵を作る） */
const deriveKey: DeriveKey = async (password, salt) => {
  const bytes = new Uint8Array([...new TextEncoder().encode(password), ...salt]);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
};

const saved: { name: string; bytes: Uint8Array }[] = [];
(window as any).__savedFiles = saved;
let lastSavePath = "";
// ── Tauri の代わり（保存の窓は開かず、保存したバイトを残す。確かめの窓は「はい」。鍵の作り方は deriveKey） ──
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
    // 保存の窓の初めのファイル名が、アプリと同じになるように（書類のフォルダ/Q/export/ファイル名）
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
  social_insurance_group_id: 1, payroll_group_id: 1, wage_type: "monthly", gender: "male", standard_remuneration: 260000,
  standard_remuneration_history: history(["", 260000]), ...o,
});
const leaves = (...list: Record<string, unknown>[]) => JSON.stringify(list);

const staffList: any[] = [
  // 資格取得届（2026年11月）
  person({ id: "3001", name: "青木　新太", furigana: "アオキ アラタ", birthday: "1998-05-15", join_date: "2026-11-02", base_wage: 250000, commute_type: "monthly", commute_amount: 10000 }),
  person({ id: "3002", name: "石井　花", furigana: "イシイ ハナ", birthday: "1990-07-07", gender: "female", join_date: "2026-11-04", wage_type: "hourly", base_wage: 1300,
    basic_pension_number: "1234-567890", zip_code: "168-8500", address: "東京都杉並区高井戸３－２－５", address_kana: "トウキョウト スギナミク タカイド 3-2-5", standard_remuneration: 142000,
    standard_remuneration_history: history(["", 142000]) }),
  person({ id: "3003", name: "上田　組合", furigana: "ウエダ クミアイ", birthday: "1985-03-03", join_date: "2026-11-01", social_insurance_group_id: 2, health_ins_num: "123", base_wage: 300000 }),
  person({ id: "3004", name: "江藤　国保", furigana: "エトウ コクホ", birthday: "1979-09-09", join_date: "2026-11-05", social_insurance_group_id: 3, base_wage: 280000,
    basic_pension_number: "2345678901", zip_code: "100-0001", address: "東京都千代田区千代田１－１", address_kana: "トウキョウト チヨダク チヨダ 1-1" }),
  person({ id: "3005", name: "大野　長老", furigana: "オオノ チョウロウ", birthday: "1950-01-20", join_date: "2026-11-10", base_wage: 200000, basic_pension_number: "0123-012345" }),
  person({ id: "3006", name: "加藤　未来", furigana: "カトウ ミライ", birthday: "2001-12-12", join_date: "2026-11-20", base_wage: 230000 }),
  person({ id: "3007", name: "菊池　番号", furigana: "キクチ バンゴウ", birthday: "1993-04-04", join_date: "2026-11-06", base_wage: 240000 }),
  person({ id: "3008", name: "小松　加入", furigana: "コマツ カニュウ", birthday: "1988-08-08", gender: "female", join_date: "2025-10-06", wage_type: "hourly", base_wage: 1200,
    standard_remuneration: 104000, standard_remuneration_history: JSON.stringify([{ from: "", amount: 0, reason: "shutoku" }, { from: "2026-11", amount: 104000, reason: "shutoku" }]),
    basic_pension_number: "3456789012", zip_code: "150-0001", address: "東京都渋谷区神宮前１－２－３", address_kana: "トウキョウト シブヤク ジングウマエ 1-2-3" }),
  person({ id: "3009", name: "島田　社宅", furigana: "シマダ シャタク", birthday: "1994-10-10", join_date: "2026-11-09", base_wage: 250000,
    commute_type: "monthly", commute_amount: 12000, commute_setting: JSON.stringify({ method: "transit", inKind: true }),
    in_kind: JSON.stringify([{ kind: "housing", name: "社宅", start: "2026-11-09", area: 40, sharers: 1, selfPay: 20000 }]) }),
  // 資格喪失届（2026年10月）
  person({ id: "3101", name: "佐々木　退職", furigana: "ササキ タイショク", birthday: "1970-02-02", join_date: "2010-04-01", retirement_date: "2026-10-31", pension_num: "5", base_wage: 320000 }),
  person({ id: "3102", name: "鈴木　組合", furigana: "スズキ クミアイ", birthday: "1980-06-06", join_date: "2015-04-01", retirement_date: "2026-10-20", pension_num: "9",
    social_insurance_group_id: 2, health_ins_num: "45", basic_pension_number: "4567890123", base_wage: 300000 }),
  person({ id: "3103", name: "高田　七十", furigana: "タカダ ナナジュウ", birthday: "1955-01-10", join_date: "2000-04-01", retirement_date: "2026-10-31", pension_num: "3",
    basic_pension_number: "5678901234", base_wage: 250000 }),
  person({ id: "3104", name: "千葉　死亡", furigana: "チバ シボウ", birthday: "1966-03-03", join_date: "2005-04-01", retirement_date: "2026-10-15", death_date: "2026-10-15", pension_num: "11",
    basic_pension_number: "6789012345", base_wage: 280000 }),
  // 産休・育休
  person({ id: "3201", name: "中島　産休", furigana: "ナカジマ サンキュウ", birthday: "1994-04-04", gender: "female", join_date: "2018-04-01", pension_num: "21", base_wage: 260000,
    leave_periods: leaves({ type: "maternity", start: "2026-09-20", end: "", dueDate: "2026-11-01", birthDate: "2026-10-28" }) }),
  person({ id: "3202", name: "西田　変更", furigana: "ニシダ ヘンコウ", birthday: "1991-01-01", gender: "female", join_date: "2016-04-01", pension_num: "22", base_wage: 270000,
    basic_pension_number: "7890123456",
    leave_periods: leaves({ type: "maternity", start: "2026-08-25", end: "2026-11-23", dueDate: "2026-10-05", birthDate: "2026-09-28",
      reported: { kind: "apply", on: "2026-08-26", start: "2026-08-25", end: "2026-11-30", dueDate: "2026-10-05" } }) }),
  person({ id: "3203", name: "野村　育休", furigana: "ノムラ イクキュウ", birthday: "1989-10-10", join_date: "2014-04-01", pension_num: "23", base_wage: 300000, basic_pension_number: "8901234567",
    leave_periods: leaves({ type: "childcare", start: "2026-10-05", end: "2026-10-25", childName: "野村　陽太", childKana: "ノムラ ヨウタ", childBirthday: "2026-09-30" }) }),
  person({ id: "3204", name: "浜田　延長", furigana: "ハマダ エンチョウ", birthday: "1990-12-12", gender: "female", join_date: "2013-04-01", pension_num: "24", base_wage: 280000,
    basic_pension_number: "9012345678",
    leave_periods: leaves({ type: "childcare", start: "2025-12-10", end: "2026-12-01", childName: "浜田　結", childKana: "ハマダ ユイ", childBirthday: "2025-10-10",
      reported: { kind: "apply", on: "2025-12-11", start: "2025-12-10", end: "2026-10-09" } }) }),
  person({ id: "3205", name: "平野　未入力", furigana: "ヒラノ ミニュウリョク", birthday: "1992-02-02", gender: "female", join_date: "2019-04-01", pension_num: "25", base_wage: 250000,
    basic_pension_number: "0123456789", leave_periods: leaves({ type: "childcare", start: "2026-11-01", end: "2027-08-31" }) }),
  person({ id: "3206", name: "役員　育休", furigana: "ヤクイン イクキュウ", birthday: "1980-05-05", join_date: "2010-04-01", pension_num: "26", base_wage: 500000, is_executive: 1,
    basic_pension_number: "1122334455",
    leave_periods: leaves({ type: "childcare", start: "2026-11-01", end: "2027-03-31", childName: "役員　子", childKana: "ヤクイン コ", childBirthday: "2026-09-01" }) }),
];

const store = {
  company: {
    id: 1, name: "健保サービス株式会社", zip_code: "100-0000", address: "東京都千代田区霞が関1-2-2", phone: "03-1234-5678",
    representative: "健保 良一", shaho_office_symbol: "01-ケイト", shaho_office_number: "123", shaho_media_seq: 23,
  },
  groups: [
    { id: 1, name: "協会けんぽ", type: "kyokai", union_office_number: null as string | null, union_media_seq: 0 },
    { id: 2, name: "見本健康保険組合", type: "union", union_office_number: "00001" as string | null, union_media_seq: 4 },
    { id: 3, name: "見本建設国保", type: "kokuho", union_office_number: null as string | null, union_media_seq: 0 },
  ],
  keys: null as any,
  numbers: [] as { staff_id: string; person: string; name: string; relation: string; number: string }[],
  logs: [] as { category: string; message: string }[],
};
(window as any).__shikakuStore = { store, staffList, saved };

/** マイナンバー（見本。チェック用数字の合う番号）を、本物と同じ暗号で入れておく */
const setupMyNumbers = async () => {
  const { record, keys } = await createKeys(PASSWORD, deriveKey);
  store.keys = record;
  for (const [staffId, number] of [["3001", "123456789018"], ["3003", "234567890123"], ["3101", "345678901234"], ["3201", "456789012347"]]) {
    store.numbers.push({ staff_id: staffId, person: "self", name: "", relation: "", number: await encryptNumber(keys, number, staffId, "self") });
  }
};

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
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE company SET shaho_media_seq")) store.company.shaho_media_seq = Number(params[0]);
    else if (q.startsWith("UPDATE social_insurance_groups SET union_media_seq = ? WHERE id = ?")) {
      store.groups.find((g) => g.id === Number(params[1]))!.union_media_seq = Number(params[0]);
    } else if (q.startsWith("UPDATE staff SET leave_periods = ? WHERE id = ?")) {
      const s = staffList.find((x) => x.id === params[1]);
      if (s) s.leave_periods = params[0];
    } else if (q.startsWith("INSERT INTO app_logs")) {
      store.logs.push({ category: String(params[2]), message: String(params[3]) });
    } else console.warn("fakeDb: 知らない EXECUTE", q, params);
    return { rowsAffected: 1 };
  },
};

const user = { id: 1, login_id: "tanto", display_name: "事務 担当" };

function Page() {
  const [list, setList] = useState(staffList);
  const [tab, setTab] = useState<"shikaku" | "menjo">("shikaku");
  const refresh = () => setList(staffList.map((s) => ({ ...s })));
  const tabButton = (key: "shikaku" | "menjo", label: string) => (
    <button id={`tab-${key}`} onClick={() => setTab(key)} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: tab === key ? "#2563eb" : "#e2e8f0", color: tab === key ? "white" : "#334155" }}>
      {label}
    </button>
  );
  return (
    <div style={{ padding: 20 }}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabButton("shikaku", "資格取得・喪失届")}
        {tabButton("menjo", "産休・育休の申出書")}
      </div>
      {tab === "shikaku"
        ? <ShikakuReportManager db={fakeDb as any} staffList={list} currentUser={user} />
        : <LeaveReportManager db={fakeDb as any} staffList={list} currentUser={user} onDataChange={refresh} />}
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
