import React, { useState, useEffect } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { modernIconBtnStyle } from "../../styles/styles";
import { fetchAddressByZip } from "../../utils/addressUtils";
import * as Master from '../../constants/salaryMaster2026';

// 選択肢用の定数を作成
export const HYOJUN_OPTIONS = Master.HYOJUN_TABLE.map(([lo, hi, std], index) => {
    let range = "";

    if (index === 0) {
        // 第1級の場合
        range = `${hi.toLocaleString()}円未満`;
    } else if (hi === Infinity) {
        // 最高等級の場合
        range = `${lo.toLocaleString()}円〜`;
    } else {
        // 通常の等級
        range = `${lo.toLocaleString()}円 〜 ${hi.toLocaleString()}円未満`;
    }

    return {
        // label: `${index + 1}級：${std.toLocaleString()}円 (${range})`,
        label: `${String(index + 1).padStart(2, '0')}級：${std.toLocaleString().padStart(9)}円 (${range})`,
        value: std
    };
});

interface Props {
    db: Database;
    onDataChange: () => void;
    staffList: any[];
}

interface CalendarPattern {
    id: number;
    name: string;
}

export default function StaffManager({ db, onDataChange, staffList }: Props) {
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
    const [filterStatus, setFilterStatus] = useState<string[]>(["active", "on_leave"]);
    const [filterBranchId, setFilterBranchId] = useState<string>("all");

    // =========================================================
    // 2. 従業員 基本情報 (targetXxx)
    // =========================================================
    const [targetId, setTargetId] = useState("");
    const [targetName, setTargetName] = useState("");
    const [targetFurigana, setTargetFurigana] = useState("");
    const [targetBirthday, setTargetBirthday] = useState("");
    
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

    // =========================================================
    // 5. 外部データ・計算用マスタ
    // =========================================================
    const [branches, setBranches] = useState<any[]>([]);
    const [calendarPatterns, setCalendarPatterns] = useState<CalendarPattern[]>([]);
    const [annualWorkDays, setAnnualWorkDays] = useState(245); // 計算結果（統計用）
    
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
    const calculateDays = async (patternId: number) => {
        if (!db) return;
        
        // 常に「現在」または「計算対象」の年を取得（うるう年判定のため）
        const year = new Date().getFullYear(); 

        // --- A. カレンダー設定がない（チェックなし）場合 ---
        if (patternId === 0) {
            let workDays = 0;
            const date = new Date(year, 0, 1); // 1月1日からスタート

            // 1年分ループ（年が変わるまで）
            while (date.getFullYear() === year) {
                // JSの getDay() は 0:日, 1:月, 2:火, 3:水, 4:木, 5:金, 6:土
                const dayLabels = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
                const dayKey = dayLabels[date.getDay()];

                // targetWorkDays の boolean値を確認
                if (targetWorkDays[dayKey as keyof typeof targetWorkDays]) {
                    workDays++;
                }
                date.setDate(date.getDate() + 1); // 翌日へ
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
            await fetchBranches();
            
            // カレンダーパターン一覧を取得
            const patterns = await db.select<CalendarPattern[]>("SELECT * FROM calendar_patterns ORDER BY id ASC");
            setCalendarPatterns(patterns);

            if (!editingId) {
                await calculateDays(targetPatternId);
            }
        };
        init();
    }, [db]);

    // パターンが変更されたら日数を再計算
    useEffect(() => {
        calculateDays(targetPatternId);
    }, [targetPatternId, targetWorkDays]);

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

        // 🆕 3. 店舗絞り込み (ここが抜けていました！)
        const matchesBranch = filterBranchId === "all" || String(s.branch_id) === filterBranchId;

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
        setEditingId(null);
    };

    const startEdit = (s: any) => {
        setDeletingId(null);
        setEditingId(s.id);
        setTargetId(s.id);
        setTargetName(s.name);
        setTargetFurigana(s.furigana || "");
        setTargetBirthday(s.birthday || "");
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
            Number(targetPatternId) !== Number(original.calendar_pattern_id || 0) // カレンダーIDの比較を追加
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
            // SQLに渡すパラメータ配列 (UPDATEとINSERTで共通、最後だけ異なる)
            const baseParams = [
                targetName, targetFurigana, targetBirthday, targetJoinDate, 
                targetRetirementDate, targetStatus, targetZip, targetAddress, 
                targetPhone, targetMobile, targetWageType, Number(targetWage), 
                targetCommuteType, Number(targetCommuteAmount), Number(targetBranchId), 
                Number(targetDependents), Number(targetResidentTax), 
                Number(targetPatternId), // calendar_pattern_id
                Number(targetDailyHours),
                Number(targetStandardRemuneration),
                workDaysString,
                Number(targetIsExecutive), 
                Number(targetIsEmploymentInsEligible), 
                Number(targetIsOvertimeEligible),
                Number(targetFixedOvertimeHours),
                Number(targetFixedOvertimeAmount)
            ];

            if (editingId) {
                // UPDATE処理
                await db.execute(
                    `UPDATE staff SET 
                        name=?, furigana=?, birthday=?, join_date=?, 
                        retirement_date=?, status=?, zip_code=?, address=?, 
                        phone=?, mobile=?, wage_type=?, base_wage=?, 
                        commute_type=?, commute_amount=?, branch_id=?, 
                        dependents=?, resident_tax=?, calendar_pattern_id=?,
                        scheduled_work_hours=?, standard_remuneration=?,
                        work_days=?, is_executive=?, is_employment_ins_eligible=?, 
                        is_overtime_eligible=?, fixed_overtime_hours=?, fixed_overtime_allowance=?
                    WHERE id=?`,
                    [...baseParams, safeId]
                );
            } else {
                // INSERT処理
                await db.execute(
                    `INSERT INTO staff (
                        name, furigana, birthday, join_date, 
                        retirement_date, status, zip_code, address, 
                        phone, mobile, wage_type, base_wage, 
                        commute_type, commute_amount, branch_id, 
                        dependents, resident_tax, calendar_pattern_id,
                        scheduled_work_hours, standard_remuneration,
                        work_days, is_executive, is_employment_ins_eligible, 
                        is_overtime_eligible, fixed_overtime_hours, fixed_overtime_allowance, id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    // 1. 店舗リストを取得する関数（共通化）
    const fetchBranches = async () => {
        if (!db) return []; // 結果を返せるように少し修正
        const res = await db.select<any[]>("SELECT * FROM branches ORDER BY id ASC");
        setBranches(res);
        return res; // useEffect側で使うために結果を返す
    };

    // --- 計算用の変数（レンダリング時に算出） ---
    const annualTotalHours = annualWorkDays * targetDailyHours;
    const monthlyAverageHours = annualTotalHours / 12;
    const hourlyConversion = targetWageType === "monthly" ? (targetWage / monthlyAverageHours) : targetWage;

    const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
    
    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h2 style={{ color: "#2c3e50", margin: 0 }}>👤 従業員詳細管理</h2>
                <button onClick={() => { setDeletingId(null); if(showForm) clearForm(); setShowForm(!showForm); }} style={{ backgroundColor: showForm ? "#95a5a6" : "#3498db", color: "white", border: "none", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
                    {showForm ? "✖ 閉じる" : "＋ 新規登録"}
                </button>
            </div>

            {showForm && (
                <section style={{ ...cardStyle, border: editingId ? "2px solid #f1c40f" : "1px solid #3498db" }}>
                    <h3 style={{ marginTop: 0, fontSize: "18px" }}>{editingId ? "📝 従業員情報の編集" : "✨ 新規従業員登録"}</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <h4 style={{ borderLeft: "4px solid #3498db", paddingLeft: "10px", margin: "0 0 5px 0", fontSize: "14px" }}>基本情報</h4>
                            
                            <div style={{ display: "flex", gap: "10px" }}>
                                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                                    {/* 従業員IDエリア */}
                                    <div>
                                        <label style={labelStyle}>
                                            従業員ID 
                                            <span style={{ 
                                                marginLeft: "6px", 
                                                color: "#e74c3c", 
                                                fontSize: "10px", 
                                                backgroundColor: "#fdedec", 
                                                padding: "1px 4px", 
                                                borderRadius: "3px" 
                                            }}>必須</span>
                                        </label>
                                        <input placeholder="001" value={targetId} onChange={e => setTargetId(e.target.value)} style={{ ...inputStyle, borderColor: isIdDuplicated() ? "#e74c3c" : "#ddd" }} disabled={!!editingId} />
                                    </div>
                                </div>

                                {/* 氏名エリア */}
                                <div style={{ flex: 2 }}>
                                    <label style={labelStyle}>
                                        氏名
                                        <span style={{ 
                                            marginLeft: "6px", 
                                            color: "#e74c3c", 
                                            fontSize: "10px", 
                                            backgroundColor: "#fdedec", 
                                            padding: "1px 4px", 
                                            borderRadius: "3px" 
                                        }}>必須</span>
                                    </label>
                                    <input placeholder="浜 太郎" value={targetName} onChange={e => setTargetName(e.target.value)} style={inputStyle} />
                                    <input placeholder="はま たろう" value={targetFurigana} onChange={e => setTargetFurigana(e.target.value)} style={{ ...inputStyle, marginTop: "4px", fontSize: "12px", height: "30px" }} />
                                </div>
                            </div>

                            {/* ✨ 生年月日（背景をなくして他と統一） */}
                            <div>
                                <label style={labelStyle}>生年月日</label>
                                <input type="date" value={targetBirthday} onChange={e => setTargetBirthday(e.target.value)} style={inputStyle} />
                            </div>

                            {/* 🆕 郵便番号セクションをグループ化 */}
                            <div>
                                <label style={labelStyle}>郵便番号</label>
                                <div style={{ display: "flex", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", borderRadius: "6px", overflow: "hidden", marginTop: "4px" }}>
                                    <input 
                                        placeholder="000-0000" 
                                        value={targetZip} 
                                        onChange={e => setTargetZip(e.target.value)} 
                                        style={{ ...inputStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none", flex: 1 }} 
                                    />
                                    <button 
                                        onClick={handleZipSearch}
                                        disabled={isSearchingZip}
                                        style={{ 
                                            padding: "0 15px", backgroundColor: "#f8fafc", border: "1px solid #ddd", 
                                            cursor: "pointer", fontSize: "12px", color: "#3498db", fontWeight: "bold", whiteSpace: "nowrap" 
                                        }}
                                    >
                                        {isSearchingZip ? "⌛" : "🔍 住所検索"}
                                    </button>
                                </div>
                            </div>

                            {/* 🆕 住所セクションをグループ化 */}
                            <div>
                                <label style={labelStyle}>住所</label>
                                <textarea 
                                    value={targetAddress} 
                                    onChange={e => setTargetAddress(e.target.value)} 
                                    style={{ ...inputStyle, height: "80px", resize: "none", marginTop: "4px" }} 
                                />
                            </div>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>電話番号</label>
                                    <input placeholder="03-xxxx-xxxx" value={targetPhone} onChange={e => setTargetPhone(e.target.value)} style={inputStyle} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>携帯電話</label>
                                    <input placeholder="090-xxxx-xxxx" value={targetMobile} onChange={e => setTargetMobile(e.target.value)} style={inputStyle} />
                                </div>
                            </div>

                            <div style={{ marginTop: "10px" }}>
                                <h4 style={{ borderLeft: "4px solid #9b59b6", paddingLeft: "10px", margin: "0 0 10px 0", fontSize: "14px" }}>税・社保設定</h4>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                    {/* --- 🆕 3大フラグ・スイッチ群 --- */}
                                    <div style={{ gridColumn: "span 2", display: "flex", gap: "15px", backgroundColor: "#f8fafc", padding: "10px", borderRadius: "5px", border: "1px solid #e2e8f0" }}>
                                        <label style={{ fontSize: "12px", display: "flex", alignItems: "center", cursor: "pointer" }}>
                                            <input 
                                                type="checkbox" 
                                                checked={targetIsExecutive === 1} 
                                                onChange={e => setTargetIsExecutive(e.target.checked ? 1 : 0)}
                                                style={{ marginRight: "5px" }}
                                            />
                                            👔 役員
                                        </label>
                                        <label style={{ fontSize: "12px", display: "flex", alignItems: "center", cursor: "pointer" }}>
                                            <input 
                                                type="checkbox" 
                                                checked={targetIsEmploymentInsEligible === 1} 
                                                onChange={e => setTargetIsEmploymentInsEligible(e.target.checked ? 1 : 0)}
                                                style={{ marginRight: "5px" }}
                                            />
                                            🔰 雇用保険加入
                                        </label>
                                        <label style={{ fontSize: "12px", display: "flex", alignItems: "center", cursor: "pointer" }}>
                                            <input 
                                                type="checkbox" 
                                                checked={targetIsOvertimeEligible === 1} 
                                                onChange={e => setTargetIsOvertimeEligible(e.target.checked ? 1 : 0)}
                                                style={{ marginRight: "5px" }}
                                            />
                                            ⏱️ 残業代対象
                                        </label>
                                    </div>
                                    {/* 🆕 扶養人数（1fr） */}
                                    <div>
                                        <label style={labelStyle}>扶養人数</label>
                                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                            <input type="number" value={targetDependents} onChange={e => setTargetDependents(Number(e.target.value))} style={{ ...inputStyle, paddingRight: "30px", textAlign: "right" }} />
                                            <span style={{ position: "absolute", right: "10px", fontSize: "12px", color: "#7f8c8d" }}>人</span>
                                        </div>
                                    </div>

                                    {/* 🆕 住民税額（span 2 を外して 1fr に） */}
                                    <div>
                                        <label style={labelStyle}>住民税額（月額）</label>
                                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                            <input type="number" value={targetResidentTax} onChange={e => setTargetResidentTax(Number(e.target.value))} style={{ ...inputStyle, paddingRight: "30px", textAlign: "right" }} />
                                            <span style={{ position: "absolute", right: "10px", fontSize: "12px", color: "#7f8c8d" }}>円</span>
                                        </div>
                                    </div>
                                    <div style={{ gridColumn: "span 2" }}>
                                        <label style={labelStyle}>標準報酬月額（社会保険計算用）</label>
                                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                            <select
                                                // 修正ポイント1: 他の項目に合わせて targetStandardRemuneration (などの state) を使う
                                                // もし state を作っていない場合は、このコンポーネントの流儀に合わせて追加が必要です
                                                value={targetStandardRemuneration} 
                                                onChange={(e) => setTargetStandardRemuneration(Number(e.target.value))}
                                                // 修正ポイント2: 他の項目と同じ inputStyle を適用
                                                style={{ ...inputStyle, paddingRight: "30px" }} 
                                            >
                                                <option value={0}>--- 自動計算（未確定） ---</option>
                                                {HYOJUN_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <p style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                                            ※決定通知書に記載されている等級の金額を選択してください。
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <h4 style={{ borderLeft: "4px solid #e67e22", paddingLeft: "10px", margin: "0 0 5px 0", fontSize: "14px" }}>所属・給与</h4>
                            {/* 🆕 状態と所属を横並び ＆ 両方ともラベル横配置 */}
                            <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
                                {/* 状態エリア */}
                                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
                                    <label style={{ ...labelStyle, marginBottom: 0, whiteSpace: "nowrap", width: "40px" }}>状態</label> 
                                    <select value={targetStatus} onChange={e => setTargetStatus(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                                        <option value="active">在籍</option>
                                        <option value="on_leave">休職</option>
                                        <option value="retired">退職</option>
                                    </select>
                                </div>
                                
                                {/* 所属エリア（状態と同じスタイルに統一） */}
                                <div style={{ flex: 2, display: "flex", alignItems: "center", gap: "10px" }}>
                                    <label style={{ ...labelStyle, marginBottom: 0, whiteSpace: "nowrap", width: "40px" }}>所属</label>
                                    <select value={targetBranchId} onChange={e => setTargetBranchId(Number(e.target.value))} style={{ ...inputStyle, flex: 1 }}>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name} ({b.prefecture})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* 🆕 入社日と退職日も横に並べてスッキリさせる */}
                            <div style={{ display: "flex", gap: "10px" }}>
                                {/* 入社日 */}
                                <div style={{ flex: 1, backgroundColor: "#f0f7ff", padding: "8px", borderRadius: "6px", border: "1px solid #dbeafe" }}>
                                    <label style={{ ...labelStyle, fontSize: "11px", color: "#1e40af", marginBottom: "4px" }}>入社日</label>
                                    <input type="date" value={targetJoinDate} onChange={e => setTargetJoinDate(e.target.value)} style={inputStyle} />
                                </div>
                                {/* 退職日 */}
                                <div style={{ flex: 1, backgroundColor: targetStatus === 'retired' ? "#fff1f2" : "#f1f5f9", padding: "8px", borderRadius: "6px" }}>
                                    <label style={{ ...labelStyle, fontSize: "11px", color: targetStatus === 'retired' ? "#991b1b" : "#64748b", marginBottom: "4px" }}>退職日</label>
                                    <input 
                                        type="date" 
                                        value={targetRetirementDate} 
                                        onChange={e => setTargetRetirementDate(e.target.value)} 
                                        style={{ ...inputStyle, backgroundColor: targetStatus !== 'retired' ? '#e2e8f0' : '#fff' }} 
                                        disabled={targetStatus !== 'retired'}
                                    />
                                </div>
                            </div>
                            
                            {/* 交通費設定セクション */}
                            <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "10px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>交通費区分</label>
                                    <select 
                                        value={targetCommuteType} 
                                        onChange={e => {
                                            setTargetCommuteType(e.target.value);
                                            // 「支給なし」に切り替えたときに、もし単価が残っていたら0にリセットしたい場合はここに追加
                                            // if (e.target.value === "none") setTargetCommuteAmount(0);
                                        }} 
                                        style={{ 
                                            ...inputStyle, 
                                            height: "38px",
                                            // 支給なしの時はセレクトボックス自体も少し落ち着いた色にするなら
                                            backgroundColor: targetCommuteType === "none" ? "#f1f5f9" : "#fff"
                                        }}
                                    >
                                        <option value="none">🚶‍♀️ 支給なし</option>
                                        <option value="daily">🚗 日額支給</option>
                                        <option value="monthly">🎫 月額固定</option>
                                    </select>
                                </div>

                                <div style={{ flex: 2 }}>
                                    <label style={{ 
                                        ...labelStyle, 
                                        color: targetCommuteType === "none" ? "#94a3b8" : "#2c3e50" // ラベルも少し薄く
                                    }}>
                                        交通費単価
                                    </label>
                                    <div style={{ 
                                        position: "relative", 
                                        display: "flex", 
                                        alignItems: "center",
                                        opacity: targetCommuteType === "none" ? 0.6 : 1 // 全体を少し透過させてグレーアウト感を出す
                                    }}>
                                        <input 
                                            type="number" 
                                            value={targetCommuteAmount} 
                                            onChange={e => setTargetCommuteAmount(Number(e.target.value))}
                                            disabled={targetCommuteType === "none"} // ✨ ここで入力をブロック
                                            style={{ 
                                                ...inputStyle, 
                                                paddingRight: "60px",
                                                textAlign: "right",
                                                // ✨ disabled時の背景色を指定
                                                backgroundColor: targetCommuteType === "none" ? "#f1f5f9" : "#fff",
                                                cursor: targetCommuteType === "none" ? "not-allowed" : "auto"
                                            }} 
                                        />
                                        <span style={{ 
                                            position: "absolute", 
                                            right: "12px", 
                                            fontSize: "12px", 
                                            color: targetCommuteType === "none" ? "#cbd5e1" : "#7f8c8d" // 支給なし時はもっと薄く
                                        }}>
                                            {targetCommuteType === "daily" ? "円 / 日" : 
                                            targetCommuteType === "monthly" ? "円 / 月" : "未設定"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                <div style={{ flex: 1, minWidth: "120px" }}>
                                    <label style={labelStyle}>給与区分</label>
                                    <select value={targetWageType} onChange={e => setTargetWageType(e.target.value)} style={{ ...inputStyle, height: "38px" }}>
                                        <option value="hourly">⏱️ 時給制</option>
                                        <option value="monthly">📅 月給制</option>
                                    </select>
                                </div>
                                <div style={{ flex: 2, minWidth: "200px" }}>
                                    <label style={labelStyle}>{targetWageType === "hourly" ? "基本時給" : "基本月給"}</label>
                                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                        <input 
                                            type="number" 
                                            value={targetWage} 
                                            onChange={e => setTargetWage(Number(e.target.value))} 
                                            style={{ 
                                                ...inputStyle, 
                                                textAlign: "right",    // ← これを追加（右寄せ）
                                                paddingRight: "60px"   // ← 単位との被り防止に少し広げました
                                            }} 
                                        />
                                        <span style={{ position: "absolute", right: "12px", fontSize: "12px", color: "#7f8c8d" }}>
                                            {targetWageType === "hourly" ? "円 / 時" : "円 / 月"}
                                        </span>
                                    </div>
                                </div>

                                {/* 月給・時給共通の勤務パターン設定エリア */}
                                <div style={{ 
                                    width: "100%", backgroundColor: "#f8f9fa", padding: "15px", borderRadius: "8px", 
                                    border: targetWageType === "monthly" ? "1px dashed #3498db" : "1px solid #e2e8f0", marginTop: "5px"
                                }}>
                                    
                                    {/* 1. カレンダーパターン と 2. 所定労働時間 の横並びコンテナ */}
                                    <div style={{ display: "flex", gap: "15px", marginBottom: "15px", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
                                        
                                        {/* 左側：カレンダーパターン */}
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                                                <input 
                                                    type="checkbox" 
                                                    id="useCalendar"
                                                    // patternId が 0 以外なら設定ありと判定
                                                    checked={targetPatternId > 0} 
                                                    onChange={(e) => {
                                                        if (!e.target.checked) {
                                                            setTargetPatternId(0);
                                                        } else {
                                                            setTargetPatternId(1); // チェックを入れたらデフォルトで「標準(1)」を選択
                                                        }
                                                    }}
                                                />
                                                <label htmlFor="useCalendar" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
                                                    適用カレンダーパターン
                                                </label>
                                            </div>
                                            
                                            <select 
                                                value={targetPatternId} 
                                                onChange={e => setTargetPatternId(Number(e.target.value))} 
                                                disabled={targetPatternId === 0}
                                                style={{ 
                                                    ...inputStyle, 
                                                    backgroundColor: targetPatternId === 0 ? "#f1f5f9" : "#fff",
                                                    opacity: targetPatternId === 0 ? 0.5 : 1 
                                                }}
                                            >
                                                {/* targetPatternId が 0 の時だけ表示されるプレースホルダー */}
                                                {targetPatternId === 0 && <option value={0}>-- カレンダーを使用しない --</option>}
                                                {calendarPatterns.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                            
                                            <p style={{ fontSize: "10px", color: "#64748b", marginTop: "4px", lineHeight: "1.4" }}>
                                                {targetPatternId === 0 
                                                    ? "※欠勤控除などを行わない完全月給制の場合などに選択します。" 
                                                    : "※休日設定から年間稼働日数を算出し、欠勤判定に使用します。"}
                                            </p>
                                        </div>

                                        {/* 右側：フレックス制 ＆ コアタイム設定 */}
                                        <div style={{ flex: 1.2, paddingLeft: "15px", borderLeft: "1px solid #e2e8f0" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                                                <input 
                                                    type="checkbox" 
                                                    id="isFlex"
                                                    checked={targetIsFlex} 
                                                    onChange={(e) => setTargetIsFlex(e.target.checked)}
                                                />
                                                <label htmlFor="isFlex" style={{ fontSize: "12px", fontWeight: "bold", color: "#2c3e50", cursor: "pointer" }}>
                                                    フレックスタイム制を適用
                                                </label>
                                            </div>

                                            {/* コアタイム入力欄 */}
                                            <div style={{ opacity: targetIsFlex ? 1 : 0.4, transition: "opacity 0.2s" }}>
                                                <span style={{ fontSize: "10px", color: "#64748b", display: "block", marginBottom: "4px" }}>コアタイム（任意）</span>
                                                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                                    <input 
                                                        type="time" 
                                                        value={targetCoreStart || ""} 
                                                        onChange={e => setTargetCoreStart(e.target.value)}
                                                        disabled={!targetIsFlex}
                                                        style={{ ...inputStyle, width: "100px", padding: "4px" }}
                                                    />
                                                    <span style={{ color: "#94a3b8" }}>～</span>
                                                    <input 
                                                        type="time" 
                                                        value={targetCoreEnd || ""} 
                                                        onChange={e => setTargetCoreEnd(e.target.value)}
                                                        disabled={!targetIsFlex}
                                                        style={{ ...inputStyle, width: "100px", padding: "4px" }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. 標準勤務・所定労働時間の設定エリア */}
                                    <div style={{ 
                                        marginBottom: "15px", 
                                        paddingBottom: "15px", 
                                        borderBottom: "1px solid #e2e8f0" // 👈 ここで契約曜日との間に横線を引いています
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}>
                                            <input 
                                                type="checkbox" 
                                                id="useDailyHours"
                                                checked={targetDailyHours > 0 || targetScheduledIn !== ""} 
                                                onChange={(e) => {
                                                    if (!e.target.checked) {
                                                        setTargetDailyHours(0);
                                                        setTargetHours(0);
                                                        setTargetMinutes(0);
                                                        setTargetScheduledIn("");
                                                    } else {
                                                        setTargetHours(8);
                                                        setTargetMinutes(0);
                                                        setTargetDailyHours(8.0);
                                                        setTargetScheduledIn("09:00");
                                                    }
                                                }}
                                            />
                                            <label htmlFor="useDailyHours" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
                                                標準始業時間・所定労働時間の設定
                                            </label>
                                        </div>
                                            
                                        <div style={{ 
                                            display: "flex", 
                                            gap: "20px", 
                                            alignItems: "flex-end",
                                            opacity: (targetDailyHours === 0 && targetScheduledIn === "") ? 0.5 : 1 
                                        }}>
                                            {/* 🆕 標準始業時刻 */}
                                            <div>
                                                <span style={{ fontSize: "10px", color: "#64748b", display: "block", marginBottom: "4px" }}>標準始業時刻</span>
                                                <input 
                                                    type="time" 
                                                    value={targetScheduledIn} 
                                                    onChange={e => setTargetScheduledIn(e.target.value)}
                                                    disabled={targetDailyHours === 0 && targetScheduledIn === ""}
                                                    style={{ ...inputStyle, width: "110px" }}
                                                />
                                            </div>

                                            {/* 1日の所定労働時間 */}
                                            <div>
                                                <span style={{ fontSize: "10px", color: "#64748b", display: "block", marginBottom: "4px" }}>1日の所定労働時間</span>
                                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                                        <input 
                                                            type="number" min="0" max="24" 
                                                            value={targetHours} 
                                                            onChange={e => {
                                                                const h = Number(e.target.value);
                                                                setTargetHours(h);
                                                                setTargetDailyHours(h + targetMinutes / 60);
                                                            }} 
                                                            disabled={targetDailyHours === 0 && targetScheduledIn === ""}
                                                            style={{ ...inputStyle, width: "70px", paddingRight: "25px", textAlign: "right", backgroundColor: targetDailyHours === 0 ? "#f1f5f9" : "#fff" }} 
                                                        />
                                                        <span style={{ position: "absolute", right: "6px", fontSize: "10px", color: "#7f8c8d" }}>時</span>
                                                    </div>
                                                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                                        <input 
                                                            type="number" min="0" max="55" step="5" 
                                                            value={targetMinutes} 
                                                            onChange={e => {
                                                                const m = Number(e.target.value);
                                                                setTargetMinutes(m);
                                                                setTargetDailyHours(targetHours + m / 60);
                                                            }} 
                                                            disabled={targetDailyHours === 0 && targetScheduledIn === ""}
                                                            style={{ ...inputStyle, width: "70px", paddingRight: "25px", textAlign: "right", backgroundColor: targetDailyHours === 0 ? "#f1f5f9" : "#fff" }} 
                                                        />
                                                        <span style={{ position: "absolute", right: "6px", fontSize: "10px", color: "#7f8c8d" }}>分</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <p style={{ fontSize: "9px", color: "#94a3b8", marginTop: "6px", lineHeight: "1.4" }}>
                                            ※始業時刻は一括反映ボタンの基準に使用します。所定時間は給与・有給計算の基礎となります。未設定の場合は、直近3ヶ月の平均賃金等から算出します。
                                        </p>
                                    </div>

                                    {/* 新設：契約曜日の設定（主に時給制・有給計算用） */}
                                    <div style={{ marginBottom: "5px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                                            <label style={{ ...labelStyle, marginBottom: 0 }}>
                                                契約曜日
                                            </label>
                                            {/* ✨ ここで「週 n 日」を上に持ってくる */}
                                            <div style={{ 
                                                fontSize: "11px", color: "#3498db", 
                                                backgroundColor: "#ebf8ff", padding: "2px 8px", borderRadius: "12px",
                                                border: "1px solid #bee3f8", fontWeight: "bold"
                                            }}>
                                                契約：週 <b>{Object.values(targetWorkDays).filter(Boolean).length}</b> 日
                                            </div>
                                        </div>

                                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                            {[
                                                { id: "mon", label: "月" },
                                                { id: "tue", label: "火" },
                                                { id: "wed", label: "水" },
                                                { id: "thu", label: "木" },
                                                { id: "fri", label: "金" },
                                                { id: "sat", label: "土", color: "#3498db" },
                                                { id: "sun", label: "日", color: "#e74c3c" }
                                            ].map((day) => (
                                                <label key={day.id} style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "3px",
                                                    padding: "4px 7px", // パディングをさらに絞る
                                                    backgroundColor: "#fff",
                                                    border: "1px solid #d1d5db",
                                                    borderRadius: "4px",
                                                    cursor: "pointer",
                                                    fontSize: "12px"
                                                }}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={targetWorkDays[day.id]} 
                                                        onChange={e => setTargetWorkDays({...targetWorkDays, [day.id]: e.target.checked})}
                                                        style={{ cursor: "pointer" }}
                                                    />
                                                    <span style={{ color: day.color || "#2c3e50", fontWeight: "bold" }}>{day.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                        <p style={{ fontSize: "9px", color: "#94a3b8", marginTop: "4px" }}>
                                            ※有給休暇の「出勤率（分母）」および「比例付与日数」の判定に使用します。未設定の場合は実績から推計します。
                                        </p>
                                    </div>

                                    {/* 3. 固定残業代（みなし残業）の設定エリア */}
                                    <div style={{ 
                                        marginTop: "15px", 
                                        paddingTop: "12px", 
                                        borderTop: "1px solid #e2e8f0" 
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}>
                                            <input 
                                                type="checkbox" 
                                                id="useFixedOvertime"
                                                // 時間または金額のどちらかが設定されていればチェック状態とする
                                                checked={targetFixedOvertimeHours > 0 || targetFixedOvertimeAmount > 0} 
                                                onChange={(e) => {
                                                    if (!e.target.checked) {
                                                        setTargetFixedOvertimeHours(0);
                                                        setTargetFixedOvertimeAmount(0);
                                                    } else {
                                                        // チェックを入れた瞬間のデフォルト値（例: 10時間）
                                                        setTargetFixedOvertimeHours(10);
                                                        setTargetFixedOvertimeAmount(0);
                                                    }
                                                }}
                                            />
                                            <label htmlFor="useFixedOvertime" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
                                                固定残業代（みなし残業）を適用する
                                            </label>
                                        </div>
                                        
                                        <div style={{ 
                                            display: "flex", 
                                            alignItems: "center", 
                                            gap: "10px", 
                                            opacity: (targetFixedOvertimeHours > 0 || targetFixedOvertimeAmount > 0) ? 1 : 0.5 
                                        }}>
                                            {/* 時間入力 */}
                                            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                                <input 
                                                    type="number" 
                                                    min="0"
                                                    step="0.1"
                                                    value={targetFixedOvertimeHours || ""} 
                                                    onChange={e => setTargetFixedOvertimeHours(Number(e.target.value))} 
                                                    disabled={!(targetFixedOvertimeHours > 0 || targetFixedOvertimeAmount > 0)}
                                                    style={{ 
                                                        ...inputStyle, 
                                                        width: "90px", 
                                                        paddingRight: "40px", 
                                                        textAlign: "right",
                                                        backgroundColor: !(targetFixedOvertimeHours > 0 || targetFixedOvertimeAmount > 0) ? "#f1f5f9" : "#fff" 
                                                    }} 
                                                    placeholder="0"
                                                />
                                                <span style={{ position: "absolute", right: "6px", fontSize: "10px", color: "#7f8c8d" }}>時間分</span>
                                            </div>

                                            <span style={{ fontSize: "12px", color: "#64748b" }}>として</span>

                                            {/* 金額入力 */}
                                            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                                <input 
                                                    type="number" 
                                                    min="0"
                                                    step="100"
                                                    value={targetFixedOvertimeAmount || ""} 
                                                    onChange={e => setTargetFixedOvertimeAmount(Number(e.target.value))} 
                                                    disabled={!(targetFixedOvertimeHours > 0 || targetFixedOvertimeAmount > 0)}
                                                    style={{ 
                                                        ...inputStyle, 
                                                        width: "120px", 
                                                        paddingRight: "25px", 
                                                        textAlign: "right",
                                                        backgroundColor: !(targetFixedOvertimeHours > 0 || targetFixedOvertimeAmount > 0) ? "#f1f5f9" : "#fff" 
                                                    }} 
                                                    placeholder="0"
                                                />
                                                <span style={{ position: "absolute", right: "6px", fontSize: "10px", color: "#7f8c8d" }}>円</span>
                                            </div>
                                            
                                            <span style={{ fontSize: "12px", color: "#64748b" }}>を固定支給</span>
                                        </div>

                                        <p style={{ fontSize: "9px", color: "#94a3b8", marginTop: "6px", lineHeight: "1.4" }}>
                                            ※設定時間を超過した残業が発生した場合は、1分単位で超過手当が自動計算されます。
                                        </p>
                                    </div>

                                    {/* 統計・換算結果フッター (月給制の時のみ表示) */}
                                    {targetWageType === "monthly" && (
                                        <div style={{ 
                                            marginTop: "15px", 
                                            paddingTop: "12px", 
                                            borderTop: "1px solid #e2e8f0", 
                                            display: "flex", 
                                            justifyContent: "space-between", 
                                            alignItems: "center" 
                                        }}>
                                            {/* 左側～中央：稼働日数・時間統計（marginLeft で位置を調整） */}
                                            <div style={{ display: "flex", gap: "30px", marginLeft: "40px" }}> {/* 👈 marginLeft を追加 */}
                                                {/* 年間稼働 */}
                                                <div style={{ display: "flex", flexDirection: "column" }}>
                                                    <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "bold" }}>年間稼働</span>
                                                    <span style={{ fontSize: "14px", color: "#2c3e50" }}>
                                                        <b style={{ fontSize: "16px" }}>{annualWorkDays}</b> <small>日</small>
                                                    </span>
                                                </div>
                                                {/* 月平均所定：時間が0なら --- */}
                                                <div style={{ display: "flex", flexDirection: "column" }}>
                                                    <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "bold" }}>月平均所定</span>
                                                    <span style={{ fontSize: "14px", color: "#2c3e50" }}>
                                                        <b style={{ fontSize: "16px" }}>
                                                            {targetDailyHours > 0 ? monthlyAverageHours.toFixed(2) : "---"}
                                                        </b> <small>h</small>
                                                    </span>
                                                </div>
                                            </div>

                                            {/* 右側：時給換算バッジ（ここはそのまま） */}
                                            <div style={{ 
                                                backgroundColor: "#ebf8ff", 
                                                padding: "8px 15px", 
                                                borderRadius: "8px", 
                                                border: "1px solid #bee3f8",
                                                textAlign: "right"
                                            }}>
                                                <div style={{ fontSize: "10px", color: "#2b6cb0", fontWeight: "bold", marginBottom: "2px" }}>💰 時給換算目安</div>
                                                <div style={{ fontSize: "18px", color: "#2c5282", fontWeight: "bold" }}>
                                                    {targetDailyHours > 0 && annualWorkDays > 0 ? (
                                                        <>約 {Math.round(hourlyConversion).toLocaleString()} <span style={{ fontSize: "12px" }}>円</span></>
                                                    ) : (
                                                        <span style={{ color: "#94a3b8", fontSize: "14px" }}>(未設定)</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px", marginTop: "25px" }}>
                        <button onClick={saveStaff} disabled={!canSave()} style={{ ...btnStyle, flex: 2, backgroundColor: isSaving ? "#3498db" : (canSave() ? (editingId ? "#f1c40f" : "#2ecc71") : "#cbd5e1") }}>
                            {isSaving ? "✅ 保存中..." : (editingId ? "更新を保存" : "新規登録")}
                        </button>
                        <button onClick={() => { clearForm(); setShowForm(false); }} style={{ ...btnStyle, flex: 1, backgroundColor: "#94a3b8" }}>キャンセル</button>
                    </div>
                </section>
            )}

            {/* 🆕 検索・絞り込みツールバー */}
            <div style={{ 
                display: "flex", 
                gap: "15px", 
                marginBottom: "15px", 
                alignItems: "center",
                backgroundColor: "#f8fafc",
                padding: "15px",
                borderRadius: "8px",
                border: "1px solid #e2e8f0"
            }}>
                {/* キーワード検索 */}
                <div style={{ flex: 2 }}>
                    <input 
                        placeholder="🔍 ID、名前、フリガナで検索..." 
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                    />
                </div>

                {/* 🆕 店舗絞り込みセレクトボックス */}
                <div style={{ flex: 1 }}>
                    <select 
                        value={filterBranchId} 
                        onChange={e => setFilterBranchId(e.target.value)}
                        style={{ ...inputStyle, margin: 0, fontSize: "14px" }}
                    >
                        <option value="all">🏢 すべての店舗</option>
                        {branches.map(b => (
                            <option key={b.id} value={String(b.id)}>{b.name}</option>
                        ))}
                    </select>
                </div>

                {/* ステータス絞り込みボタン */}
                <div style={{ display: "flex", gap: "8px" }}>
                    {[
                        { label: "在籍", value: "active", color: "#2ecc71" },
                        { label: "休職", value: "on_leave", color: "#f1c40f" },
                        { label: "退職", value: "retired", color: "#e74c3c" }
                    ].map(opt => {
                        const isActive = filterStatus.includes(opt.value);
                        return (
                            <button
                                key={opt.value}
                                onClick={() => setFilterStatus(prev => 
                                    prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
                                )}
                                style={{
                                    padding: "5px 12px",
                                    borderRadius: "15px",
                                    border: `1px solid ${opt.color}`,
                                    backgroundColor: isActive ? opt.color : "white",
                                    color: isActive ? "white" : opt.color,
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    transition: "0.2s"
                                }}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                    <button 
                        onClick={() => setFilterStatus(["active", "on_leave", "retired"])}
                        style={{ fontSize: "12px", border: "none", background: "none", color: "#3498db", cursor: "pointer", textDecoration: "underline" }}
                    >
                        すべて表示
                    </button>
                </div>
            </div>

            <section style={cardStyle}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                        <tr style={thGroupStyle}>
                            <th style={{ ...thStyle, width: "15%", cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("id")}>
                                <div style={{ display: "flex", alignItems: "center" }}>
                                    ID
                                    {sortKey === "id" && (
                                        <span style={{
                                            marginLeft: "6px",
                                            display: "inline-block",
                                            width: 0,
                                            height: 0,
                                            borderLeft: "4px solid transparent",
                                            borderRight: "4px solid transparent",
                                            // 昇順(asc)なら上向き、降順(desc)なら下向きの三角を作る
                                            borderBottom: sortOrder === "asc" ? "5px solid #3498db" : "none",
                                            borderTop: sortOrder === "desc" ? "5px solid #3498db" : "none",
                                        }} />
                                    )}
                                </div>
                            </th>
                            <th style={{ ...thStyle, width: "30%" }}>氏名</th>
                            <th style={{ ...thStyle, width: "20%", cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("branch_id")}>
                                <div style={{ display: "flex", alignItems: "center" }}>
                                    所属
                                    {sortKey === "branch_id" && (
                                        <span style={{
                                            marginLeft: "6px",
                                            display: "inline-block",
                                            width: 0,
                                            height: 0,
                                            borderLeft: "4px solid transparent",
                                            borderRight: "4px solid transparent",
                                            borderBottom: sortOrder === "asc" ? "5px solid #3498db" : "none",
                                            borderTop: sortOrder === "desc" ? "5px solid #3498db" : "none",
                                        }} />
                                    )}
                                </div>
                            </th>
                            <th style={{ ...thStyle, width: "20%" }}>給与形態</th>
                            <th style={{ ...thStyle, width: "15%", textAlign: "center" }}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedAndFilteredList.map(s => {
                            const branch = branches.find(b => b.id === s.branch_id);
                            // 🆕 退職者の場合にスタイルを変えるためのフラグ
                            const isRetired = s.status === 'retired';

                            return (
                                <tr key={s.id} style={{ 
                                    borderBottom: "1px solid #eee",
                                    backgroundColor: isRetired ? "#f9f9f9" : "transparent", // 退職者は背景をグレーに
                                    opacity: isRetired ? 0.7 : 1                  // 退職者は少し薄くする
                                }}>
                                    <td style={tdStyle}>{s.id}</td>
                                    <td style={tdStyle}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <div style={{ fontWeight: "bold" }}>{s.name}</div>
                                            {/* 🆕 状態バッジを表示 */}
                                            {isRetired && <span style={{ fontSize: "10px", backgroundColor: "#e74c3c", color: "white", padding: "1px 4px", borderRadius: "4px" }}>退職</span>}
                                            {s.status === 'on_leave' && <span style={{ fontSize: "10px", backgroundColor: "#f39c12", color: "white", padding: "1px 4px", borderRadius: "4px" }}>休職</span>}
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#7f8c8d" }}>{s.furigana}</div>
                                    </td>
                                    {/* 💡 店舗名を表示（少しバッジ風のデザインにしています） */}
                                    <td style={tdStyle}>
                                        <div style={{ 
                                            display: "inline-block",
                                            fontSize: "12px", 
                                            backgroundColor: "#ebf5fb", 
                                            color: "#2980b9", 
                                            padding: "2px 8px", 
                                            borderRadius: "12px",
                                            border: "1px solid #d6eaf8"
                                        }}>
                                            {branch ? branch.name : "---"}
                                        </div>
                                    </td>
                                    <td style={tdStyle}>{s.wage_type === "monthly" ? "月給" : "時給"} {s.base_wage.toLocaleString()}円</td>
                                    <td style={{ ...tdStyle, textAlign: "center" }}>
                                        {deletingId === s.id ? (
                                            /* --- 削除確認モード --- */
                                            <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                                <button 
                                                    className="dangerous-btn" 
                                                    onClick={() => deleteStaff(s.id)} 
                                                    style={modernIconBtnStyle("#ff0000")}
                                                >
                                                    実行
                                                </button>
                                                <button 
                                                    onClick={() => setDeletingId(null)} 
                                                    style={modernIconBtnStyle("#34495e")}
                                                >
                                                    戻る
                                                </button>
                                            </div>
                                        ) : editingId === s.id ? (
                                            /* --- 🆕 編集実行中モード --- */
                                            <div style={{ color: "#f1c40f", fontWeight: "bold", fontSize: "12px" }}>
                                                ⚡ 編集作業中
                                            </div>
                                        ) : (
                                            /* --- 通常モード --- */
                                            <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                                <button 
                                                    onClick={() => startEdit(s)} 
                                                    style={modernIconBtnStyle("#3498db")}
                                                >
                                                    編集
                                                </button>
                                                <button 
                                                    onClick={() => setDeletingId(s.id)} 
                                                    style={modernIconBtnStyle("#e74c3c")}
                                                >
                                                    削除
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>
        </div>
    );
}

const cardStyle = { backgroundColor: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)", marginBottom: "20px" };
const inputStyle = { padding: "10px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "14px", width: "100%", boxSizing: "border-box" as const };
const labelStyle = { fontSize: "12px", color: "#7f8c8d", marginBottom: "2px", display: "block" };
const thGroupStyle = { textAlign: "left" as const, borderBottom: "2px solid #eee", backgroundColor: "#fcfcfc" };
const thStyle = { padding: "12px", fontSize: "14px", color: "#7f8c8d" };
const tdStyle = { 
    padding: "12px", 
    fontSize: "14px",
    whiteSpace: "nowrap" as const, // 折り返さない
    overflow: "hidden" as const,    // はみ出しを隠す
    textOverflow: "ellipsis" as const // はみ出したら ... にする
};
const btnStyle = { color: "white", border: "none", padding: "12px", borderRadius: "8px", cursor: "pointer", fontSize: "16px", fontWeight: "bold" as const };