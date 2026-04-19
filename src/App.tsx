// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";
import CompanyManager from "./CompanyManager";
import CalendarManager from "./CalendarManager";
import StaffManager from "./StaffManager";
import AttendanceManager from "./AttendanceManager";
import PaySlipManager from "./PaySlipManager";
import CustomItemManager from "./CustomItemManager";
import BonusManager from "./BonusManager";

function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [staffList, setStaffList] = useState<any[]>([]);
  // 初期タブを "company" に変更し、セットアップ状態を管理する
  const [activeTab, setActiveTab] = useState("company");
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  
  const [targetYear, setTargetYear] = useState(2026);
  const [targetMonth, setTargetMonth] = useState(4);
  const isStaffReady = staffList.length > 0; // ✨ 従業員が1人以上いるか

  useEffect(() => {
    const init = async () => {
      try {
        const sqlite = await Database.load("sqlite:hama_kyuyo.db");

        // 一度テーブルを削除して最新構造で作り直す
        // ※ 本番運用中なら注意が必要ですが、開発中の今ならこれが一番スッキリします。
        // await sqlite.execute("DROP TABLE IF EXISTS attendance;"); 

        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS company (
            id INTEGER PRIMARY KEY CHECK (id = 1), -- 常にID 1のみ許可
            name TEXT NOT NULL,
            zip_code TEXT,
            address TEXT,
            phone TEXT,
            corporate_number TEXT, -- 法人番号
            representative TEXT,    -- 代表者名
            health_ins_num TEXT, -- 社会保険（厚年・健保）事業所番号
            labor_ins_num TEXT,  -- 労働保険番号
            round_overtime TEXT DEFAULT 'round',   -- 残業代（初期値：四捨五入）
            round_social_ins TEXT DEFAULT 'floor', -- 社会保険（初期値：切り捨て）
            round_emp_ins TEXT DEFAULT 'round',    -- 雇用保険（初期値：四捨五入）
            annual_holidays INTEGER DEFAULT 120,
            holiday_csv_url TEXT DEFAULT 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'
          );
        `);

        // branches テーブルの作成
        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            zip_code TEXT,
            prefecture TEXT NOT NULL,
            address TEXT,
            phone TEXT,
            health_ins_num TEXT,
            labor_ins_num TEXT
          );
        `);

        // 1. カレンダーパターンのマスターテーブルを追加
        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS calendar_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
          );
        `);

        await sqlite.execute("PRAGMA foreign_keys = ON;");
        const patterns = await sqlite.select<any[]>("SELECT * FROM calendar_patterns WHERE id = 1");
        if (patterns.length === 0) {
          // 確実に id=1 で「標準」を入れる
          await sqlite.execute("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        }

        // 2. カレンダー詳細テーブルを「パターンID」付きに作り直す
        // ※ work_date だけを PRIMARY KEY にすると1つのパターンしか保存できないため、
        // pattern_id との組み合わせ（複合主キー）に変更します。
        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS company_calendar (
            pattern_id INTEGER,
            work_date TEXT, -- '2026-04-01' 形式
            is_holiday INTEGER DEFAULT 0, -- 0:稼働日, 1:休日
            description TEXT,
            PRIMARY KEY (pattern_id, work_date),
            FOREIGN KEY (pattern_id) REFERENCES calendar_patterns(id) ON DELETE CASCADE
          );
        `);

        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS holiday_master (
            holiday_date TEXT PRIMARY KEY, -- '2026-05-03'
            name TEXT NOT NULL             -- '憲法記念日'
          );
        `);

        // 本店がなければ作成（最初の1件目として作成）
        const existingHead = await sqlite.select<any[]>("SELECT * FROM branches");
        if (existingHead.length === 0) {
          await sqlite.execute(
            "INSERT INTO branches (name, prefecture) VALUES ('本店', '')"
          );
        }

        // --- セットアップ状態の確認ロジック ---
        const checkSetup = async () => {
          const companyRes = await sqlite.select<any[]>("SELECT name FROM company WHERE id = 1");
          const branchRes = await sqlite.select<any[]>("SELECT prefecture FROM branches WHERE id = 1");
          
          const hasName = companyRes.length > 0 && companyRes[0].name.trim() !== "";
          const hasPref = branchRes.length > 0 && branchRes[0].prefecture !== "";
          
          if (hasName && hasPref) {
            setIsSetupComplete(true);
            // 自動で切り替えないよう、ここを "company" のままにするか、行自体を削除
            setActiveTab("company"); 
          } else {
            setIsSetupComplete(false);
            setActiveTab("company");
          }
        };

        await checkSetup();

        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS staff (
            id TEXT PRIMARY KEY, 
            name TEXT NOT NULL, 
            furigana TEXT, 
            birthday TEXT, 
            join_date TEXT, 
            health_ins_id TEXT,  -- 健康保険 被保険者番号
            pension_num TEXT,   -- 基礎年金番号（または厚年整理番号）
            employment_ins_num TEXT, -- 雇用保険 被保険者番号
            my_number TEXT,     -- マイナンバー（取り扱い注意ですが項目として）
            retirement_date TEXT, -- 🆕 追加：退職日
            status TEXT DEFAULT 'active', -- 🆕 追加：状態（active: 在籍, on_leave: 休職, retired: 退職）
            -- 1. 役員かどうか (0:従業員, 1:役員)
            is_executive INTEGER DEFAULT 0,

            -- 2. 雇用保険の対象か (0:対象外, 1:対象)
            -- 役員なら基本0、兼務役員や一般社員なら1
            is_employment_ins_eligible INTEGER DEFAULT 1,

            -- 3. 残業代計算の対象か (0:対象外, 1:対象)
            -- 管理監督者や役員なら0、一般社員なら1
            is_overtime_eligible INTEGER DEFAULT 1,
            zip_code TEXT, 
            address TEXT, 
            phone TEXT, 
            mobile TEXT, 
            wage_type TEXT DEFAULT 'hourly',
            base_wage INTEGER NOT NULL, 
            standard_remuneration INTEGER DEFAULT 0, -- 🆕 標準報酬月額（中ボス）
            calendar_pattern_id INTEGER DEFAULT 1,
            commute_type TEXT DEFAULT 'none', 
            commute_amount INTEGER DEFAULT 0, 
            branch_id INTEGER DEFAULT 0, 
            dependents INTEGER DEFAULT 0, 
            resident_tax INTEGER DEFAULT 0,
            work_days TEXT,
            scheduled_work_hours REAL DEFAULT 8.0, -- 1日の所定労働時間（例: 8.0）
            monthly_work_days REAL DEFAULT 20.0,    -- 月平均の所定労働日数（例: 20.33）
            fixed_overtime_hours REAL DEFAULT 0.0,    -- 固定残業時間（時間分）
            fixed_overtime_allowance INTEGER DEFAULT 0, -- 固定残業代（円）
            FOREIGN KEY (calendar_pattern_id) REFERENCES calendar_patterns(id)
          );
        `);

        await sqlite.execute(`  
          CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id TEXT NOT NULL,
            work_date TEXT NOT NULL,
            entry_time TEXT,
            exit_time TEXT,
            break_start TEXT,
            break_end TEXT,
            out_time TEXT,
            return_time TEXT,
            work_hours REAL DEFAULT 0,
            night_hours REAL DEFAULT 0,
            -- 🆕 将来の再現性のための「その時の単価」保存用カラム
            actual_base_wage INTEGER, 
            overtime_rate REAL,
            night_rate REAL,
            UNIQUE(staff_id, work_date),
            FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
          );
        `);

        await sqlite.execute(`
          -- 項目の辞書（何手当があるか）
          CREATE TABLE IF NOT EXISTS salary_item_master (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,       -- 'earning' (支給) or 'deduction' (控除)
            category TEXT NOT NULL    -- 'fixed' (固定), 'variable' (変動), 'formula' (自動計算)
          );

          -- スタッフごとの金額設定
          CREATE TABLE IF NOT EXISTS staff_salary_values (
              staff_id TEXT NOT NULL,
              item_id INTEGER NOT NULL,
              amount INTEGER DEFAULT 0,
              PRIMARY KEY (staff_id, item_id),
              FOREIGN KEY (item_id) REFERENCES salary_item_master(id) ON DELETE CASCADE
          );
        `);

        setDb(sqlite);
        const resStaff = await sqlite.select<any[]>("SELECT * FROM staff ORDER BY id ASC");
        setStaffList(resStaff);
      } catch (error) { console.error(error); }
    };
    init();
  }, []);

  // --- 会社設定側から完了を通知された時の処理 ---
  const handleSetupComplete = async () => {
    setIsSetupComplete(true);
    await refreshData();
  };

  // const tabStyle = (isActive: boolean) => ({
  //   padding: "12px 15px",
  //   cursor: "pointer",
  //   borderRadius: "5px",
  //   marginBottom: "5px",
  //   backgroundColor: isActive ? "#3498db" : "transparent",
  //   transition: "background-color 0.2s"
  // });

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