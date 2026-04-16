import React, { useState, useEffect } from "react";
import Database from "@tauri-apps/plugin-sql";
import { fetch } from "@tauri-apps/plugin-http";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

interface CalendarManagerProps {
    db: Database;
}

// --- 追加する型定義 ---
interface CalendarPattern {
    id: number;
    name: string;
}

const CalendarManager: React.FC<CalendarManagerProps> = ({ db }) => {
    const [csvUrl, setCsvUrl] = useState("");
    const [year, setYear] = useState(2026);
    const [loading, setLoading] = useState(false);
    const [holidays, setHolidays] = useState<Record<string, string>>({});
    const [companyHolidays, setCompanyHolidays] = useState<Record<string, number>>({});
    const [patterns, setPatterns] = useState<CalendarPattern[]>([]);
    const [currentPatternId, setCurrentPatternId] = useState<number>(1); // 初期値は「標準」

    // ✨ 追加：パターン入力モードの管理
    const [isAddingPattern, setIsAddingPattern] = useState(false);
    const [newPatternName, setNewPatternName] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState("");

    // 1. パターン一覧の読み込み（初回とパターン追加時に呼ぶ）
    const loadPatterns = async () => {
        try {
            // App.tsxで作られているはずなので、selectするだけでOK
            const res = await db.select<CalendarPattern[]>("SELECT * FROM calendar_patterns ORDER BY id ASC");
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
            const res = await db.select<any[]>("SELECT holiday_csv_url FROM company WHERE id = 1");
            if (res?.[0]?.holiday_csv_url) setCsvUrl(res[0].holiday_csv_url);
            await loadPatterns();
        };
        init();
    }, [db]);

    // パターンや年が切り替わったらデータを再ロード
    useEffect(() => {
        loadAllCalendarData();
    }, [currentPatternId, year]);

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
        const lines = csvText.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l !== "");
        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].split(",");
            if (columns.length >= 2) {
                const dateStr = columns[0].replace(/"/g, "").trim();
                const name = columns[1].replace(/"/g, "").trim();
                const parts = dateStr.split("/");
                if (parts.length === 3) {
                    const fDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                    await db.execute("INSERT OR REPLACE INTO holiday_master (holiday_date, name) VALUES (?, ?)", [fDate, name]);
                }
            }
        }
        await loadAllCalendarData();
    };

    const handleImportHolidays = async () => {
        if (!csvUrl) return;
        setLoading(true);
        try {
            const response = await fetch(csvUrl, { method: "GET" });
            const buffer = await response.arrayBuffer();
            await processCsvData(new TextDecoder("shift-jis").decode(new Uint8Array(buffer)));
        } catch (error) { console.error(error); } finally { setLoading(false); }
    };

    const handleFileImport = async () => {
        const selected = await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] });
        if (!selected) return;
        const fileData = await readFile(selected as string);
        await processCsvData(new TextDecoder("shift-jis").decode(fileData));
    };

    const saveUrl = async () => {
        await db.execute("UPDATE company SET holiday_csv_url = ? WHERE id = 1", [csvUrl]);
        alert("保存しました");
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

    // --- 統計計算 ---
    const stats = { workDays: 0, holidayDays: 0 };
    for (let m = 0; m < 12; m++) {
        getDaysInMonth(year, m).forEach(d => {
            const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const isDefH = d.getDay() === 0 || d.getDay() === 6 || !!holidays[dateKey];
            const setting = companyHolidays[dateKey];
            const isHoliday = (isDefH && setting !== 0) || (setting === 1);
            isHoliday ? stats.holidayDays++ : stats.workDays++;
        });
    }

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
        if (!window.confirm("このカレンダーパターンを削除しますか？\n（このパターンを使用している従業員の設定に影響が出る場合があります）")) return;

        try {
            await db.execute("DELETE FROM calendar_patterns WHERE id = ?", [currentPatternId]);
            setCurrentPatternId(1); // 削除したら標準に戻す
            await loadPatterns();
        } catch (e) { console.error(e); }
    };

    return (
        <div style={{ padding: "20px", color: "#2c3e50" }}>
            {/* 1. ヘッダー ＆ 設定セクション */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", gap: "20px" }}>
                
                {/* 左側：タイトルと年選択 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                        📅 会社カレンダー
                    </h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "#fff", padding: "6px 16px", borderRadius: "20px", border: "1px solid #dee2e6", width: "fit-content" }}>
                        <button onClick={() => setYear(year - 1)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "1rem", color: "#3498db" }}>◀</button>
                        <span style={{ fontWeight: "bold", fontSize: "1.1rem", minWidth: "60px", textAlign: "center" }}>{year}年</span>
                        <button onClick={() => setYear(year + 1)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "1rem", color: "#3498db" }}>▶</button>
                    </div>
                </div>

                {/* 右側：コンパクトな設定ボックス */}
                <div style={{ 
                    flex: "0 1 450px", // 最大幅を制限
                    padding: "12px", 
                    backgroundColor: "#f8fafc", 
                    borderRadius: "10px", 
                    border: "1px solid #e2e8f0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                }}>
                    <div>
                        <label style={{ fontSize: "0.7rem", fontWeight: "bold", display: "block", marginBottom: "4px", color: "#64748b" }}>祝日データ取得先(URL)</label>
                        <div style={{ display: "flex", gap: "4px" }}>
                            <input 
                                type="text" 
                                value={csvUrl} 
                                onChange={(e) => setCsvUrl(e.target.value)} 
                                placeholder="https://..."
                                style={{ flex: 1, padding: "5px 8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }} 
                            />
                            <button onClick={saveUrl} style={{ padding: "4px 10px", cursor: "pointer", fontSize: "0.8rem", borderRadius: "4px", border: "1px solid #cbd5e1", backgroundColor: "#fff" }}>保存</button>
                        </div>
                    </div>

                    {/* 取得ボタンを右下に配置 */}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                        <button 
                            onClick={handleImportHolidays} 
                            disabled={loading} 
                            style={{ backgroundColor: "#3498db", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold" }}
                        >
                            {loading ? "⌛" : "🔄 ネット取得"}
                        </button>
                        <button 
                            onClick={handleFileImport} 
                            style={{ backgroundColor: "#2ecc71", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold" }}
                        >
                            📁 ファイル読込
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. パターン管理 & 統計エリア */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", padding: "12px 20px", backgroundColor: "#fff", borderRadius: "12px", borderLeft: "5px solid #3498db", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#94a3b8", whiteSpace: "nowrap" }}>パターン:</span>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                        {patterns.map((p) => {
                            const isSelected = currentPatternId === p.id;
                            
                            // --- 編集モード表示 ---
                            if (isSelected && isEditing) {
                                return (
                                    <div key={p.id} style={{ display: "flex", gap: "4px", alignItems: "center", backgroundColor: "#fff", padding: "2px 8px", borderRadius: "15px", border: "1px solid #3498db" }}>
                                        <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()} style={{ border: "none", outline: "none", fontSize: "0.8rem", width: "80px" }} />
                                        <button onClick={handleUpdateName} style={{ border: "none", background: "none", cursor: "pointer", color: "#2ecc71" }}>✔</button>
                                        <button onClick={() => setIsEditing(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}>✖</button>
                                    </div>
                                );
                            }

                            // --- 通常表示 ---
                            return (
                                <div key={p.id} style={{ display: "flex", alignItems: "center" }}>
                                    <button
                                        onClick={() => { setCurrentPatternId(p.id); setIsEditing(false); }}
                                        style={{
                                            padding: "5px 14px",
                                            borderRadius: isSelected ? "15px 0 0 15px" : "15px",
                                            border: "1px solid",
                                            borderColor: isSelected ? "#3498db" : "#d1d5db",
                                            backgroundColor: isSelected ? "#3498db" : "white",
                                            color: isSelected ? "white" : "#64748b",
                                            cursor: "pointer",
                                            fontSize: "0.8rem",
                                            fontWeight: "bold",
                                            transition: "all 0.2s"
                                        }}
                                    >
                                        {p.name}
                                    </button>
                                    {isSelected && (
                                        <div style={{ display: "flex", border: "1px solid #3498db", borderLeft: "none", borderRadius: "0 15px 15px 0", overflow: "hidden", backgroundColor: "white" }}>
                                            <button onClick={() => { setEditName(p.name); setIsEditing(true); }} style={{ padding: "4px 8px", border: "none", background: "none", cursor: "pointer", borderRight: "1px solid #eee", fontSize: "0.7rem" }}>✏️</button>
                                            {p.id !== 1 && (
                                                <button onClick={handleDeletePattern} style={{ padding: "4px 8px", border: "none", background: "none", cursor: "pointer", color: "#e74c3c", fontSize: "0.7rem" }}>🗑️</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* 追加ボタン */}
                        {isAddingPattern ? (
                            <div style={{ display: "flex", gap: "4px", alignItems: "center", backgroundColor: "#f1f5f9", padding: "2px 8px", borderRadius: "15px", border: "1px solid #3498db" }}>
                                <input autoFocus value={newPatternName} onChange={(e) => setNewPatternName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSavePattern()} placeholder="名称入力..." style={{ border: "none", background: "transparent", outline: "none", fontSize: "0.8rem", width: "100px" }} />
                                <button onClick={handleSavePattern} style={{ border: "none", background: "none", cursor: "pointer", color: "#2ecc71" }}>✔</button>
                                <button onClick={() => setIsAddingPattern(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#e74c3c" }}>✖</button>
                            </div>
                        ) : (
                            <button onClick={() => setIsAddingPattern(true)} style={{ padding: "5px 14px", borderRadius: "15px", border: "1px dashed #94a3b8", backgroundColor: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: "0.8rem", fontWeight: "bold" }}>＋ 追加</button>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", gap: "25px", paddingLeft: "25px", borderLeft: "1px solid #eee", minWidth: "max-content" }}>
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
                                const hName = holidays[dateKey];
                                const setting = companyHolidays[dateKey];
                                const isSun = d.getDay() === 0;
                                const isSat = d.getDay() === 6;
                                const isDefH = isSun || isSat || !!hName;
                                const isFinallyHoliday = (isDefH && setting !== 0) || (setting === 1);

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

export default CalendarManager;