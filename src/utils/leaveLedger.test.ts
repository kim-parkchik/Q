import { describe, expect, test } from "bun:test";
import { fiveDayStatuses } from "./annualLeaveGrant";
import { buildLeaveLedger, leaveAmountLabel, leaveLedgerCsv, takenKindLabel } from "./leaveLedger";
import { collectLeaveTaken, summarizePaidLeave, type LeaveGrantRow } from "./paidLeave";

const grants: LeaveGrantRow[] = [
  { id: 1, name: "法定有給", grant_date: "2025-10-01", expiry_date: "2027-09-30", days_granted: 10 },
  { id: 2, name: "法定有給", grant_date: "2026-10-01", expiry_date: "2028-09-30", days_granted: 11 },
  { id: 3, name: "夏季休暇", grant_date: "2026-07-01", expiry_date: "2026-09-30", days_granted: 3 },
];
const attendance = [
  { work_date: "2025-09-20", work_type: "paid_full" },        // 最初の付与より前（Q で管理する前）
  { work_date: "2025-11-10", work_type: "paid_full" },
  { work_date: "2025-12-24", work_type: "paid_half" },
  { work_date: "2026-03-02", work_type: "normal", paid_leave_hours: 2 },
  { work_date: "2026-08-12", work_type: "paid_full" },
  { work_date: "2026-08-13", work_type: "paid_full" },
  { work_date: "2026-08-14", work_type: "paid_full" },
  { work_date: "2026-10-05", work_type: "paid_full" },
];

describe("年次有給休暇管理簿（労働基準法施行規則24条の7：時季・日数・基準日）", () => {
  const { taken } = collectLeaveTaken(attendance, []);
  const summary = summarizePaidLeave(grants, taken, 8, "2026-11-17");
  const fiveDays = fiveDayStatuses(grants, taken, "2026-11-17", { halfDayLeave: true, planned: [] });
  const ledger = buildLeaveLedger(summary, fiveDays);

  test("付与（基準日）ごとに、取った日（時季）・取った合計・残り。夏季休暇などは入れない", () => {
    expect(ledger.grants.map((g) => [g.grantDate, g.grantedDays])).toEqual([["2026-10-01", 11], ["2025-10-01", 10]]);
    const old = ledger.grants[1];
    // 2026-10-05 は、期限の早い前の付与から引く
    expect(old.taken.map((t) => [t.date, leaveAmountLabel(t.minutes, ledger.dayMinutes), takenKindLabel(t)])).toEqual([
      ["2025-11-10", "1日", "全休"], ["2025-12-24", "0.5日", "半休"], ["2026-03-02", "2時間", "時間有給 2時間"],
      ["2026-08-12", "1日", "全休"], ["2026-08-13", "1日", "全休"], ["2026-08-14", "1日", "全休"], ["2026-10-05", "1日", "全休"],
    ]);
    expect(leaveAmountLabel(old.takenMinutes, ledger.dayMinutes)).toBe("5日と6時間");
    expect(leaveAmountLabel(old.remainingMinutes, ledger.dayMinutes)).toBe("4日と2時間");
    expect(ledger.grants[0].taken).toEqual([]);
    expect(ledger.beforeFirstGrant).toEqual([{ date: "2025-09-20", days: 1, hours: 0 }]);
  });

  test("年5日：基準日から1年に、全休・半休で5日（時間単位は数えない）", () => {
    const old = ledger.grants[1].fiveDays!;
    expect([old.from, old.to, old.takenDays, old.state]).toEqual(["2025-10-01", "2026-09-30", 4.5, "overdue"]);
    expect(ledger.grants[0].fiveDays!.state).toBe("ongoing");
  });

  test("CSV：1行に1つの取った日（取った日がない付与も1行）", () => {
    const lines = leaveLedgerCsv([{ staffId: "1001", name: "山田　太郎", ledger }]).split("\r\n");
    expect(lines[0]).toBe("社員番号,氏名,基準日（付与日）,有効期限,付与日数,取得日（時季）,取得の種類,この付与から引いた日数,取得日数の合計,期限で消えた日数,残日数,年5日の期間,年5日の取得日数,年5日の状況");
    expect(lines[1]).toBe("1001,山田　太郎,2026-10-01,2028-09-30,11,,,,0日,0日,11日,2026-10-01〜2027-09-30,1,あと4日");
    expect(lines[2]).toBe("1001,山田　太郎,2025-10-01,2027-09-30,10,2025-11-10,全休,1日,5日と6時間,0日,4日と2時間,2025-10-01〜2026-09-30,4.5,期間が過ぎて足りない");
  });
});
