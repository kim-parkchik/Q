// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";
import { 
  Building2, 
  Calendar, 
  CircleUser, 
  Users, 
  Palmtree, 
  Settings, 
  Timer, 
  Coins, 
  FileText, 
  UserCog, 
  LogOut 
} from 'lucide-react';
import { DB_SCHEMAS } from "./types/dbSchema";
import { HOLIDAY_CSV_URL_DEFAULT } from "./constants/salaryMaster2026";

// auth フォルダ
import FirstSetupScreen from "./features/auth/FirstSetupScreen";
import LoginScreen from "./features/auth/LoginScreen";

// attendance フォルダ
import AttendanceManager from "./features/attendance/AttendanceManager";
import CalendarManager from "./features/attendance/CalendarManager";
import PaidLeaveManager from "./features/attendance/PaidLeaveManager";

// payroll フォルダ
import PaySlipManager from "./features/payroll/PaySlipManager";
import BonusManager from "./features/payroll/BonusManager";

// settings フォルダ
import CompanyManager from "./features/settings/CompanyManager";
import StaffManager from "./features/settings/StaffManager";
import SystemSettings from "./features/settings/SystemSettings";
import CustomItemManager from "./features/settings/CustomItemManager";

export const APP_NAME = "Q";
export const APP_VERSION = "0.1.0";

// 2. TAB_NAMES から絵文字を消してシンプルにします
const TAB_NAMES: Record<string, string> = {
  company: "会社設定",
  calendar: "会社カレンダー",
  staff: "従業員詳細管理",
  paid_leave: "有給休暇管理",
  custom_items: "給与項目設定",
  attendance: "勤怠・月次給与",
  bonus: "賞与計算",
  payslip: "明細書出力",
  user_management: "システム設定"
};

// 3. アイコンの対応表を定義（あとでループ内で使いやすくするため）
const TAB_ICONS: Record<string, React.ReactNode> = {
  company: <Building2 size={18} />,
  calendar: <Calendar size={18} />,
  staff: <Users size={18} />,
  paid_leave: <Palmtree size={18} />,
  custom_items: <Settings size={18} />,
  attendance: <Timer size={18} />,
  bonus: <Coins size={18} />,
  payslip: <FileText size={18} />,
  user_management: <UserCog size={18} />
};

function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null); // 🆕 ログインユーザー
  const [staffList, setStaffList] = useState<any[]>([]);
  // 初期タブを "company" に変更し、セットアップ状態を管理する
  const [activeTab, setActiveTab] = useState("company");
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // ✨ 初期化中フラグを追加
  const [hasUser, setHasUser] = useState<boolean | null>(null);

  const now = new Date();
  const [targetYear, setTargetYear] = useState(now.getFullYear());
  const [targetMonth, setTargetMonth] = useState(now.getMonth() + 1);
  const isStaffReady = staffList.length > 0; // ✨ 従業員が1人以上いるか
  const [companyName, setCompanyName] = useState("");

  // スタイルの注入は一度だけ行う
  useEffect(() => {
    injectDangerousStyles();
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const sqlite = await Database.load("sqlite:Q.db");

        // 1. スキーマ実行
        for (const schema of DB_SCHEMAS) {
          await sqlite.execute(schema);
        }
        await sqlite.execute("PRAGMA foreign_keys = ON;");

        // 2. マスター初期投入
        // 🆕 会社基本情報の初期レコード（URL含む）を投入
        const companyCheck = await sqlite.select<any[]>("SELECT id FROM company WHERE id = 1");
        if (companyCheck.length === 0) {
          await sqlite.execute(
            `INSERT INTO company (id, name, holiday_csv_url) VALUES (1, '', ?)`,
            [HOLIDAY_CSV_URL_DEFAULT] // 定数を使用
          );
        }
        const patterns = await sqlite.select<any[]>("SELECT * FROM calendar_patterns WHERE id = 1");
        if (patterns.length === 0) {
          // 確実に id=1 で「標準」を入れる
          await sqlite.execute("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        }
        // 給与規定グループの初期化
        const pGroups = await sqlite.select<any[]>("SELECT * FROM payroll_groups WHERE id = 1");
        if (pGroups.length === 0) {
          // ID=1: 全社共通（末締め / 当月25日払 / 当月払い）をデフォルトとして作成
          await sqlite.execute(
            `INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) 
            VALUES (1, '全社共通規定', 99, 0, 25)`
          );
        }
        // 本店がなければ作成（最初の1件目として作成）
        const existingHead = await sqlite.select<any[]>("SELECT * FROM branches");
        if (existingHead.length === 0) {
          await sqlite.execute(
            "INSERT INTO branches (name, prefecture) VALUES ('本店', '')"
          );
        }

        // 3. DBインスタンスを先にセット
        setDb(sqlite);

        const users = await sqlite.select<any[]>("SELECT id FROM users");
        setHasUser(users.length > 0);

        // 4. セットアップ状態の確認（関数にせず、ここで直接判定）
        const companyRes = await sqlite.select<any[]>("SELECT name FROM company WHERE id = 1");
        const branchRes = await sqlite.select<any[]>("SELECT prefecture FROM branches WHERE id = 1");

        // 会社名が存在すれば state に入れる
        if (companyRes.length > 0 && companyRes[0].name.trim() !== "") {
          setCompanyName(companyRes[0].name); // ★ ここでセット
        }
        
        const hasName = companyRes.length > 0 && companyRes[0].name.trim() !== "";
        const hasPref = branchRes.length > 0 && branchRes[0].prefecture !== "";
        
        // 判定結果をセット
        setIsSetupComplete(hasName && hasPref);
        // タブは初期値が "company" なので、ここでの setActiveTab は省略可能です

        // 5. スタッフリストの取得
        const resStaff = await sqlite.select<any[]>("SELECT * FROM staff ORDER BY id ASC");
        setStaffList(resStaff);
      } catch (error) { 
        console.error("Database Init Error:", error); 
      } finally {
        setIsLoading(false); // 全ての準備が整ってから isLoading を false に
      }
    };
    init();
  }, []);

  // --- 会社設定側から完了を通知された時の処理 ---
  const handleSetupComplete = async () => {
    setIsSetupComplete(true);
    
    if (db) {
      // 最新の会社名を取得して反映
      const res = await db.select<any[]>("SELECT name FROM company WHERE id = 1");
      if (res.length > 0) setCompanyName(res[0].name);
    }
    
    await refreshData();
  };

  const refreshData = async () => {
    if (!db) return;
    const resStaff = await db.select<any[]>("SELECT * FROM staff ORDER BY id ASC");
    setStaffList(resStaff);
  };

  // タブのスタイルを動的に生成する関数をアップデート
  const tabStyle = (isActive: boolean, isDisabled: boolean = false) => ({
    padding: "12px 15px",
    cursor: isDisabled ? "not-allowed" : "pointer", // 🚫 禁止カーソル
    borderRadius: "5px",
    marginBottom: "5px",
    backgroundColor: isActive ? "#3498db" : "transparent",
    transition: "all 0.2s",
    opacity: isDisabled ? 0.4 : 1, // 🌫️ グレーアウト
    pointerEvents: isDisabled ? ("none" as const) : ("auto" as const), // 物理的にクリック不可に
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  });

  if (isLoading) {
    return <div style={{ padding: "20px" }}>起動しています...</div>; // ✨ 起動中のチラつき防止
  }

  // --- 表示の出し分け ---
  if (hasUser === null) return <div>読み込み中...</div>;

  if (!hasUser) {
    // 初回起動：管理者登録画面
    return <FirstSetupScreen db={db} onComplete={() => setHasUser(true)} />;
  }

  if (!currentUser) {
    // 通常起動：ログイン画面
    return <LoginScreen db={db} onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif", backgroundColor: "#f4f7f6" }}>
      <nav style={{ width: "220px", backgroundColor: "#2c3e50", color: "#ecf0f1", display: "flex", flexDirection: "column" }}>
        {/* --- ナビゲーション最上部 --- */}
        <div style={{ 
          padding: "20px", 
          fontSize: "18px", 
          fontWeight: "bold", 
          borderBottom: "1px solid #34495e",
          color: "#ecf0f1",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          height: "70px" // 高さを固定すると安定します
        }}>
          {/* セットアップ未完了時はアイコンを黄色にして注意を引く */}
          <Building2 size={24} color={isSetupComplete ? "#3498db" : "#f1c40f"} />
          
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <span style={{ 
              overflow: "hidden", 
              textOverflow: "ellipsis", 
              whiteSpace: "nowrap",
              fontSize: isSetupComplete ? "16px" : "14px",
              color: isSetupComplete ? "#ecf0f1" : "#f1c40f"
            }}>
              {isSetupComplete ? companyName : "初期設定が必要です"}
            </span>
          </div>
        </div>
        <ul style={{ listStyle: "none", padding: "10px", margin: 0 }}>
          {/* 共通のリストアイテム描画関数（DRYに書くなら） */}
          <li onClick={() => setActiveTab("company")} style={tabStyle(activeTab === "company")}>
             <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {TAB_ICONS.company}
                <span>{TAB_NAMES.company}</span>
             </div>
          </li>
          {isSetupComplete && (
            <>
              {/* 各メニューを Lucide アイコンに置き換え */}
              <li onClick={() => setActiveTab("calendar")} style={tabStyle(activeTab === "calendar")}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {TAB_ICONS.calendar}
                  <span>{TAB_NAMES.calendar}</span>
                </div>
              </li>
              <li onClick={() => setActiveTab("staff")} style={tabStyle(activeTab === "staff")}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {TAB_ICONS.staff}
                  <span>{TAB_NAMES.staff}</span>
                </div>
              </li>

              {/* 無効化（isStaffReady判定）が必要なメニュー */}
              {[
                { id: "paid_leave", key: "paid_leave" },
                { id: "custom_items", key: "custom_items" },
                { id: "attendance", key: "attendance" },
                { id: "bonus", key: "bonus" },
                { id: "payslip", key: "payslip" },
              ].map(item => (
                <li 
                  key={item.id}
                  onClick={() => isStaffReady && setActiveTab(item.id)} 
                  style={tabStyle(activeTab === item.id, !isStaffReady)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {TAB_ICONS[item.key]}
                    <span>{TAB_NAMES[item.key]}</span>
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
        
        {/* ガイドメッセージの出し分け */}
        {/* --- 修正箇所 --- */}
        <div style={{ flex: 1 }}></div>

        {/* ⚙️ 管理者専用メニュー */}
        {currentUser.role === 'admin' && (
          <ul style={{ listStyle: "none", padding: "10px", margin: 0, borderTop: "1px solid #34495e" }}>
            <li onClick={() => setActiveTab("user_management")} style={tabStyle(activeTab === "user_management")}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {TAB_ICONS.user_management}
                <span>{TAB_NAMES.user_management}</span>
              </div>
            </li>
          </ul>
        )}

        {/* ガイドメッセージの出し分け：marginTop: "auto" を削除 */}
        <div style={{ padding: "20px", fontSize: "12px", color: "#95a5a6", lineHeight: "1.6" }}>
          {!isSetupComplete ? (
            <>💡 会社名と本店の所在地を設定すると、基本機能が解放されます。</>
          ) : !isStaffReady ? (
            <div style={{ color: "#f1c40f" }}>💡 次は「従業員管理」から、最初の1人を登録しましょう！</div>
          ) : null}
          <div style={{ 
            padding: "10px 20px", 
            fontSize: "10px", 
            color: "#bdc3c7", 
            textAlign: "right",
            fontFamily: "monospace",
            opacity: 0.7 
          }}>
            {APP_NAME} ver {APP_VERSION}
          </div>
        </div>
      </nav>
      {/* --- 右側：ヘッダー ＋ メインコンテンツ --- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        
        {/* 🆕 右上のヘッダーエリア */}
        <header style={{ 
          height: "60px", 
          backgroundColor: "#fff", 
          borderBottom: "1px solid #e0e0e0", 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", // 両端に広げる
          padding: "0 30px",
          flexShrink: 0
        }}>
          {/* 左側：パンくずリスト風の表示 */}
          <div style={{ fontSize: "16px", color: "#606266", display: "flex", alignItems: "center", gap: "8px" }}>
            {/* 現在のタブのアイコンをヘッダーにも表示 */}
            <span style={{ color: "#3498db" }}>{TAB_ICONS[activeTab]}</span>
            <span style={{ fontWeight: "bold", color: "#303133" }}>
              {TAB_NAMES[activeTab] || "ホーム"}
            </span>
          </div>
         <div style={{ fontSize: "14px", color: "#333", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
               <CircleUser size={16} color="#909399" />
               <span style={{ fontWeight: "500" }}>{currentUser.display_name} さん</span>
            </div>
            <button 
              onClick={() => setCurrentUser(null)} 
              style={{ 
                padding: "4px 12px", 
                fontSize: "12px", 
                cursor: "pointer", 
                backgroundColor: "#fff", 
                border: "1px solid #dcdfe6", 
                borderRadius: "4px", 
                color: "#606266",
                transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: "5px"
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f5f7fa")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
            >
              <LogOut size={14} />
              ログアウト
            </button>
          </div>
        </header>

        {/* 下：コンテンツ表示エリア */}
        <main style={{ flex: 1, padding: "30px", overflowY: "auto" }}>
          {activeTab === "company" && db && (
            <CompanyManager db={db} onSetupComplete={handleSetupComplete} />
          )}

          {/* セットアップ未完了なら他のコンポーネントは表示させない（ガード） */}
          {isSetupComplete && (
            <>
              {activeTab === "calendar" && db && (
                <CalendarManager db={db} />
              )}
              {activeTab === "staff" && db && (
                <StaffManager db={db} staffList={staffList} onDataChange={refreshData} />
              )}
              {activeTab === "paid_leave" && db && (
                <PaidLeaveManager db={db} staffList={staffList} />
              )}
              {activeTab === "custom_items" && db && (
                <CustomItemManager db={db} staffList={staffList} />
              )}
              {activeTab === "attendance" && db && (
                <AttendanceManager 
                  db={db} 
                  staffList={staffList}
                  targetYear={targetYear}
                  setTargetYear={setTargetYear}
                  targetMonth={targetMonth}
                  setTargetMonth={setTargetMonth}
                />
              )}
              {activeTab === "bonus" && db && (
                <BonusManager db={db} staffList={staffList} />
              )}
              {activeTab === "payslip" && db && (
                <PaySlipManager 
                  db={db} 
                  staffList={staffList} 
                  targetYear={targetYear} 
                  targetMonth={targetMonth} 
                />
              )}
            </>
          )}
          {activeTab === "user_management" && db && (
            <SystemSettings db={db} />
          )}
        </main>
      </div>
    </div>
  );
}

// 💀 ヤバいボタン用のアニメーション
const injectDangerousStyles = () => {
  if (typeof document === 'undefined') return;
  // 二重に追加されないようにチェック
  if (document.getElementById('dangerous-style')) return;

  const style = document.createElement('style');
  style.id = 'dangerous-style';
  style.innerHTML = `
    @keyframes pulse-red {
      0% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7); }
      70% { box-shadow: 0 0 0 15px rgba(255, 0, 0, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
    }
    @keyframes shake-extreme {
      0% { transform: translate(1px, 1px); }
      20% { transform: translate(-2px, -1px); }
      40% { transform: translate(-2px, 2px); }
      60% { transform: translate(2px, 1px); }
      80% { transform: translate(1px, -2px); }
      100% { transform: translate(-1px, 1px); }
    }
    .dangerous-btn {
      animation: pulse-red 1.2s infinite !important; /* 少し鼓動を速く */
      background-color: #ff0000 !important;
      color: white !important;
      border: 1px solid #b30000 !important;
      font-weight: 900 !important;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
    }
    .dangerous-btn:hover {
      animation: shake-extreme 0.1s infinite !important; /* 超高速震動 */
      background-color: #e60000 !important;
      /* cursor指定を削除しました */
    }
  `;
  document.head.appendChild(style);
};
injectDangerousStyles();

export default App;