import React, { useEffect } from "react"; // 🆕 ここが重要！
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
  ClipboardList, 
  TrendingUp, 
  Baby, 
  HeartHandshake, 
  Calculator, 
  FileText, 
  FileSpreadsheet, 
  BookOpen, 
  Landmark, 
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
import SanteiManager from "./features/payroll/SanteiManager";
import ZuijiManager from "./features/payroll/ZuijiManager";
import LeaveEndRevisionManager from "./features/payroll/LeaveEndRevisionManager";
import YouikuTokureiManager from "./features/payroll/YouikuTokureiManager";
import NenchoManager from "./features/nencho/NenchoManager";
import WithholdingSlipManager from "./features/nencho/WithholdingSlipManager";
import WithholdingLedgerManager from "./features/nencho/WithholdingLedgerManager";
import SalaryPaymentReportManager from "./features/nencho/SalaryPaymentReportManager";

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
  santei: "算定基礎（定時決定）",
  zuiji: "月変（随時改定）",
  kyugyo: "休業終了時改定",
  youiku: "養育期間の特例",
  nencho: "年末調整",
  gensen: "源泉徴収票",
  gensenbo: "源泉徴収簿",
  kyuho: "給与支払報告書",
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
  santei: <ClipboardList size={18} />,
  zuiji: <TrendingUp size={18} />,
  kyugyo: <Baby size={18} />,
  youiku: <HeartHandshake size={18} />,
  nencho: <Calculator size={18} />,
  gensen: <FileSpreadsheet size={18} />,
  gensenbo: <BookOpen size={18} />,
  kyuho: <Landmark size={18} />,
  payslip: <FileText size={18} />,
  user_management: <UserCog size={18} />
};

const AnimatedLogo = () => {
  useEffect(() => {
    S.injectLogoStyles();
  }, []);

  return (
    /* クラス名を logo-fade-in に変更 */
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 512 512" 
      width="256" 
      height="256" 
      className="logo-fade-in"
    >
      <defs>
        <linearGradient id="ksu-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#002D62", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#0055A4", stopOpacity: 1 }} />
        </linearGradient>
        <mask id="cutout">
          <rect width="512" height="512" fill="white"/>
          {/* Qの文字部分をシンプルに配置 */}
          <g transform="translate(51, 51) scale(0.8)">
            <path d="M256 120 C180 120 128 172 128 248 C128 324 180 376 256 376 C332 376 384 324 384 248 C384 172 332 120 256 120 Z" fill="black" />
            <rect x="290" y="325" width="70" height="30" rx="15" transform="rotate(45 290 325)" fill="black" />
          </g>
        </mask>
      </defs>
      
      <rect x="56" y="56" width="400" height="400" rx="90" fill="url(#ksu-gradient)" mask="url(#cutout)" />
    </svg>
  );
};

function App() {
  const {
    db,
    createNewProject, // 🆕 追加
    openProject,      // 🆕 追加
    closeProject,     // 🆕 追加
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

  // --- 🆕 ここを書き換え：DBがまだ選ばれていない時の画面 ---
  if (!db) {
    return (
      <div style={{ 
        height: "100vh", display: "flex", flexDirection: "column", 
        justifyContent: "center", alignItems: "center", gap: "20px",
        backgroundColor: "#f5f7fa" 
      }}>
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          {/* 🆕 作成したアニメーションロゴに差し替え */}
          <AnimatedLogo />
        </div>
        
        <div style={{ display: "flex", gap: "15px" }}>
          <button 
            onClick={createNewProject} 
            style={{ 
              padding: "12px 24px", backgroundColor: "#002D62", color: "white", 
              border: "none", borderRadius: "4px", cursor: "pointer",
              transition: "transform 0.2s", // 少し動きをつける
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = "scale(1.05)"}
            onMouseOut={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            新しく会社ファイルを作る
          </button>
          <button 
            onClick={openProject} 
            style={{ 
              padding: "12px 24px", backgroundColor: "white", border: "1px solid #dcdfe6", 
              borderRadius: "4px", cursor: "pointer",
              transition: "transform 0.2s",
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = "scale(1.05)"}
            onMouseOut={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            既存のファイルを開く (.qp)
          </button>
        </div>
        <div style={{ color: "#909399", fontSize: "12px", marginTop: "10px" }}>
          {APP_NAME} ver {APP_VERSION}
        </div>
      </div>
    );
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
          {/* 「会社設定」だけは常に表示（セットアップの起点なので） */}
          <li onClick={() => setActiveTab("company")} style={S.getTabStyle(activeTab === "company")}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {TAB_ICONS.company}
              <span>{TAB_NAMES.company}</span>
            </div>
          </li>

          {/* 残りのメニューを条件付きで一括描画 */}
          {isSetupComplete && [
            "calendar", 
            "staff", 
            "paid_leave", 
            "custom_items", 
            "attendance", 
            "bonus", 
            "santei",
            "zuiji",
            "kyugyo",
            "youiku",
            "nencho",
            "gensen",
            "gensenbo",
            "kyuho",
            "payslip"
          ].map((tabKey) => {
            // 💡 スタッフ登録が必要なタブかどうかを判定
            const needsStaff = ["paid_leave", "custom_items", "attendance", "bonus", "santei", "zuiji", "kyugyo", "youiku", "nencho", "gensen", "gensenbo", "kyuho", "payslip"].includes(tabKey);
            const isDisabled = needsStaff && !isStaffReady;

            return (
              <li 
                key={tabKey}
                onClick={() => !isDisabled && setActiveTab(tabKey)} 
                style={S.getTabStyle(activeTab === tabKey, isDisabled)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {TAB_ICONS[tabKey]}
                  <span>{TAB_NAMES[tabKey]}</span>
                </div>
              </li>
            );
          })}
        </ul>
        
        {/* 余白を埋めてシステム設定を下寄せにする */}
        <div style={{ flex: 1 }}></div>

        {/* 🆕 システム設定メニュー（書き方を統一） */}
        <ul style={S.systemMenuArea}>
          <li 
            onClick={() => setActiveTab("user_management")} 
            style={S.getTabStyle(activeTab === "user_management")}
          >
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
              onClick={closeProject} // 🆕 setCurrentUser(null) から変更！
              style={S.logoutButton}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f5f7fa")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
            >
              <LogOut size={14} />
              会社を閉じる
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
              {activeTab === "santei" && db && (
                <SanteiManager db={db} staffList={staffList} onDataChange={refreshData} />
              )}
              {activeTab === "zuiji" && db && (
                <ZuijiManager db={db} staffList={staffList} onDataChange={refreshData} />
              )}
              {activeTab === "kyugyo" && db && (
                <LeaveEndRevisionManager db={db} staffList={staffList} onDataChange={refreshData} />
              )}
              {activeTab === "youiku" && db && (
                <YouikuTokureiManager db={db} staffList={staffList} onDataChange={refreshData} />
              )}
              {activeTab === "nencho" && db && (
                <NenchoManager db={db} staffList={staffList} />
              )}
              {activeTab === "gensen" && db && (
                <WithholdingSlipManager db={db} staffList={staffList} />
              )}
              {activeTab === "gensenbo" && db && (
                <WithholdingLedgerManager db={db} staffList={staffList} />
              )}
              {activeTab === "kyuho" && db && (
                <SalaryPaymentReportManager db={db} staffList={staffList} onDataChange={refreshData} />
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