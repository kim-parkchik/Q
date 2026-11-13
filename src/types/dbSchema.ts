import { HOLIDAY_CSV_URL_DEFAULT } from "../constants/appConfig";

/**
 * 従業員ごとの記録の表（出勤簿・賃金台帳・年次有給休暇管理簿などの元になるもの）
 * 労働基準法で保存が必要なため、記録が1件でもある従業員は削除できないようにする（退職にして残す）。
 * ※ これらの表は従業員を消すと一緒に消える（ON DELETE CASCADE）ので、削除そのものを止める。
 */
export const STAFF_RECORD_TABLES = [
  { table: "attendance", label: "勤怠" },
  { table: "salary_results", label: "給与の確定結果" },
  { table: "bonus_staff_values", label: "賞与の入力" },
  { table: "bonus_results", label: "賞与の確定結果" },
  { table: "paid_leave_grants", label: "有給の付与" },
  { table: "paid_leave_usage", label: "有給の取得" },
  { table: "special_leave_grants", label: "特別休暇の付与" },
] as const;

export const DB_SCHEMAS = [
    // 0. ユーザー管理（ログイン・権限）
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    my_number_access INTEGER DEFAULT 0, -- マイナンバーを扱える（事務取扱担当者。1）。印を付けられるのは管理者（詳しくは utils/myNumber.ts）
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
    round_social_ins TEXT DEFAULT 'currency_law', -- 社会保険料（本人負担分）の端数：給与から引くときは50銭以下切り捨て・50銭超切り上げ（協会けんぽの保険料額表）。特約があれば floor など
    round_emp_ins TEXT DEFAULT 'currency_law', -- 雇用保険料（本人負担分）の端数：賃金から引くときは50銭以下切り捨て・50銭1厘以上切り上げ（厚生労働省）。特約があれば round など
    default_emp_ins_type TEXT DEFAULT 'general', -- 会社全体の雇用保険区分
    week_start_day INTEGER DEFAULT 0,  -- 週の開始曜日 (0=日曜, 1=月曜, ..., 6=土曜)
    is_small_business INTEGER DEFAULT 0, -- 中小企業（2023年3月までの月60時間超の割増は25%でよかった）
    hourly_leave INTEGER DEFAULT 0,      -- 時間単位の有給を使う（労使協定を結んでいる。労働基準法39条4項。1年に5日分まで）
    half_day_leave INTEGER DEFAULT 1,    -- 半日単位の有給（半休）を使う（法律の決まりではなく、会社が認めるとき。初めは使う）
    annual_leave_rule TEXT,              -- 年次有給休暇の付与日（JSON。入社日ごとか、毎年◯月◯日にそろえるか。NULL は入社日ごと。utils/annualLeaveGrant.ts）
    annual_holidays INTEGER DEFAULT 120,
    holiday_csv_url TEXT DEFAULT '${HOLIDAY_CSV_URL_DEFAULT}',
    holiday_source TEXT DEFAULT 'url',
    corporate_search_mode TEXT DEFAULT 'scraping', -- 'scraping' or 'api'
    gbiz_api_key TEXT DEFAULT '',
    backup_generations INTEGER DEFAULT 10
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
    is_invalid INTEGER DEFAULT 0,    -- 0:正常, 1:法違反(休日不足など)
    error_message TEXT               -- なぜダメなのかの理由（UI表示用）
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
    social_insurance_group_id INTEGER DEFAULT 1, -- 社保規定グループとの紐付け
    kokuho_premium INTEGER DEFAULT 0,  -- 国民健康保険組合の保険料（月額・本人負担。社保規定が国保組合の人だけ使う。utils/healthInsurer.ts）
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
    commute_setting TEXT,              -- 通勤の方法・片道の距離・定期代・有料道路・駐車場等（JSON。非課税限度額に使う。詳しくは utils/commuteAllowance.ts）
    fixed_break_apply INTEGER DEFAULT 1, -- 給与規定グループの「決まった休憩」を使うか（1: 使う / 0: 使わない。utils/fixedBreak.ts）
    dependents INTEGER DEFAULT 0, 
    tax_column TEXT DEFAULT 'kou', -- 源泉所得税の欄（kou: 甲欄 / otsu: 乙欄 / hei: 丙欄）
    resident_tax INTEGER DEFAULT 0,    -- 住民税の月額（以前の入れ方。下の年度の額を入れていない月に使う）
    resident_tax_schedule TEXT,        -- 住民税の特別徴収の額（年度ごとの6月分〜翌年5月分。JSON。詳しくは utils/residentTax.ts）
    resident_tax_municipality TEXT,    -- 住民税の市区町村（1月1日の住所の市区町村の団体コード6桁。給与支払報告書の提出先。utils/localGov.ts）
    standard_remuneration INTEGER DEFAULT 0,  -- いちばん新しい標準報酬月額（その月の分の値は下の履歴から求める）
    standard_remuneration_history TEXT,      -- 標準報酬月額の履歴（何年何月分から・いくら・理由。JSON。詳しくは utils/standardRemuneration.ts）
    wage_history TEXT,        -- 基本給の履歴（何年何月分から・給与形態・金額。JSON。詳しくは utils/staffHistory.ts。base_wage・wage_type はいちばん新しい値）
    dependents_history TEXT,  -- 扶養人数の履歴（何年何月分から・何人。JSON。dependents はいちばん新しい値）
    is_employment_ins_eligible INTEGER DEFAULT 1,
    employment_insurance_type TEXT,  -- 個人別の雇用保険区分（NULLなら会社設定に従う）
    health_ins_num TEXT,      -- 健康保険被保険者番号
    pension_num TEXT,         -- 厚生年金整理番号
    employment_ins_num TEXT,  -- 雇用保険被保険者番号
    flat_tax_reduction_persons INTEGER DEFAULT 0, -- 令和6年分 定額減税の人数（本人＋同一生計配偶者＋扶養親族。0なら月次減税をしない）
    leave_periods TEXT,       -- 産休・育休の期間（社会保険料の免除に使う。JSON。詳しくは utils/leaveExemption.ts）
    youiku_tokurei TEXT,      -- 養育期間の標準報酬月額の特例の申出（子・養育特例開始年月日など。JSON。詳しくは utils/youikuTokurei.ts）
    my_number TEXT,           -- 使わない（マイナンバーは my_numbers の表に置く。従業員の一覧に入らないように）
    FOREIGN KEY (calendar_pattern_id) REFERENCES calendar_patterns(id),
    FOREIGN KEY (payroll_group_id) REFERENCES payroll_groups(id),
    FOREIGN KEY (social_insurance_group_id) REFERENCES social_insurance_groups(id)
  );`,

  // 7. 勤怠データ
  `CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    work_date TEXT NOT NULL,
    entry_time TEXT,
    exit_time TEXT,
    breaks TEXT,                     -- 手入力した休憩の一覧（JSON。[{"start":"12:00","end":"13:00"},{"start":"15:00","end":"17:00","leave":true}]。NULL なら打刻を使う。utils/breaks.ts）
    csv_entry_time TEXT,
    csv_exit_time TEXT,
    csv_breaks TEXT,                 -- 打刻（TimeQard・CSV）の休憩の一覧（JSON）
    work_type TEXT DEFAULT '',       -- 勤務区分（normal・holiday・paid_full・paid_half・special（特別休暇）・special_half（特別休暇の半日）・absent など）
    leave_type_id INTEGER,           -- 特別休暇の種類（leave_types.id。区分が special・special_half の日だけ）
    leave_paid INTEGER,              -- 特別休暇が有給か（確定したときの休暇の種類の設定。1: 有給 / 0: 無給。utils/specialLeave.ts）
    special_leave_hours REAL DEFAULT 0, -- 時間単位の特別休暇の時間（時間休。休暇の種類は leave_type_id。区分が special・special_half の日は使わない）
    paid_leave_hours REAL DEFAULT 0,
    memo TEXT,
    is_finalized INTEGER DEFAULT 0,  -- 0: 未確定, 1: 確定済み
    finalized_at TEXT,               -- 確定された日時
    finalized_by TEXT,               -- 確定させたユーザー名
    work_hours REAL DEFAULT 0,
    night_hours REAL DEFAULT 0,
    actual_base_wage INTEGER, 
    overtime_rate REAL,
    night_rate REAL,
    is_error INTEGER DEFAULT 0,    -- 0:正常, 1:再計算・確認が必要
    error_message TEXT,            -- エラー内容（「起算日変更による再計算待ち」など）
    break_none INTEGER DEFAULT 0,  -- その日は休憩を取らなかった（1 なら決まった休憩を引かない。utils/fixedBreak.ts）
    auto_break TEXT,               -- 確定したときに引いた決まった休憩（「12:00〜13:00」「45分」。引かなければ空）
    UNIQUE(staff_id, work_date),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 8. 有給付与枠
  `CREATE TABLE IF NOT EXISTS paid_leave_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    name TEXT DEFAULT '法定有給',  -- 年次有給休暇の付与だけを入れる（夏季休暇などの特別休暇は special_leave_grants）
    grant_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    days_granted REAL NOT NULL,
    days_used REAL DEFAULT 0,  -- 使っていない（前の有給の画面で使っていた。いまは確定した勤怠から数える。utils/paidLeave.ts）
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 9. 有給取得履歴（前の有給の画面の「消化を記録する」で入れたもの。いまは入れない。
  //    その日に確定した勤怠がないときだけ、有給を取った日として数える）
  `CREATE TABLE IF NOT EXISTS paid_leave_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    days_used REAL NOT NULL,
    description TEXT,
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 9-2. 会社独自の休暇（特別休暇）の種類（夏季休暇・慶弔休暇など。くわしくは utils/specialLeave.ts）
  `CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_paid INTEGER DEFAULT 1,        -- 1: 有給（休んでも給与を引かない・払う） / 0: 無給
    track_balance INTEGER DEFAULT 1,  -- 1: 残りを数える（付与から引く） / 0: 数えない（慶弔休暇など、そのつど取る休暇）
    allow_half INTEGER DEFAULT 0,     -- 1: 半日でも取れる
    allow_hourly INTEGER DEFAULT 0,   -- 1: 時間単位でも取れる（子の看護等休暇・介護休暇は、1時間単位でも取れるようにしなければならない）
    grant_rule TEXT,                  -- 発生（JSON。{"month":7,"day":1,"days":3}：毎年7月1日に3日。NULL は決まりなし（人ごとに付与））
    expiry_rule TEXT,                 -- 消滅（JSON。{"mode":"months","months":3}：付与日から3か月 / {"mode":"date","month":9,"day":30}：9月30日まで）
    is_active INTEGER DEFAULT 1,      -- 0: 使わない（勤怠で選べない。前の記録はそのまま）
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (DATETIME('now', 'localtime'))
  );`,

  // 9-3. 特別休暇の付与（人ごと。0日の付与は「この回は付与しない」の印）
  `CREATE TABLE IF NOT EXISTS special_leave_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    leave_type_id INTEGER NOT NULL,
    grant_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    days_granted REAL NOT NULL,
    created_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE,
    FOREIGN KEY(leave_type_id) REFERENCES leave_types(id)
  );`,

  // 10. 給与項目辞書
  `CREATE TABLE IF NOT EXISTS salary_item_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL, 
    display_order INTEGER DEFAULT 0,
    in_overtime_base INTEGER DEFAULT 1 -- 支給項目を残業代の時給（割増賃金の基礎）に入れるか（1: 入れる / 0: 入れない。家族手当・通勤手当・住宅手当など）
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
    standard_overtime_pay INTEGER,   -- 標準割増の支給額（固定残業代がある人は、法定の計算額）
    high_overtime_pay INTEGER,       -- 高率割増の支給額（固定残業代がある人は、法定の計算額）
    statutory_overtime_pay INTEGER,  -- 法定内残業の支給額（割増なし）
    fixed_overtime_allowance INTEGER,           -- 固定残業代（時間外労働の割増賃金に当てる定額。なしは 0）
    fixed_overtime_excess INTEGER DEFAULT 0,    -- 時間外労働の割増賃金が固定残業代を超えた差額（超過分として払った額）
    non_fixed_earnings INTEGER,                 -- 支給合計のうち非固定的賃金（残業代・休日や深夜の手当・変動の支給項目。月変の年間平均に使う）
    absence_deduction INTEGER,                  -- 欠勤控除の額（月給制。v8 より前に確定した給与は NULL）
    tardy_deduction INTEGER,                    -- 遅刻・早退・中抜けの控除の額（月給制・日給制。v10 より前に確定した給与は NULL）
    unpaid_leave_deduction INTEGER,             -- 無給の特別休暇の控除の額（月給制。欠勤控除と同じ計算。v11 より前に確定した給与は NULL）
    flex_carry_hours REAL,                      -- フレックスタイム制で、次の月に繰り越す不足時間（フレックスタイム制の人だけ。ほかは NULL）
    prescribed_work_days INTEGER,               -- 計算期間の所定労働日数（会社カレンダーから数えたもの。算定・月変の支払基礎日数に使う。わからなければ NULL）

    total_earnings INTEGER DEFAULT 0,
    taxable_amount INTEGER DEFAULT 0,
    health_insurance INTEGER DEFAULT 0,
    nursing_insurance INTEGER DEFAULT 0,
    child_support INTEGER DEFAULT 0,  -- 子ども・子育て支援金（令和8年4月分から）
    welfare_pension INTEGER DEFAULT 0,
    emp_insurance INTEGER DEFAULT 0,
    kokuho_premium INTEGER DEFAULT 0, -- 国民健康保険組合の保険料（国保組合の人だけ。social_ins_total に入れる）
    social_ins_total INTEGER DEFAULT 0,
    income_tax INTEGER DEFAULT 0,
    flat_tax_reduction INTEGER DEFAULT 0, -- 定額減税額（令和6年6月〜12月。income_tax はこれを引いた後の額）
    resident_tax INTEGER DEFAULT 0,
    year_end_adjustment INTEGER DEFAULT 0, -- この給与で精算した年末調整の過不足額（＋還付／−徴収）。net_pay に含む
    net_pay INTEGER DEFAULT 0,
    processed_at TEXT DEFAULT (DATETIME('now', 'localtime')), -- いつ確定したか
    UNIQUE(staff_id, target_year, target_month),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 13. 給与確定フラグ
  // ※ いまは使っていない（給与を確定したかは、その人・その月の salary_results があるかで見る。勤怠の画面のロックも同じ）
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
    type TEXT NOT NULL,              -- 'earning' (支給) or 'deduction' (控除)
    display_order INTEGER DEFAULT 0,
    is_default_active INTEGER DEFAULT 1 -- 1なら新しい賞与作成時に自動で有効
  );`,

  // 賞与設定と項目の紐付けテーブル
  `CREATE TABLE IF NOT EXISTS bonus_setting_items (
    bonus_setting_id INTEGER,
    item_id INTEGER,
    PRIMARY KEY (bonus_setting_id, item_id),
    FOREIGN KEY (bonus_setting_id) REFERENCES bonus_settings(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES bonus_item_master(id) ON DELETE CASCADE
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

  // 賞与計算結果保存テーブル (確定・履歴用)
  `CREATE TABLE IF NOT EXISTS bonus_results (
    bonus_setting_id INTEGER NOT NULL,
    staff_id TEXT NOT NULL,
    total_earnings INTEGER,    -- 総支給（生データ）
    hyojun_bonus INTEGER,      -- 標準賞与額（1,000円未満切り捨て後）
    health_insurance INTEGER,  -- 健保
    nursing_insurance INTEGER, -- 介護
    child_support INTEGER,     -- 子ども・子育て支援金
    welfare_pension INTEGER,   -- 厚生年金
    emp_insurance INTEGER,     -- 雇用保険
    income_tax INTEGER,        -- 所得税
    custom_deductions INTEGER, -- カスタム控除の合計額
    net_pay INTEGER,           -- 差引支給額
    is_nursing INTEGER,        -- 当時、介護保険対象者だったか（0 or 1）
    processed_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    PRIMARY KEY (bonus_setting_id, staff_id),
    FOREIGN KEY (bonus_setting_id) REFERENCES bonus_settings(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 17. 給与規定グループ（締日・支払日の管理）
  `CREATE TABLE IF NOT EXISTS payroll_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    closing_day INTEGER NOT NULL,   -- 1~28 または 99(末日)
    is_next_month INTEGER NOT NULL, -- 0:当月払い, 1:翌月払い
    payment_day INTEGER NOT NULL,    -- 1~31
    tax_calc_method TEXT DEFAULT 'table', -- 源泉所得税の計算方法 'table':月額表 / 'densanki':電算機計算の特例
    social_ins_collection TEXT DEFAULT 'current', -- 社会保険料の徴収 'current':当月徴収（その月の分） / 'next':翌月徴収（前月の分）
    proration_method TEXT DEFAULT 'none', -- 計算期間の途中で入社・退職した月給制の人の日割り 'none':しない / 'workdays':所定労働日数 / 'calendar':暦日数
    absence_deduction_method TEXT DEFAULT 'workdays', -- 月給制の人の欠勤控除 'workdays':計算期間の所定労働日数で割る / 'annual':1年間の月平均の所定労働日数で割る / 'none':しない（完全月給制）
    tardy_deduction_method TEXT DEFAULT 'none',       -- 月給制・日給制の人の遅刻・早退・中抜けの控除 'none':しない / 'annual':1か月平均所定労働時間で割る / 'period':計算期間の所定労働時間で割る
    flex_rule TEXT,                                   -- フレックスタイム制の決まり（JSON。総労働時間・法定の総枠・不足時間。NULL は初めの決まり。utils/flexTime.ts）
    fixed_break TEXT,                -- 決まった休憩（休憩の時刻が入っていない日に引く。JSON。空なら使わない。utils/fixedBreak.ts）
    is_active INTEGER DEFAULT 1      -- 1:有効, 0:廃止
  );`,

  // 18. 社会保険規定グループ（健康保険の保険者。くわしくは utils/healthInsurer.ts）
  `CREATE TABLE IF NOT EXISTS social_insurance_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'kyokai',      -- kyokai：協会けんぽ（料率は都道府県ごと）／union：健康保険組合（下の料率の表）／kokuho：国民健康保険組合（従業員ごとの月額）
    is_active INTEGER DEFAULT 1
  );`,

  // 18-2. 健康保険組合の料率（本人負担の%。「何年何月分から」ごと）
  `CREATE TABLE IF NOT EXISTS social_insurance_group_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    from_month TEXT NOT NULL,              -- この料率を使いはじめる保険料の月（YYYY-MM）
    health_rate REAL NOT NULL DEFAULT 0,   -- 健康保険（本人負担の%）
    care_rate REAL NOT NULL DEFAULT 0,     -- 介護保険（本人負担の%。40〜64歳）
    child_support_rate REAL NOT NULL DEFAULT 0, -- 子ども・子育て支援金（本人負担の%。令和8年4月分から）
    UNIQUE(group_id, from_month),
    FOREIGN KEY (group_id) REFERENCES social_insurance_groups(id) ON DELETE CASCADE
  );`,

  // log
  // 年末調整（1人・1年分の申告書の内容と、保存したときの計算結果。詳しくは utils/nenchoDeclaration.ts・utils/nencho.ts）
  `CREATE TABLE IF NOT EXISTS year_end_adjustments (
    staff_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    declaration TEXT,              -- 申告書の内容（JSON）
    result TEXT,                   -- 保存したときの計算結果（JSON）
    settle_year INTEGER,           -- 過不足額を精算する給与の支払年月（空なら、その年の12月）
    settle_month INTEGER,
    updated_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    PRIMARY KEY (staff_id, year),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 住民税の市区町村ごとの設定（給与支払報告書の提出先。詳しくは utils/salaryPaymentReport.ts）
  `CREATE TABLE IF NOT EXISTS resident_tax_municipalities (
    code TEXT PRIMARY KEY,         -- 団体コード（6桁。utils/localGov.ts）
    designation_number TEXT,       -- 指定番号（市区町村が会社に付けた番号。特別徴収税額の決定通知書に書いてある）
    atena_number TEXT,             -- 宛名番号（市区町村が会社に付けた番号。特別徴収税額通知の CSV に書いてある）
    special_due INTEGER DEFAULT 0, -- 納期の特例の承認を受けた（1）：6月〜11月分は12月10日、12月〜翌年5月分は6月10日までに納める（地方税法321条の5の2）
    updated_at TEXT DEFAULT (DATETIME('now', 'localtime'))
  );`,

  // 給与支払報告書の、従業員ごと・年分ごとの設定（詳しくは utils/salaryPaymentReport.ts）
  `CREATE TABLE IF NOT EXISTS salary_payment_reports (
    staff_id TEXT NOT NULL,
    year INTEGER NOT NULL,         -- 給与を支払った年（令和8年分なら2026。翌年1月に出す）
    ordinary_collection INTEGER,   -- 普通徴収にする（1）・特別徴収にする（0）。空なら初めの値（退職した人・乙欄の人は普通徴収）
    ordinary_reason TEXT,          -- 普通徴収にする理由（摘要に書く符号「普A」〜「普F」、またはそのほかの理由）
    submit INTEGER,                -- 出さなくてよい退職者（30万円以下）も出す（1）
    updated_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    PRIMARY KEY (staff_id, year),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // 紙の給与支払報告書（総括表。地方税法施行規則 第十七号様式）に書く、会社の表にない事項（1行だけ。features/nencho/SalaryReportSummaryView.tsx）
  `CREATE TABLE IF NOT EXISTS salary_report_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payer_kana TEXT,               -- 給与支払者の氏名又は名称のフリガナ
    office_name TEXT,              -- 所得税の源泉徴収をしている事務所又は事業の名称（空なら会社名）
    address_kana TEXT,             -- 同上の所在地のフリガナ
    business_type TEXT,            -- 事業種目
    tax_office TEXT,               -- 所轄税務署名（「税務署」は付けない）
    contact_dept TEXT, contact_section TEXT, contact_name TEXT, contact_phone TEXT, -- 連絡者の所属課・係・氏名・電話番号
    accountant_name TEXT, accountant_phone TEXT,  -- 関与税理士等の氏名・電話番号
    payment_method TEXT,           -- 給与の支払方法及びその期日（月給・毎月25日 など）
    payment_slip TEXT,             -- 納入書の送付（need：必要・no：不要・空：選んでいない）
    updated_at TEXT DEFAULT (DATETIME('now', 'localtime'))
  );`,

  // マイナンバー（個人番号）。従業員の一覧（staff.*）に入らないよう、別の表に置く。
  // 見る・入れる・消すのは、事務取扱担当者の印（users.my_number_access）がある人だけ（詳しくは utils/myNumber.ts）
  `CREATE TABLE IF NOT EXISTS my_numbers (
    staff_id TEXT NOT NULL,
    person TEXT NOT NULL,          -- "self"（本人）か、家族の印（"family:生年月日:氏名"。utils/myNumber.ts の familyKey）
    name TEXT,                     -- 家族の氏名（画面に出す。本人は空）
    relation TEXT,                 -- 家族の続柄（配偶者・子など。画面に出す）
    number TEXT NOT NULL,          -- 暗号化した番号（"v1:…"。utils/myNumberCrypto.ts）。暗号化を始める前に登録したものは12桁のまま（始めるときに暗号化する）
    number_hash TEXT,              -- 同じ番号が2か所にないかを確かめる値（HMAC。鍵がないと番号に戻せない）
    updated_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    PRIMARY KEY (staff_id, person),
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,

  // マイナンバーを暗号化する鍵（データ鍵）を、パスワードと回復用キーで包んだもの。1行だけ（詳しくは utils/myNumberCrypto.ts）
  `CREATE TABLE IF NOT EXISTS my_number_keys (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    kdf TEXT NOT NULL,                 -- パスワードから鍵を作る方式と強さ（JSON）
    salt TEXT NOT NULL,                -- パスワードから鍵を作るときの salt（base64）
    wrapped_by_password TEXT NOT NULL, -- パスワードから作った鍵で包んだデータ鍵
    recovery_salt TEXT NOT NULL,
    wrapped_by_recovery TEXT NOT NULL, -- 回復用キーから作った鍵で包んだデータ鍵
    created_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    updated_at TEXT DEFAULT (DATETIME('now', 'localtime'))
  );`,

  // TimeQard（打刻のソフト）の設定。1行だけ（くわしくは timeqard/DESIGN.md の 5.4・features/timeqard/timeqardStore.ts）
  `CREATE TABLE IF NOT EXISTS timeqard_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_mark TEXT NOT NULL,        -- 会社の印（A〜Z・2〜7 の8文字。従業員ファイル・打刻カード・打刻の CSV に入れ、ほかの会社のものと取り違えないようにする）
    created_at TEXT DEFAULT (DATETIME('now', 'localtime')),
    last_export_at TEXT,               -- 最後に従業員ファイルを書き出した日時（「2026-11-07T16:30:00+09:00」）
    last_export_fingerprint TEXT       -- そのときの中身の確かめ用の値（そのあとに従業員・カードが変わったら、書き出し直すよう知らせる）
  );`,

  // TimeQard の打刻カード（QR コード）。作り直すと、前のカードに revoked_at を入れる（くわしくは timeqard/DESIGN.md の 5.2）
  `CREATE TABLE IF NOT EXISTS timeqard_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL,
    card_number TEXT NOT NULL UNIQUE,  -- カードの番号（A〜Z・2〜7 の26文字。QR コードの中身の一部。同じカードを刷り直せるように残す）
    issued_at TEXT NOT NULL,           -- 作った日時
    revoked_at TEXT,                   -- 作り直して使えなくした日時（空なら、いま使えるカード）
    FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE
  );`,
  // いま使えるカードは、1人に1枚だけ
  `CREATE UNIQUE INDEX IF NOT EXISTS timeqard_cards_one_active ON timeqard_cards(staff_id) WHERE revoked_at IS NULL;`,

  `CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    user_name TEXT
  );`,

  // 記録がある従業員の削除を止める（画面の確認をすり抜けても、記録が一緒に消えないようにする）
  // ※ IF NOT EXISTS のため、中身を変えるときは別の名前で作り直すこと（前の名前の TRIGGER は、マイグレーションで消す）
  //    v11 で特別休暇の付与（special_leave_grants）を足したので、keep_staff_with_records から _v2 にした
  `CREATE TRIGGER IF NOT EXISTS keep_staff_with_records_v2
    BEFORE DELETE ON staff
    WHEN ${STAFF_RECORD_TABLES.map(({ table }) => `EXISTS (SELECT 1 FROM ${table} WHERE staff_id = OLD.id)`).join("\n      OR ")}
  BEGIN
    SELECT RAISE(ABORT, '勤怠・給与・賞与・有給・休暇の記録がある従業員は削除できません。退職にしてください。');
  END;`
];