/**
 * Q の会社独自の休暇（特別休暇）の画面を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/leave.html を開く
 * ・会社設定の「休暇の種類」タブ（src/features/settings/company/LeaveTypeTab.tsx）：会社ファイルの代わりに、ページの中の表（fakeDb）に保存する
 * ・有給休暇管理の画面の特別休暇の部分（src/features/attendance/SpecialLeavePanel.tsx）：発生の日が来た付与の知らせ・付与・取り消し
 * ・勤怠の表の区分（src/features/attendance/manager/AttendanceTable.tsx）と知らせ（PaidLeaveNotice.tsx）：
 *   休暇を選んで確定すると、下の給与の計算（src/utils/calcSalary.ts）が変わる。時間休（時間単位の特別休暇）と、休憩の一覧の中抜けの印も試せる
 * ・子の看護等休暇・介護休暇は、「休暇の種類」の「見本から作る」で作る
 */
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../../src/components/Toast";
import { MessageDialogProvider } from "../../src/components/MessageDialog";
import LeaveTypeTab from "../../src/features/settings/company/LeaveTypeTab";
import { DueGrantBanner, SpecialLeaveSection } from "../../src/features/attendance/SpecialLeavePanel";
import AttendanceTable from "../../src/features/attendance/manager/AttendanceTable";
import PaidLeaveNotice from "../../src/features/attendance/manager/PaidLeaveNotice";
import { calculateSalary } from "../../src/utils/calcSalary";
import { calcDayHours } from "../../src/utils/fixedBreak";
import { effectiveBreaks } from "../../src/utils/breaks";
import {
  dueGrants, isSpecialLeaveWorkType, leaveTypeFromRow, maxHourlyLeave, parseLeaveOption, summarizeSpecialLeave,
  type GrantRecord, type LeaveType, type SpecialLeaveDay, type SpecialLeaveGrantRow,
} from "../../src/utils/specialLeave";
import { formatLeaveMinutes } from "../../src/utils/paidLeave";

// ── Tauri の代わり（確かめを出す画面は、いつも「はい」にする） ──
(window as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    if (cmd.startsWith("plugin:dialog|")) {
      console.info("確かめ（自動で「はい」）:", args?.message);
      // ask は、押したボタンの名前が okLabel（初めは "Yes"）なら「はい」とみなす
      const b = args?.buttons;
      if (b?.OkCancelCustom) return b.OkCancelCustom[0];
      if (b?.OkCustom) return b.OkCustom;
      return b === "YesNo" ? "Yes" : b === "OkCancel" ? "Ok" : true;
    }
    return null;
  },
  transformCallback: () => 0,
};

const TODAY = "2026-11-12";

// ── 会社ファイルの代わり（ページの中の表） ──
const store = {
  leaveTypes: [
    { id: 1, name: "夏季休暇", is_paid: 1, track_balance: 1, allow_half: 1, allow_hourly: 0, grant_rule: JSON.stringify({ month: 7, day: 1, days: 3 }), expiry_rule: JSON.stringify({ mode: "date", month: 9, day: 30 }), is_active: 1, sort_order: 0 },
    { id: 2, name: "慶弔休暇", is_paid: 1, track_balance: 0, allow_half: 0, allow_hourly: 0, grant_rule: null, expiry_rule: JSON.stringify({ mode: "months", months: 12 }), is_active: 1, sort_order: 1 },
    { id: 3, name: "リフレッシュ休暇", is_paid: 0, track_balance: 1, allow_half: 1, allow_hourly: 0, grant_rule: JSON.stringify({ month: 11, day: 1, days: 2 }), expiry_rule: JSON.stringify({ mode: "months", months: 3 }), is_active: 1, sort_order: 2 },
  ] as any[],
  grants: [
    { id: 1, staff_id: "1001", leave_type_id: 1, grant_date: "2026-07-01", expiry_date: "2026-09-30", days_granted: 3 },
    { id: 2, staff_id: "1002", leave_type_id: 1, grant_date: "2026-07-01", expiry_date: "2026-09-30", days_granted: 3 },
  ] as (SpecialLeaveGrantRow & { staff_id: string })[],
  // 前の月までに確定した特別休暇の日（山田さん）
  history: [
    { work_date: "2026-08-10", work_type: "special", leave_type_id: 1 },
    { work_date: "2026-08-11", work_type: "special_half", leave_type_id: 1 },
  ] as SpecialLeaveDay[],
};
let nextId = 100;
(window as any).__leaveStore = store; // 確かめのとき、ページの外から中身を見る
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

const fakeDb = {
  async select(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM leave_types ORDER BY")) {
      return [...store.leaveTypes].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    }
    if (q.includes("COUNT(*) FROM attendance WHERE leave_type_id")) {
      const id = Number(params[0]);
      return [{ days: store.history.filter((d) => Number(d.leave_type_id) === id).length, grants: store.grants.filter((g) => g.leave_type_id === id).length }];
    }
    console.warn("fakeDb: 知らない SELECT", q, params);
    return [];
  },
  async execute(sql: string, params: any[] = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("INSERT INTO leave_types")) {
      const [name, is_paid, track_balance, allow_half, allow_hourly, grant_rule, expiry_rule, is_active, sort_order] = params;
      store.leaveTypes.push({ id: nextId++, name, is_paid, track_balance, allow_half, allow_hourly, grant_rule, expiry_rule, is_active, sort_order });
    } else if (q.startsWith("UPDATE leave_types SET")) {
      const [name, is_paid, track_balance, allow_half, allow_hourly, grant_rule, expiry_rule, is_active, id] = params;
      const t = store.leaveTypes.find((x) => x.id === Number(id));
      if (t) Object.assign(t, { name, is_paid, track_balance, allow_half, allow_hourly, grant_rule, expiry_rule, is_active });
    } else if (q.startsWith("DELETE FROM leave_types")) {
      store.leaveTypes = store.leaveTypes.filter((x) => x.id !== Number(params[0]));
      console.info("fakeDb: 休暇の種類を消した", params[0]);
    } else if (!q.startsWith("INSERT INTO app_logs")) {
      console.warn("fakeDb: 知らない EXECUTE", q, params);
    }
    notify();
    return { rowsAffected: 1 };
  },
};

const staffList = [
  { id: "1001", name: "山田 太郎", status: "active", join_date: "2020-04-01", retirement_date: null },
  { id: "1002", name: "佐藤 花子", status: "active", join_date: "2026-11-05", retirement_date: null },
  { id: "1003", name: "鈴木 一郎", status: "active", join_date: "2018-10-01", retirement_date: null },
];
const monthly = { id: "1001", name: "山田 太郎", wage_type: "monthly", base_wage: 300000, scheduled_work_hours: 8, commute_type: "none", commute_amount: 0, standard_remuneration: 0, birthday: "1990-06-15" };
const hourly = { ...monthly, wage_type: "hourly", base_wage: 1200 };

const DATES = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
const blankRow = () => ({
  in: "09:00", out: "18:00", breaks: [{ start: "12:00", end: "13:00" }], csvBreaks: [], is_finalized: 0, workType: "normal",
  leaveTypeId: null as number | null, leavePaid: null as number | null, specialHours: 0, paidHours: 0, memo: "", savedHours: 0, nightHours: 0,
  breakNone: false, autoBreak: "", csv_entry_time: "", csv_exit_time: "",
});

function useLeaveTypes() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  useEffect(() => {
    const load = () => setTypes([...store.leaveTypes].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map(leaveTypeFromRow));
    load();
    listeners.add(load);
    return () => { listeners.delete(load); };
  }, []);
  return types;
}

function Page() {
  const types = useLeaveTypes();
  const [, setTick] = useState(0);
  const refresh = () => { setTick((t) => t + 1); notify(); };
  const [rows, setRows] = useState<Record<string, any>>(() => Object.fromEntries(DATES.map((d) => [d, blankRow()])));

  // 勤怠の画面の代わり（useAttendanceManager と同じ動き）
  const am: any = {
    isLoading: false, isClosed: false, monthlyWorkData: rows, dateList: DATES, holidays: {}, companyHolidays: {},
    fixedBreakRule: null, breakInfo: {}, hourlyLeaveEnabled: false, leaveTypes: types, paidLeave: null,
    handleCellChange: (date: string, field: string, value: any) => setRows((p) => ({ ...p, [date]: { ...p[date], [field]: value } })),
    handleWorkTypeChange: (date: string, value: string) => {
      const { workType, leaveTypeId } = parseLeaveOption(value);
      const special = isSpecialLeaveWorkType(workType);
      setRows((p) => ({ ...p, [date]: { ...p[date], workType, leaveTypeId: special ? leaveTypeId : p[date].specialHours > 0 ? p[date].leaveTypeId : null, specialHours: special ? 0 : p[date].specialHours } }));
    },
    handleHourlyLeaveTypeChange: (date: string, leaveTypeId: number | null) => setRows((p) => ({ ...p, [date]: { ...p[date], leaveTypeId } })),
    finalizeAttendance: async (date: string) => {
      const row = rows[date];
      const special = isSpecialLeaveWorkType(row.workType);
      const hours = special ? 0 : Number(row.specialHours) || 0;
      if (hours > maxHourlyLeave(8) || !Number.isInteger(hours)) { alert(`${date} の時間休は ${maxHourlyLeave(8)}時間まで`); return false; }
      const t = special || hours > 0 ? types.find((x) => x.id === Number(row.leaveTypeId)) : undefined;
      if ((special || hours > 0) && !t) { alert(`${date} の休暇の種類がわかりません`); return false; }
      const total = row.workType === "special" ? 0 : calcDayHours({ entry: row.in, exit: row.out, breaks: effectiveBreaks(row.breaks, row.csvBreaks) }, null).total;
      setRows((p) => ({ ...p, [date]: { ...p[date], is_finalized: 1, savedHours: total, specialHours: hours, leavePaid: t ? (t.paid ? 1 : 0) : null } }));
      return true;
    },
    unfinalizeAttendance: async (date: string) => setRows((p) => ({ ...p, [date]: { ...p[date], is_finalized: 0, leavePaid: null } })),
  };
  // 勤怠の画面の知らせ（useAttendanceManager の specialLeave と同じ数え方）
  const yamadaGrants = store.grants.filter((g) => g.staff_id === "1001");
  const periodDays: SpecialLeaveDay[] = [
    ...store.history,
    ...DATES.filter((d) => isSpecialLeaveWorkType(rows[d].workType) || rows[d].specialHours > 0)
      .map((d) => ({ work_date: d, work_type: rows[d].workType, leave_type_id: rows[d].leaveTypeId, special_leave_hours: rows[d].specialHours })),
  ];
  const inPeriod = (d: string) => d >= DATES[0] && d <= DATES[DATES.length - 1];
  am.specialLeave = {
    asOf: DATES[DATES.length - 1],
    types: types.map((t) => summarizeSpecialLeave(t, yamadaGrants, periodDays, DATES[DATES.length - 1], 8))
      .filter((s) => s.taken.some((t) => inPeriod(t.date)) || (s.type.active && s.type.trackBalance && s.hasGrants))
      .map((s) => {
        const taken = s.taken.filter((t) => inPeriod(t.date)).reduce((sum, t) => sum + t.minutes, 0);
        return {
          id: s.type.id, name: s.type.name, paid: s.type.paid, trackBalance: s.type.trackBalance, hasGrants: s.hasGrants,
          remainingText: formatLeaveMinutes(s.remainingMinutes, 8),
          takenInPeriod: taken > 0 ? formatLeaveMinutes(taken, 8) : "",
          shortages: s.shortages.filter((t) => inPeriod(t.date)).map((t) => ({ date: t.date, shortage: formatLeaveMinutes(t.shortageMinutes, 8) })),
        };
      }),
    unknownDates: DATES.filter((d) => (isSpecialLeaveWorkType(rows[d].workType) || rows[d].specialHours > 0) && !types.some((t) => t.id === Number(rows[d].leaveTypeId))),
  };

  // 給与の計算（確定した日だけ）
  const finalized = DATES.filter((d) => rows[d].is_finalized === 1).map((d) => ({
    work_date: d, work_hours: rows[d].savedHours, night_hours: 0, work_type: rows[d].workType, leave_paid: rows[d].leavePaid, paid_leave_hours: 0,
    special_leave_hours: rows[d].specialHours,
  }));
  const extras = { allowanceName: "", allowanceAmount: 0, residentTax: 0, prefecture: "東京", dependents: 0, customItems: [], periodWorkDays: 21, annualWorkDays: 245, tardyDeductionMethod: "annual" as const };
  const rMonthly = calculateSalary(monthly, finalized, extras, 2026, 11, { week_start_day: 0, round_overtime: "round" });
  const rHourly = calculateSalary(hourly, finalized, extras, 2026, 11, { week_start_day: 0, round_overtime: "round" });

  const dues = useMemo(() => dueGrants(types, staffList, store.grants as GrantRecord[], TODAY), [types, store.grants.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 28 }}>
      <section>
        <h2 id="settings">1. 会社設定の「休暇の種類」</h2>
        <LeaveTypeTab db={fakeDb} />
      </section>

      <section>
        <h2 id="leave">2. 有給休暇管理（今日は {TODAY}。山田 太郎さんを選んだところ）</h2>
        <DueGrantBanner dues={dues} busy={false} onGrant={(due, ids, days) => {
          for (const id of ids) store.grants.push({ id: nextId++, staff_id: id, leave_type_id: due.type.id, grant_date: due.grantDate, expiry_date: due.expiryDate, days_granted: days });
          refresh();
          return true;
        }} />
        <SpecialLeaveSection
          types={types}
          grants={yamadaGrants}
          days={[...store.history, ...DATES.filter((d) => rows[d].is_finalized === 1 && (isSpecialLeaveWorkType(rows[d].workType) || rows[d].specialHours > 0))
            .map((d) => ({ work_date: d, work_type: rows[d].workType, leave_type_id: rows[d].leaveTypeId, special_leave_hours: rows[d].specialHours }))]}
          today={TODAY}
          hoursPerDay={8}
          busy={false}
          onAddGrant={(g) => { store.grants.push({ id: nextId++, staff_id: "1001", leave_type_id: g.type.id, grant_date: g.grantDate, expiry_date: g.expiryDate, days_granted: g.days }); refresh(); }}
          onDeleteGrant={(_t, g) => { store.grants = store.grants.filter((x) => x.id !== g.id); refresh(); }}
        />
      </section>

      <section>
        <h2 id="attendance">3. 勤怠の画面（山田 太郎さん・11月9日〜13日）</h2>
        <PaidLeaveNotice am={am} />
        <div style={{ background: "white", borderRadius: 8, padding: 10 }}>
          <AttendanceTable am={am} />
        </div>
        <pre id="salary" style={{ background: "#fff", padding: 12, marginTop: 12, fontSize: 12 }}>
          {JSON.stringify({
            確定した日: finalized.map((r) => `${r.work_date} ${r.work_type}${r.special_leave_hours > 0 ? ` 時間休${r.special_leave_hours}h` : ""}${r.leave_paid === null ? "" : r.leave_paid ? "(有給)" : "(無給)"}`),
            月給300000円: { 支給合計: rMonthly.totalEarnings, 無給休暇控除: rMonthly.unpaidLeaveDeduction, 無給の時間: rMonthly.unpaidLeaveHours, 計算式: rMonthly.unpaidLeaveDeductionDetail, 遅刻早退控除: rMonthly.tardyDeduction, 有給の特別休暇の日数: rMonthly.specialLeaveDays },
            時給1200円: { 支給合計: rHourly.totalEarnings, 基本給: rHourly.basePay, 特別休暇手当: rHourly.specialLeavePay, 特別休暇の時間: rHourly.specialLeaveHours },
          }, null, 2)}
        </pre>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MessageDialogProvider>
    <ToastProvider>
      <Page />
    </ToastProvider>
  </MessageDialogProvider>,
);
