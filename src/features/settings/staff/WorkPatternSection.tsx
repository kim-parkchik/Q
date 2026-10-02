/**
 * 「所属・給与」下段：カレンダー・所定労働時間・契約曜日・固定残業代・換算結果
 * （StaffManager.tsx から分割）
 */
import { inputStyle, labelStyle } from '../StaffManager.styles';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function WorkPatternSection({ cm }: Props) {
    const {
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
        targetWage,
        targetFixedOvertimeHours,
        setTargetFixedOvertimeHours,
        targetFixedOvertimeAmount,
        setTargetFixedOvertimeAmount,
        calendarPatterns,
        annualWorkDays,
        monthlyAverageHours,
        hourlyConversion,
    } = cm;

    return (
        <>
            {/* 共通の勤務パターン設定エリア */}
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

                {/* 統計・換算結果フッター (月給制または日給制の時に表示) */}
                {(targetWageType === "monthly" || targetWageType === "daily") && (
                    <div style={{ 
                        marginTop: "15px", 
                        paddingTop: "12px", 
                        borderTop: "1px solid #e2e8f0", 
                        display: "flex", 
                        justifyContent: "space-between", 
                        alignItems: "center" 
                    }}>
                        {/* --- 左側：統計エリア（月給制の時のみ表示） --- */}
                        <div style={{ display: "flex", gap: "30px", marginLeft: "40px" }}>
                            {targetWageType === "monthly" && (
                                <>
                                    {/* 年間稼働 */}
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "bold" }}>年間稼働</span>
                                        <span style={{ fontSize: "14px", color: "#2c3e50" }}>
                                            <b style={{ fontSize: "16px" }}>{annualWorkDays}</b> <small>日</small>
                                        </span>
                                    </div>
                                    {/* 月平均所定 */}
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "bold" }}>月平均所定</span>
                                        <span style={{ fontSize: "14px", color: "#2c3e50" }}>
                                            <b style={{ fontSize: "16px" }}>
                                                {targetDailyHours > 0 ? monthlyAverageHours.toFixed(2) : "---"}
                                            </b> <small>h</small>
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* --- 右側：時給換算バッジ（日給・月給の両方で表示） --- */}
                        <div style={{ 
                            backgroundColor: "#ebf8ff", 
                            padding: "8px 15px", 
                            borderRadius: "8px", 
                            border: "1px solid #bee3f8",
                            textAlign: "right"
                        }}>
                            <div style={{ fontSize: "10px", color: "#2b6cb0", fontWeight: "bold", marginBottom: "2px" }}>
                                💰 {targetWageType === "daily" ? "日給からの時給換算" : "時給換算目安"}
                            </div>
                            <div style={{ fontSize: "18px", color: "#2c5282", fontWeight: "bold" }}>
                                {/* 
                                    日給制の場合：所定労働時間(targetDailyHours)があれば計算
                                    月給制の場合：所定労働時間 と 年間稼働日数(annualWorkDays)があれば計算
                                */}
                                {targetDailyHours > 0 && (targetWageType === "daily" || annualWorkDays > 0) ? (
                                    <>
                                        約 {Math.round(
                                            targetWageType === "daily" 
                                            ? (targetWage / targetDailyHours)  // 日給 ÷ 1日の所定時間
                                            : hourlyConversion                 // 月給用の既存計算ロジック
                                        ).toLocaleString()} 
                                        <span style={{ fontSize: "12px" }}> 円</span>
                                    </>
                                ) : (
                                    <span style={{ color: "#94a3b8", fontSize: "14px" }}>
                                        {targetDailyHours === 0 ? "(所定時間未設定)" : "(未設定)"}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
