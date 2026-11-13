/**
 * Q のマイナンバーの画面（src/features/mynumber/MyNumberManager.tsx）の、保存期間が過ぎた番号の知らせを、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/mynumber.html を開く
 * ・上：メニューの「マイナンバー」の知らせ（src/App.tsx と同じ「要削除 n」。数えるのは useExpiredMyNumberCount）
 * ・下：マイナンバーの画面。番号は見本の暗号（中身はない）で、鍵は閉じたまま（消すのに鍵は要らない）。確かめの窓はいつも「消す」
 * 見本の5人（この PC の今日の日付で数える。2026年11月に作った）：
 *   山田さん（在籍。配偶者は今の申告書に載っている。子は2017年分まで → 2025年1月10日まで保管で、過ぎている）
 *   佐藤さん（2017年9月に退職 → 2025年1月10日まで。申告書に見当たらない家族の番号も本人と同じ日）
 *   鈴木さん（2024年3月に退職 → 2032年1月10日まで保管）
 *   高橋さん（「退職」なのに退職日がない → 保存期間がわからない）
 *   伊藤さん（2018年12月末に退職し、2019年1月に最後の給与 → 2027年1月10日まで保管）
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import MyNumberManager from "../../src/features/mynumber/MyNumberManager";
import { MyNumberUnlockProvider } from "../../src/features/mynumber/MyNumberUnlock";
import { useExpiredMyNumberCount } from "../../src/features/mynumber/useExpiredMyNumberCount";
import { familyKey } from "../../src/utils/myNumber";

// ── Tauri の代わり（確かめの窓は、いつも1つ目のボタン（「消す」）にする。ファイルには書かない） ──
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

const SPOUSE = { name: "山田 花子", birthday: "1988-05-05" };
const CHILD = { name: "山田 一郎", birthday: "2000-04-01", relation: "子" };
const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const decl = (staff_id: string, year: number, o: { spouse?: boolean; child?: boolean } = {}) =>
  ({ staff_id, year, declaration: JSON.stringify({ spouse: o.spouse ? SPOUSE : null, dependents: o.child ? [CHILD] : [] }) });

const store = {
  numbers: [
    { staff_id: "1001", person: "self", name: "", relation: "" },
    { staff_id: "1001", person: familyKey(SPOUSE.name, SPOUSE.birthday), name: SPOUSE.name, relation: "配偶者" },
    { staff_id: "1001", person: familyKey(CHILD.name, CHILD.birthday), name: CHILD.name, relation: "子" },
    { staff_id: "1002", person: "self", name: "", relation: "" },
    { staff_id: "1002", person: familyKey("佐藤 健", "1985-02-02"), name: "佐藤 健", relation: "配偶者" },
    { staff_id: "1003", person: "self", name: "", relation: "" },
    { staff_id: "1004", person: "self", name: "", relation: "" },
    { staff_id: "1005", person: "self", name: "", relation: "" },
  ],
  declarations: [
    ...years(2016, 2026).map((y) => decl("1001", y, { spouse: true, child: y <= 2017 })),
    decl("1002", 2016), decl("1002", 2017),
    decl("1003", 2023), decl("1003", 2024),
  ],
  salaries: [["1001", 2026], ["1002", 2017], ["1003", 2024], ["1004", 2019], ["1005", 2019]] as [string, number][],
  logs: [] as { created_at: string; user_name: string | null; message: string }[],
};
(window as any).__mynumber = store;

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT my_number_access FROM users")) return [{ my_number_access: 1 }];
    if (q.startsWith("SELECT kdf, salt, wrapped_by_password")) return [{ kdf: "{}", salt: "", wrapped_by_password: "", recovery_salt: "", wrapped_by_recovery: "" }];
    if (q.startsWith("SELECT created_at FROM my_number_keys")) return [{ created_at: "2026-11-01 09:00:00" }];
    if (q.startsWith("SELECT name FROM company")) return [{ name: "見本株式会社" }];
    if (q.startsWith("SELECT created_at, user_name, message FROM app_logs")) return [...store.logs].reverse();
    if (q.startsWith("SELECT staff_id, year, declaration FROM year_end_adjustments")) return store.declarations;
    if (q.startsWith("SELECT staff_id, person, name, relation FROM my_numbers")) return store.numbers;
    if (q.startsWith("SELECT staff_id, MAX(target_year) AS y FROM salary_results")) return store.salaries.map(([staff_id, y]) => ({ staff_id, y }));
    if (q.includes("FROM bonus_results r JOIN bonus_settings s")) return [];
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("DELETE FROM my_numbers WHERE staff_id = ? AND person = ?")) {
      store.numbers = store.numbers.filter((n) => !(n.staff_id === params[0] && n.person === params[1]));
    } else if (q.startsWith("INSERT INTO app_logs")) {
      if (params[2] === "mynumber") store.logs.push({ created_at: params[0], user_name: params[4], message: params[3] });
    } else {
      console.warn("fakeDb: 知らない EXECUTE", q, params);
    }
    return { rowsAffected: 1 };
  },
};

const staffList = [
  { id: "1001", name: "山田 太郎", status: "active", retirement_date: null },
  { id: "1002", name: "佐藤 花子", status: "retired", retirement_date: "2017-09-30" },
  { id: "1003", name: "鈴木 一郎", status: "retired", retirement_date: "2024-03-31" },
  { id: "1004", name: "高橋 二郎", status: "retired", retirement_date: null },
  { id: "1005", name: "伊藤 三郎", status: "retired", retirement_date: "2018-12-31" },
];
const user = { id: 1, login_id: "tanto", display_name: "事務 担当" };

function Page() {
  const [check, setCheck] = useState(0);
  const expired = useExpiredMyNumberCount(fakeDb as any, user, staffList, check);
  return (
    <div style={{ padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto 16px", display: "flex", gap: 16, alignItems: "center" }}>
        <div id="menu-item" style={{ width: 220, padding: "10px 14px", borderRadius: 8, background: "#1f2d3d", color: "white", display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <span>マイナンバー</span>
          {!!expired && (
            <span style={{ marginLeft: "auto", padding: "1px 6px", borderRadius: "9px", backgroundColor: "#dc2626", color: "white", fontSize: "11px", fontWeight: "bold" }}>
              要削除 {expired}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "#64748b" }}>← メニューの知らせ（App.tsx と同じ。事務取扱担当者だけに出る）</span>
      </div>
      <MyNumberManager db={fakeDb as any} staffList={staffList} currentUser={user} onNumbersChanged={() => setCheck((n) => n + 1)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MessageDialogProvider>
    <ToastProvider>
      <MyNumberUnlockProvider>
        <Page />
      </MyNumberUnlockProvider>
    </ToastProvider>
  </MessageDialogProvider>,
);
