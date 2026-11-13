/**
 * 有給休暇の画面（年次有給休暇の付与・残り・取った日と、会社独自の休暇（特別休暇）の付与・残り）
 *
 * 特別休暇（夏季休暇など）は、休暇の種類（会社設定）ごとに付与と残りを出し、発生の日が来た付与を知らせる
 * （SpecialLeavePanel.tsx。数え方は utils/specialLeave.ts）。
 * 年次有給休暇は、付与日（入社日ごとか、会社で決めた日にそろえる）が来て、まだ登録していない付与を、日数と出勤率と一緒に知らせ、
 * 年5日を取れていない人も知らせる（AnnualLeavePanel.tsx。決まりは utils/annualLeaveGrant.ts）。
 *
 * 有給を取った日は、勤怠の画面で「全休(有給)」「半休(有給)」「時間有給」を入れて確定する（給与の計算と同じ記録）。
 * この画面では付与を登録し、確定した勤怠から数えた残り・取った日・期限で消えた日数を見る（数え方は utils/paidLeave.ts）。
 * 前は、この画面の「消化を記録する」で別に記録していた（paid_leave_usage）。その記録は消さず、
 * その日に確定した勤怠がないときだけ数える。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { writeLog } from "../../utils/logUtils";
import {
  ANNUAL_LEAVE_GRANT_NAME,
  collectLeaveTaken,
  defaultExpiryDate,
  formatLeaveMinutes,
  formatTakenAmount,
  isAnnualLeaveGrant,
  leaveHoursPerDay,
  loadPaidLeaveData,
  summarizePaidLeave,
  type AttendanceLeaveRow,
  type LeaveGrantRow,
  type ManualLeaveRecord,
} from "../../utils/paidLeave";
import {
  dueGrants,
  formatLeaveDays,
  loadLeaveTypes,
  loadSpecialLeaveData,
  type DueGrant,
  type GrantRecord,
  type LeaveType,
  type SpecialLeaveDay,
  type SpecialLeaveGrantRow,
} from "../../utils/specialLeave";
import { DueGrantBanner, SpecialLeaveSection } from "./SpecialLeavePanel";
import { AnnualGrantDueBanner, FiveDayOverview, StaffAnnualInfo } from "./AnnualLeavePanel";
import { loadAnnualLeaveOverview, type DueAnnualGrantInfo, type StaffAnnualLeave } from "../../utils/annualLeaveOverview";
import { DEFAULT_ANNUAL_LEAVE_RULE, stageLabel, type AnnualLeaveRule } from "../../utils/annualLeaveGrant";

interface Props {
  db: Database;
  staffList: any[];
}

interface LeaveData {
  staffId: string;
  grants: LeaveGrantRow[];
  attendance: AttendanceLeaveRow[];
  manual: ManualLeaveRecord[];
  /** 特別休暇の付与と、確定した勤怠の特別休暇の日 */
  specialGrants: SpecialLeaveGrantRow[];
  specialDays: SpecialLeaveDay[];
}

/** 1日の所定労働時間（7.5 → 7時間30分） */
const formatScheduledHours = (value: unknown): string => {
  const minutes = Math.round((Number(value) || 0) * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
};

const PaidLeaveManager: React.FC<Props> = ({ db, staffList }) => {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>(["active"]);

  // マスタ上の全店舗名
  const [allBranchNames, setAllBranchNames] = useState<string[]>([]);
  // 支店フィルタの状態
  const [branchFilters, setBranchFilters] = useState<string[]>([]);

  // データベースから「全店舗名」を直接取得する
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await db.select<any[]>("SELECT name FROM branches ORDER BY id ASC");
        const names = res.map(b => b.name);
        setAllBranchNames(names);
        // 初回のみ、全ての支店を選択状態にする
        setBranchFilters(names);
      } catch (error) {
        console.error("支店リストの取得に失敗:", error);
      }
    };
    fetchBranches();
  }, [db]); // dbが変わった時（初回）のみ実行

  const today = dayjs().format("YYYY-MM-DD");

  // 付与の入力
  const [grantDate, setGrantDate] = useState(today);
  const [days, setDays] = useState("10");
  const [expiryDate, setExpiryDate] = useState(defaultExpiryDate(today));
  const [saving, setSaving] = useState(false);

  // 付与日を変えたら、有効期限を「付与日から2年」にする（長くするときは、あとで直せる）
  useEffect(() => {
    setExpiryDate(defaultExpiryDate(grantDate));
  }, [grantDate]);

  // 付与・確定した勤怠・前の記録
  const [data, setData] = useState<LeaveData | null>(null);
  const loadSeq = useRef(0);

  const loadAllData = useCallback(async (staffId: string) => {
    if (!staffId) return;
    const seq = ++loadSeq.current;
    try {
      const [loaded, special] = await Promise.all([loadPaidLeaveData(db, staffId), loadSpecialLeaveData(db, staffId)]);
      if (seq !== loadSeq.current) return; // 読み込み中にほかの人を選んだ
      setData({ staffId, ...loaded, specialGrants: special.grants, specialDays: special.days });
    } catch (e) {
      console.error(e);
      dialog.error(`有給の記録を読み込めませんでした。\n${e}`);
    }
  }, [db, dialog]);

  // 会社独自の休暇（特別休暇）の種類と、全員の付与（発生の日が来た付与の知らせに使う）
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [allSpecialGrants, setAllSpecialGrants] = useState<GrantRecord[]>([]);
  const [specialBusy, setSpecialBusy] = useState(false);
  const loadCompanyLeave = useCallback(async () => {
    try {
      const [types, grants] = await Promise.all([
        loadLeaveTypes(db),
        db.select<GrantRecord[]>("SELECT staff_id, leave_type_id, grant_date FROM special_leave_grants"),
      ]);
      setLeaveTypes(types);
      setAllSpecialGrants(grants ?? []);
    } catch (e) {
      console.error(e);
      dialog.error(`休暇の種類を読み込めませんでした。\n${e}`);
    }
  }, [db, dialog]);
  useEffect(() => { loadCompanyLeave(); }, [loadCompanyLeave]);

  // 年次有給休暇：付与日が来て、まだ登録していない付与と、年5日の取得（会社全体。utils/annualLeaveOverview.ts）
  const [annualOverview, setAnnualOverview] = useState<{ rule: AnnualLeaveRule; staff: StaffAnnualLeave[] } | null>(null);
  const [annualBusy, setAnnualBusy] = useState(false);
  const loadAnnual = useCallback(async () => {
    try {
      setAnnualOverview(await loadAnnualLeaveOverview(db, staffList, dayjs().format("YYYY-MM-DD")));
    } catch (e) {
      console.error("年次有給休暇の付与の知らせ・年5日の読み込みエラー:", e);
    }
  }, [db, staffList]);
  useEffect(() => { loadAnnual(); }, [loadAnnual]);

  useEffect(() => {
    if (selectedStaffId) loadAllData(selectedStaffId);
    else setData(null);
  }, [selectedStaffId, loadAllData]);

  const staff = staffList.find(s => String(s.id) === String(selectedStaffId));
  const staffLabel = staff ? `${staff.name}さん（${staff.id}）` : `従業員（${selectedStaffId}）`;
  const hoursInfo = leaveHoursPerDay(staff?.scheduled_work_hours);
  const H = hoursInfo.hours;

  const view = useMemo(() => {
    if (!data || data.staffId !== selectedStaffId) return null;
    const annualGrants = data.grants.filter(isAnnualLeaveGrant);
    const { taken, manualChecks } = collectLeaveTaken(data.attendance, data.manual);
    const summary = summarizePaidLeave(annualGrants, taken, H, today);
    return {
      summary,
      uncountedManual: manualChecks.filter(c => !c.counted),
      shortages: summary.taken.filter(t => t.shortageMinutes > 0),
      beforeFirst: summary.taken.filter(t => t.beforeFirstGrant),
      grantDateOf: new Map(annualGrants.map(g => [g.id, g.grant_date])),
    };
  }, [data, selectedStaffId, H, today]);

  // --- 付与の登録 ---
  const handleAddGrant = async () => {
    if (!selectedStaffId || saving) return;
    const n = Number(days);
    if (!grantDate || !dayjs(grantDate).isValid()) return dialog.warning("付与日を入れてください。");
    if (!Number.isFinite(n) || n <= 0 || Math.round(n * 2) !== n * 2) {
      return dialog.warning("付与日数は、0.5日きざみの、0より大きい数で入れてください。");
    }
    const minExpiry = defaultExpiryDate(grantDate);
    if (!expiryDate) return dialog.warning("有効期限を入れてください。");
    if (expiryDate < minExpiry) {
      return dialog.warning(
        `有効期限は、付与日から2年（${minExpiry}まで）より短くできません。\n` +
        "年次有給休暇は、付与日から2年で時効になります（労働基準法115条）。");
    }
    setSaving(true);
    try {
      await db.execute(
        "INSERT INTO paid_leave_grants (staff_id, name, grant_date, expiry_date, days_granted) VALUES (?, ?, ?, ?, ?)",
        [selectedStaffId, ANNUAL_LEAVE_GRANT_NAME, grantDate, expiryDate, n]
      );
      await writeLog(db, "INFO", "attendance", `${staffLabel}に、年次有給休暇 ${n}日（付与日 ${grantDate}・有効期限 ${expiryDate}）を登録しました`);
      toast.success(`年次有給休暇 ${n}日を登録しました`);
      await Promise.all([loadAllData(selectedStaffId), loadAnnual()]);
    } catch (e) {
      console.error(e);
      dialog.error(`付与を登録できませんでした。\n${e}`);
    } finally {
      setSaving(false);
    }
  };

  // --- 付与の取り消し ---
  const handleDeleteGrant = async (g: LeaveGrantRow, usedMinutes: number) => {
    const label = "年次有給休暇";
    const usedNote = usedMinutes > 0
      ? `\nこの付与から引いていた有給（${formatLeaveMinutes(usedMinutes, H)}）は、ほかの付与から引き直します。足りなければ「残りが足りません」と出ます。`
      : "";
    const ok = await ask(`${g.grant_date}に付与した${label} ${g.days_granted}日を取り消しますか？${usedNote}`, {
      title: "付与の取り消し", kind: "warning", okLabel: "取り消す", cancelLabel: "やめる",
    });
    if (!ok) return;
    try {
      await db.execute("DELETE FROM paid_leave_grants WHERE id = ? AND staff_id = ?", [g.id, selectedStaffId]);
      await writeLog(db, "INFO", "attendance", `${staffLabel}の${label}の付与（付与日 ${g.grant_date}・${g.days_granted}日）を取り消しました`);
      toast.success("付与を取り消しました");
      await Promise.all([loadAllData(selectedStaffId), loadAnnual()]);
    } catch (e) {
      console.error(e);
      dialog.error(`付与を取り消せませんでした。\n${e}`);
    }
  };

  // --- 特別休暇：発生の日が来た付与（チェックした人に付与する。days が 0 なら、この回は付与しない） ---
  const dues = useMemo(() => dueGrants(leaveTypes, staffList, allSpecialGrants, today), [leaveTypes, staffList, allSpecialGrants, today]);
  const handleDueGrant = async (due: DueGrant, staffIds: string[], days: number): Promise<boolean> => {
    if (specialBusy || staffIds.length === 0) return false;
    const names = due.staff.filter(s => staffIds.includes(String(s.id))).map(s => s.name);
    const what = days > 0
      ? `${due.grantDate} の${due.type.name}（${formatLeaveDays(days)}・有効期限 ${due.expiryDate}）を、${names.length}人に付与しますか？`
      : `${due.grantDate} の${due.type.name}を、${names.length}人には付与しないことにしますか？（0日の付与として残します）`;
    const ok = await ask(`${what}\n${names.join("、")}`, {
      title: days > 0 ? "特別休暇の付与" : "この回は付与しない", kind: "info", okLabel: days > 0 ? "付与する" : "付与しない", cancelLabel: "やめる",
    });
    if (!ok) return false;
    setSpecialBusy(true);
    try {
      for (const id of staffIds) {
        await db.execute(
          "INSERT INTO special_leave_grants (staff_id, leave_type_id, grant_date, expiry_date, days_granted) VALUES (?, ?, ?, ?, ?)",
          [id, due.type.id, due.grantDate, due.expiryDate, days],
        );
      }
      await writeLog(db, "INFO", "attendance", days > 0
        ? `${due.type.name} ${days}日（付与日 ${due.grantDate}・有効期限 ${due.expiryDate}）を${staffIds.length}人に付与しました（${staffIds.join("・")}）`
        : `${due.type.name}（付与日 ${due.grantDate}）を${staffIds.length}人には付与しないことにしました（${staffIds.join("・")}）`);
      toast.success(days > 0 ? `${due.type.name}を${staffIds.length}人に付与しました` : `${staffIds.length}人には付与しないことにしました`);
      await loadCompanyLeave();
      if (selectedStaffId) await loadAllData(selectedStaffId);
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`付与を登録できませんでした（途中まで登録したときは、知らせに残りの人が出ます）。\n${e}`);
      await loadCompanyLeave();
      return false;
    } finally {
      setSpecialBusy(false);
    }
  };

  // --- 特別休暇：人ごとの付与の登録・取り消し ---
  const handleAddSpecialGrant = async (input: { type: LeaveType; grantDate: string; expiryDate: string; days: number }) => {
    if (!selectedStaffId || specialBusy) return;
    setSpecialBusy(true);
    try {
      await db.execute(
        "INSERT INTO special_leave_grants (staff_id, leave_type_id, grant_date, expiry_date, days_granted) VALUES (?, ?, ?, ?, ?)",
        [selectedStaffId, input.type.id, input.grantDate, input.expiryDate, input.days],
      );
      await writeLog(db, "INFO", "attendance", `${staffLabel}に、${input.type.name} ${input.days}日（付与日 ${input.grantDate}・有効期限 ${input.expiryDate}）を登録しました`);
      toast.success(`${input.type.name} ${formatLeaveDays(input.days)}を登録しました`);
      await Promise.all([loadAllData(selectedStaffId), loadCompanyLeave()]);
    } catch (e) {
      console.error(e);
      dialog.error(`付与を登録できませんでした。\n${e}`);
    } finally {
      setSpecialBusy(false);
    }
  };
  const handleDeleteSpecialGrant = async (type: LeaveType, g: SpecialLeaveGrantRow, usedText: string) => {
    const usedNote = usedText
      ? `\nこの付与から引いていた${usedText}は、ほかの付与から引き直します。足りなければ「残りが足りません」と出ます。`
      : "";
    const ok = await ask(`${g.grant_date}に付与した${type.name} ${g.days_granted}日を取り消しますか？${usedNote}`, {
      title: "付与の取り消し", kind: "warning", okLabel: "取り消す", cancelLabel: "やめる",
    });
    if (!ok) return;
    try {
      await db.execute("DELETE FROM special_leave_grants WHERE id = ? AND staff_id = ?", [g.id, selectedStaffId]);
      await writeLog(db, "INFO", "attendance", `${staffLabel}の${type.name}の付与（付与日 ${g.grant_date}・${g.days_granted}日）を取り消しました`);
      toast.success("付与を取り消しました");
      await Promise.all([loadAllData(selectedStaffId), loadCompanyLeave()]);
    } catch (e) {
      console.error(e);
      dialog.error(`付与を取り消せませんでした。\n${e}`);
    }
  };

  // --- 年次有給休暇：付与日が来た付与を登録する（days が 0 なら「付与しない」。出勤率が8割未満のときなど） ---
  const registerAnnualGrant = async (staffId: string, info: DueAnnualGrantInfo, days: number) => {
    if (annualBusy) return;
    const person = staffList.find(s => String(s.id) === staffId);
    const label = `${person?.name ?? staffId}さん（${staffId}）`;
    const what = days > 0
      ? `${label}に、${info.grant.date} の年次有給休暇 ${days}日（${stageLabel(info.grant.stage)}${info.proportional ? "・比例付与" : ""}・有効期限 ${defaultExpiryDate(info.grant.date)}）を付与しますか？`
        + (info.rate.ok === null ? "\n出勤率を Q の勤怠で確かめられません。出勤簿などで8割以上か確かめてください。" : "")
        + (info.rate.ok === false ? "\n出勤率が8割未満です。付与しないときは「付与しない」を押してください。" : "")
      : `${label}の ${info.grant.date} の年次有給休暇を、付与しないことにしますか？（出勤率が8割未満のときなど。0日の付与として残します）`;
    const ok = await ask(what, { title: days > 0 ? "年次有給休暇の付与" : "付与しない", kind: "info", okLabel: days > 0 ? "付与する" : "付与しない", cancelLabel: "やめる" });
    if (!ok) return;
    setAnnualBusy(true);
    try {
      const expiry = defaultExpiryDate(info.grant.date);
      await db.execute(
        "INSERT INTO paid_leave_grants (staff_id, name, grant_date, expiry_date, days_granted) VALUES (?, ?, ?, ?, ?)",
        [staffId, ANNUAL_LEAVE_GRANT_NAME, info.grant.date, expiry, days],
      );
      await writeLog(db, "INFO", "attendance", days > 0
        ? `${label}に、年次有給休暇 ${days}日（付与日 ${info.grant.date}・有効期限 ${expiry}・${stageLabel(info.grant.stage)}）を付与しました`
        : `${label}の ${info.grant.date} の年次有給休暇を付与しないことにしました`);
      toast.success(days > 0 ? `年次有給休暇 ${days}日を付与しました` : "付与しないことにしました");
      await loadAnnual();
      if (selectedStaffId === staffId) await loadAllData(staffId);
    } catch (e) {
      console.error(e);
      dialog.error(`付与を登録できませんでした。\n${e}`);
    } finally {
      setAnnualBusy(false);
    }
  };

  // --- 前に有給の画面で記録した取得の取り消し ---
  const handleDeleteManual = async (r: ManualLeaveRecord) => {
    const ok = await ask(`前に有給の画面で記録した取得（${r.usage_date}・${r.days_used}日）を取り消しますか？`, {
      title: "前の記録の取り消し", kind: "warning", okLabel: "取り消す", cancelLabel: "やめる",
    });
    if (!ok) return;
    try {
      await db.execute("DELETE FROM paid_leave_usage WHERE id = ? AND staff_id = ?", [r.id, selectedStaffId]);
      await writeLog(db, "INFO", "attendance", `${staffLabel}の、有給の画面で記録した取得（${r.usage_date}・${r.days_used}日）を取り消しました`);
      toast.success("前の記録を取り消しました");
      await loadAllData(selectedStaffId);
    } catch (e) {
      console.error(e);
      dialog.error(`前の記録を取り消せませんでした。\n${e}`);
    }
  };

  // ✨ フィルタリングロジック
  const filteredStaffList = staffList.filter(s => {
    const matchesStatus = activeFilters.includes(s.status);
    const matchesBranch = branchFilters.includes(s.branch_name);
    return matchesStatus && matchesBranch;
  });

  // ✨ フィルタ変更時のリセットロジック
  useEffect(() => {
    if (selectedStaffId) {
      const isStillVisible = filteredStaffList.some(s => String(s.id) === String(selectedStaffId));
      if (!isStillVisible) setSelectedStaffId("");
    }
  }, [activeFilters, branchFilters, filteredStaffList]); // filteredStaffList 自体も監視対象へ

  const fmt = (minutes: number) => formatLeaveMinutes(minutes, H);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <section style={{ marginBottom: "20px" }}>
        {/* 1. 上段：支店選択（グループ分けの役割） */}
        <div style={{
          backgroundColor: "white",
          padding: "12px 20px",
          borderRadius: "10px 10px 0 0", // 下側は繋げる
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "#e2e8f0",
          borderBottom: "none", // 下の段と合体させる
          display: "flex",
          alignItems: "center",
          gap: "15px",
          flexWrap: "wrap"
        }}>
          <span style={filterLabelStyle}>対象支店:</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {allBranchNames.map(branchName => (
              <button
                key={branchName}
                onClick={() => {
                  setBranchFilters(prev =>
                    prev.includes(branchName)
                      ? prev.filter(v => v !== branchName)
                      : [...prev, branchName]
                  );
                }}
                style={getFilterButtonStyle(branchFilters.includes(branchName), "#0055A4")}
              >
                {branchName}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setActiveFilters(["active"]); // 「在籍」のみに戻す
              setBranchFilters(allBranchNames); // 「全支店選択」に戻す
            }}
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              border: "none",
              background: "none",
              color: "#94a3b8",
              cursor: "pointer",
              textDecoration: "underline"
            }}
          >
            条件をリセット
          </button>
        </div>

        {/* 2. 下段：従業員選択 ＆ 状態フィルタ ＆ 残りの表示（高さ固定） */}
        <div style={{
          backgroundColor: "#f1f5f9",
          padding: "10px 20px",
          borderRadius: "0 0 10px 10px",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          gap: "40px",
          height: "52px",
          boxSizing: "border-box"
        }}>
          <div style={{ flex: "0 1 450px" }}>
            <select
            value={selectedStaffId}
            onChange={e => setSelectedStaffId(e.target.value)}
            style={{
              width: "100%",
              fontSize: "14px",
              padding: "0 12px",
              height: "32px",
              borderRadius: "6px",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: "#cbd5e1",
              cursor: "pointer",
              backgroundColor: "white",
              lineHeight: "30px"
            }}
            >
            <option value="">-- 従業員を選択 ({filteredStaffList.length}名) --</option>
            {filteredStaffList.map(s => (
              <option key={s.id} value={s.id}>
              [{s.branch_name || "本部"}] {s.id}: {s.name}
              </option>
            ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={filterLabelStyle}>状態:</span>
            {[
            { label: "在籍", value: "active", color: "#2ecc71" },
            { label: "休職", value: "on_leave", color: "#f1c40f" },
            { label: "退職", value: "retired", color: "#e74c3c" }
            ].map(opt => (
            <button
              key={opt.value}
              onClick={() => {
              setActiveFilters(prev =>
                prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
              );
              }}
              style={{
              ...getFilterButtonStyle(activeFilters.includes(opt.value), opt.color),
              height: "28px",
              lineHeight: "1"
              }}
            >
              {opt.label}
            </button>
            ))}
          </div>

          {/* 右端：今日の残り（非表示時も高さを維持） */}
          <div style={{
            marginLeft: "auto",
            minWidth: "120px",
            display: "flex",
            justifyContent: "flex-end"
          }}>
            {selectedStaffId ? (
              <div style={{
                backgroundColor: "#002D62",
                color: "white",
                padding: "4px 15px",
                borderRadius: "6px",
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                height: "32px",
                boxSizing: "border-box",
                whiteSpace: "nowrap"
              }}>
                <span style={{ fontSize: "10px", opacity: 0.8 }}>今日の残り</span>
                <span style={{ fontSize: "16px", fontWeight: "bold" }}>
                  {!view ? "…" : view.summary.hasGrants ? fmt(view.summary.remainingMinutes) : "付与なし"}
                </span>
              </div>
            ) : (
              <div style={{ height: "32px" }} />
            )}
          </div>
        </div>
      </section>

      <AnnualGrantDueBanner
        items={annualOverview?.staff ?? []}
        rule={annualOverview?.rule ?? DEFAULT_ANNUAL_LEAVE_RULE}
        busy={annualBusy}
        onGrant={(staffId, info) => registerAnnualGrant(staffId, info, info.days)}
        onSkip={(staffId, info) => registerAnnualGrant(staffId, info, 0)}
      />
      <FiveDayOverview items={annualOverview?.staff ?? []} today={today} />
      <DueGrantBanner dues={dues} busy={specialBusy} onGrant={handleDueGrant} />

      {!selectedStaffId ? (
        <div style={{ textAlign: "center", padding: "100px", color: "#94a3b8", backgroundColor: "white", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
          従業員を選択してください
        </div>
      ) : !view ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94a3b8" }}>読み込み中…</div>
      ) : (
        <>
          {/* 知らせ */}
          {view.shortages.length > 0 && (
            <div style={noticeStyle("#fde8e8", "#9b1c1c")}>
              <b>⚠ 残りが足りない有給があります。</b>付与が登録されていないか、日数が足りません。付与を登録するか、勤怠を直してください。
              <ul style={{ margin: "6px 0 0", paddingLeft: "20px" }}>
                {view.shortages.map(t => (
                  <li key={`${t.date}-${t.source}-${t.manualId ?? ""}`}>
                    {t.date}：{formatTakenAmount(t)}のうち、{fmt(t.shortageMinutes)}が足りません
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hoursInfo.assumed && view.summary.taken.some(t => t.hours > 0) && (
            <div style={noticeStyle("#fef3c7", "#92400e")}>
              この人の1日の所定労働時間が入っていないので、時間単位の有給は8時間を1日として数えています。従業員の画面で、1日の所定労働時間を入れてください。
            </div>
          )}
          {!view.summary.hasGrants ? (
            <div style={noticeStyle("#f1f5f9", "#475569")}>
              この人の年次有給休暇の付与は、まだ登録されていません。付与を登録すると、勤怠で入れた有給を引いて残りを出します。
              （有給をほかのシステムや表で管理しているときは、登録しなくても給与は計算できます）
            </div>
          ) : view.beforeFirst.length > 0 && (
            <div style={noticeStyle("#f1f5f9", "#475569")}>
              最初の付与（{view.summary.firstGrantDate}）より前の有給（{fmt(view.beforeFirst.reduce((sum, t) => sum + t.minutes, 0))}分）は、残りから引いていません。Q で有給を管理する前の分として扱っています。
            </div>
          )}

          {/* 次の付与と、年5日の取得 */}
          <StaffAnnualInfo info={annualOverview?.staff.find(s => s.staffId === String(selectedStaffId)) ?? null} today={today} />

          {/* 付与の登録・入れ方 */}
          <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
            <div style={{ flex: 1, backgroundColor: "white", padding: "18px", borderRadius: "10px", border: "1px solid #e2e8f0", borderTop: "4px solid #38a169" }}>
              <h3 style={{ marginTop: 0, marginBottom: "15px", fontSize: "16px", color: "#2f855a", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>➕</span> 年次有給休暇の付与を登録
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={miniLabelStyle}>付与日（基準日）</label>
                  <input type="date" value={grantDate} onChange={e => setGrantDate(e.target.value)} style={formInputStyle} />
                </div>
                <div>
                  <label style={miniLabelStyle}>付与日数</label>
                  <input type="number" min="0.5" step="0.5" value={days} onChange={e => setDays(e.target.value)} style={formInputStyle} />
                </div>
                <div>
                  <label style={miniLabelStyle}>有効期限</label>
                  <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} style={formInputStyle} />
                </div>
              </div>
              <p style={hintStyle}>
                有効期限の初めの値は、付与日から2年です（労働基準法115条）。会社の決まりで長くするときは、直してください（短くはできません）。
              </p>
              <p style={hintStyle}>
                Q に勤怠を入れる前に使った分があるときは、その分を引いた日数で登録してください（例：11日付与され、Q を使う前に3日使っていたら8日）。
              </p>
              <button onClick={handleAddGrant} disabled={saving} style={{ ...actionBtnStyle, backgroundColor: saving ? "#9ae6b4" : "#38a169", marginTop: "10px" }}>
                付与を登録する
              </button>
            </div>

            <div style={{ flex: 1, backgroundColor: "white", padding: "18px", borderRadius: "10px", border: "1px solid #e2e8f0", borderTop: "4px solid #3182ce" }}>
              <h3 style={{ marginTop: 0, marginBottom: "12px", fontSize: "16px", color: "#2b6cb0" }}>
                有給を取った日の入れ方
              </h3>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", lineHeight: 1.7, color: "#334155" }}>
                <li>
                  有給を取った日は、勤怠の画面で「全休(有給)」「半休(有給)」「時間有給」を入れて確定してください。
                  ここには、確定した勤怠の有給が出ます（給与の計算と同じ記録です。この画面で別に記録する必要はありません）。
                </li>
                <li>
                  時間単位の有給は、1日＝{H}時間で数えます
                  {hoursInfo.assumed
                    ? "（1日の所定労働時間が入っていないので、8時間）。"
                    : `（1日の所定労働時間 ${formatScheduledHours(staff?.scheduled_work_hours)} を、1時間に満たない端数を切り上げた時間。労働基準法施行規則24条の4）。`}
                </li>
                <li>期限の早い付与（ふつうは古い付与）から先に引きます。</li>
                <li>有効期限が過ぎた分は、自動で残りから外し、「期限で消えた」に出します。</li>
              </ul>
            </div>
          </div>

          {/* 表 */}
          <div style={{ backgroundColor: "white", padding: "20px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <h3 style={sectionTitleStyle("#3498db")}>年次有給休暇の付与</h3>
            <table style={tableStyle}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={thStyle}>付与日（基準日）</th>
                  <th style={thStyle}>有効期限</th>
                  <th style={thStyle}>付与日数</th>
                  <th style={thStyle}>使った</th>
                  <th style={thStyle}>期限で消えた</th>
                  <th style={thStyle}>今日の残り</th>
                  <th style={thStyle}>状態</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {view.summary.grants.length > 0 ? view.summary.grants.map(gs => (
                  <tr key={gs.grant.id}>
                    <td style={tdStyle}>{gs.grant.grant_date}</td>
                    <td style={tdStyle}>{gs.grant.expiry_date}</td>
                    <td style={tdStyle}>{fmt(gs.grantedMinutes)}</td>
                    <td style={tdStyle}>
                      {fmt(gs.usedMinutes)}
                      {gs.laterMinutes > 0 && <div style={{ fontSize: "11px", color: "#64748b" }}>このあと {fmt(gs.laterMinutes)} 使う予定</div>}
                    </td>
                    <td style={{ ...tdStyle, color: gs.expiredMinutes > 0 ? "#b45309" : "#cbd5e1" }}>
                      {gs.expiredMinutes > 0 ? fmt(gs.expiredMinutes) : "-"}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: "bold", color: gs.state === "active" ? "#2c3e50" : "#cbd5e1" }}>
                      {gs.state === "active" ? fmt(gs.remainingMinutes) : gs.state === "upcoming" ? "（付与日から）" : "-"}
                    </td>
                    <td style={tdStyle}>
                      <span style={stateStyle(gs.state)}>
                        {gs.state === "active" ? "使える" : gs.state === "upcoming" ? "これから" : "期限切れ"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <button style={smallBtnStyle("#e53e3e")} onClick={() => handleDeleteGrant(gs.grant, gs.usedMinutes + gs.laterMinutes)}>取り消す</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>年次有給休暇の付与は、まだありません</td></tr>
                )}
              </tbody>
            </table>

            <h3 style={{ ...sectionTitleStyle("#94a3b8"), marginTop: "30px" }}>有給を取った日</h3>
            <table style={tableStyle}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={thStyle}>取った日</th>
                  <th style={thStyle}>日数</th>
                  <th style={thStyle}>入れた所</th>
                  <th style={thStyle}>引いた付与</th>
                  <th style={thStyle}>備考</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {view.summary.taken.length > 0 ? [...view.summary.taken].reverse().map(t => (
                  <tr key={`${t.date}-${t.source}-${t.manualId ?? ""}`}>
                    <td style={tdStyle}>{t.date}</td>
                    <td style={tdStyle}>{formatTakenAmount(t)}</td>
                    <td style={tdStyle}>{t.source === "attendance" ? "勤怠" : "有給の画面（前の記録）"}</td>
                    <td style={tdStyle}>
                      {t.allocations.length > 0
                        ? t.allocations.map(a => `${view.grantDateOf.get(a.grantId)}の付与から${fmt(a.minutes)}`).join("、")
                        : "-"}
                    </td>
                    <td style={tdStyle}>
                      {t.shortageMinutes > 0 && <div style={{ color: "#c53030", fontWeight: "bold" }}>残りが足りません（{fmt(t.shortageMinutes)}）</div>}
                      {t.beforeFirstGrant && (
                        <div style={{ color: "#94a3b8" }}>
                          {view.summary.hasGrants ? "最初の付与より前なので、引いていません" : "付与が登録されていないので、引いていません"}
                        </div>
                      )}
                      {t.afterAsOf && <div style={{ color: "#64748b" }}>今日より後の日（予定。今日の残りからは、まだ引いていません）</div>}
                    </td>
                    <td style={tdStyle}>
                      {t.source === "manual" && (
                        <button
                          style={smallBtnStyle("#e53e3e")}
                          onClick={() => {
                            const rec = data?.manual.find(m => m.id === t.manualId);
                            if (rec) handleDeleteManual(rec);
                          }}
                        >
                          取り消す
                        </button>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>有給を取った日は、まだありません（勤怠で確定した有給が出ます）</td></tr>
                )}
              </tbody>
            </table>

            {view.uncountedManual.length > 0 && (
              <>
                <h3 style={{ ...sectionTitleStyle("#cbd5e1"), marginTop: "30px" }}>数えていない、前の記録</h3>
                <p style={hintStyle}>
                  前に有給の画面で記録した取得のうち、確定した勤怠と同じ日の分です。勤怠のほうを正しい記録として使っています。要らなければ取り消してください。
                </p>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={thStyle}>日付</th>
                      <th style={thStyle}>日数</th>
                      <th style={thStyle}>数えていない理由</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.uncountedManual.map(c => (
                      <tr key={c.record.id}>
                        <td style={tdStyle}>{c.record.usage_date}</td>
                        <td style={tdStyle}>{c.record.days_used}日</td>
                        <td style={tdStyle}>{c.reason}</td>
                        <td style={tdStyle}>
                          <button style={smallBtnStyle("#e53e3e")} onClick={() => handleDeleteManual(c.record)}>取り消す</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

          </div>

          <SpecialLeaveSection
            types={leaveTypes}
            grants={data?.specialGrants ?? []}
            days={data?.specialDays ?? []}
            today={today}
            hoursPerDay={H}
            busy={specialBusy}
            onAddGrant={handleAddSpecialGrant}
            onDeleteGrant={handleDeleteSpecialGrant}
          />
        </>
      )}
    </div>
  );
};

// スタイル定数
const miniLabelStyle = { fontSize: "11px", color: "#64748b", fontWeight: "bold", display: "block", marginBottom: "4px" };
const formInputStyle = { width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "14px", boxSizing: "border-box" as const };
const actionBtnStyle = { width: "100%", padding: "10px", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const };
const thStyle = { padding: "12px 10px", textAlign: "left" as const, fontSize: "12px", color: "#64748b", borderBottom: "2px solid #e2e8f0" };
const tdStyle = { padding: "12px 10px", fontSize: "14px", borderBottom: "1px solid #f1f5f9" };
const hintStyle: React.CSSProperties = { fontSize: "11px", color: "#64748b", margin: "8px 0 0", lineHeight: 1.6 };
const sectionTitleStyle = (color: string): React.CSSProperties => ({
  marginTop: 0, fontSize: "15px", borderLeft: `4px solid ${color}`, paddingLeft: "10px", marginBottom: "15px",
});
const noticeStyle = (background: string, color: string): React.CSSProperties => ({
  backgroundColor: background, color, padding: "10px 14px", borderRadius: "8px", fontSize: "13px", lineHeight: 1.6, marginBottom: "12px",
});
const smallBtnStyle = (color: string): React.CSSProperties => ({
  padding: "3px 10px", fontSize: "12px", borderRadius: "4px", border: `1px solid ${color}`, backgroundColor: "white", color, cursor: "pointer",
});
const stateStyle = (state: "upcoming" | "active" | "expired"): React.CSSProperties => {
  const color = state === "active" ? "#2f855a" : state === "upcoming" ? "#2b6cb0" : "#94a3b8";
  return { fontSize: "12px", fontWeight: "bold", color, border: `1px solid ${color}`, borderRadius: "10px", padding: "1px 8px" };
};
const filterLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: "bold",
  color: "#64748b",
  minWidth: "40px"
};

const getFilterButtonStyle = (isActive: boolean, color: string): React.CSSProperties => ({
  padding: "4px 14px",
  borderRadius: "15px",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: color,
  backgroundColor: isActive ? color : "white",
  color: isActive ? "white" : color,
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: "bold",
  transition: "0.2s",
  whiteSpace: "nowrap",
  outline: "none"
});
export default PaidLeaveManager;
