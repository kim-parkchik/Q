// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState, Fragment } from "react";
import { calcDetailedDiff, formatHours } from "../../utils/timeUtils";
import { generateAttendanceCSV, parseAttendanceCSV } from "../../utils/csvUtils";
import { modernIconBtnStyle } from "../../styles/styles";
import { calculateSalary } from "../../utils/calcSalary";
import { OVERTIME_RATE, NIGHT_SHIFT_RATE, OVERTIME_PREMIUM_LIMIT_HOURS, OVERTIME_PREMIUM_RATE } from '../../constants/salaryMaster2026';


// 🆕 ニコイチ入力コンポーネント
function TimeInputPair({ value, onChange }: { value: string, onChange: (val: string) => void }) {
    const [h, m] = (value || ":").split(":");

    const formatInput = (val: string) => {
        return val
            .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/[^0-9]/g, "")
            // sliceはせず、後のバリデーションで弾く
    };

    const handleInputChange = (newVal: string, otherPart: string, isHours: boolean) => {
        const cleaned = formatInput(newVal);
        if (isHours) {
            onChange(`${cleaned}:${otherPart}`);
        } else {
            onChange(`${otherPart}:${cleaned}`);
        }
    };

    const padValue = (val: string) => {
        if (!val) return "";
        return val.padStart(2, '0');
    };

    const inputStyle = {
        width: "32px", // 🆕 少し広げて3桁近くになっても大丈夫なように
        border: "none",
        outline: "none",
        textAlign: "center" as const,
        fontSize: "14px",
        fontFamily: "monospace",
        backgroundColor: "transparent",
        padding: "4px 0"
    };

    return (
        <div style={{
            display: "inline-flex",
            alignItems: "center",
            backgroundColor: "#ffffff",
            border: "1px solid #ddd",
            borderRadius: "4px",
            padding: "0 2px",
            width: "60px",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)"
        }}>
            <input
                type="text"
                inputMode="numeric"
                value={h || ""}
                placeholder="00"
                // 🆕 ポイント: isComposingイベントを見て、IME中（下線がある時）のonChangeを無視する
                onChange={e => {
                    const isIme = (e.nativeEvent as any).isComposing;
                    if (!isIme) {
                        handleInputChange(e.target.value, m, true);
                    }
                }}
                // 確定した瞬間に反映
                onCompositionEnd={e => {
                    handleInputChange((e.target as HTMLInputElement).value, m, true);
                }}
                onBlur={() => onChange(`${padValue(h)}:${m}`)}
                style={inputStyle}
            />
            <span style={{ color: "#ccc", fontWeight: "bold", userSelect: "none" }}>:</span>
            <input
                type="text"
                inputMode="numeric"
                value={m || ""}
                placeholder="00"
                onChange={e => {
                    const isIme = (e.nativeEvent as any).isComposing;
                    if (!isIme) {
                        handleInputChange(e.target.value, h, false);
                    }
                }}
                onCompositionEnd={e => {
                    handleInputChange((e.target as HTMLInputElement).value, h, false);
                }}
                onBlur={() => onChange(`${h}:${padValue(m)}`)}
                style={inputStyle}
            />
        </div>
    );
}

interface AttendanceManagerProps {
    db: any;
    staffList: any[];
    targetYear: number;
    setTargetYear: (year: number) => void;
    targetMonth: number;
    setTargetMonth: (month: number) => void;
}

export default function AttendanceManager({
    db,
    staffList,
    targetYear,
    setTargetYear,
    targetMonth,
    setTargetMonth
}: AttendanceManagerProps) {
    const [activeTab, setActiveTab] = useState<"csv" | "individual">("individual");
    const [selectedStaffId, setSelectedStaffId] = useState("");
    const [monthlyWorkData, setMonthlyWorkData] = useState<Record<string, any>>({});
    const [companySettings, setCompanySettings] = useState<any>(null);
    const [branchPrefecture, setBranchPrefecture] = useState<string>("京都");
    const [remainingPaidLeave, setRemainingPaidLeave] = useState<number>(0);
    const [holidays, setHolidays] = useState<Record<string, string>>({});
    const [companyHolidays, setCompanyHolidays] = useState<Record<string, number>>({});

    // データ読み込み関数 (loadMonthlyData 内、または useEffect 内で実行)
    const loadCalendarSettings = async () => {
        // 1. 祝日マスターのロード
        // const resHolidays = await db.select<any[]>("SELECT holiday_date, name FROM holiday_master");
        const resHolidays = await db.select("SELECT holiday_date, name FROM holiday_master") as any[];
        const hMap: Record<string, string> = {};
        resHolidays.forEach((h) => { hMap[h.holiday_date] = h.name; });
        setHolidays(hMap);

        // 2. 会社カレンダー設定のロード (選択中のスタッフのパターンに合わせる)
        if (selectedStaffId) {
            const staff = staffList.find(s => String(s.id) === String(selectedStaffId));
            const patternId = staff?.calendar_pattern_id || 1;
            // const resCompany = await db.select<any[]>(
            //     "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
            //     [patternId]
            // );
            const resCompany = await db.select(
                    "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
                    [patternId]
                ) as any[];
            const cMap: Record<string, number> = {};
            resCompany.forEach((c) => { cMap[c.work_date] = c.is_holiday; });
            setCompanyHolidays(cMap);
        }
    };

    // targetMonth や selectedStaffId が変わった時に再実行
    useEffect(() => {
        loadCalendarSettings();
    }, [db, targetMonth, selectedStaffId]);

    const checkRemainingPaidLeave = async () => {
        if (!db || !selectedStaffId) return;

        // 1. 有効期限内の付与日数のみ合計（期限切れは残日数に含めない）
        const today = new Date().toISOString().split("T")[0];
        const grants = await db.select(
            "SELECT SUM(days_granted) as total FROM paid_leave_grants WHERE staff_id = ? AND expiry_date >= ?",
            [selectedStaffId, today]
        ) as any[];
        const totalGranted = grants[0]?.total || 0;

        // 2. 使用済み日数を取得（DBの attendance テーブルから集計）
        const used = await db.select(`
            SELECT 
                SUM(CASE WHEN work_type = 'paid_full' THEN 1.0 
                        WHEN work_type = 'paid_half' THEN 0.5 
                        ELSE 0 END) as used_days,
                SUM(paid_leave_hours) as used_hours
            FROM attendance 
            WHERE staff_id = ?`,
            [selectedStaffId]
        ) as any[];

        const daysFromType = used[0]?.used_days || 0;
        const daysFromHours = (used[0]?.used_hours || 0) / 8; // 8時間で1日換算の場合

        setRemainingPaidLeave(totalGranted - (daysFromType + daysFromHours));
    };

    // 従業員を切り替えた時にチェック
    useEffect(() => { checkRemainingPaidLeave(); }, [selectedStaffId]);

    // 1. フィルタ状態の管理（初期値は 'active' のみ）
    const [activeFilters, setActiveFilters] = useState<string[]>(["active"]);
    
    // 2. フィルタボタンの定義
    const statusOptions = [
        { label: "在籍", value: "active", color: "#2ecc71" },   // 緑
        { label: "休職", value: "on_leave", color: "#f1c40f" }, // 黄
        { label: "退職", value: "retired", color: "#e74c3c" },  // 赤
    ];

    // 3. フィルタリングされたリストを作成
    const filteredStaffList = (staffList || []).filter(s => {
        // 選択されているステータスに含まれる人だけを通す
        return activeFilters.includes(s.status || "active");
    });

    // ✨ フィルタ変更によって選択中の人がリストから消えたら、選択をリセットする
    useEffect(() => {
        if (selectedStaffId) {
            // 現在選んでいる人が、フィルタ後のリストにまだ存在するか確認
            const isStillVisible = filteredStaffList.some(s => String(s.id) === String(selectedStaffId));
            
            if (!isStillVisible) {
                setSelectedStaffId(""); // リストから消えたら選択を解除（詳細画面を閉じる）
            }
        }
    }, [filteredStaffList]); // フィルタ結果が変わるたびに実行

    // 4. トグル関数
    const toggleFilter = (val: string) => {
        setActiveFilters(prev => 
            prev.includes(val) 
                ? prev.filter(v => v !== val) // すでにあれば削除
                : [...prev, val]              // なければ追加
        );
    };

    // 📄 生データ（打刻ログ）のエクスポート
    const handleExportRawCSV = async () => {
        if (!db) return;
        const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-`;
        try {
            const data = await db.select(`
                SELECT 
                    staff_id, work_date, 
                    csv_entry_time as entry_time, csv_exit_time as exit_time,
                    csv_break_start as break_start, csv_break_end as break_end,
                    csv_out_time as out_time, csv_return_time as return_time
                FROM attendance 
                WHERE work_date LIKE ?
                ORDER BY staff_id, work_date
            `, [`${monthStr}%`]) as any[];

            if (!data.length) return alert("出力するデータがありません。");

            const csvContent = generateAttendanceCSV(data); // 既存の関数を使用
            downloadCSV(csvContent, `打刻ログ_${targetYear}年${targetMonth}月.csv`);
        } catch (e) {
            console.error(e);
            alert("エクスポートに失敗しました。");
        }
    };

    // 📤 完全データ（修正・集計済み）のエクスポート
    const handleExportFullCSV = async () => {
        if (!db) return;
        const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-`;
        try {
            const data = await db.select(`
                SELECT a.*, s.name as staff_name 
                FROM attendance a
                JOIN staff s ON a.staff_id = s.id
                WHERE a.work_date LIKE ?
                ORDER BY a.staff_id, a.work_date
            `, [`${monthStr}%`]) as any[];

            if (!data.length) return alert("出力するデータがありません。");

            // 全項目を含めたCSV文字列を生成（※utils側の更新が必要です）
            const csvContent = generateAttendanceCSV(data); 
            downloadCSV(csvContent, `勤怠詳細_${targetYear}年${targetMonth}月.csv`);
        } catch (e) {
            console.error(e);
            alert("エクスポートに失敗しました。");
        }
    };

    // 共通のダウンロード処理（BOM付き）
    const downloadCSV = (content: string, filename: string) => {
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };

    // 修正版 handleImportCSV
    const handleImportCSV = async () => {
        // 🆕 Tauri標準のファイル選択ダイアログを使う場合 (推奨)
        // import { open } from '@tauri-apps/plugin-dialog';
        // const selected = await open({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
        
        // 現状の input 要素を使う方法を継続する場合の改善
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';

        input.onchange = async (e: any) => {
            const file = e.target.files[0];
            if (!file) return;

            // 🆕 文字コード対策：Shift-JISかUTF-8か不安な場合は
            // FileReaderの第2引数に 'shift-jis' を指定するか、パース前に確認
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const text = event.target?.result as string;
                    // parseAttendanceCSV が適切に配列を返しているか確認
                    const rows = parseAttendanceCSV(text);
                    
                    if (rows.length === 0) return;

                    const isFullFormat = "区分" in rows[0] || "名前" in rows[0];

                    // 🆕 高速化：大量の INSERT はトランザクションを使いたいところですが、
                    // plugin-sql では直接 BEGIN/COMMIT を使うか、ループ内で逐次実行します。
                    for (const row of rows) {
                        const sId = row["スタッフID"];
                        const date = row["日付"];
                        if (!sId || !date) continue;

                        const staff = staffList.find(s => String(s.id) === String(sId));
                        if (!staff) continue;

                        // 時間の計算
                        const { total, night } = calcDetailedDiff(
                            row["出勤"], row["退勤"], row["休憩始"], row["休憩終"], row["外出"], row["戻り"]
                        );

                        // 🆕 既存データを削除して入れ直す（重複エラー防止）
                        await db.execute("DELETE FROM attendance WHERE staff_id = ? AND work_date = ?", [sId, date]);
                        
                        await db.execute(
                            `INSERT INTO attendance (
                                staff_id, work_date, 
                                entry_time, exit_time, break_start, break_end, out_time, return_time,
                                csv_entry_time, csv_exit_time, csv_break_start, csv_break_end, csv_out_time, csv_return_time,
                                work_hours, night_hours,
                                actual_base_wage, overtime_rate, night_rate,
                                work_type, paid_leave_hours, memo
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                sId, date, 
                                row["出勤"] || "", row["退勤"] || "", row["休憩始"] || "", row["休憩終"] || "", row["外出"] || "", row["戻り"] || "",
                                row["出勤"] || "", row["退勤"] || "", row["休憩始"] || "", row["休憩終"] || "", row["外出"] || "", row["戻り"] || "",
                                Number(total), Number(night), 
                                staff.wage_type === "monthly" ? 0 : staff.base_wage, 
                                1.25, 0.25,
                                isFullFormat ? (row["区分"] || "normal") : "normal",
                                isFullFormat ? (Number(row["有給h"]) || 0) : 0,
                                isFullFormat ? (row["備考"] || "") : ""
                            ]
                        );
                    }
                    alert("インポートが完了しました。");
                    loadMonthlyData(); // 画面を更新
                } catch (err) {
                    console.error("インポートエラー:", err);
                    alert("CSV読み込み中にエラーが発生しました。");
                }
            };
            reader.readAsText(file, 'utf-8'); // 必要に応じて 'shift-jis'
        };
        input.click();
    };

    const loadMonthlyData = async () => {
        if (!db || !selectedStaffId) {
            setMonthlyWorkData({});
            return;
        }
        const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-`;
        try {
            // 1. 会社設定の取得（型アサーションを外出しして安定させる）
            const configData = await db.select("SELECT * FROM company WHERE id = 1") as any[];
            if (configData && configData.length > 0) {
                setCompanySettings(configData[0]);
            }

            // 1b. スタッフの拠点都道府県を取得（健保料率計算用）
            const staffForBranch = staffList?.find(s => String(s.id) === String(selectedStaffId));
            if (staffForBranch?.branch_id) {
                const branchData = await db.select(
                    "SELECT prefecture FROM branches WHERE id = ?",
                    [staffForBranch.branch_id]
                ) as any[];
                if (branchData?.[0]?.prefecture) {
                    setBranchPrefecture(branchData[0].prefecture.replace(/[都道府県]$/, "") || "京都");
                }
            }

            // 2. 勤怠データの取得
            const attendanceData = await db.select(
                "SELECT * FROM attendance WHERE staff_id = ? AND work_date LIKE ?",
                [selectedStaffId, `${monthStr}%`]
            ) as any[];

            const loaded: Record<string, any> = {};
            
            // 配列であることを確認してからループ（VSCodeのエラー避け）
            if (Array.isArray(attendanceData)) {
                attendanceData.forEach(row => {
                    loaded[row.work_date] = { 
                        in: row.entry_time || "", 
                        out: row.exit_time || "", 
                        bStart: row.break_start || "", 
                        bEnd: row.break_end || "",
                        outTime: row.out_time || "",
                        returnTime: row.return_time || "",
                        isSaved: true,
                        savedHours: Number(row.work_hours) || 0,
                        nightHours: Number(row.night_hours) || 0,
                        actual_base_wage: row.actual_base_wage || 0,
                        overtime_rate: row.overtime_rate || 1.25,
                        night_rate: row.night_rate || 0.25,
                        
                        // --- 🆕 ここを追加 ---
                        // DBのカラム名 (row.xxx) と UIで使う名前 (xxx: ) を紐付け
                        workType: row.work_type || "normal", 
                        paidHours: row.paid_leave_hours || 0, 
                        memo: row.memo || "",
                        
                        // CSV表示用（Rawデータの表示に必要）
                        csv_entry_time: row.csv_entry_time || "--:--",
                        csv_exit_time: row.csv_exit_time || "--:--"
                        // --------------------
                    };
                });
            }
            setMonthlyWorkData(loaded);
        } catch (e) { 
            console.error("データ読み込みエラー:", e); 
        }
    };

    useEffect(() => { loadMonthlyData(); }, [selectedStaffId, targetYear, targetMonth, db]);

    const handleCellChange = (date: string, field: string, value: string) => {
        setMonthlyWorkData(prev => {
            const currentRow = prev[date] || {};
            if (currentRow[field] === value) return prev;

            // 🆕 ロジックを単純化：変更があれば「未保存」確定。
            // ただし、空の状態からいじり始めた時は、まだ「保存ボタン」を出さないフラグとして使う
            return {
                ...prev,
                [date]: { 
                    ...currentRow, 
                    [field]: value, 
                    isSaved: false // フリをやめて、常に false に
                }
            };
        });
    };

    const saveAttendance = async (date: string) => {
        if (!db || !selectedStaffId) return;
        const row = monthlyWorkData[date];
        const currentStaff = staffList?.find(s => String(s.id) === String(selectedStaffId));
        if (!row || !currentStaff) return;

        // --- 1. 時間バリデーション (通常勤務の時だけ厳しくチェック) ---
        const isOver48 = (timeStr: string) => {
            if (!timeStr || !timeStr.includes(":")) return false;
            const h = parseInt(timeStr.split(":")[0], 10);
            return h >= 48;
        };

        const targetTimes = [row.in, row.out, row.bStart, row.bEnd, row.outTime, row.returnTime];
        if (targetTimes.some(isOver48)) {
            alert("48:00以上の時間は入力できません。");
            return;
        }

        // 🆕 修正ポイント：通常勤務("normal") か 半休("paid_half") の時だけ出退勤チェックをする
        const needsTimeInput = row.workType === "normal" || row.workType === "paid_half";
        if (needsTimeInput && (!row.in || !row.out)) {
            alert("出勤・退勤時間を入力してください。");
            return;
        }

        // --- 2. 計算 (全休のときは計算をスキップして 0 にする) ---
        // 🆕 修正ポイント：全休("paid_full") または 欠勤("absent") なら 0、それ以外は計算
        let calcTotal: number = 0;
        let calcNight: number = 0;

        if (row.workType !== "paid_full" && row.workType !== "absent") {
            // 2. 計算結果を受け取る
            const { total, night } = calcDetailedDiff(row.in, row.out, row.bStart, row.bEnd, row.outTime, row.returnTime);
            
            // 3. 🆕 Number() で数値に変換して代入する
            calcTotal = Number(total);
            calcNight = Number(night);
        }

        try {
            await db.execute("DELETE FROM attendance WHERE staff_id = ? AND work_date = ?", [selectedStaffId, date]);
            
            const isMonthly = currentStaff.wage_type === "monthly";

            await db.execute(
                `INSERT INTO attendance (
                    staff_id, work_date, entry_time, exit_time, 
                    break_start, break_end, out_time, return_time, 
                    work_hours, night_hours,
                    actual_base_wage, overtime_rate, night_rate,
                    work_type, paid_leave_hours, memo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    selectedStaffId, date, row.in||"", row.out||"", 
                    row.bStart||"", row.bEnd||"", row.outTime||"", row.returnTime||"", 
                    Number(calcTotal), Number(calcNight), // 🆕 計算済みの値を使う
                    isMonthly ? 0 : currentStaff.base_wage, 
                    OVERTIME_RATE,
                    NIGHT_SHIFT_RATE,
                    row.workType || "normal",
                    Number(row.paidHours) || 0,
                    row.memo || ""
                ]
            );

            setMonthlyWorkData(prev => ({ 
                ...prev, 
                [date]: { 
                    ...prev[date], 
                    isSaved: true, 
                    savedHours: Number(calcTotal), // 🆕
                    nightHours: Number(calcNight), // 🆕
                    actual_base_wage: isMonthly ? 0 : currentStaff.base_wage,
                    workType: row.workType || "normal",
                    paidHours: Number(row.paidHours) || 0,
                    memo: row.memo || ""
                } 
            }));
        } catch (e) {
            console.error("【保存エラー詳細】", e);
            alert("❌ 保存できませんでした");
        }

        await checkRemainingPaidLeave();
    };

    const saveAllMonthlyData = async () => {
        if (!db || !selectedStaffId) return;
        const targetDates = Object.keys(monthlyWorkData).filter(date => {
            const row = monthlyWorkData[date];
            return !row.isSaved && (row.in || row.out);
        });
        if (targetDates.length === 0) return alert("保存が必要な入力はありません。");
        try {
            for (const date of targetDates) { await saveAttendance(date); }
            alert(`${targetDates.length}件保存しました！`);
        } catch (e) { alert("エラー: " + e); }
    };

    const revertAttendance = async (date: string) => {
        if (!db || !selectedStaffId) return;

        try {
            // 1. 型アサーションを後ろに付ける (as any[])
            const res = await db.select(
                "SELECT * FROM attendance WHERE staff_id = ? AND work_date = ?",
                [selectedStaffId, date]
            ) as any[];

            if (res && res.length > 0) {
                const row = res[0];
                setMonthlyWorkData(prev => ({
                    ...prev,
                    [date]: { 
                        in: row.entry_time || "", 
                        out: row.exit_time || "", 
                        bStart: row.break_start || "", 
                        bEnd: row.break_end || "", 
                        outTime: row.out_time || "",
                        returnTime: row.return_time || "",
                        isSaved: true, 
                        savedHours: Number(row.work_hours) || 0,
                        nightHours: Number(row.night_hours) || 0,
                        actual_base_wage: row.actual_base_wage || 0
                    }
                }));
            } else {
                // 2. delete を使わず、スプレッド構文で特定のキーを除外する（よりクリーンな書き方）
                setMonthlyWorkData(prev => {
                    const { [date]: _, ...rest } = prev;
                    return rest;
                });
            }
        } catch (e) {
            console.error("元に戻す処理でエラーが発生しました:", e);
        }

        await checkRemainingPaidLeave(); // 🆕 最後にこれを入れる
    };

    // --- スタイル定義 ---
    const cardStyle = { backgroundColor: "white", padding: "20px", borderRadius: "12px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)", marginBottom: "20px" };
    const inputStyle = { padding: "10px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "14px", width: "100%", boxSizing: "border-box" as const };
    const labelStyle = { fontSize: "12px", color: "#7f8c8d", marginBottom: "2px", display: "block" };
    const thStyle = { padding: "12px", fontSize: "14px", color: "#7f8c8d", textAlign: "left" as const };
    const tdStyle = { padding: "12px", fontSize: "14px" };
    const btnStyle = { backgroundColor: "#2ecc71", color: "white", border: "none", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" as const };
    // セットの区切りに使う、少し広めの右余白
    const tdSpacerStyle = { ...tdStyle, paddingRight: "30px" }; 
    // セット内の狭い余白（デフォルトより少し詰めたい場合）
    const tdTightStyle = { ...tdStyle, paddingRight: "4px" };

    // --- ★ 集計ロジック（給与計算エンジン呼び出し版） ★ ---
    const staffInfo = staffList?.find(s => String(s.id) === String(selectedStaffId));

    // 1. 保存済みの勤怠データをエンジン用フォーマットに変換
    const attendanceRowsForCalc = Object.entries(monthlyWorkData)
        .filter(([_, row]) => row.isSaved)
        .map(([date, row]) => ({
            work_date: date,
            work_hours: row.savedHours,
            night_hours: row.nightHours,
            actual_base_wage: row.actual_base_wage
        }));

    // 2. 給与計算エンジンを実行
    // ※ extrasは一旦空（住民税や手当を拡張する時にここを使います）
    const calcResult = (staffInfo && attendanceRowsForCalc.length > 0 && companySettings)
        ? calculateSalary(
            staffInfo, 
            attendanceRowsForCalc, 
            { 
                allowanceName: "", allowanceAmount: 0, residentTax: 0, 
                prefecture: branchPrefecture, 
                dependents: 0, customItems: [] 
            }, 
            targetYear, targetMonth, companySettings
        )
        : null;

    // 3. JSXで使用する変数に結果を紐付け
    const totalHours         = calcResult?.totalWorkHours || 0;
    const totalNightHours    = calcResult?.totalNightHours || 0;
    const totalOvertimeHours = calcResult?.totalOvertimeHours || 0;
    const totalPay           = calcResult?.totalEarnings || 0; // 交通費・割増・端数処理すべて込み
    const totalCommute       = calcResult?.commutePay || 0;
    const over60Hours = Math.max(0, totalOvertimeHours - OVERTIME_PREMIUM_LIMIT_HOURS);

    // --- スタイル定義（追加分） ---
    const tabContainerStyle = {
        display: "flex",
        borderBottom: "2px solid #eee",
        marginBottom: "20px",
        gap: "10px"
    };

    const tabButtonStyle = (isActive: boolean) => ({
        padding: "12px 24px",
        cursor: "pointer",
        fontSize: "15px",
        fontWeight: "bold" as const,
        border: "none",
        borderBottom: isActive ? "3px solid #3498db" : "3px solid transparent",
        backgroundColor: "transparent",
        color: isActive ? "#3498db" : "#7f8c8d",
        transition: "0.2s"
    });

    return (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
            {/* 🆕 タブメニュー */}
            <div style={tabContainerStyle}>
                <button 
                    onClick={() => setActiveTab("individual")} 
                    style={tabButtonStyle(activeTab === "individual")}
                >
                    👤 個別編集・集計
                </button>
                <button 
                    onClick={() => setActiveTab("csv")} 
                    style={tabButtonStyle(activeTab === "csv")}
                >
                    📂 一括操作 (CSV)
                </button>
            </div>

            {/* --- 📂 一括操作 (CSV) タブの内容 --- */}
            {activeTab === "csv" && (
                <div style={{ ...cardStyle, borderTop: "4px solid #7f8c8d" }}>
                    <h3 style={{ marginTop: 0 }}>データの入出力</h3>
                    <p style={{ fontSize: "13px", color: "#666" }}>
                        {targetYear}年{targetMonth}月のデータをCSV形式でエクスポート・インポートします。
                    </p>
                    <div style={{ display: "flex", gap: "15px", marginTop: "20px" }}>
                        <div style={{ flex: 1, padding: "15px", border: "1px solid #eee", borderRadius: "8px" }}>
                            <h4 style={{ marginTop: 0 }}>📤 エクスポート</h4>
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <button onClick={handleExportRawCSV} style={modernIconBtnStyle("#7f8c8d")}>
                                    📄 打刻ログ（Rawデータ）を出力
                                </button>
                                <button onClick={handleExportFullCSV} style={modernIconBtnStyle("#34495e")}>
                                    📤 詳細データ（集計済み）を出力
                                </button>
                            </div>
                        </div>
                        <div style={{ flex: 1, padding: "15px", border: "1px solid #eee", borderRadius: "8px" }}>
                            <h4 style={{ marginTop: 0 }}>📥 インポート</h4>
                            <button onClick={handleImportCSV} style={{ ...modernIconBtnStyle("#2980b9"), width: "100%" }}>
                                📥 CSVファイルを読み込む
                            </button>
                            <p style={{ fontSize: "11px", color: "#999", marginTop: "10px" }}>
                                ※既存の日付データは上書きされますのでご注意ください。
                            </p>
                        </div>
                    </div>
                </div>
            )}
            {/* --- 👤 個別編集・集計 タブの内容 --- */}
            {activeTab === "individual" && (
                <>
                    {/* ... (中略：年月選択、スタッフ選択) ... */}
                    <div style={{ 
                        display: "flex", 
                        gap: "8px", 
                        alignItems: "center", // 👈 これが「高さの中心」を合わせる司令塔です
                        marginTop: "15px",    // 外側の余白
                        marginBottom: "5px"
                    }}>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                <select value={targetYear} onChange={e => setTargetYear(Number(e.target.value))} style={{ ...inputStyle, width: "100px" }}>
                                    {[2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}年</option>)}
                                </select>
                                <select value={targetMonth} onChange={e => setTargetMonth(Number(e.target.value))} style={{ ...inputStyle, width: "80px" }}>
                                    {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}月</option>))}
                                </select>
                            </div>
                        </div>
                        <button 
                            onClick={() => { const d = new Date(); setTargetYear(d.getFullYear()); setTargetMonth(d.getMonth() + 1); }} 
                            style={{ 
                                ...modernIconBtnStyle("#7f8c8d"), 
                                height: "32px",       // セレクトボックスと数値を合わせる
                                margin: "0 0 0 20px",            // 👈 重要：ここにあった marginTop: "15px" を完全に削除
                                padding: "0 12px",
                                fontSize: "12px",
                                display: "inline-flex", // 内部のテキストも中央寄せにするため
                                alignItems: "center",   // ボタン内のテキストの垂直中央
                                justifyContent: "center",
                                border: "1px solid #7f8c8d", // 必要に応じて枠線を明示
                                boxSizing: "border-box"      // 枠線を含めた高さ計算にする
                            }}
                        >
                            今月に戻る
                        </button>
                    </div>

                    {/* 🆕 従業員選択・フィルタ・一括保存セクション */}
                    <section style={{ 
                        display: "flex", 
                        justifyContent: "space-between", 
                        alignItems: "stretch", // 高さを揃える
                        gap: "20px", 
                        marginBottom: "10px", 
                        marginTop: "0"
                    }}>
                        {/* 左側：従業員選択カード（フィルタ機能付き） */}
                        <div style={{ 
                            ...cardStyle, 
                            width: "780px",         // 👈 ここを px で固定！(500px + ボタン類 + 余白の合計)
                            flex: "none",           // 👈 勝手に伸び縮みさせない
                            boxSizing: "border-box", 
                            margin: "5px 0",
                            padding: "12px 20px"
                        }}>
                            <div style={{ 
                                display: "flex", 
                                alignItems: "center", 
                                gap: "10px",       // 👈 ボタンとセレクトボックスの距離をギュッと詰める
                            }}>
                                {/* 左側：従業員選択セレクトボックス（幅をさらに拡大） */}
                                <div style={{ width: "500px" }}> 
                                    <select 
                                        value={selectedStaffId} 
                                        onChange={e => setSelectedStaffId(e.target.value)} 
                                        style={{ 
                                            ...inputStyle, 
                                            fontSize: "14px",   // 👈 高さを抑えるため普通のサイズに
                                            padding: "4px 10px", // 👈 上下パディングを絞って高さを「普通」に
                                            height: "32px",     // 👈 標準的な高さ
                                            cursor: "pointer"
                                        }}
                                    >
                                        <option value="">-- 従業員を選択してください --</option>
                                        {filteredStaffList.map(s => (
                                            <option key={s.id} value={s.id}>
                                                [{s.id}] {s.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* 中央：一括保存ボタン（ここが後から出てもレイアウトが崩れないように配置） */}
                                {/* ※未保存がある時だけ表示されるロジックは維持 */}
                                {Object.values(monthlyWorkData).some(row => !row.isSaved && (row.in || row.out)) && (
                                    <button 
                                        onClick={saveAllMonthlyData} 
                                        style={{ 
                                            ...modernIconBtnStyle("#e67e22"), 
                                            fontSize: "12px", 
                                            padding: "4px 12px",
                                            height: "32px",
                                            whiteSpace: "nowrap"
                                        }}
                                    >
                                        📂 未保存分をすべて保存
                                    </button>
                                )}

                                {/* 右側：フィルタボタン群（右端に固定） */}
                                <div style={{ 
                                    display: "flex", 
                                    gap: "8px", 
                                    alignItems: "center", 
                                    marginLeft: "auto" 
                                }}>
                                    {[
                                        { label: "在籍", value: "active", color: "#2ecc71" },
                                        { label: "休職", value: "on_leave", color: "#f1c40f" },
                                        { label: "退職", value: "retired", color: "#e74c3c" }
                                    ].map(opt => {
                                        const isActive = activeFilters.includes(opt.value);
                                        return (
                                            <button
                                                key={opt.value}
                                                onClick={() => toggleFilter(opt.value)}
                                                style={{
                                                    padding: "4px 12px", // 👈 高さを抑えるため上下を4pxに
                                                    borderRadius: "15px", 
                                                    border: `1px solid ${opt.color}`,
                                                    backgroundColor: isActive ? opt.color : "white",
                                                    color: isActive ? "white" : opt.color,
                                                    cursor: "pointer",
                                                    fontSize: "11px",
                                                    fontWeight: "bold",
                                                    height: "28px",    // 👈 セレクトボックスより少しだけ低くしてメリハリを
                                                    transition: "0.2s",
                                                    whiteSpace: "nowrap"
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                    <button 
                                        onClick={() => setActiveFilters(["active", "on_leave", "retired"])}
                                        style={{ 
                                            fontSize: "11px", 
                                            border: "none", 
                                            background: "none", 
                                            color: "#3498db", 
                                            cursor: "pointer", 
                                            textDecoration: "underline",
                                            marginLeft: "4px"
                                        }}
                                    >
                                        すべて
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 右側：一括保存ボタン（ここを「最初からある前提」にする） */}
                        <div style={{ 
                            flex: "0 0 235px",       // 👈 常に 235px の幅を確保する
                            display: "flex", 
                            alignItems: "flex-end", 
                            paddingBottom: "0" 
                        }}>
                            {selectedStaffId ? (
                                <button 
                                    onClick={saveAllMonthlyData} 
                                    style={{ 
                                        ...btnStyle, 
                                        backgroundColor: "#34495e", 
                                        fontSize: "14px", 
                                        display: "flex", 
                                        alignItems: "center", 
                                        gap: "8px",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                        width: "100%",      // 親の 280px いっぱいにする
                                        height: "fit-content",
                                        padding: "12px 20px"
                                    }}
                                >
                                    📂 今月の未保存分をすべて保存
                                </button>
                            ) : (
                                // ボタンがない時も透明な何かを置いておく必要はありませんが、
                                // 枠が確保されているので、後からボタンが出ても左側のカードを押し潰しません。
                                null
                            )}
                        </div>
                    </section>

                    {selectedStaffId ? (
                        <>
                        {/* <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "15px" }}>
                            <button onClick={saveAllMonthlyData} style={{ ...btnStyle, backgroundColor: "#34495e", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                            📂 今月の未保存分をすべて保存
                            </button>
                        </div> */}
                        <section style={cardStyle}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr style={{ backgroundColor: "#fcfcfc", borderBottom: "2px solid #eee" }}>
                                        <th style={{ ...thStyle, width: "100px" }}>日付</th>
                                        <th style={thStyle}>出勤</th>
                                        <th style={{ ...thStyle, paddingRight: "30px" }}>退勤</th>
                                        <th style={thStyle}>休憩開始</th>
                                        <th style={{ ...thStyle, paddingRight: "30px" }}>休憩終了</th>
                                        <th style={thStyle}>外出</th>
                                        <th style={{ ...thStyle, paddingRight: "30px" }}>戻り</th>
                                        <th style={thStyle}>実働時間</th>
                                        <th style={thStyle}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from({ length: new Date(targetYear, targetMonth, 0).getDate() }, (_, i) => {
                                        const day = i + 1;
                                        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                        const dayOfWeek = new Date(targetYear, targetMonth - 1, day).toLocaleDateString('ja-JP', { weekday: 'short' });
                                        
                                        const rowData = monthlyWorkData[dateStr] || {};
                                        const row = {
                                            in: rowData.in || "",
                                            out: rowData.out || "",
                                            bStart: rowData.bStart || "",
                                            bEnd: rowData.bEnd || "",
                                            outTime: rowData.outTime || "",
                                            returnTime: rowData.returnTime || "",
                                            workType: rowData.workType || "normal",
                                            paidHours: rowData.paidHours || 0,
                                            memo: rowData.memo || "",
                                            isSaved: rowData.isSaved || false,
                                            savedHours: Number(rowData.savedHours) || 0,
                                            nightHours: Number(rowData.night_hours) || 0, // 👈 追加
                                            csvIn: rowData.csv_entry_time || "--:--",
                                            csvOut: rowData.csv_exit_time || "--:--",
                                        };

                                        const hName = holidays[dateStr];              // 祝日名（あれば）
                                        const cSetting = companyHolidays[dateStr];    // 1:休日, 0:出勤, undefined:設定なし
                                        
                                        const isSun = dayOfWeek === "日";
                                        const isSat = dayOfWeek === "土";

                                        // 「赤色」にする条件：社休日設定がある OR (設定がなく、かつ日曜か祝日)
                                        const isRedDay = (cSetting === 1) || (cSetting === undefined && (isSun || !!hName));
                                        // 「青色」にする条件：土曜かつ、赤色（祝日）ではない
                                        const isBlueDay = isSat && !isRedDay; 

                                        // 背景色の決定ロジック
                                        const rowBgColor = 
                                            row.workType === "paid_full" ? "#e8f5e9" : 
                                            row.workType === "absent" ? "#fff3e0" : 
                                            isRedDay ? "#fff5f5" : 
                                            isBlueDay ? "#f5faff" : "#fcfcfc";

                                        // 文字色の決定ロジック
                                        const dateTextColor = isRedDay ? "#e74c3c" : isBlueDay ? "#3498db" : "#2c3e50";

                                        const isFullyTyped = (t: string) => {
                                            if (!t || t === ":") return false;
                                            const [h, m] = t.split(":");
                                            return h.length === 2 && m.length === 2;
                                        };

                                        const hasAnyInput = (t: string) => {
                                            return t && t !== ":" && t.replace(":", "").length > 0;
                                        };

                                        const toMin = (t: string) => {
                                            const [h, m] = t.split(":").map(Number);
                                            return h * 60 + m;
                                        };

                                        const isEmpty = !hasAnyInput(row.in) && !hasAnyInput(row.out) && 
                                                        !hasAnyInput(row.bStart) && !hasAnyInput(row.bEnd) &&
                                                        !hasAnyInput(row.outTime) && !hasAnyInput(row.returnTime);

                                        const isBaseComplete = isFullyTyped(row.in) && isFullyTyped(row.out);

                                        // 🆕 ここで定義しておくと矛盾チェックが動きます
                                        const isBreakComplete = isFullyTyped(row.bStart) && isFullyTyped(row.bEnd);
                                        const isOutComplete = isFullyTyped(row.outTime) && isFullyTyped(row.returnTime);

                                        const isBreakIncomplete = (hasAnyInput(row.bStart) || hasAnyInput(row.bEnd)) && !isBreakComplete;
                                        const isOutIncomplete = (hasAnyInput(row.outTime) || hasAnyInput(row.returnTime)) && !isOutComplete;

                                        // 🆕 48時間制対応の矛盾チェック
                                        let isTimeRangeError = false;
                                        if (isBaseComplete) {
                                            const start = toMin(row.in);
                                            const end = toMin(row.out);

                                            // 1. 退勤が出勤より前、または同時ならエラー
                                            if (end <= start) isTimeRangeError = true;

                                            // 2. 休憩時間のチェック（出勤〜退勤の間に収まっているか）
                                            if (isBreakComplete) {
                                                const bS = toMin(row.bStart);
                                                const bE = toMin(row.bEnd);
                                                // 休憩開始が出勤より前、休憩終了が退勤より後、または休憩の前後逆転をチェック
                                                if (bS < start || bE > end || bE <= bS) isTimeRangeError = true;
                                            }

                                            // 3. 外出時間のチェック（出勤〜退勤の間に収まっているか）
                                            if (isOutComplete) {
                                                const oS = toMin(row.outTime);
                                                const oR = toMin(row.returnTime);
                                                // 外出開始が出勤より前、戻りが退勤より後、または外出の前後逆転をチェック
                                                if (oS < start || oR > end || oR <= oS) isTimeRangeError = true;
                                            }
                                        }

                                        // 🆕 isTimeRangeError を条件に追加
                                        const isAllInputValid = isBaseComplete && !isBreakIncomplete && !isOutIncomplete && !isTimeRangeError;

                                        // --- 状態判定・計算系（これらが必要！） ---
                                        const hasChange = !row.isSaved;

                                        const { total: currentHours } = calcDetailedDiff(
                                            row.in, row.out, row.bStart, row.bEnd, row.outTime, row.returnTime
                                        );

                                        return (
                                            <Fragment key={dateStr}>
                                                <tr style={{ 
                                                    // 🆕 計算済みの rowBgColor を使う
                                                    backgroundColor: rowBgColor, 
                                                    borderTop: "3px solid #eee" 
                                                }}>
                                                    <td rowSpan={3} style={{ ...tdStyle, fontWeight: "bold", borderRight: "1px solid #eee", verticalAlign: "top", width: "100px" }}>
                                                        <div style={{ 
                                                            fontSize: "14px", 
                                                            // 🆕 計算済みの dateTextColor を使う
                                                            color: dateTextColor 
                                                        }}>
                                                            {day}日 ({dayOfWeek})
                                                            {/* 🆕 せっかくなので祝日名も日付の下に出しましょう */}
                                                            {hName && <div style={{ fontSize: "9px", fontWeight: "normal", marginTop: "2px" }}>{hName}</div>}
                                                        </div>
                                                        <select
                                                            value={row.workType}
                                                            onChange={e => {
                                                                const nextType = e.target.value;
                                                                if ((nextType === "paid_full" || nextType === "paid_half") && remainingPaidLeave <= 0) {
                                                                    alert("有給残日数がありません。");
                                                                    return;
                                                                }
                                                                handleCellChange(dateStr, 'workType', nextType);
                                                            }}
                                                            style={{ ...inputStyle, marginTop: "4px", fontSize: "12px", padding: "2px" }}
                                                        >
                                                            <option value="normal">出勤（平日）</option>
                                                            <option value="holiday_work">休日出勤</option>
                                                            <option value="paid_full">全休(有給)</option>
                                                            <option value="paid_half">半休(有給)</option>
                                                            <option value="absent">欠勤</option>
                                                        </select>
                                                    </td>
                                                    <td style={{ ...tdTightStyle, color: "#94a3b8" }}>
                                                        <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(入)</span>
                                                        {row.csvIn || rowData.csv_entry_time || "--:--"}
                                                    </td>
                                                    <td style={{ ...tdSpacerStyle, color: "#94a3b8" }}>
                                                        <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(出)</span>
                                                        {row.csvOut || rowData.csv_exit_time || "--:--"}
                                                    </td>
                                                    <td colSpan={2} style={{ ...tdTightStyle, fontSize: "11px", color: "#bdc3c7" }}>
                                                        休憩(CSV): {rowData.csv_break_start || "--:--"} ~ {rowData.csv_break_end || "--:--"}
                                                    </td>
                                                    <td colSpan={2} style={{ ...tdTightStyle, fontSize: "11px", color: "#bdc3c7" }}>
                                                        外出(CSV): {rowData.csv_out_time || "--:--"} ~ {rowData.csv_return_time || "--:--"}
                                                    </td>
                                                    <td rowSpan={3} style={{ ...tdStyle, width: "120px", borderLeft: "1px solid #eee", textAlign: "center" }}>
                                                        <div style={{ fontWeight: "bold", color: row.isSaved ? (row.savedHours > 8 ? "#e74c3c" : "#2ecc71") : "#3498db" }}>
                                                            {row.isSaved ? `${Math.floor(row.savedHours)}h ${Math.round((row.savedHours % 1) * 60)}m` : (isAllInputValid ? `🚀 ${currentHours}h` : "-")}
                                                        </div>
                                                        {row.isSaved && row.nightHours > 0 && (
                                                            <div style={{ fontSize: "10px", color: "#9b59b6" }}>深夜: {row.nightHours}h</div>
                                                        )}
                                                    </td>
                                                    <td rowSpan={3} style={{ ...tdStyle, textAlign: "center", width: "100px", borderLeft: "1px solid #eee" }}>
                                                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center" }}>
                                                            
                                                            {/* 【保存 / 更新】ボタン */}
                                                            {((isAllInputValid) || row.workType !== "normal") && hasChange && (
                                                                <button 
                                                                    style={!row.isSaved ? modernIconBtnStyle("#3498db") : modernIconBtnStyle("#27ae60")} 
                                                                    onClick={() => saveAttendance(dateStr)}
                                                                >
                                                                    {/* 🆕 row.isSaved を見ることで、保存直後に「更新」に変わります */}
                                                                    {!row.isSaved ? "保存" : "更新"}
                                                                </button>
                                                            )}

                                                            {/* 【戻る】ボタン */}
                                                            {/* 🆕 変更があり、かつ元々保存されていたデータがある場合のみ表示 */}
                                                            {hasChange && row.isSaved && (
                                                                <button 
                                                                    style={modernIconBtnStyle("#e67e22")} 
                                                                    onClick={() => revertAttendance(dateStr)}
                                                                >
                                                                    戻る
                                                                </button>
                                                            )}

                                                            {/* 🆕 変更がない時は「✅ 保存済」と出すと、ユーザーが安心します */}
                                                            {row.isSaved && !hasChange && (
                                                                <span style={{ color: "#2ecc71", fontSize: "11px", fontWeight: "bold" }}>
                                                                    ✅ 保存済
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>

                                                <tr style={{ 
                                                    backgroundColor: (row.workType === "paid_full" || row.workType === "absent") ? "#f9f9f9" : "#fff",
                                                    opacity: (row.workType === "paid_full" || row.workType === "absent") ? 0.5 : 1,
                                                    pointerEvents: (row.workType === "paid_full" || row.workType === "absent") ? "none" : "auto"
                                                }}>
                                                    <td style={tdTightStyle}><TimeInputPair value={row.in} onChange={val => handleCellChange(dateStr, 'in', val)} /></td>
                                                    <td style={tdSpacerStyle}><TimeInputPair value={row.out} onChange={val => handleCellChange(dateStr, 'out', val)} /></td>
                                                    <td style={tdTightStyle}><TimeInputPair value={row.bStart} onChange={val => handleCellChange(dateStr, 'bStart', val)} /></td>
                                                    <td style={tdSpacerStyle}><TimeInputPair value={row.bEnd} onChange={val => handleCellChange(dateStr, 'bEnd', val)} /></td>
                                                    <td style={tdTightStyle}><TimeInputPair value={row.outTime} onChange={val => handleCellChange(dateStr, 'outTime', val)} /></td>
                                                    <td style={tdSpacerStyle}>
                                                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                                            <TimeInputPair value={row.returnTime} onChange={val => handleCellChange(dateStr, 'returnTime', val)} />
                                                            <div style={{ textAlign: "center", borderLeft: "1px solid #eee", paddingLeft: "8px", pointerEvents: "auto" }}>
                                                                <span style={{ fontSize: "9px", display: "block", color: "#7f8c8d" }}>有給h</span>
                                                                <input type="number" step="0.5" value={row.paidHours} onChange={e => handleCellChange(dateStr, 'paidHours', e.target.value)} style={{ width: "35px", fontSize: "11px", border: "1px solid #ddd" }} />
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>

                                                <tr style={{ backgroundColor: "#fdfdfd", borderBottom: "1px solid #eee" }}>
                                                    <td colSpan={6} style={{ padding: "6px 12px", pointerEvents: "auto" }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: "4px", width: "100%" }}>
                                                            <span style={{ 
                                                                fontSize: "11px", 
                                                                color: "#94a3b8", 
                                                                fontWeight: "bold",
                                                                whiteSpace: "nowrap", // ✨ これが重要！「備」と「考」を絶対に分かれないようにします
                                                                flexShrink: 0         // ✨ ラベルが潰されないように死守します
                                                            }}>
                                                                備考：
                                                            </span>
                                                            <input 
                                                                type="text" 
                                                                placeholder="理由、遅刻・早退の内容など" 
                                                                value={row.memo || ""}
                                                                onChange={e => handleCellChange(dateStr, 'memo', e.target.value)}
                                                                style={{ 
                                                                    flex: 1,          // ✨ 残りの横幅をすべて入力欄に割り当てます
                                                                    fontSize: "12px", 
                                                                    border: "none", 
                                                                    borderBottom: "1px dashed #cbd5e1", 
                                                                    background: "transparent", 
                                                                    outline: "none",
                                                                    minWidth: 0       // ✨ inputが親を突き破るのを防ぎます
                                                                }}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>

                            <div style={{ 
                                marginTop: "20px", 
                                padding: "20px", 
                                backgroundColor: "#2c3e50", 
                                color: "white", 
                                borderRadius: "12px",
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr 1fr 1fr 1.5fr", 
                                gap: "15px"
                            }}>
                                <div>
                                    <div style={{ fontSize: "12px", color: "#bdc3c7" }}>基本情報</div>
                                    <div style={{ fontSize: "18px", fontWeight: "bold" }}>{attendanceRowsForCalc.length}日 / {formatHours(totalHours)}</div>
                                    {/* 🆕 月給制の場合は本来の額面を小さく表示 */}
                                    {staffInfo?.wage_type === "monthly" && (
                                        <div style={{ fontSize: "11px", color: "#95a5a6" }}>月給: ¥{Number(staffInfo.base_wage).toLocaleString()}</div>
                                    )}
                                </div>
                                
                                <div>
                                    <div style={{ fontSize: "12px", color: "#e74c3c" }}>残業合計 (割増込)</div>
                                    <div style={{ fontSize: "18px", fontWeight: "bold", color: "#e74c3c" }}>
                                        {formatHours(totalOvertimeHours)}
                                    </div>
                                    {over60Hours > 0 && (
                                        <div style={{ fontSize: "11px", color: "#ff7675" }}> 
                                            {/* 🆕 60 という数字と、50% という数字を定数から算出 */}
                                            (うち{OVERTIME_PREMIUM_LIMIT_HOURS}h超 [{(OVERTIME_PREMIUM_RATE - 1) * 100}%増]: {formatHours(over60Hours)}) 
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div style={{ fontSize: "12px", color: "#f1c40f" }}>深夜合計</div>
                                    <div style={{ fontSize: "18px", fontWeight: "bold", color: "#f1c40f" }}>{formatHours(totalNightHours)}</div>
                                </div>

                                {/* 🆕 欠勤控除がある場合はここを表示、なければ交通費を表示 */}
                                <div>
                                    {calcResult && calcResult.absenceDeduction > 0 ? (
                                        <>
                                            <div style={{ fontSize: "12px", color: "#ff7675" }}>欠勤控除</div>
                                            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#ff7675" }}>
                                                -¥{calcResult.absenceDeduction.toLocaleString()}
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ fontSize: "12px", color: "#bdc3c7" }}>交通費</div>
                                            <div style={{ fontSize: "18px", fontWeight: "bold" }}>¥{totalCommute.toLocaleString()}</div>
                                        </>
                                    )}
                                </div>

                                <div style={{ borderLeft: "1px solid #7f8c8d", paddingLeft: "20px", textAlign: "right" }}>
                                    <div style={{ fontSize: "12px", color: "#2ecc71" }}>💰 差引総支給額（概算）</div>
                                    <div style={{ fontSize: "28px", fontWeight: "bold", color: "#2ecc71" }}>
                                        ¥{totalPay.toLocaleString()}
                                    </div>
                                    {/* 🆕 補足: 交通費が含まれていることを明記 */}
                                    <div style={{ fontSize: "10px", color: "#95a5a6" }}>※残業・深夜・交通費・控除を反映済</div>
                                </div>
                            </div>
                        </section>
                        </>
                    ) : null}
                </>
            )}
        </div>
    );
}