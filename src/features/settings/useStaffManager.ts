/**
 * 従業員管理画面（StaffManager）の状態とデータ操作
 * 画面の見た目は staff/ 以下の各セクション、ロジックはここにまとめる
 */
import { useState, useEffect } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { fetchAddressByZip } from "../../utils/addressUtils";

interface UseStaffManagerArgs {
    db: Database;
    onDataChange: () => void;
    staffList: any[];
}

interface CalendarPattern {
    id: number;
    name: string;
}

export function useStaffManager({ db, onDataChange, staffList }: UseStaffManagerArgs) {
    // =========================================================
    // 1. システム・画面制御状態
    // =========================================================
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isSearchingZip, setIsSearchingZip] = useState(false); // 郵便番号検索中

    // --- 表示・ソート・絞り込み ---
    const [sortKey, setSortKey] = useState<"id" | "branch_id">("id");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
    const [searchKeyword, setSearchKeyword] = useState("");
    const [filterStatus, setFilterStatus] = useState(["active", "on_leave", "retired"]);

    // =========================================================
    // 2. 従業員 基本情報 (targetXxx)
    // =========================================================
    const [targetId, setTargetId] = useState("");
    const [targetName, setTargetName] = useState("");
    const [targetFurigana, setTargetFurigana] = useState("");
    const [targetBirthday, setTargetBirthday] = useState("");
    const [targetGender, setTargetGender] = useState("");
    
    // --- 連絡先・住所 ---
    const [targetZip, setTargetZip] = useState("");
    const [targetAddress, setTargetAddress] = useState("");
    const [targetPhone, setTargetPhone] = useState("");
    const [targetMobile, setTargetMobile] = useState("");

    // --- 所属・入退社・ステータス ---
    const [targetBranchId, setTargetBranchId] = useState(1);
    const [targetStatus, setTargetStatus] = useState("active");
    const [targetJoinDate, setTargetJoinDate] = useState(new Date().toISOString().split('T')[0]);
    const [targetRetirementDate, setTargetRetirementDate] = useState("");
    const [targetIsExecutive, setTargetIsExecutive] = useState(0); // 役員か

    // =========================================================
    // 3. 勤務ルール・時間設定
    // =========================================================
    // --- カレンダー・曜日 ---
    const [targetPatternId, setTargetPatternId] = useState(1);
    const [targetWorkDays, setTargetWorkDays] = useState<Record<string, boolean>>({
        mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false
    });

    // --- 所定労働時間・始業 ---
    const [targetScheduledIn, setTargetScheduledIn] = useState(""); // 標準始業
    const [targetDailyHours, setTargetDailyHours] = useState(8.0);  // 1日の計算用(h)
    const [targetHours, setTargetHours] = useState(8);              // 入力用(時)
    const [targetMinutes, setTargetMinutes] = useState(0);           // 入力用(分)

    // --- フレックス・コアタイム ---
    const [targetIsFlex, setTargetIsFlex] = useState(false);
    const [targetCoreStart, setTargetCoreStart] = useState("");
    const [targetCoreEnd, setTargetCoreEnd] = useState("");

    // =========================================================
    // 4. 給与・手当・控除設定
    // =========================================================
    const [targetWageType, setTargetWageType] = useState("hourly"); // 時給/月給
    const [targetWage, setTargetWage] = useState(1200);
    const [targetIsOvertimeEligible, setTargetIsOvertimeEligible] = useState(1); // 残業代支給対象か

    // --- 固定残業代（みなし） ---
    const [targetFixedOvertimeHours, setTargetFixedOvertimeHours] = useState(0);
    const [targetFixedOvertimeAmount, setTargetFixedOvertimeAmount] = useState(0);

    // --- 通勤費・社保・税金 ---
    const [targetCommuteType, setTargetCommuteType] = useState("daily");
    const [targetCommuteAmount, setTargetCommuteAmount] = useState(0);
    const [targetDependents, setTargetDependents] = useState(0);
    const [targetResidentTax, setTargetResidentTax] = useState(0);
    const [targetStandardRemuneration, setTargetStandardRemuneration] = useState(0); // 標準報酬月額
    const [targetIsEmploymentInsEligible, setTargetIsEmploymentInsEligible] = useState(1); // 雇用保険
    const [targetHealthInsNum, setTargetHealthInsNum] = useState("");      // 健康保険被保険者番号
    const [targetPensionNum, setTargetPensionNum] = useState("");          // 厚生年金整理番号
    const [targetEmploymentInsNum, setTargetEmploymentInsNum] = useState(""); // 雇用保険被保険者番号

    const [targetSocialInsGroupId, setTargetSocialInsGroupId] = useState(1); // 🆕 追加
    const [targetEmpInsType, setTargetEmpInsType] = useState(""); // 🆕 追加 (NULL=会社設定に従う)

    // =========================================================
    // 5. 外部データ・計算用マスタ
    // =========================================================
    const [socialGroups, setSocialGroups] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [branchFilters, setBranchFilters] = useState<string[]>(branches.map(b => b.name));
    const [calendarPatterns, setCalendarPatterns] = useState<CalendarPattern[]>([]);
    const [annualWorkDays, setAnnualWorkDays] = useState(245); // 計算結果（統計用）
    const [payrollGroups, setPayrollGroups] = useState<any[]>([]);
    const [targetPayrollGroupId, setTargetPayrollGroupId] = useState(1);
    
    // 🆕 住所検索を実行する関数
    const handleZipSearch = async () => {
        // 数字以外を除去
        const cleanZip = targetZip.replace(/[^\d]/g, "");
        
        if (cleanZip.length !== 7) {
            alert("郵便番号は7桁の数字で入力してください。");
            return;
        }

        // ハイフンを入れた形式に整形 (例: 1234567 -> 123-4567)
        const formattedZip = cleanZip.slice(0, 3) + "-" + cleanZip.slice(3);
        setTargetZip(formattedZip); // 入力欄の見た目もハイフンありに更新

        setIsSearchingZip(true);
        try {
            const res = await fetchAddressByZip(cleanZip); // 検索自体は数字のみでOK
            if (res) {
                setTargetAddress(`${res.address1}${res.address2}${res.address3}`);
            } else {
                alert("該当する住所が見つかりませんでした。");
            }
        } catch (e) {
            alert("住所検索エラーが発生しました。");
        } finally {
            setIsSearchingZip(false);
        }
    };

    // --- 年間稼働日数を計算する関数 (patternIdを引数に取る) ---
    const calculateDays = async (patternId: number, currentWorkDays: Record<string, boolean>) => {
        if (!db) return;
        const year = new Date().getFullYear(); 

        if (patternId === 0) {
            let workDays = 0;
            const date = new Date(year, 0, 1);
            while (date.getFullYear() === year) {
                const dayLabels = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
                const dayKey = dayLabels[date.getDay()];

                // ⚠️ ここ！ 外の targetWorkDays ではなく引数の currentWorkDays を使う
                if (currentWorkDays[dayKey as keyof typeof currentWorkDays]) {
                    workDays++;
                }
                date.setDate(date.getDate() + 1);
            }
            setAnnualWorkDays(workDays);
            return;
        }

        // --- B. カレンダー設定がある場合 ---
        // (既存の祝日マスターや company_calendar を参照するロジック)
        try {
            const resHolidays = await db.select<any[]>("SELECT holiday_date FROM holiday_master");
            const hSet = new Set(resHolidays.map(h => h.holiday_date.replaceAll("/", "-")));

            // 指定された pattern_id の設定のみを取得
            const resCompany = await db.select<any[]>(
                "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
                [patternId]
            );
            const cMap: Record<string, number> = {};
            resCompany.forEach(c => { cMap[c.work_date] = c.is_holiday; });

            let workDays = 0;
            for (let m = 0; m < 12; m++) {
                const date = new Date(year, m, 1);
                while (date.getMonth() === m) {
                    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const isDefH = (date.getDay() === 0 || date.getDay() === 6 || hSet.has(dateKey));
                    const setting = cMap[dateKey];
                    const isFinallyHoliday = (isDefH && setting !== 0) || (setting === 1);
                    
                    if (!isFinallyHoliday) workDays++;
                    date.setDate(date.getDate() + 1);
                }
            }
            setAnnualWorkDays(workDays);
        } catch (e) {
            console.error("日数計算エラー:", e);
        }
    };

    // 時・分が変更されたら、計算用の小数値を更新する
    useEffect(() => {
        const decimalHours = targetHours + (targetMinutes / 60);
        setTargetDailyHours(decimalHours);
    }, [targetHours, targetMinutes]);

    // --- 初期化処理 ---
    useEffect(() => {
        const init = async () => {
            if (!db) return;
            await fetchSocialGroups();
            await fetchBranches();
            await fetchPayrollGroups();
            
            // カレンダーパターン一覧を取得
            const patterns = await db.select<CalendarPattern[]>("SELECT * FROM calendar_patterns ORDER BY id ASC");
            setCalendarPatterns(patterns);

            if (!editingId) {
                await calculateDays(targetPatternId, targetWorkDays);
            }
        };
        init();
    }, [db]);

    // パターンが変更されたら日数を再計算
    useEffect(() => {
        calculateDays(targetPatternId, targetWorkDays);
    }, [targetPatternId, targetWorkDays, db]); // dbも依存配列に入れておくと安全です

    // 絞り込みと言語検索を適用
    const filteredList = staffList.filter(s => {
        // 1. ステータス絞り込み
        const matchesStatus = filterStatus.includes(s.status || "active");
        
        // 2. キーワード検索 (ID, 名前, フリガナ)
        const keyword = searchKeyword.toLowerCase();
        const matchesKeyword = 
            String(s.id).includes(keyword) ||
            s.name.toLowerCase().includes(keyword) ||
            (s.furigana || "").toLowerCase().includes(keyword);

        // 🆕 3. 店舗絞り込み（ここを修正！）
        // staffList の branch_name が、選択中の配列 branchFilters に含まれているかチェック
        const matchesBranch = branchFilters.includes(s.branch_name);

        return matchesStatus && matchesKeyword && matchesBranch;
    });

    // filteredList に対してソートを行う
    const sortedAndFilteredList = [...filteredList].sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];

        // localeCompare を使うと、数値・文字列を問わず「人間にとって自然な順序」で並び替えてくれます
        // { numeric: true } を指定するのがポイントです
        if (sortOrder === "asc") {
            return String(valA).localeCompare(String(valB), undefined, { numeric: true });
        } else {
            return String(valB).localeCompare(String(valA), undefined, { numeric: true });
        }
    });

    // ヘッダーをクリックした時の処理
    const handleSort = (key: "id" | "branch_id") => {
        if (sortKey === key) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortOrder("asc");
        }
    };

    const clearForm = () => {
        setTargetId(""); setTargetName(""); setTargetFurigana(""); setTargetBirthday(""); 
        setTargetJoinDate(new Date().toISOString().split('T')[0]);
        setTargetRetirementDate("");
        setTargetStatus("active");
        setTargetZip(""); setTargetAddress(""); setTargetPhone(""); setTargetMobile(""); setTargetCommuteAmount(0);
        setTargetBranchId(1); setTargetDependents(0); setTargetResidentTax(0);
        setTargetStandardRemuneration(0);
        setTargetWorkDays({ mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false });
        setTargetSocialInsGroupId(1);
        setTargetEmpInsType("");
        setEditingId(null);
    };

    const startEdit = (s: any) => {
        setDeletingId(null);
        setEditingId(s.id);
        setTargetId(s.id);
        setTargetName(s.name);
        setTargetFurigana(s.furigana || "");
        setTargetBirthday(s.birthday || "");
        setTargetGender(s.gender || "unknown");
        setTargetJoinDate(s.join_date || "");
        setTargetRetirementDate(s.retirement_date || ""); // 🆕
        setTargetStatus(s.status || "active"); // 🆕
        setTargetZip(s.zip_code || "");
        setTargetAddress(s.address || "");
        setTargetPhone(s.phone || ""); // 👈 追加
        setTargetMobile(s.mobile || ""); // 👈 追加
        setTargetWage(s.base_wage);
        setTargetCommuteType(s.commute_type);
        setTargetCommuteAmount(s.commute_amount);
        setTargetWageType(s.wage_type || "hourly");
        setTargetPatternId(s.calendar_pattern_id || 1);
        const hoursVal = s.scheduled_work_hours || 8; 
        const h = Math.floor(hoursVal);
        const m = Math.round((hoursVal - h) * 60);
        setTargetHours(h);
        setTargetMinutes(m);
        setTargetBranchId(s.branch_id || 1);
        setTargetDependents(s.dependents || 0);
        setTargetResidentTax(s.resident_tax || 0);
        setTargetStandardRemuneration(s.standard_remuneration || 0); // 🆕 追加
        setTargetSocialInsGroupId(s.social_insurance_group_id || 1);
        setTargetEmpInsType(s.employment_insurance_type || "");
        setTargetIsExecutive(s.is_executive || 0);
        setTargetIsEmploymentInsEligible(s.is_employment_ins_eligible ?? 1); // 雇用保険はデフォルト1なので??を使用
        setTargetIsOvertimeEligible(s.is_overtime_eligible ?? 1);
        setTargetFixedOvertimeHours(s.fixed_overtime_hours || 0);
        setTargetFixedOvertimeAmount(s.fixed_overtime_allowance || 0);
        // 🆕 曜日データの復元
        const newWorkDays = { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false };
        if (s.work_days) {
            s.work_days.split(',').forEach((day: string) => {
                if (day in newWorkDays) {
                    (newWorkDays as any)[day] = true;
                }
            });
        }
        setTargetWorkDays(newWorkDays);

        setShowForm(true);
    };

    const isIdDuplicated = () => {
        if (editingId || isSaving) return false;
        if (!targetId.trim()) return false;
        return staffList.some(s => String(s.id) === String(targetId).trim());
    };

    const isChanged = () => {
        if (!editingId) return true; 
        const original = staffList.find(s => String(s.id) === String(editingId));
        if (!original) return true;

        const currentWorkDaysStr = Object.entries(targetWorkDays).filter(([_,v])=>v).map(([k])=>k).join(',');
        const originalWorkDaysStr = original.work_days || "";

        return (
            currentWorkDaysStr !== originalWorkDaysStr ||
            String(targetStatus) !== String(original.status || "active") ||
            String(targetRetirementDate) !== String(original.retirement_date || "") ||
            String(targetWageType) !== String(original.wage_type || "hourly") ||
            String(targetName) !== String(original.name) ||
            String(targetFurigana) !== String(original.furigana || "") ||
            Number(targetWage) !== Number(original.base_wage) ||
            String(targetBirthday) !== String(original.birthday || "") ||
            String(targetJoinDate) !== String(original.join_date || "") ||
            String(targetZip) !== String(original.zip_code || "") ||
            String(targetAddress) !== String(original.address || "") ||
            String(targetPhone) !== String(original.phone || "") ||
            String(targetMobile) !== String(original.mobile || "") ||
            String(targetCommuteType) !== String(original.commute_type) ||
            Number(targetCommuteAmount) !== Number(original.commute_amount) ||
            Number(targetBranchId) !== Number(original.branch_id || 1) ||
            Number(targetDependents) !== Number(original.dependents || 0) ||
            Number(targetResidentTax) !== Number(original.resident_tax || 0) ||
            Number(targetDailyHours) !== Number(original.scheduled_work_hours || 8) ||
            Number(targetStandardRemuneration) !== Number(original.standard_remuneration || 0) ||
            Number(targetIsExecutive) !== Number(original.is_executive || 0) ||
            Number(targetIsEmploymentInsEligible) !== Number(original.is_employment_ins_eligible ?? 1) ||
            Number(targetIsOvertimeEligible) !== Number(original.is_overtime_eligible ?? 1) ||
            Number(targetFixedOvertimeHours) !== Number(original.fixed_overtime_hours || 0) ||
            Number(targetFixedOvertimeAmount) !== Number(original.fixed_overtime_allowance || 0) ||
            Number(targetPatternId) !== Number(original.calendar_pattern_id || 0) ||
            Number(targetSocialInsGroupId) !== Number(original.social_insurance_group_id || 1) ||
            String(targetEmpInsType || "") !== String(original.employment_insurance_type || "")
        );
    };

    const canSave = () => {
        const hasRequiredFields = targetId.trim() !== "" && targetName.trim() !== "";
        return hasRequiredFields && !isIdDuplicated() && isChanged() && !isSaving;
    };

    const saveStaff = async () => {
        if (!db || !targetId || !targetName) return;
        const safeId = String(targetId).trim();
        setIsSaving(true);

        const workDaysString = Object.entries(targetWorkDays)
            .filter(([_, checked]) => checked)
            .map(([day]) => day)
            .join(',');

        try {
            const baseParams = [
                targetName, targetFurigana, targetBirthday, targetGender, targetJoinDate, 
                targetRetirementDate, targetStatus, targetZip, targetAddress, 
                targetPhone, targetMobile, targetWageType, Number(targetWage), 
                targetCommuteType, Number(targetCommuteAmount), Number(targetBranchId), 
                Number(targetDependents), Number(targetResidentTax), 
                Number(targetPatternId),
                Number(targetDailyHours),
                Number(targetStandardRemuneration),
                workDaysString,
                Number(targetIsExecutive), 
                Number(targetIsEmploymentInsEligible), 
                Number(targetIsOvertimeEligible),
                Number(targetFixedOvertimeHours),
                Number(targetFixedOvertimeAmount),
                // 🆕 追加
                Number(targetSocialInsGroupId),      // social_insurance_group_id
                targetEmpInsType || null     // employment_insurance_type
            ];

            if (editingId) {
                await db.execute(
                    `UPDATE staff SET 
                        name=?, furigana=?, birthday=?, gender=?, join_date=?, 
                        retirement_date=?, status=?, zip_code=?, address=?, 
                        phone=?, mobile=?, wage_type=?, base_wage=?, 
                        commute_type=?, commute_amount=?, branch_id=?, 
                        dependents=?, resident_tax=?, calendar_pattern_id=?,
                        scheduled_work_hours=?, standard_remuneration=?,
                        work_days=?, is_executive=?, is_employment_ins_eligible=?, 
                        is_overtime_eligible=?, fixed_overtime_hours=?, fixed_overtime_allowance=?,
                        social_insurance_group_id=?, employment_insurance_type=? -- 🆕 追加
                    WHERE id=?`,
                    [...baseParams, safeId]
                );
            } else {
                await db.execute(
                    `INSERT INTO staff (
                        name, furigana, birthday, gender, join_date, 
                        retirement_date, status, zip_code, address, 
                        phone, mobile, wage_type, base_wage, 
                        commute_type, commute_amount, branch_id, 
                        dependents, resident_tax, calendar_pattern_id,
                        scheduled_work_hours, standard_remuneration,
                        work_days, is_executive, is_employment_ins_eligible, 
                        is_overtime_eligible, fixed_overtime_hours, fixed_overtime_allowance,
                        social_insurance_group_id, employment_insurance_type, -- 🆕 追加
                        id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, // ? は 30個
                    [...baseParams, safeId]
                );
            }
            onDataChange();
            setTimeout(() => {
                setIsSaving(false);
                setShowForm(false);
                clearForm();
            }, 800);
        } catch (e) {
            alert("保存エラー: " + e);
            setIsSaving(false);
        }
    };

    const deleteStaff = async (id: any) => {
        // 🆕 編集中の場合は削除させない
        if (editingId && String(id) === String(editingId)) {
            alert("編集中のため削除できません。一度編集を閉じてください。");
            return;
        }
        
        try {
            await db.execute("DELETE FROM staff WHERE id = ?", [String(id)]);
            onDataChange();
            setDeletingId(null); // 削除完了後にリセット
        } catch (e) {
            console.error(e);
        }
    };

    const fetchSocialGroups = async () => {
        try {
            const res = await db.select<any[]>("SELECT id, name FROM social_insurance_groups WHERE is_active = 1 ORDER BY id ASC");
            setSocialGroups(res);
            
            // 新規登録時のデフォルト値をセット（リストが空でない場合）
            if (!editingId && res.length > 0 && targetSocialInsGroupId === 1) {
                setTargetSocialInsGroupId(res[0].id);
            }
        } catch (e) {
            console.error("社保規定の取得に失敗:", e);
        }
    };

    // 1. 店舗リストを取得する関数（共通化）
    const fetchBranches = async () => {
        if (!db) return;
        const res = await db.select<any[]>("SELECT * FROM branches ORDER BY id ASC");
        setBranches(res);
        
        // 直接 res (取得した最新データ) から名前の配列を作ってセットする
        const allNames = res.map(b => b.name);
        setBranchFilters(allNames); 
    };

    const fetchPayrollGroups = async () => {
        if (!db) return;
        const res = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
        setPayrollGroups(res);
    };


    // --- 計算用の変数（レンダリング時に算出） ---
    const annualTotalHours = annualWorkDays * targetDailyHours;
    const monthlyAverageHours = annualTotalHours / 12;
    const hourlyConversion = targetWageType === "monthly" ? (targetWage / monthlyAverageHours) : targetWage;

    const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

    // 💡 スタッフが一人もいないかどうかの判定（既存の staffList を使用）
    const isFirstRun = staffList.length === 0;

    // 💡 最初の1人がいない時は、強制的に showForm を true とみなす
    const isFormVisible = isFirstRun || showForm;

    return {
        db,
        onDataChange,
        staffList,
        showForm,
        setShowForm,
        editingId,
        setEditingId,
        isSaving,
        setIsSaving,
        deletingId,
        setDeletingId,
        isSearchingZip,
        setIsSearchingZip,
        sortKey,
        setSortKey,
        sortOrder,
        setSortOrder,
        searchKeyword,
        setSearchKeyword,
        filterStatus,
        setFilterStatus,
        targetId,
        setTargetId,
        targetName,
        setTargetName,
        targetFurigana,
        setTargetFurigana,
        targetBirthday,
        setTargetBirthday,
        targetGender,
        setTargetGender,
        targetZip,
        setTargetZip,
        targetAddress,
        setTargetAddress,
        targetPhone,
        setTargetPhone,
        targetMobile,
        setTargetMobile,
        targetBranchId,
        setTargetBranchId,
        targetStatus,
        setTargetStatus,
        targetJoinDate,
        setTargetJoinDate,
        targetRetirementDate,
        setTargetRetirementDate,
        targetIsExecutive,
        setTargetIsExecutive,
        targetPatternId,
        setTargetPatternId,
        targetWorkDays,
        setTargetWorkDays,
        targetScheduledIn,
        setTargetScheduledIn,
        targetDailyHours,
        setTargetDailyHours,
        targetHours,
        setTargetHours,
        targetMinutes,
        setTargetMinutes,
        targetIsFlex,
        setTargetIsFlex,
        targetCoreStart,
        setTargetCoreStart,
        targetCoreEnd,
        setTargetCoreEnd,
        targetWageType,
        setTargetWageType,
        targetWage,
        setTargetWage,
        targetIsOvertimeEligible,
        setTargetIsOvertimeEligible,
        targetFixedOvertimeHours,
        setTargetFixedOvertimeHours,
        targetFixedOvertimeAmount,
        setTargetFixedOvertimeAmount,
        targetCommuteType,
        setTargetCommuteType,
        targetCommuteAmount,
        setTargetCommuteAmount,
        targetDependents,
        setTargetDependents,
        targetResidentTax,
        setTargetResidentTax,
        targetStandardRemuneration,
        setTargetStandardRemuneration,
        targetIsEmploymentInsEligible,
        setTargetIsEmploymentInsEligible,
        targetHealthInsNum,
        setTargetHealthInsNum,
        targetPensionNum,
        setTargetPensionNum,
        targetEmploymentInsNum,
        setTargetEmploymentInsNum,
        targetSocialInsGroupId,
        setTargetSocialInsGroupId,
        targetEmpInsType,
        setTargetEmpInsType,
        socialGroups,
        setSocialGroups,
        branches,
        setBranches,
        branchFilters,
        setBranchFilters,
        calendarPatterns,
        setCalendarPatterns,
        annualWorkDays,
        setAnnualWorkDays,
        payrollGroups,
        setPayrollGroups,
        targetPayrollGroupId,
        setTargetPayrollGroupId,
        handleZipSearch,
        calculateDays,
        filteredList,
        sortedAndFilteredList,
        handleSort,
        clearForm,
        startEdit,
        isIdDuplicated,
        isChanged,
        canSave,
        saveStaff,
        deleteStaff,
        fetchSocialGroups,
        fetchBranches,
        fetchPayrollGroups,
        annualTotalHours,
        monthlyAverageHours,
        hourlyConversion,
        branchMap,
        isFirstRun,
        isFormVisible,
    };
}

export type StaffManagerState = ReturnType<typeof useStaffManager>;
