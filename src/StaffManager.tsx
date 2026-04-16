import React, { useState, useEffect } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { modernIconBtnStyle, fetchAddressByZip } from "./utils"; // 👈 utilsからインポート

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
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isSearchingZip, setIsSearchingZip] = useState(false); // 🆕 検索中フラグ

    // --- フォーム用ステート ---
    const [targetId, setTargetId] = useState("");
    const [targetName, setTargetName] = useState("");
    const [targetFurigana, setTargetFurigana] = useState("");
    const [targetBirthday, setTargetBirthday] = useState("");
    const [targetWage, setTargetWage] = useState(1200);
    const [targetJoinDate, setTargetJoinDate] = useState(new Date().toISOString().split('T')[0]);
    const [targetStatus, setTargetStatus] = useState("active"); // 🆕
    const [targetRetirementDate, setTargetRetirementDate] = useState(""); // 🆕
    const [targetZip, setTargetZip] = useState("");
    const [targetAddress, setTargetAddress] = useState("");
    const [targetPhone, setTargetPhone] = useState("");
    const [targetMobile, setTargetMobile] = useState("");
    const [targetCommuteType, setTargetCommuteType] = useState("daily");
    const [targetCommuteWage, setTargetCommuteWage] = useState(0);
    const [targetWageType, setTargetWageType] = useState("hourly");
    const [targetDependents, setTargetDependents] = useState(0);
    const [targetResidentTax, setTargetResidentTax] = useState(0);

    const [branches, setBranches] = useState<any[]>([]);
    const [targetBranchId, setTargetBranchId] = useState(1); // 1（本店）をデフォルトに
    const [annualWorkDays, setAnnualWorkDays] = useState(245); // デフォルト値（計算が終わるまで）
    const [targetDailyHours, setTargetDailyHours] = useState(8.0); // 1日の所定労働時間
    const [targetHours, setTargetHours] = useState(8);
    const [targetMinutes, setTargetMinutes] = useState(0);
    const [sortKey, setSortKey] = useState<"id" | "branch_id">("id");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

    const [calendarPatterns, setCalendarPatterns] = useState<CalendarPattern[]>([]);
    const [targetPatternId, setTargetPatternId] = useState(1);

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
        const year = 2026; 

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
    }, [targetPatternId]);

    const sortedList = [...staffList].sort((a, b) => {
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
        setTargetRetirementDate(""); // 🆕
        setTargetStatus("active"); // 🆕
        setTargetZip(""); setTargetAddress(""); setTargetPhone(""); setTargetMobile(""); setTargetCommuteWage(0);
        setTargetBranchId(1); setTargetDependents(0); setTargetResidentTax(0);
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
        setTargetWage(s.hourly_wage);
        setTargetCommuteType(s.commute_type);
        setTargetCommuteWage(s.commute_wage);
        setTargetWageType(s.wage_type || "hourly");
        setTargetPatternId(s.calendar_pattern_id || 1); // パターンIDをセット
        const h = Math.floor(s.daily_working_hours || 8); // 小数点以下切り捨て
        const m = Math.round(((s.daily_working_hours || 8) - h) * 60); // 残りを分に変換
        setTargetHours(h);
        setTargetMinutes(m);
        setTargetBranchId(s.branch_id || 1);
        setTargetDependents(s.dependents_count || 0);
        setTargetResidentTax(s.resident_tax || 0);
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

        return (
            String(targetStatus) !== String(original.status || "active") || // 🆕
            String(targetRetirementDate) !== String(original.retirement_date || "") || // 🆕
            String(targetWageType) !== String(original.wage_type || "hourly") ||
            String(targetName) !== String(original.name) ||
            String(targetFurigana) !== String(original.furigana || "") ||
            Number(targetWage) !== Number(original.hourly_wage) ||
            String(targetBirthday) !== String(original.birthday || "") ||
            String(targetJoinDate) !== String(original.join_date || "") ||
            String(targetZip) !== String(original.zip_code || "") ||
            String(targetAddress) !== String(original.address || "") ||
            String(targetPhone) !== String(original.phone || "") || // 👈 追加
            String(targetMobile) !== String(original.mobile || "") || // 👈 追加
            String(targetCommuteType) !== String(original.commute_type) ||
            Number(targetCommuteWage) !== Number(original.commute_wage) ||
            Number(targetBranchId) !== Number(original.branch_id || 1) ||
            Number(targetDependents) !== Number(original.dependents_count || 0) ||
            Number(targetResidentTax) !== Number(original.resident_tax || 0)
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
        try {
            const params = [
                targetName, targetFurigana, targetBirthday, targetJoinDate, 
                targetRetirementDate, targetStatus, targetZip, targetAddress, 
                targetPhone, targetMobile, targetWageType, Number(targetWage), 
                targetCommuteType, Number(targetCommuteWage), Number(targetBranchId), 
                Number(targetDependents), Number(targetResidentTax), 
                targetPatternId, 
                targetDailyHours, // 👈 これを追加
                safeId
            ];

            if (editingId) {
                await db.execute(
                    `UPDATE staff SET 
                        name=?, furigana=?, birthday=?, join_date=?, 
                        retirement_date=?, status=?, zip_code=?, address=?, 
                        phone=?, mobile=?, wage_type=?, hourly_wage=?, 
                        commute_type=?, commute_wage=?, branch_id=?, 
                        dependents_count=?, resident_tax=?, calendar_pattern_id=?,
                        scheduled_work_hours=? -- 👈 カラム名に合わせて追加
                    WHERE id=?`,
                    params
                );
            } else {
                await db.execute(
                    `INSERT INTO staff (
                        name, furigana, birthday, join_date, 
                        retirement_date, status, zip_code, address, 
                        phone, mobile, wage_type, hourly_wage, 
                        commute_type, commute_wage, branch_id, 
                        dependents_count, resident_tax, calendar_pattern_id,
                        scheduled_work_hours, -- 👈 カラム名に合わせて追加
                        id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params
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
        try {
            await db.execute("DELETE FROM staff WHERE id = ?", [String(id)]);
            onDataChange();
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
                            <h4 style={{ borderLeft: "4px solid #3498db", paddingLeft: "10px", margin: "0 0 5px 0", fontSize: "14px" }}>基本情報・給与</h4>
                            
                            <div style={{ display: "flex", gap: "10px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>従業員ID {editingId && "(固定)"}</label>
                                    <input placeholder="001" value={targetId} onChange={e => setTargetId(e.target.value)} style={{ ...inputStyle, borderColor: isIdDuplicated() ? "#e74c3c" : "#ddd" }} disabled={!!editingId} />
                                </div>
                                <div style={{ flex: 2 }}>
                                    <label style={labelStyle}>氏名</label>
                                    <input placeholder="浜 太郎" value={targetName} onChange={e => setTargetName(e.target.value)} style={inputStyle} />
                                    <input placeholder="はま たろう" value={targetFurigana} onChange={e => setTargetFurigana(e.target.value)} style={{ ...inputStyle, marginTop: "4px", fontSize: "12px", height: "30px" }} />
                                </div>
                            </div>

                            <div style={{ display: "flex", gap: "10px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>生年月日</label>
                                    <input type="date" value={targetBirthday} onChange={e => setTargetBirthday(e.target.value)} style={inputStyle} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>状態</label> {/* 🆕 ステータス選択 */}
                                    <select value={targetStatus} onChange={e => setTargetStatus(e.target.value)} style={inputStyle}>
                                        <option value="active">在籍</option>
                                        <option value="on_leave">休職</option>
                                        <option value="retired">退職</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: "flex", gap: "10px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>入社日</label>
                                    <input type="date" value={targetJoinDate} onChange={e => setTargetJoinDate(e.target.value)} style={inputStyle} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>退職日</label> {/* 🆕 退職日入力 */}
                                    <input 
                                        type="date" 
                                        value={targetRetirementDate} 
                                        onChange={e => setTargetRetirementDate(e.target.value)} 
                                        style={{ ...inputStyle, backgroundColor: targetStatus !== 'retired' ? '#f0f0f0' : '#fff' }} 
                                        disabled={targetStatus !== 'retired'}
                                    />
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
                                        <input type="number" value={targetWage} onChange={e => setTargetWage(Number(e.target.value))} style={{ ...inputStyle, paddingRight: "50px" }} />
                                        <span style={{ position: "absolute", right: "12px", fontSize: "12px", color: "#7f8c8d" }}>
                                            {targetWageType === "hourly" ? "円 / 時" : "円 / 月"}
                                        </span>
                                    </div>
                                </div>

                                {targetWageType === "monthly" && (
                                    <div style={{ 
                                        width: "100%", backgroundColor: "#f8f9fa", padding: "15px", borderRadius: "8px", 
                                        border: "1px dashed #3498db", marginTop: "5px"
                                    }}>
                                        {/* 1. カレンダーパターンの選択 */}
                                        <div style={{ marginBottom: "15px", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
                                            <label style={labelStyle}>適用カレンダーパターン</label>
                                            <select 
                                                value={targetPatternId} 
                                                onChange={e => setTargetPatternId(Number(e.target.value))} 
                                                style={{ ...inputStyle, backgroundColor: "#fff" }}
                                            >
                                                {calendarPatterns.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                            <p style={{ fontSize: "10px", color: "#64748b", marginTop: "4px", marginLeft: "2px" }}>
                                                ※選択したパターンの休日設定から年間稼働日数を算出します
                                            </p>
                                        </div>

                                        {/* 2. 所定労働時間と統計 */}
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>1日の所定労働時間</label>
                                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                                        <input 
                                                            type="number" min="0" max="24" 
                                                            value={targetHours} 
                                                            onChange={e => setTargetHours(Number(e.target.value))} 
                                                            style={{ ...inputStyle, width: "80px", paddingRight: "30px", textAlign: "right" }} 
                                                        />
                                                        <span style={{ position: "absolute", right: "8px", fontSize: "11px", color: "#7f8c8d" }}>時</span>
                                                    </div>
                                                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                                        <input 
                                                            type="number" min="0" max="55" step="5" 
                                                            value={targetMinutes} 
                                                            onChange={e => setTargetMinutes(Number(e.target.value))} 
                                                            style={{ ...inputStyle, width: "80px", paddingRight: "30px", textAlign: "right" }} 
                                                        />
                                                        <span style={{ position: "absolute", right: "8px", fontSize: "11px", color: "#7f8c8d" }}>分</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div style={{ flex: 1, display: "flex", justifyContent: "space-around", fontSize: "13px", marginTop: "15px" }}>
                                                <div style={{ textAlign: "center" }}>
                                                    <div style={labelStyle}>年間稼働</div>
                                                    <b style={{ color: "#2c3e50", fontSize: "1.1rem" }}>{annualWorkDays}</b> 日
                                                </div>
                                                <div style={{ textAlign: "center" }}>
                                                    <div style={labelStyle}>月平均所定</div>
                                                    <b style={{ fontSize: "1.1rem" }}>{monthlyAverageHours.toFixed(2)}</b> h
                                                </div>
                                            </div>
                                        </div>

                                        {/* 3. 時給換算結果 */}
                                        <div style={{ 
                                            textAlign: "right", borderTop: "1px solid #dee2e6", paddingTop: "8px", 
                                            color: "#2980b9", fontWeight: "bold", marginTop: "10px" 
                                        }}>
                                            💰 時給換算： 約 {Math.round(hourlyConversion).toLocaleString()} 円
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <h4 style={{ borderLeft: "4px solid #e67e22", paddingLeft: "10px", margin: "0 0 5px 0", fontSize: "14px" }}>連絡先・住所</h4>
                            {/* 🆕 郵便番号検索セクション */}
                            <label style={labelStyle}>郵便番号</label>
                            <div style={{ display: "flex", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", borderRadius: "6px", overflow: "hidden" }}>
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
                            <label style={labelStyle}>住所</label>
                            <textarea value={targetAddress} onChange={e => setTargetAddress(e.target.value)} style={{ ...inputStyle, height: "80px", resize: "none" }} />
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
                                <h4 style={{ borderLeft: "4px solid #9b59b6", paddingLeft: "10px", margin: "0 0 10px 0", fontSize: "14px" }}>税・社保・所属設定</h4>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                    <div>
                                        <label style={labelStyle}>所属店舗</label>
                                        <select value={targetBranchId} onChange={e => setTargetBranchId(Number(e.target.value))} style={inputStyle}>
                                            {branches.map(b => (
                                                <option key={b.id} value={b.id}>{b.name} ({b.prefecture})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>扶養人数</label>
                                        <input type="number" value={targetDependents} onChange={e => setTargetDependents(Number(e.target.value))} style={inputStyle} />
                                    </div>
                                    <div style={{ gridColumn: "span 2" }}>
                                        <label style={labelStyle}>住民税額（月額）</label>
                                        <input type="number" value={targetResidentTax} onChange={e => setTargetResidentTax(Number(e.target.value))} style={inputStyle} />
                                    </div>
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
                        {sortedList.map(s => {
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
                                    <td style={tdStyle}>{s.wage_type === "monthly" ? "月給" : "時給"} {s.hourly_wage.toLocaleString()}円</td>
                                    <td style={{ ...tdStyle, textAlign: "center" }}>
                                        {deletingId === s.id ? (
                                            <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                                <button className="dangerous-btn" onClick={() => deleteStaff(s.id)} style={modernIconBtnStyle("#ff0000")}>削除</button>
                                                <button onClick={() => setDeletingId(null)} style={modernIconBtnStyle("#34495e")}>戻る</button>
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
                                                <button onClick={() => startEdit(s)} style={modernIconBtnStyle("#3498db")}>編集</button>
                                                <button onClick={() => setDeletingId(s.id)} style={modernIconBtnStyle("#e74c3c")}>削除</button>
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