import { HOLIDAY_CSV_URL_DEFAULT } from "../constants/salaryMaster2026";

export const DB_SCHEMAS = [
    // 0. ユーザー管理（ログイン・権限）
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    status TEXT DEFAULT 'active',
    last_login TEXT,
    created_at TEXT DEFAULT (DATETIME('now', 'localtime'))
  );`,
  
  // 1. 会社基本情報
  `CREATE TABLE IF NOT EXISTS company (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    zip_code TEXT,
    address TEXT,
    phone TEXT,
    corporate_number TEXT,
    representative TEXT,
    health_ins_num TEXT,
    labor_ins_num TEXT,
    round_overtime TEXT DEFAULT 'round',
    round_social_ins TEXT DEFAULT 'floor',
    round_emp_ins TEXT DEFAULT 'round',
    week_start_day INTEGER DEFAULT 0,  -- 週の開始曜日 (0=日曜, 1=月曜, ..., 6=土曜)
    annual_holidays INTEGER DEFAULT 120,
    holiday_csv_url TEXT DEFAULT '${HOLIDAY_CSV_URL_DEFAULT}',
    holiday_source TEXT DEFAULT 'url',
    corporate_search_mode TEXT DEFAULT 'scraping', -- 'scraping' or 'api'
    gbiz_api_key TEXT DEFAULT ''                   -- APIキー
  );`,

  // 2. 拠点（支店）情報
  `CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    zip_code TEXT,
    prefecture TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    health_ins_num TEXT,
    labor_ins_num TEXT
  );`,

  // 3. カレンダーパターン
  `CREATE TABLE IF NOT EXISTS calendar_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_invalid INTEGER DEFAULT 0,    -- 🆕 0:正常, 1:法違反(休日不足など)
    error_message TEXT               -- 🆕 なぜダメなのかの理由（UI表示用）
  );`,

  // 4. カレンダー詳細
  `CREATE TABLE IF NOT EXISTS company_calendar (
    pattern_id INTEGER,
    work_date TEXT,
    is_holiday INTEGER DEFAULT 0,
    description TEXT,
    PRIMARY KEY (pattern_id, work_date),
    FOREIGN KEY (pattern_id) REFERENCES calendar_patterns(id) ON DELETE CASCADE
  );`,

  // 5. 祝日マスター
  `CREATE TABLE IF NOT EXISTS holiday_master (
    holiday_date TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );`,

  // 6. 従業員マスター
  `CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY, 
    name TEXT NOT NULL, 
    furigana TEXT, 
    birthday TEXT, 
    gender TEXT DEFAULT 'unknown',
    zip_code TEXT, 
    address TEXT, 
    phone TEXT, 
    mobile TEXT, 
    branch_id INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    join_date TEXT, 
    retirement_date TEXT, 
    is_executive INTEGER DEFAULT 0,
    payroll_group_id INTEGER DEFAULT 1,
    calendar_pattern_id INTEGER DEFAULT 1,
    work_days TEXT,
    scheduled_in TEXT DEFAULT '',
    scheduled_work_hours REAL DEFAULT 8.0,
    is_flex INTEGER DEFAULT 0,
    core_start TEXT DEFAULT '',
    core_end TEXT DEFAULT '',
    wage_type TEXT DEFAULT 'hourly',
    base_wage INTEGER NOT NULL, 
    is_overtime_eligible INTEGER DEFAULT 1,
    fixed_overtime_hours REAL DEFAULT 0.0,
    fixed_overtime_allowance INTEGER DEFAULT 0,
    commute_type TEXT DEFAULT 'none', 
    commute_amount INTEGER DEFAULT 0, 
    dependents INTEGER DEFAULT 0, 
    resident_tax INTEGER DEFAULT 0,
    standard_remuneration INTEGER DEFAULT 0,
    is_employment_ins_eligible INTEGER DEFAULT 1,
    health_ins_id TEXT,
    pension_num TEXT,
    employment_ins_num TEXT,
    my_number TEXT,
    FOREIGN KEY (calendar_pattern_id) REFERENCES calendar_patterns(id),
    FOREIGN KEY (payroll_group_id) REFERENCES payroll_groups(id)
  );`,

  // 7. 勤怠データ
  `CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    work_date TEXT NOT NULL,
    entry_time TEXT,
    exit_time TEXT,
    break_start TEXT,
    break_end TEXT,
    out_time TEXT,
    return_time TEXT,
    csv_entry_time TEXT,
    csv_exit_time TEXT,
    csv_break_start TEXT,
    csv_break_end TEXT,
    csv_out_time TEXT,
    csv_return_time TEXT,
    work_type TEXT DEFAULT 'normal',
    paid_leave_hours REAL DEFAULT 0,
    memo TEXT,
    work_hours REAL DEFAULT 0,
    night_hours REAL DEFAULT 0,
    actual_base_wage INTEGER, 
    overtime_rate REAL,
    night_rate REAL,
    is_error INTEGER DEFAULT 0,    -- 🆕 追加：0:正常, 1:再計算・確認が必要
    error_message TEXT,            -- 🆕 追加：エラー内容（「起算日変更による再計算待ち」など）
    UNIQUE(staff_id, work_date),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 8. 有給付与枠
  `CREATE TABLE IF NOT EXISTS paid_leave_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    name TEXT DEFAULT '法定有給',
    grant_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    days_granted REAL NOT NULL,
    days_used REAL DEFAULT 0,
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 9. 有給取得履歴
  `CREATE TABLE IF NOT EXISTS paid_leave_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    days_used REAL NOT NULL,
    description TEXT,
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 10. 給与項目辞書
  `CREATE TABLE IF NOT EXISTS salary_item_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL, 
    display_order INTEGER DEFAULT 0
  );`,

  // 11. スタッフ個別給与設定
  `CREATE TABLE IF NOT EXISTS staff_salary_values (
    staff_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    amount INTEGER DEFAULT 0,
    PRIMARY KEY (staff_id, item_id),
    FOREIGN KEY (item_id) REFERENCES salary_item_master(id) ON DELETE CASCADE
  );`,

  // 12. 給与計算結果
  `CREATE TABLE IF NOT EXISTS salary_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL,
    
    -- ★ 証拠（スナップショット）として残すべき項目
    applied_base_wage INTEGER,       -- その時の時給/月給
    applied_dependents INTEGER,      -- その時の扶養人数
    total_work_hours REAL,           -- 総労働時間
    total_overtime_hours REAL,       -- 総残業時間
    total_night_hours REAL,          -- 総深夜時間

    -- ★ 追加：標準と高率を分けて保存
    standard_overtime_hours REAL,    -- 標準割増の対象時間
    high_overtime_hours REAL,        -- 高率割増の対象時間
    standard_overtime_pay INTEGER,   -- 標準割増の支給額
    high_overtime_pay INTEGER,       -- 高率割増の支給額
    statutory_overtime_pay INTEGER,  -- 法定内残業の支給額（割増なし）

    total_earnings INTEGER DEFAULT 0,
    taxable_amount INTEGER DEFAULT 0,
    health_insurance INTEGER DEFAULT 0,
    nursing_insurance INTEGER DEFAULT 0,
    welfare_pension INTEGER DEFAULT 0,
    emp_insurance INTEGER DEFAULT 0,
    social_ins_total INTEGER DEFAULT 0,
    income_tax INTEGER DEFAULT 0,
    resident_tax INTEGER DEFAULT 0,
    net_pay INTEGER DEFAULT 0,
    processed_at TEXT DEFAULT (DATETIME('now', 'localtime')), -- いつ確定したか
    UNIQUE(staff_id, target_year, target_month),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 13. 給与確定フラグ
  `CREATE TABLE IF NOT EXISTS salary_closings (
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL,
    is_closed INTEGER DEFAULT 0,
    PRIMARY KEY (target_year, target_month)
  );`,

  // 14. 賞与設定
  `CREATE TABLE IF NOT EXISTS bonus_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL,
    payment_date TEXT,
    is_closed INTEGER DEFAULT 0
  );`,

  // 15. 賞与項目辞書
  `CREATE TABLE IF NOT EXISTS bonus_item_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL
  );`,

  // 16. スタッフ個別賞与設定
  `CREATE TABLE IF NOT EXISTS bonus_staff_values (
    bonus_setting_id INTEGER NOT NULL,
    staff_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    amount INTEGER DEFAULT 0,
    PRIMARY KEY (bonus_setting_id, staff_id, item_id),
    FOREIGN KEY (bonus_setting_id) REFERENCES bonus_settings(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES bonus_item_master(id) ON DELETE CASCADE
  );`,

  // 17. 給与規定グループ（締日・支払日の管理）
  `CREATE TABLE IF NOT EXISTS payroll_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    closing_day INTEGER NOT NULL,   -- 1~28 または 99(末日)
    is_next_month INTEGER NOT NULL, -- 0:当月払い, 1:翌月払い
    payment_day INTEGER NOT NULL    -- 1~31
  );`
];