/**
 * Q の年次有給休暇の付与日の知らせと、年5日の取得（src/features/attendance/AnnualLeavePanel.tsx）を、見本の従業員で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/annual.html を開く
 * 会社の付与日の決まりを切り替えると、付与日・日数・出勤率が変わる（計算は src/utils/annualLeaveGrant.ts。会社ファイルの代わりに、ページの中の見本を使う）
 * 年5日：高橋さんは1年の期間が重なるのでまとめて按分（18か月で7.5日。「半休を使う」を外すと8日）、伊藤さんは10日を分けて付与した人
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AnnualGrantDueBanner, FiveDayOverview, StaffAnnualInfo } from "../../src/features/attendance/AnnualLeavePanel";
import {
  attendanceRateFor, dueAnnualGrants, grantDaysFor, plannedGrants, workScaleOf, type AnnualLeaveRule, type AttendanceForRate,
} from "../../src/utils/annualLeaveGrant";
import { fiveDaysOf, type StaffAnnualLeave } from "../../src/utils/annualLeaveOverview";
import type { CalendarContext } from "../../src/utils/annualWorkDays";
import { parseWorkDays } from "../../src/utils/annualWorkDays";
import dayjs from "dayjs";

const TODAY = "2026-11-13";
const ctxOf = (workDays: string): CalendarContext => ({ patternId: 0, workDays: parseWorkDays(workDays), holidays: new Set(), companyCalendar: {} });

/** from から to までの出勤する曜日に勤怠を入れる（absent の日は欠勤、paid の日は年休、half の日は半休） */
const attendance = (workDays: string, from: string, to: string, absent: string[] = [], paid: string[] = [], half: string[] = []): AttendanceForRate[] => {
  const days = parseWorkDays(workDays);
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const rows: AttendanceForRate[] = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, "day")) {
    if (!days[keys[d.day()]]) continue;
    const date = d.format("YYYY-MM-DD");
    rows.push(absent.includes(date) ? { work_date: date, work_type: "absent", work_hours: 0 }
      : paid.includes(date) ? { work_date: date, work_type: "paid_full", work_hours: 0 }
      : half.includes(date) ? { work_date: date, work_type: "paid_half", work_hours: 4 }
      : { work_date: date, work_type: "normal", work_hours: 8 });
  }
  return rows;
};
const grant = (id: number, date: string, days: number) => ({ id, name: "法定有給", grant_date: date, expiry_date: dayjs(date).add(2, "year").subtract(1, "day").format("YYYY-MM-DD"), days_granted: days });
const FULL = "mon,tue,wed,thu,fri";

const people = [
  {
    id: "1001", name: "山田 太郎", join_date: "2024-04-01", work_days: FULL, scheduled_work_hours: 8,
    grants: [grant(1, "2024-10-01", 10), grant(2, "2025-10-01", 11)],
    rows: attendance(FULL, "2025-10-01", "2026-11-12", ["2026-02-02", "2026-02-03", "2026-02-04"], ["2025-12-01", "2026-03-02", "2026-08-03"]),
  },
  {
    id: "1002", name: "佐藤 花子（パート・週3日・6時間）", join_date: "2026-04-15", work_days: "mon,wed,fri", scheduled_work_hours: 6,
    grants: [], rows: attendance("mon,wed,fri", "2026-08-01", "2026-11-12"),
  },
  {
    id: "1003", name: "鈴木 一郎", join_date: "2025-03-01", work_days: FULL, scheduled_work_hours: 8,
    grants: [grant(3, "2025-09-01", 10), grant(4, "2026-09-01", 11)],
    rows: attendance(FULL, "2025-09-01", "2026-11-12", [], ["2026-01-05", "2026-01-06", "2026-02-02", "2026-03-02", "2026-04-01", "2026-10-01"]),
  },
  {
    id: "1004", name: "高橋 二郎（4月1日にそろえて、期間が重なる）", join_date: "2025-04-01", work_days: FULL, scheduled_work_hours: 8,
    grants: [grant(5, "2025-10-01", 10), grant(6, "2026-04-01", 11)],
    rows: attendance(FULL, "2025-10-01", "2026-11-12", [], ["2025-12-01", "2026-01-05", "2026-05-11", "2026-08-03", "2026-09-01"]),
  },
  {
    id: "1005", name: "伊藤 三郎（入社日に5日・6か月後に5日）", join_date: "2026-04-01", work_days: FULL, scheduled_work_hours: 8,
    grants: [grant(7, "2026-04-01", 5), grant(8, "2026-10-01", 5)],
    rows: attendance(FULL, "2026-04-01", "2026-11-12", [], ["2026-06-01", "2026-09-01"]),
  },
];

const RULES: Record<string, AnnualLeaveRule> = {
  hire: { mode: "hire" },
  sixMonths: { mode: "unified", month: 4, day: 1, first: "sixMonths" },
  unifiedFirst: { mode: "unified", month: 4, day: 1, first: "unifiedFirst" },
};

function build(rule: AnnualLeaveRule, halfDayLeave: boolean): StaffAnnualLeave[] {
  return people.map((p) => {
    const ctx = ctxOf(p.work_days);
    const staff = { ...p, calendar_pattern_id: 0 };
    const planned = plannedGrants(p.join_date, rule, TODAY);
    const due = dueAnnualGrants(planned, p.grants, TODAY).map((g) => ({
      grant: g, ...grantDaysFor(g.stage, workScaleOf(staff, null)),
      rate: attendanceRateFor(g.periodFrom, g.periodTo, ctx, p.rows, [], g.deemedFrom && g.deemedTo ? { from: g.deemedFrom, to: g.deemedTo } : null),
    }));
    const nextPlan = planned.find((g) => g.date > TODAY) ?? null;
    const taken = p.rows
      .filter((r) => r.work_type === "paid_full" || r.work_type === "paid_half")
      .map((r) => ({ date: r.work_date, days: r.work_type === "paid_half" ? 0.5 : 1, hours: 0, source: "attendance" as const }));
    return {
      staffId: p.id, name: p.name, due, noJoinDate: false,
      next: nextPlan ? { date: nextPlan.date, stage: nextPlan.stage, legalDate: nextPlan.legalDate, ...grantDaysFor(nextPlan.stage, workScaleOf(staff, null)) } : null,
      fiveDays: fiveDaysOf(p, p.grants, taken, TODAY, { rule, halfDayLeave }),
    };
  });
}

function Page() {
  const [ruleKey, setRuleKey] = useState("hire");
  const [halfDay, setHalfDay] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const items = build(RULES[ruleKey], halfDay);
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <h2>年次有給休暇の付与日の知らせと年5日（今日は {TODAY}）</h2>
      <label style={{ display: "block", marginBottom: 6 }}>
        会社の付与日の決まり：
        <select id="rule" value={ruleKey} onChange={(e) => setRuleKey(e.target.value)}>
          <option value="hire">入社日ごと</option>
          <option value="sixMonths">毎年4月1日にそろえる（初回は入社6か月後）</option>
          <option value="unifiedFirst">毎年4月1日にそろえる（統一日が先なら初回から）</option>
        </select>
      </label>
      <label style={{ display: "block", marginBottom: 12 }}>
        <input id="halfDay" type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} /> 半日単位の有給（半休）を使う（会社設定の「基本情報」）
      </label>
      <AnnualGrantDueBanner items={items} rule={RULES[ruleKey]} busy={false}
        onGrant={(id, d) => setLog((l) => [...l, `付与する：${id} ${d.grant.date} ${d.days}日`])}
        onSkip={(id, d) => setLog((l) => [...l, `付与しない：${id} ${d.grant.date}`])} />
      <FiveDayOverview items={items} today={TODAY} />
      {items.map((s) => (
        <div key={s.staffId}>
          <h3 style={{ fontSize: 15 }}>{s.name}</h3>
          <StaffAnnualInfo info={s} today={TODAY} />
        </div>
      ))}
      <pre id="log">{log.join("\n")}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
