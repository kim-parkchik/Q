/**
 * 日ごとの勤怠入力表（出退勤・休憩・外出・勤務区分・確定）
 * （AttendanceManager.tsx から分割）
 */
import { Fragment } from "react";
import { Check, CheckCircle, AlertCircle, Undo2 } from 'lucide-react';
import dayjs from "dayjs";
import { S } from '../AttendanceManager.styles';
import TimeInputPair from './TimeInputPair';
import { checkHasInput } from './attendanceHelpers';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function AttendanceTable({ am }: Props) {
  const {
    isLoading,
    isClosed,
    monthlyWorkData,
    dateList,
    holidays,
    companyHolidays,
    handleCellChange,
    finalizeAttendance,
    unfinalizeAttendance,
  } = am;

  return (
    <table style={{ 
      width: "100%", 
      borderCollapse: "collapse",
      opacity: isLoading ? 0.4 : 1, // 🆕 ロード中は少し薄くする
      transition: "opacity 0.2s ease" // 🆕 じんわり切り替える
    }}>
      <thead>
        <tr style={{ backgroundColor: "#fcfcfc", borderBottom: "2px solid #eee" }}>
          <th style={{ ...S.th, width: "100px" }}>日付</th>
          <th style={S.th}>出勤</th>
          <th style={{ ...S.th, paddingRight: "20px" }}>退勤</th>
          <th style={S.th}>休憩(始)</th>
          <th style={{ ...S.th, paddingRight: "20px" }}>休憩(終)</th>
          <th style={S.th}>外出</th>
          <th style={{ ...S.th, paddingRight: "2px" }}>戻り</th>
          {/* 🆕 独立した時間有給列 */}
          <th style={{ ...S.th, width: "60x", color: "#3498db" }}>時間有給</th>
          
          {/* 🆕 実働と操作を一つのエリアとして定義 */}
          <th style={{ ...S.th, width: "130px", borderLeft: "1px solid #eee" }}>実働 / 確定</th>
        </tr>
      </thead>
      <tbody>
        {/* 🆕 dateListを使ってループを回す */}
        {dateList.map((dateStr: string) => {
          // dateStr は "YYYY-MM-DD" 形式
          const d = dayjs(dateStr);
          const day = d.date();
          const dayOfWeek = d.format('ddd');
          
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
            isFinalized: rowData.is_finalized === 1,
            savedHours: Number(rowData.savedHours) || 0,
            nightHours: Number(rowData.night_hours) || 0,
            csvIn: rowData.csv_entry_time || "--:--",
            csvOut: rowData.csv_exit_time || "--:--",
          };

          // --- 1. 状態判定（シンプルに！） ---
          const hasInput = checkHasInput(row);
          const isFinalized = row.isFinalized;

          // --- 2. 矛盾チェック（エラーメッセージ） ---
          let timeErrorMsg = "";

          // --- 3. 背景色・文字色 ---
          const hName = holidays[dateStr];
          const cSetting = companyHolidays[dateStr];
          const isRedDay = (cSetting === 1) || (cSetting === undefined && (dayOfWeek === "日" || !!hName));
          const isBlueDay = dayOfWeek === "土" && !isRedDay;
          const rowBgColor = S.rowBgColor(isRedDay, isBlueDay);
          const dateTextColor = S.dateTextColor(isRedDay, isBlueDay);

          // --- 1. 状態判定 ---
          const isAbsent = row.workType === "absent"; // 欠勤かどうか

          // --- 2. スタイル定義（動的に切り替え） ---
          const borderLeftStyle = isFinalized 
            ? "5px solid #2ecc71" 
            : "5px solid transparent";

          // スタンプの色
          const stampColor = isAbsent ? "#e74c3c" : "#2ecc71";
          const StampIcon = isAbsent ? AlertCircle : CheckCircle; // 欠勤時は警告アイコンにするのもアリ

          return (
            <Fragment key={dateStr}>
              <tr style={{ 
                backgroundColor: rowBgColor,
                borderTop: "3px solid #eee",
                borderLeft: borderLeftStyle,
                transition: "all 0.3s ease" 
              }}>
                {/* --- 1. 日付・区分 (rowSpan=3) --- */}
                <td 
                  rowSpan={3} 
                  style={{ 
                    ...S.td, 
                    position: "relative",
                    fontWeight: "bold", 
                    borderRight: "1px solid #eee", 
                    verticalAlign: "top", 
                    width: "100px",
                    overflow: "hidden",
                    backgroundColor: rowBgColor
                  }}
                >
                  {/* --- 確定スタンプ (背景レイヤー) --- */}
                  {isFinalized && (
                    <div style={{
                      position: "absolute",
                      top: "40px",
                      left: "50%",
                      transform: "translateX(-50%) rotate(-15deg)",
                      color: stampColor, // ★ 動的に赤か緑に変わる
                      opacity: 0.12,
                      zIndex: 0,
                      pointerEvents: "none"
                    }}>
                      <StampIcon size={55} strokeWidth={1.5} />
                    </div>
                  )}

                  {/* --- 前面コンテンツ (zIndexを上げて前面へ) --- */}
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: "14px", color: dateTextColor }}>
                      <span style={{ fontSize: "10px", display: "block", color: "#95a5a6", fontWeight: "normal" }}> 
                        {d.format('YYYY/MM')}
                      </span>
                      <span style={{ fontSize: "16px" }}>{day}</span>
                      <span style={{ fontSize: "12px", marginLeft: "2px" }}>({dayOfWeek})</span>                           
                      {hName && <span style={S.holidayBadge}>{hName}</span>}
                    </div>

                    <select
                      value={row.workType}
                      onChange={e => handleCellChange(dateStr, 'workType', e.target.value)}
                      style={{ 
                        ...S.input, 
                        marginTop: "4px", 
                        fontSize: "12px", 
                        // ★ 欠勤なら赤、確定なら緑、それ以外は通常色
                        color: isAbsent ? "#e74c3c" : (isFinalized ? "#27ae60" : "#2c3e50"),
                        fontWeight: (isAbsent || isFinalized) ? "bold" : "normal",
                        
                        backgroundColor: isFinalized ? "transparent" : "#ffffff",
                        border: isFinalized ? "1px solid transparent" : "1px solid #ced4da",
                        borderRadius: "4px",
                        appearance: isFinalized ? "none" : "auto", 
                        // @ts-ignore
                        WebkitAppearance: isFinalized ? "none" : "auto", 
                        padding: "2px", 
                        lineHeight: "1.5",
                        height: "28px",
                        width: "100%",
                        display: "block",
                        textAlign: "center",
                        cursor: isFinalized ? "default" : "pointer",
                        outline: "none",
                      }}
                      disabled={isFinalized || isClosed}
                    >
                      <option value="">（未選択）</option>
                      <option value="normal">出勤（平日）</option>
                      <option value="holiday">公休</option>
                      <option value="holiday_work">休日出勤</option>
                      <option value="paid_full">全休(有給)</option>
                      <option value="paid_half">半休(有給)</option>
                      {/* セレクトボックスの中も赤くしておくと親切 */}
                      <option value="absent" style={{ color: "#e74c3c" }}>欠勤</option>
                    </select>
                  </div>
                </td>

                {/* --- 2. 打刻ログ表示エリア (グレーの文字の部分) --- */}
                <td style={{ ...S.tdTight, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(入)</span>
                  <span style={{ fontSize: "11px" }}>{rowData.csv_entry_time || "--:--"}</span>
                </td>
                <td style={{ ...S.tdSpacer, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(出)</span>
                  <span style={{ fontSize: "11px" }}>{rowData.csv_exit_time || "--:--"}</span>
                </td>
                <td style={{ ...S.tdTight, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(休始)</span>
                  <span style={{ fontSize: "11px" }}>{rowData.csv_break_start || "--:--"}</span>
                </td>
                <td style={{ ...S.tdSpacer, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(休終)</span>
                  <span style={{ fontSize: "11px" }}>{rowData.csv_break_end || "--:--"}</span>
                </td>
                <td style={{ ...S.tdTight, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(外)</span>
                  <span style={{ fontSize: "11px" }}>{rowData.csv_out_time || "--:--"}</span>
                </td>
                <td style={{ ...S.tdSpacer, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(戻)</span>
                  <span style={{ fontSize: "11px" }}>{rowData.csv_return_time || "--:--"}</span>
                </td>

                {/* --- 3. 時間有給列 --- */}
                <td rowSpan={3} style={{ 
                  borderLeft: "1px solid #eee", 
                  textAlign: "center", 
                  verticalAlign: "middle",
                  backgroundColor: (row.workType === "paid_full" || isAbsent) ? "#f9f9f9" : rowBgColor 
                }}>
                  <span style={{ 
                    fontSize: "10px", 
                    // ラベルも確定時は少し緑に寄せると統一感が出ます
                    color: isFinalized ? "#27ae60" : "#94a3b8", 
                    display: "block", 
                    marginBottom: "4px" 
                  }}>
                    時間有給
                  </span>
                  
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <input 
                      type="number" 
                      step="1" 
                      value={row.paidHours} 
                      onChange={e => handleCellChange(dateStr, 'paidHours', e.target.value)} 
                      style={{ 
                        width: "45px", 
                        fontSize: "13px", 
                        textAlign: "center",
                        borderRadius: "4px",
                        // 確定時のスタイル
                        border: isFinalized ? "1px solid transparent" : "1px solid #ddd",
                        backgroundColor: (isFinalized || isClosed) ? "transparent" : "#fff",
                        
                        // --- 🆕 色の修正：確定時は濃い緑にする ---
                        color: isFinalized ? "#27ae60" : "#333",
                        fontWeight: isFinalized ? "bold" : "normal",
                        opacity: 1, // ブラウザの無効化スタイルを上書き
                        WebkitTextFillColor: isFinalized ? "#27ae60" : undefined // iOS対策
                      }} 
                      disabled={isFinalized || isClosed} 
                    />
                    <span style={{ 
                      fontSize: "10px", 
                      color: isFinalized ? "#27ae60" : "#7f8c8d", 
                      marginLeft: "2px",
                      fontWeight: isFinalized ? "bold" : "normal"
                    }}>
                      h
                    </span>
                  </div>
                </td>

                {/* --- 4. 実働 / 確定エリア (rowSpan=3 で統合) --- */}
                <td rowSpan={3} style={{ 
                  ...S.td, 
                  width: "130px", 
                  borderLeft: "1px solid #eee", 
                  textAlign: "center", 
                  backgroundColor: isFinalized ? "#f0fff4" : "#fffdeb",
                  boxShadow: isFinalized ? "inset 0 0 10px rgba(46, 204, 113, 0.1)" : "none"
                }}>
                  <div style={{ marginBottom: "8px" }}>
                    <span style={{ fontSize: "10px", color: "#94a3b8", display: "block" }}>
                      {isFinalized ? "支給対象合計" : "実働(計算中)"}
                    </span>
                    <div style={{ 
                      fontSize: "16px",
                      fontWeight: "bold", 
                      color: isFinalized ? "#2ecc71" : "#f1c40f" 
                    }}>
                      {isFinalized 
                        ? `${Math.floor(row.savedHours + (Number(row.paidHours)||0))}h ${Math.round(((row.savedHours + (Number(row.paidHours)||0)) % 1) * 60)}m` 
                        : "--" 
                      }
                    </div>
                    {/* 内訳を表示すると親切 */}
                    {isFinalized && row.paidHours > 0 && (
                      <div style={{ fontSize: "9px", color: "#3498db" }}>
                        (内 有給 {row.paidHours}h)
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center" }}>
                    {timeErrorMsg ? (
                      <div style={{ color: "#e74c3c", textAlign: "center" }}>
                        <AlertCircle size={18} />
                        <div style={{ fontSize: "10px" }}>時間不正</div>
                      </div>
                    ) : isFinalized ? (
                      <button onClick={() => unfinalizeAttendance(dateStr)} disabled={isClosed} style={S.modernIconBtn("#95a5a6")}>
                        <Undo2 size={14} /> <span>解除</span>
                      </button>
                    ) : (
                      <button onClick={() => finalizeAttendance(dateStr)} disabled={isClosed} style={S.modernIconBtn("#3498db")}>
                        <Check size={14} /> <span>確定</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>

              <tr style={{ 
                backgroundColor: (row.workType === "paid_full" || isAbsent ? "#f9f9f9" : rowBgColor),
                borderLeft: borderLeftStyle,
                opacity: 1, 
              }}>
                <td style={S.tdTight}><TimeInputPair value={isAbsent ? ":" : row.in} onChange={val => handleCellChange(dateStr, 'in', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdSpacer}><TimeInputPair value={isAbsent ? ":" : row.out} onChange={val => handleCellChange(dateStr, 'out', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdTight}><TimeInputPair value={isAbsent ? ":" : row.bStart} onChange={val => handleCellChange(dateStr, 'bStart', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdSpacer}><TimeInputPair value={isAbsent ? ":" : row.bEnd} onChange={val => handleCellChange(dateStr, 'bEnd', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdTight}><TimeInputPair value={isAbsent ? ":" : row.outTime} onChange={val => handleCellChange(dateStr, 'outTime', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={{ ...S.tdSpacer, paddingRight: "2px" }}><TimeInputPair value={isAbsent ? ":" : row.returnTime} onChange={val => handleCellChange(dateStr, 'returnTime', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
              </tr>

              <tr style={{ 
                backgroundColor: rowBgColor,
                borderBottom: "1px solid #eee",
                borderLeft: borderLeftStyle
              }}>
                <td colSpan={6} style={{ padding: "6px 12px", pointerEvents: "auto" }}>
                  <div style={S.memoContainer}>
                    <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "bold", whiteSpace: "nowrap", flexShrink: 0 }}>
                      備考：
                    </span>
                    <input 
                      type="text" 
                      placeholder="理由、遅刻・早退の内容など" 
                      value={row.memo || ""}
                      onChange={e => handleCellChange(dateStr, 'memo', e.target.value)}
                      style={{...S.memoInput, color: isFinalized ? "#27ae60" : "inherit"}}
                      disabled={isFinalized || isClosed}
                    />
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
