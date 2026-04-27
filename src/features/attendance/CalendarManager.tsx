import React, { useState, useEffect } from "react";
import Database from "@tauri-apps/plugin-sql";
import { fetch } from "@tauri-apps/plugin-http";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Pencil, Trash2, Check, X, Plus, RotateCw, FileUp, AlertTriangle } from 'lucide-react';
import { HOLIDAY_CSV_URL_DEFAULT } from "../../constants/salaryMaster2026";

interface CalendarManagerProps {
    db: Database;
}

// --- 型定義を更新 ---
interface CalendarPattern {
    id: number;
    name: string;
    is_invalid: number;
}

const CalendarManager: React.FC<CalendarManagerProps> = ({ db }) => {
    const [csvUrl, setCsvUrl] = useState("");
    const [year, setYear] = useState(2026);
    const [loading, setLoading] = useState(false);
    const [holidays, setHolidays] = useState<Record<string, string>>({});
    const [companyHolidays, setCompanyHolidays] = useState<Record<string, number>>({});
    const [patterns, setPatterns] = useState<CalendarPattern[]>([]);
    const [currentPatternId, setCurrentPatternId] = useState<number>(1); // 初期値は「標準」
    const [weekStartDay, setWeekStartDay] = useState(0); // ✨追加
    const [holidaySource, setHolidaySource] = useState<"url" | "file">("url"); 
    const [fixedCsvUrl, setFixedCsvUrl] = useState("");
    const [hasHeader, setHasHeader] = useState(true); // デフォルトは「あり」

    const [isAddingPattern, setIsAddingPattern] = useState(false);
    const [newPatternName, setNewPatternName] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState("");


    // 1. パターン一覧の読み込み（初回とパターン追加時に呼ぶ）
    const loadPatterns = async () => {
        try {
            // App.tsxで作られているはずなので、selectするだけでOK
            const res = await db.select<CalendarPattern[]>("SELECT id, name, is_invalid FROM calendar_patterns ORDER BY id ASC");
            setPatterns(res);
            
            // currentPatternId が未設定（初期状態）なら、最初のパターン（標準）を選択
            if (res.length > 0 && !currentPatternId) {
                setCurrentPatternId(res[0].id);
            }
        } catch (e) { 
            console.error(e); 
        }
    };

    // 2. カレンダーデータの読み込み（年、またはカレンダーパターンが変わった時に呼ぶ）
    const loadAllCalendarData = async () => {
        try {
            const resHolidays = await db.select<any[]>("SELECT holiday_date, name FROM holiday_master");
            const hMap: Record<string, string> = {};
            resHolidays.forEach((h) => { hMap[h.holiday_date.replaceAll("/", "-")] = h.name; });
            setHolidays(hMap);

            const resCompany = await db.select<any[]>(
                "SELECT work_date, is_holiday FROM company_calendar WHERE pattern_id = ?",
                [currentPatternId]
            );
            const cMap: Record<string, number> = {};
            resCompany.forEach((c) => { cMap[c.work_date] = c.is_holiday; });
            setCompanyHolidays(cMap);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        const init = async () => {
            try {
                // 🆕 holiday_source も select 対象に追加
                const res = await db.select<any[]>("SELECT holiday_csv_url, week_start_day, holiday_source FROM company WHERE id = 1");
                
                if (res && res.length > 0) {
                    const urlFromDb = res[0].holiday_csv_url;
                    
                    if (urlFromDb) {
                        setCsvUrl(urlFromDb);
                        setFixedCsvUrl(urlFromDb);
                    }
                    
                    if (res[0].week_start_day !== undefined) {
                        setWeekStartDay(res[0].week_start_day);
                    }

                    // 🆕 取得モード（url か file）をセット
                    if (res[0].holiday_source) {
                        setHolidaySource(res[0].holiday_source);
                    }
                }
                await loadPatterns();
            } catch (e) {
                console.error("Calendar init error:", e);
            }
        };
        init();
    }, [db]);

    // パターンや年が切り替わったらデータを再ロード
    useEffect(() => {
        loadAllCalendarData();
    }, [currentPatternId, year]);

    // --- ✨ 統計計算 & 労務バリデーションロジック ---
    const stats = { workDays: 0, holidayDays: 0 };
    const invalidWeeks: string[] = [];
    let currentWeekHolidays = 0;
    let weekStartDate = "";

    const getDaysInYear = () => {
        const days = [];
        for (let m = 0; m < 12; m++) {
            const date = new Date(year, m, 1);
            while (date.getMonth() === m) {
                days.push(new Date(date));
                date.setDate(date.getDate() + 1);
            }
        }
        return days;
    };

    getDaysInYear().forEach(d => {
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        
        // 週の区切りチェック（ここは変更なし）
        if (d.getDay() === weekStartDay) {
            if (weekStartDate !== "" && currentWeekHolidays === 0) {
                invalidWeeks.push(weekStartDate);
            }
            weekStartDate = dateKey;
            currentWeekHolidays = 0;
        }

        // --- 判定ロジックの修正 ---
        const isSunOrSat = d.getDay() === 0 || d.getDay() === 6;
        const setting = companyHolidays[dateKey]; // 個別設定 (0:出勤, 1:休日, undefined:設定なし)

        let isFinallyHoliday = false;

        if (setting !== undefined) {
            // A. 個別設定がある場合は、それを最優先する
            isFinallyHoliday = (setting === 1);
        } else {
            // B. 個別設定がない場合は、デフォルトのルール（土日のみ）に従う
            // ※ ここで !!holidays[dateKey] を見ないのがポイント！
            isFinallyHoliday = isSunOrSat;
        }
        // -----------------------

        if (isFinallyHoliday) {
            stats.holidayDays++;
            currentWeekHolidays++;
        } else {
            stats.workDays++;
        }
    });
    // 最後の週のチェック
    if (weekStartDate !== "" && currentWeekHolidays === 0) {
        invalidWeeks.push(weekStartDate);
    }

    const isLawful = invalidWeeks.length === 0;

    // ✨ 判定結果をDBに自動同期
    useEffect(() => {
        const syncStatus = async () => {
            const errorMsg = isLawful ? "" : `${invalidWeeks.length}箇所の休日不足`;
            await db.execute(
                "UPDATE calendar_patterns SET is_invalid = ?, error_message = ? WHERE id = ?",
                [isLawful ? 0 : 1, errorMsg, currentPatternId]
            );
            await loadPatterns();
        };
        if (currentPatternId) syncStatus();
    }, [isLawful, currentPatternId, db]);

    // 3. 日付の切り替え（pattern_id を考慮）
    const toggleDay = async (dateKey: string) => {
        const d = new Date(dateKey);
        const isDefaultHoliday = (d.getDay() === 0 || d.getDay() === 6 || !!holidays[dateKey]);
        const currentStatus = companyHolidays[dateKey]; 

        if (currentStatus === undefined) {
            // デフォルト（土日祝）なら「出勤(0)」へ、平日なら「休日(1)」へ
            const newStatus = isDefaultHoliday ? 0 : 1;
            
            // 💡 INSERT OR REPLACE を使うことで、もし既にデータがあっても上書きしてエラーを防ぎます
            await db.execute(
                "INSERT OR REPLACE INTO company_calendar (pattern_id, work_date, is_holiday) VALUES (?, ?, ?)", 
                [currentPatternId, dateKey, newStatus]
            );
        } else {
            // 💡 設定がある場合は削除（デフォルトの状態に戻す）
            await db.execute(
                "DELETE FROM company_calendar WHERE pattern_id = ? AND work_date = ?", 
                [currentPatternId, dateKey]
            );
        }
        await loadAllCalendarData();
    };

    const processCsvData = async (csvText: string) => {
        const cleanText = csvText.replace(/^\uFEFF/, "");
        const lines = cleanText.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l !== "");
        
        // 🆕 インポート前に、表示中の年の祝日データを一度リセットする
        // holiday_master からその年のデータを削除
        await db.execute(
            "DELETE FROM holiday_master WHERE holiday_date LIKE ?",
            [`${year}-%`]
        );
        // company_calendar からその年の祝日設定(is_holiday=1)を削除
        await db.execute(
            "DELETE FROM company_calendar WHERE pattern_id = ? AND work_date LIKE ? AND is_holiday = 1",
            [currentPatternId, `${year}-%`]
        );

        const startIndex = hasHeader ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
            const columns = lines[i].split(",");
            if (columns.length < 2) continue;

            const dateStr = columns[0].replace(/"/g, "").trim();
            const name = columns[1].replace(/"/g, "").trim();
            
            // 日付のパース（ここは既存のまま）
            const parts = dateStr.split("/");
            if (parts.length === 3) {
                const fDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                
                await db.execute(
                    "INSERT OR REPLACE INTO holiday_master (holiday_date, name) VALUES (?, ?)", 
                    [fDate, name]
                );

                await db.execute(
                    "INSERT OR REPLACE INTO company_calendar (pattern_id, work_date, is_holiday) VALUES (?, ?, 1)",
                    [currentPatternId, fDate]
                );
            }
        }
        await loadAllCalendarData();
    };

    // --- 祝日取得アクション (一つに統合) ---
    const handleFetchHolidays = async () => {
        setLoading(true);

        try {
            const res = await db.select("SELECT holiday_source, holiday_csv_url FROM company WHERE id = 1") as any[];
            const source = res[0]?.holiday_source || "url";
            const targetUrl = res[0]?.holiday_csv_url || fixedCsvUrl || HOLIDAY_CSV_URL_DEFAULT;

            if (source === "url") {
                // --- オンライン取得モード ---
                const response = await fetch(targetUrl, { method: "GET" });
                const buffer = await response.arrayBuffer();
                // 内閣府はShift-JIS確定なのでそのまま
                await processCsvData(new TextDecoder("shift-jis").decode(new Uint8Array(buffer)));
            } else {
                // --- ローカルファイルモード ---
                const selected = await open({ 
                    multiple: false, 
                    filters: [{ name: "CSV", extensions: ["csv"] }] 
                });
                if (!selected) return;
                const fileData = await readFile(selected as string);
                
                // 🆕 文字コードの自動判別ロジック
                let decodedText = "";
                try {
                    // 1. まずは UTF-8 で試みる (fatal: true で失敗を検知)
                    decodedText = new TextDecoder("utf-8", { fatal: true }).decode(fileData);
                } catch (e) {
                    // 2. UTF-8 で失敗したら Shift-JIS (CP932) でデコード
                    console.log("UTF-8 decode failed, trying Shift-JIS...");
                    decodedText = new TextDecoder("shift-jis").decode(fileData);
                }
                
                await processCsvData(decodedText);
            }
        } catch (e) {
            console.error(e);
            alert("祝日データの取得に失敗しました。ファイルが壊れているか、形式が違います。");
        } finally {
            setLoading(false);
        }
    };

    const getDaysInMonth = (y: number, m: number) => {
        const date = new Date(y, m, 1);
        const days = [];
        while (date.getMonth() === m) {
            days.push(new Date(date));
            date.setDate(date.getDate() + 1);
        }
        return days;
    };

    // --- 新規パターンの保存処理 ---
    const handleSavePattern = async () => {
        if (!newPatternName.trim()) return;

        try {
            await db.execute("INSERT INTO calendar_patterns (name) VALUES (?)", [newPatternName.trim()]);
            await loadPatterns(); 
            setNewPatternName(""); // 入力欄を空にする
            setIsAddingPattern(false); // 入力モードを閉じる
        } catch (e) {
            console.error(e);
            alert("パターンの追加に失敗しました。");
        }
    };

    // --- パターン名の変更保存 ---
    const handleUpdateName = async () => {
        if (!editName.trim()) return;
        try {
            await db.execute("UPDATE calendar_patterns SET name = ? WHERE id = ?", [editName.trim(), currentPatternId]);
            await loadPatterns();
            setIsEditing(false);
        } catch (e) { console.error(e); }
    };

    // --- パターンの削除 ---
    const handleDeletePattern = async () => {
        if (currentPatternId === 1) {
            alert("「標準」パターンは削除できません。");
            return;
        }

        // ✨ window.confirm を ask に置き換え
        const ok = await ask(
            "このカレンダーパターンを削除しますか？\n（このパターンを使用している従業員の設定に影響が出る場合があります）",
            { 
                title: 'パターンの削除確認', 
                kind: 'warning',
                okLabel: '削除する',
                cancelLabel: 'キャンセル'
            }
        );

        if (!ok) return;

        try {
            await db.execute("DELETE FROM calendar_patterns WHERE id = ?", [currentPatternId]);
            setCurrentPatternId(1); // 削除したら標準に戻す
            await loadPatterns();
        } catch (e) { 
            console.error(e);
            alert("パターンの削除に失敗しました。");
        }
    };

    return (
        <div style={{ padding: "20px", color: "#2c3e50" }}>
            {/* 1. ヘッダー：年選択と祝日取得ボタンのみ */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "25px" }}>
                {/* 左側：年選択 */}
                <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                    <div style={{ 
                        display: "flex", alignItems: "center", gap: "10px", 
                        backgroundColor: "#fff", padding: "5px 15px", borderRadius: "8px", 
                        border: "1px solid #e2e8f0", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" 
                    }}>
                        <button onClick={() => setYear(year - 1)} style={navBtnStyle}>◀</button>
                        <span style={{ fontWeight: "bold", fontSize: "1.2rem", width: "70px", textAlign: "center" }}>{year}年</span>
                        <button onClick={() => setYear(year + 1)} style={navBtnStyle}>▶</button>
                    </div>
                </div>

                {/* 右側：設定（ファイルモード時のみ）と実行ボタンをまとめるグループ */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {holidaySource === "file" && (
                        <label style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            gap: "6px", 
                            fontSize: "0.85rem", 
                            cursor: "pointer", 
                            color: "#64748b",
                            userSelect: "none" // テキスト選択を防いでボタン感を出す
                        }}>
                            <input 
                                type="checkbox" 
                                checked={hasHeader} 
                                onChange={(e) => setHasHeader(e.target.checked)} 
                                style={{ cursor: "pointer", width: "16px", height: "16px" }}
                            />
                            1行目は見出し
                        </label>
                    )}

                    <button 
                        onClick={handleFetchHolidays}
                        disabled={loading}
                        style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            backgroundColor: holidaySource === 'url' ? "#3498db" : "#2ecc71",
                            color: "white", border: "none", padding: "10px 20px", borderRadius: "8px",
                            cursor: "pointer", fontWeight: "bold", transition: "opacity 0.2s"
                        }}
                    >
                        {loading ? <RotateCw size={18} className="animate-spin" /> : (holidaySource === 'url' ? <RotateCw size={18} /> : <FileUp size={18} />)}
                        {holidaySource === 'url' ? "最新の祝日を取得" : "祝日CSVを読み込む"}
                    </button>
                </div>
            </div>

            {/* 2. パターン管理 & 統計エリア */}
            <div style={patternContainerStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#94a3b8" }}>カレンダー形式:</span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                        {patterns.map((p) => {
                            const isSelected = currentPatternId === p.id;
                            const isError = p.is_invalid === 1;

                            if (isSelected && isEditing) {
                                return (
                                    <div key={p.id} style={editInputWrapper}>
                                        <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()} style={editInput} />
                                        <Check size={16} onClick={handleUpdateName} style={{ color: "#2ecc71", cursor: "pointer" }} />
                                        <X size={16} onClick={() => setIsEditing(false)} style={{ color: "#94a3b8", cursor: "pointer" }} />
                                    </div>
                                );
                            }

                            return (
                                <div key={p.id} style={{ display: "flex", alignItems: "center" }}>
                                    <button
                                        onClick={() => { setCurrentPatternId(p.id); setIsEditing(false); }}
                                        style={patternBtnStyle(isSelected, isError)}
                                    >
                                        {isError && <AlertTriangle size={14} style={{ marginRight: "4px" }} />}
                                        {p.name}
                                    </button>
                                    {isSelected && (
                                        <div style={actionBtnGroup}>
                                            <button onClick={() => { setEditName(p.name); setIsEditing(true); }} style={iconBtn}><Pencil size={14} /></button>
                                            {p.id !== 1 && (
                                                <button onClick={handleDeletePattern} style={{ ...iconBtn, color: "#e74c3c" }}><Trash2 size={14} /></button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {/* 🆕 追加ボタンと入力欄の切り替えロジック */}
                        {isAddingPattern ? (
                            <div style={editInputWrapper}>
                                <input 
                                    autoFocus 
                                    value={newPatternName} 
                                    onChange={(e) => setNewPatternName(e.target.value)} 
                                    onKeyDown={(e) => e.key === 'Enter' && handleSavePattern()} 
                                    placeholder="名称入力..." 
                                    style={editInput} 
                                />
                                <Check size={16} onClick={handleSavePattern} style={{ color: "#2ecc71", cursor: "pointer" }} />
                                <X size={16} onClick={() => { setIsAddingPattern(false); setNewPatternName(""); }} style={{ color: "#e74c3c", cursor: "pointer" }} />
                            </div>
                        ) : (
                            <button onClick={() => setIsAddingPattern(true)} style={addBtnStyle}>
                                <Plus size={14} /> 追加
                            </button>
                        )}
                    </div>
                </div>

                <div style={statsWrapper}>
                    {/* 🆕 労務アラートの追加 */}
                    <div style={{ 
                        fontSize: "0.8rem", 
                        padding: "4px 10px", 
                        borderRadius: "4px", 
                        backgroundColor: isLawful ? "#e8f8f5" : "#fdedec", 
                        color: isLawful ? "#27ae60" : "#e74c3c",
                        fontWeight: "bold",
                        border: `1px solid ${isLawful ? "#27ae60" : "#e74c3c"}`
                    }}>
                        {isLawful ? "✅ 法定休日遵守" : `⚠️ 休日不足 (${invalidWeeks.length}箇所)`}
                    </div>

                    <div style={{ fontSize: "0.85rem", color: "#7f8c8d" }}>稼働日数: <span style={{ fontWeight: "bold", fontSize: "1.2rem", color: "#2c3e50" }}>{stats.workDays}</span> 日</div>
                    <div style={{ fontSize: "0.85rem", color: "#7f8c8d" }}>休日数: <span style={{ fontWeight: "bold", fontSize: "1.2rem", color: "#e74c3c" }}>{stats.holidayDays}</span> 日</div>
                </div>
            </div>

            {/* 3. カレンダーグリッド */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                {Array.from({ length: 12 }, (_, m) => (
                    <div key={m} style={{ backgroundColor: "#fff", padding: "8px", borderRadius: "8px", border: "1px solid #eee" }}>
                        <div style={{ textAlign: "center", fontWeight: "bold", marginBottom: "8px", borderBottom: "1px solid #f8f9fa" }}>{m + 1}月</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" }}>
                            {Array.from({ length: new Date(year, m, 1).getDay() }).map((_, i) => <div key={`e-${i}`} />)}
                            {getDaysInMonth(year, m).map((d) => {
                                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                const hName = holidays[dateKey]; // 祝日名はマスタから取得（表示用）
                                const setting = companyHolidays[dateKey]; // 個別設定
                                const isSun = d.getDay() === 0;
                                const isSat = d.getDay() === 6;
                                // 判定ロジック：個別設定があればそれに従い、なければ土日かどうかだけ見る
                                const isFinallyHoliday = (setting !== undefined) ? (setting === 1) : (isSun || isSat);

                                let textColor = "#2c3e50";
                                if (hName || isSun) textColor = "#e74c3c";
                                else if (isSat) textColor = "#3498db";

                                return (
                                    <div 
                                        key={d.toISOString()} 
                                        onClick={() => toggleDay(dateKey)}
                                        title={hName || ""} // ここが「優しさ」ポイントです！
                                        style={{ 
                                            textAlign: "center", padding: "4px 0", borderRadius: "3px", fontSize: "0.75rem", cursor: "pointer",
                                            color: textColor,
                                            backgroundColor: isFinallyHoliday ? "#fadbd8" : "transparent",
                                            border: setting === undefined ? "1px solid transparent" : (setting === 1 ? "1px solid #e74c3c" : "1px solid #bdc3c7"),
                                            fontWeight: hName ? "bold" : "normal"
                                        }}
                                    >
                                        {d.getDate()}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Styles ---
const navBtnStyle = { border: "none", background: "none", cursor: "pointer", fontSize: "1rem", color: "#3498db", padding: "5px" };
const patternContainerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", padding: "15px 20px", backgroundColor: "#fff", borderRadius: "12px", borderLeft: "5px solid #3498db", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" };
const patternBtnStyle = (isSelected: boolean, isError: boolean) => ({
    display: "flex", alignItems: "center", padding: "6px 16px", borderRadius: isSelected ? "8px 0 0 8px" : "8px",
    border: "1px solid", borderColor: isSelected ? "#3498db" : "#e2e8f0",
    backgroundColor: isSelected ? "#3498db" : "white", color: isSelected ? "white" : "#64748b",
    cursor: "pointer", fontSize: "0.85rem", fontWeight: "bold" as const, transition: "all 0.2s"
});
const actionBtnGroup = { display: "flex", border: "1px solid #3498db", borderLeft: "none", borderRadius: "0 8px 8px 0", overflow: "hidden", backgroundColor: "white" };
const iconBtn = { padding: "6px 10px", border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", borderRight: "1px solid #f0f0f0" };
const addBtnStyle = { display: "flex", alignItems: "center", gap: "4px", padding: "6px 14px", borderRadius: "8px", border: "1px dashed #cbd5e1", backgroundColor: "transparent", color: "#64748b", cursor: "pointer", fontSize: "0.85rem" };
const editInputWrapper = { display: "flex", gap: "8px", alignItems: "center", backgroundColor: "#fff", padding: "4px 10px", borderRadius: "8px", border: "1px solid #3498db" };
const editInput = { border: "none", outline: "none", fontSize: "0.85rem", width: "100px" };
const statsWrapper = { display: "flex", gap: "25px", paddingLeft: "25px", borderLeft: "1px solid #eee", alignItems: "center" };

export default CalendarManager;