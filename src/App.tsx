// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";
import { DB_SCHEMAS } from "./dbSchema";
import CompanyManager from "./CompanyManager";
import CalendarManager from "./CalendarManager";
import StaffManager from "./StaffManager";
import AttendanceManager from "./AttendanceManager";
import PaySlipManager from "./PaySlipManager";
import CustomItemManager from "./CustomItemManager";
import BonusManager from "./BonusManager";
import PaidLeaveManager from "./PaidLeaveManager";

function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [staffList, setStaffList] = useState<any[]>([]);
  // 初期タブを "company" に変更し、セットアップ状態を管理する
  const [activeTab, setActiveTab] = useState("company");
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // ✨ 初期化中フラグを追加

  const now = new Date();
  const [targetYear, setTargetYear] = useState(now.getFullYear());
  const [targetMonth, setTargetMonth] = useState(now.getMonth() + 1);
  const isStaffReady = staffList.length > 0; // ✨ 従業員が1人以上いるか

  // スタイルの注入は一度だけ行う
  useEffect(() => {
    injectDangerousStyles();
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const sqlite = await Database.load("sqlite:hama_kyuyo.db");

        // 1. スキーマ実行
        for (const schema of DB_SCHEMAS) {
          await sqlite.execute(schema);
        }
        await sqlite.execute("PRAGMA foreign_keys = ON;");

        // 2. マスター初期投入
        const patterns = await sqlite.select<any[]>("SELECT * FROM calendar_patterns WHERE id = 1");
        if (patterns.length === 0) {
          // 確実に id=1 で「標準」を入れる
          await sqlite.execute("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
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

        // 4. セットアップ状態の確認（関数にせず、ここで直接判定）
        const companyRes = await sqlite.select<any[]>("SELECT name FROM company WHERE id = 1");
        const branchRes = await sqlite.select<any[]>("SELECT prefecture FROM branches WHERE id = 1");
        
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
        setIsLoading(false); // ✨ 成功しても失敗しても初期化終了
      }
    };
    init();
  }, []);

  // --- 会社設定側から完了を通知された時の処理 ---
  const handleSetupComplete = async () => {
    setIsSetupComplete(true);
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

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif", backgroundColor: "#f4f7f6" }}>
      <nav style={{ width: "220px", backgroundColor: "#2c3e50", color: "#ecf0f1", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", fontSize: "20px", fontWeight: "bold", borderBottom: "1px solid #34495e" }}>⚓️ はま給与</div>
        <ul style={{ listStyle: "none", padding: "10px", margin: 0 }}>
          <li onClick={() => setActiveTab("company")} style={tabStyle(activeTab === "company")}>🏢 会社設定</li>
          
          {isSetupComplete && (
            <>
              <li onClick={() => setActiveTab("calendar")} style={tabStyle(activeTab === "calendar")}>📅 会社カレンダー</li>
              <li onClick={() => setActiveTab("staff")} style={tabStyle(activeTab === "staff")}>👤 従業員詳細管理</li>
              {/* --- 以下、従業員登録が必要なメニュー --- */}
              <li 
                onClick={() => isStaffReady && setActiveTab("paid_leave")} 
                style={tabStyle(activeTab === "paid_leave", !isStaffReady)}
              >
                🏖 有給休暇管理
              </li>
              <li 
                onClick={() => isStaffReady && setActiveTab("custom_items")} 
                style={tabStyle(activeTab === "custom_items", !isStaffReady)}
              >
                ⚙️ 項目設定
              </li>
              <li 
                onClick={() => isStaffReady && setActiveTab("attendance")} 
                style={tabStyle(activeTab === "attendance", !isStaffReady)}
              >
                ⏱️ 勤怠・月次給与
              </li>
              <li 
                onClick={() => isStaffReady && setActiveTab("bonus")} 
                style={tabStyle(activeTab === "bonus", !isStaffReady)}
              >
                💰 賞与計算
              </li>
              <li 
                onClick={() => isStaffReady && setActiveTab("payslip")} 
                style={tabStyle(activeTab === "payslip", !isStaffReady)}
              >
                📄 明細書出力
              </li>
            </>
          )}
        </ul>
        
        {/* ガイドメッセージの出し分け */}
        <div style={{ marginTop: "auto", padding: "20px", fontSize: "12px", color: "#95a5a6", lineHeight: "1.6" }}>
          {!isSetupComplete ? (
            <>💡 会社名と本店の所在地を設定すると、基本機能が解放されます。</>
          ) : !isStaffReady ? (
            <div style={{ color: "#f1c40f" }}>💡 次は「従業員管理」から、最初の1人を登録しましょう！</div>
          ) : (
            <div style={{ 
              marginTop: "auto", 
              padding: "20px", 
              fontSize: "11px", 
              color: "#bdc3c7", 
              textAlign: "right",
              fontFamily: "monospace" // バージョン表記っぽく
            }}>
              ver 0.0.1
            </div>
          )}
        </div>
      </nav>

      <div style={{ flex: 1, padding: "30px", overflowY: "auto" }}>
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