/**
 * 日ごとの勤怠入力表（出退勤・休憩・勤務区分・時間有給・確定）
 * （AttendanceManager.tsx から分割）
 *
 * 休憩は1日に何回でも入れられる（utils/breaks.ts）。表には1回目だけを出し、2回目からは「休憩の一覧」の画面で入れる
 * （フォームの形を崩さないため）。私用の外出・中抜けも休憩として入れる。
 */
import { Fragment, useState } from "react";
import { Check, CheckCircle, AlertCircle, Undo2, ListPlus } from 'lucide-react';
import dayjs from "dayjs";
import { S } from '../AttendanceManager.styles';
import TimeInputPair from './TimeInputPair';
import BreakListDialog from './BreakListDialog';
import type { AttendanceViewModel } from './types';
import { durationLabel } from '../../../utils/fixedBreak';
import { effectiveBreaks, isCompleteSpan, spanLabel, type BreakSpan } from '../../../utils/breaks';
import { SPECIAL_LEAVE_FULL, SPECIAL_LEAVE_HALF, isSpecialLeaveWorkType, leaveOptionValue, specialLeaveLabel } from '../../../utils/specialLeave';
import { describeLeave, LEAVE_TYPE_SHORT_NAMES } from '../../../utils/leaveOfAbsence';

interface Props {
  am: AttendanceViewModel;
}

/** 欠勤の日（出退勤・休憩を入れない） */
const isAbsentRow = (rowData: any) => (rowData.workType || "normal") === "absent";

/** 休憩の長さ（分。始めと終わりがそろっているものだけ） */
const spanMinutes = (b: BreakSpan) => {
  if (!isCompleteSpan(b)) return 0;
  const [sh, sm] = b.start.split(":").map(Number);
  const [eh, em] = b.end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return e < s ? e + 1440 - s : e - s;
};

export default function AttendanceTable({ am }: Props) {
  const {
    isLoading,
    isClosed,
    monthlyWorkData,
    dateList,
    holidays,
    companyHolidays,
    handleCellChange,
    handleWorkTypeChange,
    handleHourlyLeaveTypeChange,
    finalizeAttendance,
    unfinalizeAttendance,
    fixedBreakRule,
    breakInfo,
    hourlyLeaveEnabled,
    halfDayLeaveEnabled,
    leaveTypes,
    leaveDays,
  } = am;
  // 休憩の一覧の画面を開いている日
  const [breakDialogDate, setBreakDialogDate] = useState<string | null>(null);

  /**
   * 休憩の一覧を変える（時間有給の印を付けた中抜けがあれば、時間有給の時間を1時間単位で切り上げて足りるようにする。
   * 時間単位の特別休暇の印を付けた中抜けがあれば、時間休の種類をその休暇にし、時間休の時間を同じく足りるようにする）
   */
  const changeBreaks = (dateStr: string, list: BreakSpan[] | null) => {
    handleCellChange(dateStr, 'breaks', list);
    const items = list ?? [];
    const row = monthlyWorkData[dateStr] || {};
    const leave = items.filter(b => b.leave && !b.leaveTypeId).reduce((a, b) => a + spanMinutes(b), 0);
    const need = Math.ceil(leave / 60);
    if (need > (Number(row.paidHours) || 0)) handleCellChange(dateStr, 'paidHours', need);
    const special = items.filter(b => b.leaveTypeId);
    if (special.length > 0) {
      const typeId = special[0].leaveTypeId!;
      if (Number(row.leaveTypeId) !== typeId) handleHourlyLeaveTypeChange(dateStr, typeId);
      const needSpecial = Math.ceil(special.reduce((a, b) => a + spanMinutes(b), 0) / 60);
      if (needSpecial > (Number(row.specialHours) || 0)) handleCellChange(dateStr, 'specialHours', needSpecial);
    }
  };

  /** 時間単位でも取れる特別休暇の種類（使う種類と、その日に入っている種類） */
  const hourlyTypesFor = (currentId: number | null) =>
    leaveTypes.filter(t => t.allowHourly && (t.active || t.id === currentId));

  /** 表の1回目の休憩を直す（手で直すと、その日は手入力の一覧を使う） */
  const changeFirstBreak = (dateStr: string, field: "start" | "end", value: string) => {
    const v = value === ":" ? "" : value;
    const rowData = monthlyWorkData[dateStr] || {};
    const manual: BreakSpan[] | null = rowData.breaks ?? null;
    if (manual === null && v === "") return; // 打刻のままで、何も入れていない
    const list = [...(manual ?? rowData.csvBreaks ?? [])];
    const first = list[0] ?? { start: "", end: "" };
    if ((first[field] ?? "") === v && manual !== null) return;
    list[0] = { ...first, [field]: v };
    changeBreaks(dateStr, list.filter((b, i) => i > 0 || b.start || b.end));
  };

  const dialogRow = breakDialogDate ? (monthlyWorkData[breakDialogDate] || {}) : null;
  // 休憩の一覧で中抜けに付けられる特別休暇（その日が特別休暇（1日・半日）なら付けない）
  const dialogLeaveTypes = dialogRow && !isSpecialLeaveWorkType(dialogRow.workType)
    ? hourlyTypesFor(dialogRow.leaveTypeId ?? null).map(t => ({ id: t.id, name: t.name }))
    : [];

  return (
    <>
    {breakDialogDate && dialogRow && (
      <BreakListDialog
        dateLabel={dayjs(breakDialogDate).format("M月D日（ddd）")}
        punched={dialogRow.csvBreaks ?? []}
        manual={dialogRow.breaks ?? null}
        hourlyLeave={hourlyLeaveEnabled}
        leaveTypes={dialogLeaveTypes}
        disabled={dialogRow.is_finalized === 1 || isClosed || isAbsentRow(dialogRow)}
        onChange={(list) => changeBreaks(breakDialogDate, list)}
        onClose={() => setBreakDialogDate(null)}
      />
    )}
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
          <th style={{ ...S.th, paddingRight: "2px" }}>休憩の一覧</th>
          {/* 時間単位の休暇（時間有給・時間単位の特別休暇） */}
          <th style={{ ...S.th, width: "96px", color: "#3498db" }}>時間休</th>
          
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
            workType: rowData.workType || "normal",
            // 特別休暇の種類（区分が special・special_half の日と、時間休を入れた日）
            leaveTypeId: rowData.leaveTypeId ?? null,
            // 時間単位の特別休暇の時間（時間休）
            specialHours: rowData.specialHours ?? 0,
            paidHours: rowData.paidHours || 0,
            // 休憩：手入力の一覧（null なら打刻）と打刻の一覧。表には1回目を出す
            manualBreaks: (rowData.breaks ?? null) as BreakSpan[] | null,
            punchedBreaks: (rowData.csvBreaks ?? []) as BreakSpan[],
            memo: rowData.memo || "",
            isFinalized: rowData.is_finalized === 1,
            savedHours: Number(rowData.savedHours) || 0,
            nightHours: Number(rowData.night_hours) || 0,
            csvIn: rowData.csv_entry_time || "--:--",
            csvOut: rowData.csv_exit_time || "--:--",
          };

          // --- 1. 状態判定（シンプルに！） ---
          const isFinalized = row.isFinalized;
          // 決まった休憩・休憩を引かなかった理由・労働基準法34条の休憩に足りない分（useAttendanceManager の breakInfo）
          const brk = breakInfo[dateStr] as (typeof breakInfo)[string] | undefined; // 出勤・退勤が入っていない日はない
          const breakNone = !!rowData.breakNone;
          // 「休憩なし」の印：決まった休憩を使う人の、出勤・退勤が入っている日（前に付けた印は、いつでも外せる）
          const showBreakNone = ((!!fixedBreakRule && !!brk && brk.workMinutes > 0) || breakNone) && !isAbsentRow(rowData);
          // 時間有給にした中抜けより、時間有給の時間が少ない（1時間単位で切り上げた時間が要る）
          const leaveNeedHours = Math.ceil((brk?.leaveMinutes ?? 0) / 60);
          const leaveShort = leaveNeedHours > (Number(rowData.paidHours) || 0);
          // 特別休暇にした中抜けより、時間休の時間が少ない
          const specialNeedHours = Math.ceil((brk?.specialLeaveMinutes ?? 0) / 60);
          const specialShort = specialNeedHours > (Number(rowData.specialHours) || 0);

          // --- 2. 矛盾チェック（エラーメッセージ） ---
          let timeErrorMsg = "";

          // --- 3. 背景色・文字色 ---
          const hName = holidays[dateStr];
          const cSetting = companyHolidays[dateStr];
          const isRedDay = (cSetting === 1) || (cSetting === undefined && (dayOfWeek === "日" || !!hName));
          const isBlueDay = dayOfWeek === "土" && !isRedDay;
          // 休業・休職の日（従業員の画面で入れた期間）は、薄い紫にする
          const leave = leaveDays[dateStr];
          const rowBgColor = leave ? "#f5f3ff" : S.rowBgColor(isRedDay, isBlueDay);
          // 休業の日に、働いた・休暇の記録を入れている（給与は働いた時間の分を払うので知らせる）
          const leaveHasRecord = !!leave && (!!rowData.in || !!rowData.out || ["paid_full", "paid_half", "special", "special_half"].includes(row.workType)
            || Number(rowData.paidHours) > 0 || Number(rowData.specialHours) > 0);
          const dateTextColor = S.dateTextColor(isRedDay, isBlueDay);

          // --- 1. 状態判定 ---
          const isAbsent = row.workType === "absent"; // 欠勤かどうか
          // 1日休む日（全休・特別休暇の1日）は、時間有給の欄を薄くする
          const isDayOff = row.workType === "paid_full" || row.workType === SPECIAL_LEAVE_FULL;
          // 区分のプルダウン：特別休暇は休暇の種類も入れた値。使わない種類でも、その日に入っていれば出す
          const isSpecial = isSpecialLeaveWorkType(row.workType);
          // 時間休（時間単位の特別休暇）：特別休暇（1日・半日）の日は出さない
          const specialHourlyTypes = isSpecial ? [] : hourlyTypesFor(row.leaveTypeId === null ? null : Number(row.leaveTypeId));
          const showSpecialHours = !isSpecial && !isAbsent && (specialHourlyTypes.length > 0 || Number(row.specialHours) > 0);
          const selectValue = isSpecial && row.leaveTypeId !== null ? leaveOptionValue(row.workType, Number(row.leaveTypeId)) : row.workType;
          const leaveOptions = leaveTypes.filter(t => t.active || (isSpecial && t.id === Number(row.leaveTypeId)));

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
                    {leave && (
                      <div
                        title={`${describeLeave(leave)}。休業の日は働いていないので、給与を払いません（月給は、給与規定グループの「休業の月の日割り」で日割り）`}
                        style={{ display: "inline-block", margin: "2px 0", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: "bold", color: "#6d28d9", backgroundColor: "#ede9fe" }}
                      >
                        {LEAVE_TYPE_SHORT_NAMES[leave.type]}
                      </div>
                    )}
                    {leaveHasRecord && (
                      <div style={{ fontSize: 10, color: "#b45309", fontWeight: "normal", lineHeight: 1.3 }}>⚠ 休業の期間の日です</div>
                    )}

                    <select
                      value={selectValue}
                      onChange={e => handleWorkTypeChange(dateStr, e.target.value)}
                      title={isSpecial ? specialLeaveLabel(leaveTypes.find(t => t.id === Number(row.leaveTypeId)), row.workType) : undefined}
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
                      <option value="holiday_work">所定休日出勤</option>
                      <option value="statutory_holiday">法定休日出勤（35%増）</option>
                      <option value="paid_full">全休(有給)</option>
                      {/* 半休は、会社の設定で半日単位の有給を使うときだけ選べる（前に入れた日は、そのまま出す） */}
                      {(halfDayLeaveEnabled || row.workType === "paid_half") && <option value="paid_half">半休(有給)</option>}
                      {/* 会社独自の休暇（特別休暇）。種類は会社設定の「休暇の種類」で作る（utils/specialLeave.ts） */}
                      {leaveOptions.length > 0 && (
                        <optgroup label="会社独自の休暇">
                          {leaveOptions.map(t => (
                            <Fragment key={t.id}>
                              <option value={leaveOptionValue(SPECIAL_LEAVE_FULL, t.id)}>{t.name}{t.paid ? "" : "(無給)"}</option>
                              {(t.allowHalf || (row.workType === SPECIAL_LEAVE_HALF && Number(row.leaveTypeId) === t.id)) && (
                                <option value={leaveOptionValue(SPECIAL_LEAVE_HALF, t.id)}>{t.name}(半日){t.paid ? "" : "(無給)"}</option>
                              )}
                            </Fragment>
                          ))}
                        </optgroup>
                      )}
                      {/* 区分は特別休暇なのに種類がわからない日（消した種類など）：選び直してもらう */}
                      {isSpecial && !leaveOptions.some(t => t.id === Number(row.leaveTypeId)) && (
                        <option value={selectValue}>特別休暇（種類を選び直してください）</option>
                      )}
                      {/* セレクトボックスの中も赤くしておくと親切 */}
                      <option value="absent" style={{ color: "#e74c3c" }}>欠勤</option>
                      {/* 会社の都合で休ませた日（休業手当を払う。少し働いた日は出退勤も入れる。utils/averageWage.ts） */}
                      <option value="company_leave" style={{ color: "#7c3aed" }}>休業（会社都合）</option>
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
                  <span style={{ fontSize: "11px" }}>{row.punchedBreaks[0]?.start || "--:--"}</span>
                </td>
                <td style={{ ...S.tdSpacer, color: "#94a3b8" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(休終)</span>
                  <span style={{ fontSize: "11px" }}>{row.punchedBreaks[0]?.end || "--:--"}</span>
                </td>
                <td style={{ ...S.tdSpacer, color: "#94a3b8", paddingRight: "2px" }}>
                  <span style={{ fontSize: "9px", display: "block", color: "#bdc3c7" }}>打刻(ほか)</span>
                  <span style={{ fontSize: "11px" }} title={row.punchedBreaks.slice(1).map(spanLabel).join("、")}>
                    {row.punchedBreaks.length > 1 ? `${row.punchedBreaks.length - 1}回` : "--"}
                  </span>
                </td>

                {/* --- 3. 時間有給列（会社の設定で時間単位の有給を使うときだけ入れられる） --- */}
                <td rowSpan={3} style={{ 
                  borderLeft: "1px solid #eee", 
                  textAlign: "center", 
                  verticalAlign: "middle",
                  backgroundColor: (isDayOff || isAbsent) ? "#f9f9f9" : rowBgColor 
                }}>
                  {!hourlyLeaveEnabled && !(Number(row.paidHours) > 0) ? (
                    !showSpecialHours && (
                      <span style={{ fontSize: "10px", color: "#cbd5e1" }} title="時間単位の有給は、会社の設定で「使う」にしたときに入れられます">—</span>
                    )
                  ) : (<>
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
                      disabled={isFinalized || isClosed || !hourlyLeaveEnabled} 
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
                  {!hourlyLeaveEnabled && (
                    <span style={{ fontSize: "9px", color: "#b45309", display: "block" }}>会社の設定で使わない</span>
                  )}
                  </>)}
                  {/* 時間単位の特別休暇（子の看護等休暇・介護休暇など）。特別休暇（1日・半日）の日は入れない */}
                  {showSpecialHours && (
                    <div style={{ marginTop: (hourlyLeaveEnabled || Number(row.paidHours) > 0) ? "8px" : 0, paddingTop: (hourlyLeaveEnabled || Number(row.paidHours) > 0) ? "6px" : 0,
                      borderTop: (hourlyLeaveEnabled || Number(row.paidHours) > 0) ? "1px dashed #e2e8f0" : "none" }}>
                      <select
                        value={row.leaveTypeId ?? ""}
                        onChange={e => handleHourlyLeaveTypeChange(dateStr, e.target.value === "" ? null : Number(e.target.value))}
                        disabled={isFinalized || isClosed}
                        title="時間単位で取った休暇の種類"
                        style={{ width: "88px", fontSize: "10px", padding: "1px", color: isFinalized ? "#6b46c1" : "#333",
                          border: isFinalized ? "1px solid transparent" : "1px solid #ddd", backgroundColor: "transparent" }}
                      >
                        <option value="">休暇（時間）</option>
                        {specialHourlyTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : "(無給)"}</option>)}
                      </select>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: "3px" }}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.specialHours}
                          onChange={e => handleCellChange(dateStr, 'specialHours', e.target.value)}
                          disabled={isFinalized || isClosed}
                          style={{ width: "45px", fontSize: "13px", textAlign: "center", borderRadius: "4px",
                            border: isFinalized ? "1px solid transparent" : "1px solid #ddd",
                            backgroundColor: (isFinalized || isClosed) ? "transparent" : "#fff",
                            color: isFinalized ? "#6b46c1" : "#333", fontWeight: isFinalized ? "bold" : "normal", opacity: 1 }}
                        />
                        <span style={{ fontSize: "10px", color: isFinalized ? "#6b46c1" : "#7f8c8d", marginLeft: "2px" }}>h</span>
                      </div>
                    </div>
                  )}
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
                    {isFinalized && Number(row.specialHours) > 0 && !isSpecial && (
                      <div style={{ fontSize: "9px", color: "#6b46c1" }}>
                        (ほかに 休暇 {row.specialHours}h)
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
                backgroundColor: (isDayOff || isAbsent ? "#f9f9f9" : rowBgColor),
                borderLeft: borderLeftStyle,
                opacity: 1, 
              }}>
                <td style={S.tdTight}><TimeInputPair value={isAbsent ? ":" : row.in} onChange={val => handleCellChange(dateStr, 'in', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdSpacer}><TimeInputPair value={isAbsent ? ":" : row.out} onChange={val => handleCellChange(dateStr, 'out', val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdTight}><TimeInputPair value={isAbsent ? ":" : (row.manualBreaks?.[0]?.start ?? "")} onChange={val => changeFirstBreak(dateStr, "start", val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={S.tdSpacer}><TimeInputPair value={isAbsent ? ":" : (row.manualBreaks?.[0]?.end ?? "")} onChange={val => changeFirstBreak(dateStr, "end", val)} disabled={isFinalized || isClosed || isAbsent} isFinalized={isFinalized} /></td>
                <td style={{ ...S.tdSpacer, paddingRight: "2px" }}>
                  {(() => {
                    const list = effectiveBreaks(row.manualBreaks, row.punchedBreaks);
                    const others = list.slice(1);
                    const leave = list.filter(b => b.leave && !b.leaveTypeId).reduce((a, b) => a + spanMinutes(b), 0);
                    const specialLeave = list.filter(b => b.leaveTypeId).reduce((a, b) => a + spanMinutes(b), 0);
                    const otherRest = others.filter(b => !b.leave && !b.leaveTypeId).reduce((a, b) => a + spanMinutes(b), 0);
                    return (
                      <button
                        onClick={() => setBreakDialogDate(dateStr)}
                        disabled={isAbsent}
                        title={list.length > 0
                          ? list.map(b => `${spanLabel(b)}${b.leaveTypeId ? `（${leaveTypes.find(t => t.id === b.leaveTypeId)?.name ?? "特別休暇"}）` : b.leave ? "（時間有給）" : ""}`).join("、")
                          : "休憩を足す・直す"}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 3, fontSize: "11px", padding: "3px 6px", borderRadius: 4,
                          border: "1px solid #cbd5e1", background: "#fff", color: others.length > 0 || leave > 0 || specialLeave > 0 ? "#1d4ed8" : "#64748b",
                          cursor: isAbsent ? "default" : "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        <ListPlus size={12} />
                        {others.length > 0 ? `ほか${others.length}回${otherRest > 0 ? `（${durationLabel(otherRest)}）` : ""}` : (isFinalized || isClosed ? "一覧" : "足す")}
                        {leave > 0 && <span style={{ color: "#2563eb" }}>・有給{durationLabel(leave)}</span>}
                        {specialLeave > 0 && <span style={{ color: "#6b46c1" }}>・休暇{durationLabel(specialLeave)}</span>}
                      </button>
                    );
                  })()}
                </td>
              </tr>

              <tr style={{ 
                backgroundColor: rowBgColor,
                borderBottom: "1px solid #eee",
                borderLeft: borderLeftStyle
              }}>
                <td colSpan={5} style={{ padding: "6px 12px", pointerEvents: "auto" }}>
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
                  {/* 休憩：決まった休憩・「休憩なし」・労働基準法34条の休憩に足りない日 */}
                  {(brk?.autoBreak || brk?.notice || (brk?.shortage ?? 0) > 0 || showBreakNone || leaveShort || specialShort) && (
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", marginTop: "4px", fontSize: "11px" }}>
                      {showBreakNone && (
                        <label style={{ display: "flex", alignItems: "center", gap: "3px", color: "#475569", cursor: isFinalized || isClosed ? "default" : "pointer" }}
                          title="その日は休憩を取らなかったとき（決まった休憩を引きません）">
                          <input type="checkbox" checked={breakNone} disabled={isFinalized || isClosed}
                            onChange={e => handleCellChange(dateStr, 'breakNone', e.target.checked)} />
                          休憩なし
                        </label>
                      )}
                      {brk?.autoBreak && (
                        <span style={{ color: "#64748b" }}>
                          決まった休憩（{brk.autoBreak}）を{isFinalized ? "引きました" : "引きます"}
                        </span>
                      )}
                      {brk?.notice && <span style={{ color: "#b45309" }}>⚠ {brk.notice}</span>}
                      {leaveShort && (
                        <span style={{ color: "#b45309" }}>
                          ⚠ 時間有給にした中抜け（{durationLabel(brk!.leaveMinutes)}）より、時間有給（{Number(rowData.paidHours) || 0}時間）が少ない（{leaveNeedHours}時間が要ります）
                        </span>
                      )}
                      {specialShort && (
                        <span style={{ color: "#b45309" }}>
                          ⚠ 休暇にした中抜け（{durationLabel(brk!.specialLeaveMinutes)}）より、時間休（{Number(rowData.specialHours) || 0}時間）が少ない（{specialNeedHours}時間が要ります）
                        </span>
                      )}
                      {(brk?.shortage ?? 0) > 0 && (
                        <span style={{ color: "#b91c1c" }}>
                          ⚠ 休憩が足りません（労働時間{durationLabel(brk!.workMinutes)}には、休憩{brk!.workMinutes > 480 ? "1時間" : "45分"}以上。
                          いまは{brk!.restMinutes > 0 ? durationLabel(brk!.restMinutes) : "なし"}。労働基準法34条）
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </>
  );
}
