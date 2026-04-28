// @ts-ignore
import pkg from "../package.json";
import { useApp } from "./useApp";
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
import * as S from "./App.styles";

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

export const APP_NAME = pkg.name.toUpperCase(); // "q" を "Q" にしたい場合は upperCase
export const APP_VERSION = pkg.version;

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
  const {
    db,
    currentUser, setCurrentUser,
    staffList,
    activeTab, setActiveTab,
    isSetupComplete,
    isLoading,
    hasUser, setHasUser,
    companyName,
    targetYear, setTargetYear,
    targetMonth, setTargetMonth,
    isStaffReady,
    handleSetupComplete,
    refreshData
  } = useApp();

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
    <div style={S.container}>
      <nav style={S.sidebar}>
        {/* --- ナビゲーション最上部 --- */}
        <div style={S.sidebarHeader}>
          {/* セットアップ未完了時はアイコンを黄色にして注意を引く */}
          <Building2 size={24} color={isSetupComplete ? "#3498db" : "#f1c40f"} />
          <span>{isSetupComplete ? companyName : "初期設定が必要です"}</span>
        </div>
        <ul style={S.menuList}>
          {/* 共通のリストアイテム描画関数（DRYに書くなら） */}
          <li onClick={() => setActiveTab("company")} style={S.getTabStyle(activeTab === "company")}>
             <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {TAB_ICONS.company}
                <span>{TAB_NAMES.company}</span>
             </div>
          </li>
          {isSetupComplete && (
            <>
              {/* 各メニューを Lucide アイコンに置き換え */}
              <li onClick={() => setActiveTab("calendar")} style={S.getTabStyle(activeTab === "calendar")}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {TAB_ICONS.calendar}
                  <span>{TAB_NAMES.calendar}</span>
                </div>
              </li>
              <li onClick={() => setActiveTab("staff")} style={S.getTabStyle(activeTab === "staff")}>
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
                  style={S.getTabStyle(activeTab === item.id, !isStaffReady)}
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

        {/* 🆕 システム設定メニュー（adminなら常時、staffなら常時表示） */}
        <ul style={{ listStyle: "none", padding: "10px", margin: 0, borderTop: "1px solid #34495e" }}>
          <li onClick={() => setActiveTab("user_management")} style={S.getTabStyle(activeTab === "user_management")}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {TAB_ICONS.user_management}
              <span>{TAB_NAMES.user_management}</span>
            </div>
          </li>
        </ul>

        {/* ガイドメッセージの出し分け：marginTop: "auto" を削除 */}
        <div style={S.guideBox}>
          {!isSetupComplete ? (
            <>💡 会社名と本店の所在地を設定すると、基本機能が解放されます。</>
          ) : !isStaffReady ? (
            <div style={{ color: "#f1c40f" }}>💡 次は「従業員管理」から、最初の1人を登録しましょう！</div>
          ) : null}
          <div style={S.versionText}>{APP_NAME} ver {APP_VERSION}</div>
        </div>
      </nav>
      {/* --- 右側：ヘッダー ＋ メインコンテンツ --- */}
      <div style={S.mainWrapper}>
        <header style={S.header}>
          {/* 左側：パンくずリスト風の表示 */}
          <div style={{ fontSize: "16px", color: "#606266", display: "flex", alignItems: "center", gap: "8px" }}>
            {/* 現在のタブのアイコンをヘッダーにも表示 */}
            <span style={{ color: "#3498db" }}>{TAB_ICONS[activeTab]}</span>
            <span style={{ fontWeight: "bold", color: "#303133" }}>
              {TAB_NAMES[activeTab] || "ホーム"}
            </span>
          </div>
         <div style={S.headerRight}>
            <div style={S.userInfo}>
               <CircleUser size={16} color="#909399" />
               <span style={{ fontWeight: "500" }}>{currentUser.display_name} さん</span>
            </div>
            <button 
              onClick={() => setCurrentUser(null)} 
              style={S.logoutButton}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f5f7fa")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
            >
              <LogOut size={14} />
              ログアウト
            </button>
          </div>
        </header>

        {/* 下：コンテンツ表示エリア */}
        <main style={S.mainContent}>
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
            <SystemSettings db={db} currentUser={currentUser} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;