import { useState, useEffect } from "react";
// 🆕 calculateSalary を追加（ファイルパスは作成した場所に合わせて調整してください）
import { calcDetailedDiff, modernIconBtnStyle, formatHours, generateAttendanceCSV, parseAttendanceCSV } from "./utils";
import { calculateSalary } from "./calcSalary";

// 将来的にDBから読み込む設定値（関数の外でも内でも良いですが、まずはここでOK）
const PAYROLL_SETTINGS = {
    OVERTIME_THRESHOLD: 8,      // 何時間を超えたら残業か
    OVERTIME_RATE: 1.25,        // 残業代の倍率
};

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
    const [selectedStaffId, setSelectedStaffId] = useState("");
    const [monthlyWorkData, setMonthlyWorkData] = useState<Record<string, any>>({});
    const [companySettings, setCompanySettings] = useState<any>(null);
    const [branchPrefecture, setBranchPrefecture] = useState<string>("東京");

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

    // 4. トグル関数
    const toggleFilter = (val: string) => {
        setActiveFilters(prev => 
            prev.includes(val) 
                ? prev.filter(v => v !== val) // すでにあれば削除
                : [...prev, val]              // なければ追加
        );
    };

    const handleExportCSV = async () => {
        if (!db) return;
        
        // YYYY-MM- の形式を作成
        const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-`;
        
        try {
            // 1. DBからその月の全スタッフデータを取得
            const data = await db.select(`
                SELECT a.*, s.name as staff_name 
                FROM attendance a
                JOIN staff s ON a.staff_id = s.id
                WHERE a.work_date LIKE ?
                ORDER BY a.staff_id, a.work_date
            `, [`${monthStr}%`]) as any[];

            if (!data || data.length === 0) {
                alert("出力するデータがありません。");
                return;
            }

            // 2. utilsの関数でCSV文字列に変換
            const csvContent = generateAttendanceCSV(data);
            
            // 3. ブラウザにダウンロードさせる
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `勤怠データ_${targetYear}年${targetMonth}月.csv`;
            link.click();
            
            // メモリ解放
            URL.revokeObjectURL(url);
            
        } catch (e) {
            console.error("CSV出力エラー:", e);
            alert("エクスポート中にエラーが発生しました。");
        }
    };

    const handleImportCSV = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';

        input.onchange = async (e: any) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const text = event.target?.result as string;
                    const rows = parseAttendanceCSV(text);
                    
                    console.log(`${rows.length}件のインポートを開始します...`);

                    for (const row of rows) {
                        console.log("Row Object:", row);

                        const sId = row["スタッフID"];
                        const date = row["日付"];
                        
                        if (!sId || !date) {
                            console.warn("スキップ：スタッフIDまたは日付がありません", row);
                            continue;
                        }

                        // 🆕 ここを追加！ スタッフ情報を特定する
                        const staff = staffList.find(s => String(s.id) === String(sId));
                        if (!staff) {
                            console.warn(`スキップ：ID ${sId} のスタッフがマスタに存在しません`);
                            continue;
                        }

                        const { total, night } = calcDetailedDiff(
                            row["出勤"], row["退勤"], row["休憩開始"], row["休憩終了"], row["外出"], row["戻り"]
                        );

                        await db.execute("DELETE FROM attendance WHERE staff_id = ? AND work_date = ?", [sId, date]);
                        await db.execute(
                            `INSERT INTO attendance (
                                staff_id, work_date, entry_time, exit_time, 
                                break_start, break_end, out_time, return_time, 
                                work_hours, night_hours,
                                actual_base_wage, overtime_rate, night_rate
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                sId, date, row["出勤"] || "", row["退勤"] || "", 
                                row["休憩開始"] || "", row["休憩終了"] || "", 
                                row["外出"] || "", row["戻り"] || "", 
                                Number(total), Number(night), 
                                staff.base_wage, 1.25, 0.25 // staff が見つかっていればOK
                            ]
                        );
                    }
                    console.log("インポートが完了しました。画面を更新します。");
                    loadMonthlyData(); 
                } catch (err) {
                    console.error("エラー:", err);
                }
            };
            reader.readAsText(file);
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
                    setBranchPrefecture(branchData[0].prefecture.replace(/[都道府県]$/, "") || "東京");
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
                        night_rate: row.night_rate || 0.25
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

        // --- 🆕 48時間上限バリデーション ---
        const isOver48 = (timeStr: string) => {
            if (!timeStr || !timeStr.includes(":")) return false;
            const h = parseInt(timeStr.split(":")[0], 10);
            return h >= 48; // 48:00ちょうど、またはそれ以上ならアウト
        };

        const targetTimes = [row.in, row.out, row.bStart, row.bEnd, row.outTime, row.returnTime];
        if (targetTimes.some(isOver48)) {
            alert("48:00以上の時間は入力できません。他社ソフトの仕様に合わせ、上限は47:59までとしています。");
            return;
        }
        // ---------------------------------

        if (!row.in || !row.out) {
            alert("出勤・退勤時間を入力してください。");
            return;
        }

        // 計算結果を取得
        const { total, night } = calcDetailedDiff(row.in, row.out, row.bStart, row.bEnd, row.outTime, row.returnTime);

        try {
            // 一旦消して
            await db.execute("DELETE FROM attendance WHERE staff_id = ? AND work_date = ?", [selectedStaffId, date]);
            
            const isMonthly = currentStaff.wage_type === "monthly";

            await db.execute(
                `INSERT INTO attendance (
                    staff_id, work_date, entry_time, exit_time, 
                    break_start, break_end, out_time, return_time, 
                    work_hours, night_hours,
                    actual_base_wage, overtime_rate, night_rate
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    selectedStaffId, date, row.in||"", row.out||"", 
                    row.bStart||"", row.bEnd||"", row.outTime||"", row.returnTime||"", 
                    Number(total), Number(night),
                    // ✅ 月給制なら 0 (または NULL)、時給制なら base_wage を入れる
                    isMonthly ? 0 : currentStaff.base_wage, 
                    PAYROLL_SETTINGS.OVERTIME_RATE,
                    0.25
                ]
            );

            setMonthlyWorkData(prev => ({ 
                ...prev, 
                [date]: { 
                    ...prev[date], 
                    isSaved: true, 
                    savedHours: Number(total), 
                    nightHours: Number(night),
                    actual_base_wage: isMonthly ? 0 : currentStaff.base_wage
                } 
            }));
        } catch (e) {
            // 1. 開発者向け：コンソールに詳細を出力（原因特定が早まります）
            console.error("【保存エラー詳細】", {
                date,
                staffId: selectedStaffId,
                error: e
            });

            // 2. ユーザー向け：状況に合わせたメッセージ
            // SQLiteなどの制約違反や接続エラーを想定
            const errorMessage = e instanceof Error ? e.message : String(e);
            
            alert(
                "❌ 保存できませんでした\n\n" +
                "理由: " + errorMessage + "\n\n" +
                "ネット接続を確認するか、ブラウザを再読み込みして再度お試しください。"
            );
        }
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
    const over60Hours = Math.max(0, totalOvertimeHours - 60);

    return (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
            <h2 style={{ color: "#2c3e50" }}>📅 勤務記録・給与集計</h2>
            {/* ... (中略：年月選択、スタッフ選択) ... */}
            <div style={{ display: "flex", gap: "20px", alignItems: "center", marginTop: "15px", borderTop: "1px solid #eee", paddingTop: "15px" }}>
                <div>
                    <label style={labelStyle}>対象年月</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <select value={targetYear} onChange={e => setTargetYear(Number(e.target.value))} style={{ ...inputStyle, width: "100px" }}>
                            {[2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}年</option>)}
                        </select>
                        <select value={targetMonth} onChange={e => setTargetMonth(Number(e.target.value))} style={{ ...inputStyle, width: "80px" }}>
                            {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}月</option>))}
                        </select>
                    </div>
                </div>
                <button onClick={() => { const d = new Date(); setTargetYear(d.getFullYear()); setTargetMonth(d.getMonth() + 1); }} style={{ ...modernIconBtnStyle("#7f8c8d"), marginTop: "15px" }}>今月に戻る</button>
                {/* 🆕 ここに一括操作ボタンを追加 */}
                <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
                    <button 
                        onClick={handleExportCSV} // 紐付け！
                        style={modernIconBtnStyle("#34495e")}
                    >
                        📤 CSV出力
                    </button>
                    <button 
                        onClick={handleImportCSV} // 🆕 紐付け
                        style={modernIconBtnStyle("#2980b9")}
                    >
                        📥 CSV取込
                    </button>
                </div>
            </div>

            {/* 🆕 従業員選択・フィルタ・一括保存セクション */}
            <section style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "stretch", // 高さを揃える
                gap: "20px", 
                marginBottom: "25px", 
                marginTop: "20px"
            }}>
                {/* 左側：従業員選択カード（フィルタ機能付き） */}
                <div style={{ ...cardStyle, flex: "1", margin: 0, borderTop: "4px solid #3498db", display: "flex", flexDirection: "column", gap: "12px" }}>
                    
                    {/* フィルタボタン群 */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "12px", fontWeight: "bold", color: "#7f8c8d" }}>表示:</span>
                        {statusOptions.map(opt => {
                            const isActive = activeFilters.includes(opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => toggleFilter(opt.value)}
                                    style={{
                                        padding: "4px 12px",
                                        borderRadius: "15px",
                                        border: `1px solid ${opt.color}`,
                                        backgroundColor: isActive ? opt.color : "white",
                                        color: isActive ? "white" : opt.color,
                                        cursor: "pointer",
                                        fontSize: "11px",
                                        fontWeight: "bold",
                                        transition: "0.2s"
                                    }}
                                >
                                    {isActive ? "✅ " : ""}{opt.label}
                                </button>
                            );
                        })}
                        <button
                            onClick={() => setActiveFilters(["active", "on_leave", "retired"])}
                            style={{
                                padding: "4px 12px",
                                borderRadius: "15px",
                                border: "1px solid #95a5a6",
                                backgroundColor: "white",
                                color: "#7f8c8d",
                                cursor: "pointer",
                                fontSize: "11px"
                            }}
                        >
                            全員
                        </button>
                    </div>

                    {/* 従業員選択プルダウン */}
                    <div>
                        <label style={labelStyle}>対象の従業員を選択</label>
                        <select 
                            value={selectedStaffId} 
                            onChange={e => setSelectedStaffId(e.target.value)} 
                            style={{ ...inputStyle, fontSize: "16px", fontWeight: "bold" }}
                        >
                            <option value="">-- {activeFilters.length === 0 ? "表示をオンにしてください" : "従業員を選んでください"} --</option>
                            {filteredStaffList.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.id}: {s.name} ({s.status === 'active' ? '在籍' : s.status === 'retired' ? '退職' : '休職'})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* 右側：一括保存ボタン（配置バランスのため位置調整） */}
                <div style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end", paddingBottom: "10px" }}>
                    {selectedStaffId && (
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
                                height: "fit-content",
                                padding: "12px 20px"
                            }}
                        >
                            📂 今月の未保存分をすべて保存
                        </button>
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
                                <th style={{ ...thStyle, paddingRight: "30px" }}>退勤</th> {/* 隙間 */}
                                <th style={thStyle}>休憩開始</th>
                                <th style={{ ...thStyle, paddingRight: "30px" }}>休憩終了</th> {/* 隙間 */}
                                <th style={thStyle}>外出</th>
                                <th style={{ ...thStyle, paddingRight: "30px" }}>戻り</th> {/* 隙間 */}
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
                                    isSaved: rowData.isSaved || false,
                                    savedHours: Number(rowData.savedHours) || 0
                                };

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
                                    <tr key={dateStr} style={{ 
                                        borderBottom: "1px solid #f2f2f2", 
                                        backgroundColor: dayOfWeek === "日" ? "#fff5f5" : dayOfWeek === "土" ? "#f5faff" : "transparent" 
                                    }}>
                                        <td style={{ ...tdStyle, fontWeight: "bold" }}>{day}日 ({dayOfWeek})</td>
                                        <td style={tdTightStyle}><TimeInputPair value={row.in} onChange={val => handleCellChange(dateStr, 'in', val)} /></td>
                                        <td style={tdSpacerStyle}><TimeInputPair value={row.out} onChange={val => handleCellChange(dateStr, 'out', val)} /></td>
                                        <td style={tdTightStyle}><TimeInputPair value={row.bStart} onChange={val => handleCellChange(dateStr, 'bStart', val)} /></td>
                                        <td style={tdSpacerStyle}><TimeInputPair value={row.bEnd} onChange={val => handleCellChange(dateStr, 'bEnd', val)} /></td>
                                        <td style={tdTightStyle}><TimeInputPair value={row.outTime} onChange={val => handleCellChange(dateStr, 'outTime', val)} /></td>
                                        <td style={tdSpacerStyle}><TimeInputPair value={row.returnTime} onChange={val => handleCellChange(dateStr, 'returnTime', val)} /></td>

                                        <td style={{ ...tdStyle, width: "140px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", height: "45px" }}>
                                                {rowData.isSaved && !hasChange ? (
                                                    /* 親要素に relative を指定し、高さを固定（例: 45px） */
                                                    <div style={{ 
                                                        position: "relative", 
                                                        height: "45px", 
                                                        display: "flex", 
                                                        alignItems: "center" 
                                                    }}>
                                                        
                                                        {/* メインの行（チェックと実働時間） */}
                                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                            <span style={{ fontSize: "14px", display: "flex", alignItems: "center" }}>✅</span>
                                                            
                                                            <div style={{ 
                                                                color: row.savedHours > PAYROLL_SETTINGS.OVERTIME_THRESHOLD ? "#e74c3c" : "#2ecc71", 
                                                                fontWeight: "bold",
                                                                display: "flex",
                                                                alignItems: "baseline",
                                                                lineHeight: "1"
                                                            }}>
                                                                <span style={{ fontSize: "16px" }}>{Math.floor(row.savedHours)}</span>
                                                                <span style={{ fontSize: "10px", marginLeft: "2px", marginRight: "4px" }}>時間</span>
                                                                <span style={{ fontSize: "16px" }}>{Math.round((row.savedHours % 1) * 60)}</span>
                                                                <span style={{ fontSize: "10px", marginLeft: "2px" }}>分</span>
                                                            </div>
                                                        </div>

                                                        {/* 🆕 残業チップ：単位を小さくして表示 */}
                                                        {row.savedHours > PAYROLL_SETTINGS.OVERTIME_THRESHOLD && (
                                                            <div style={{ 
                                                                position: "absolute",
                                                                top: "31px",
                                                                left: "20px",
                                                                fontSize: "9px", // チップ全体の基準サイズ
                                                                color: "#e74c3c", 
                                                                backgroundColor: "#fff5f5", 
                                                                padding: "0px 4px", 
                                                                borderRadius: "3px", 
                                                                border: "1px solid #ffcccc",
                                                                whiteSpace: "nowrap",
                                                                display: "flex",        // 🆕 横並び
                                                                alignItems: "baseline"  // 🆕 下端揃え
                                                            }}>
                                                                <span style={{ marginRight: "3px" }}>残業</span>
                                                                
                                                                {/* 時間の数字 */}
                                                                <span style={{ fontSize: "10px", fontWeight: "bold" }}>
                                                                    {Math.floor(row.savedHours - PAYROLL_SETTINGS.OVERTIME_THRESHOLD)}
                                                                </span>
                                                                {/* 時間の単位（さらに小さく） */}
                                                                <span style={{ fontSize: "8px", marginLeft: "1px", marginRight: "2px" }}>時間</span>
                                                                
                                                                {/* 分の数字 */}
                                                                <span style={{ fontSize: "10px", fontWeight: "bold" }}>
                                                                    {Math.round(((row.savedHours - PAYROLL_SETTINGS.OVERTIME_THRESHOLD) % 1) * 60)}
                                                                </span>
                                                                {/* 分の単位（さらに小さく） */}
                                                                <span style={{ fontSize: "8px", marginLeft: "1px" }}>分</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    // --- 未保存（入力中）状態 ---
                                                    <div style={{ fontSize: "13px" }}>
                                                        {isEmpty ? (
                                                            <span style={{ color: "#bdc3c7" }}>-</span>
                                                        ) : isTimeRangeError ? (
                                                            // 🆕 矛盾がある時は赤字で警告！
                                                            <span style={{ color: "#e74c3c", fontWeight: "bold" }}>⚠️ 時間枠不正</span>
                                                        ) : isAllInputValid ? (
                                                            // 🆕 🚀 の色を時間によって変え、24時間を超えたら警告ラベルを出す
                                                            <span style={{ 
                                                                color: Number(currentHours) > 16 ? "#e67e22" : "#3498db", 
                                                                fontWeight: "bold" 
                                                            }}>
                                                                🚀 {currentHours}h
                                                                {Number(currentHours) > 24 && (
                                                                    <span style={{ 
                                                                        marginLeft: "4px", 
                                                                        fontSize: "10px", 
                                                                        backgroundColor: "#fff7ed", 
                                                                        color: "#ea580c", 
                                                                        padding: "1px 4px", 
                                                                        borderRadius: "4px",
                                                                        border: "1px solid #ffedd5"
                                                                    }}>
                                                                        長時間
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: "#bdc3c7", fontStyle: "italic" }}>
                                                                {isBreakIncomplete ? "休憩入力待ち..." : 
                                                                isOutIncomplete ? "外出入力待ち..." : 
                                                                !isBaseComplete ? "入力中..." : "保存できます"}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </td>

                                        <td style={{ ...tdStyle, textAlign: "center", width: "120px" }}>
                                            <div style={{ display: "flex", gap: "4px", justifyContent: "center", minHeight: "30px", alignItems: "center" }}>
                                                
                                                {/* 【更新・保存ボタン】: 整合性が完璧な時だけ出す */}
                                                {isAllInputValid && hasChange && (
                                                    <button 
                                                        style={row.savedHours === 0 ? modernIconBtnStyle("#3498db") : modernIconBtnStyle("#27ae60")} 
                                                        onClick={() => saveAttendance(dateStr)}
                                                    >
                                                        {row.savedHours === 0 ? "保存" : "更新"}
                                                    </button>
                                                )}

                                                {/* 【戻るボタン】: 
                                                    重要：isAllInputValid に依存させない！
                                                    「一度保存された実績(savedHours > 0)があり」かつ「変更(hasChange)がある」なら、
                                                    入力が途中（分がまだ、等）でも常に表示する。 */}
                                                {hasChange && row.savedHours > 0 && (
                                                    <button 
                                                        style={modernIconBtnStyle("#e67e22")} 
                                                        onClick={() => revertAttendance(dateStr)}
                                                    >
                                                        戻る
                                                    </button>
                                                )}
                                                
                                            </div>
                                        </td>
                                    </tr>
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
                                <div style={{ fontSize: "11px", color: "#ff7675" }}> (うち50%増: {formatHours(over60Hours)}) </div>
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
            ) : (
                <div style={{ ...cardStyle, textAlign: "center", padding: "60px 20px", border: "2px dashed #cbd5e1", color: "#94a3b8" }}>
                    <div style={{ fontSize: "50px" }}>👤👈</div>
                    <h3>従業員を選択してください</h3>
                </div>
            )}
        </div>
    );
}