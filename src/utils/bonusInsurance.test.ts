/**
 * 賞与の標準賞与額の上限（前に支払った賞与との累計）と、賞与の所得税に使う「前月の給与」の状況のテスト
 * 実行方法: bun test
 */
import { describe, expect, test } from "bun:test";
import {
    bonusFiscalYearOf, cappedBonusStandard, earlierBonusTotals, isEarlierBonus, isHealthInsuredOn, isPensionInsuredOn, prevSalaryStatusOf,
    type OtherBonus,
} from "./bonusInsurance";

const HEALTH_LIMIT = 5_730_000;
const PENSION_LIMIT = 1_500_000;
/** 社会保険に加入している役員（標準報酬月額 650,000円） */
const staff = { id: "S001", join_date: "2020-04-01", birthday: "1970-05-10", standard_remuneration: 650000 };
const bonus = (settingId: number, paymentDate: string, standard: number): OtherBonus => ({ settingId, paymentDate, standard });

describe("どの賞与が前か・年度", () => {
    test("支給日が前の賞与。同じ日なら先に作った賞与", () => {
        expect(isEarlierBonus(bonus(1, "2026-07-10", 0), { settingId: 2, paymentDate: "2026-12-10" })).toBe(true);
        expect(isEarlierBonus(bonus(3, "2026-12-10", 0), { settingId: 2, paymentDate: "2026-07-10" })).toBe(false);
        expect(isEarlierBonus(bonus(1, "2026-07-10", 0), { settingId: 2, paymentDate: "2026-07-10" })).toBe(true);
        expect(isEarlierBonus(bonus(3, "2026-07-10", 0), { settingId: 2, paymentDate: "2026-07-10" })).toBe(false);
    });
    test("健康保険の年度は4月〜翌年3月", () => {
        expect(bonusFiscalYearOf("2026-03-31")).toBe(2025);
        expect(bonusFiscalYearOf("2026-04-01")).toBe(2026);
    });
});

describe("健康保険の標準賞与額は、年度の累計573万円まで（前に支払った賞与だけを数える）", () => {
    // 夏（7月）400万円・冬（12月）400万円
    const others = [bonus(1, "2026-07-10", 4_000_000), bonus(2, "2026-12-10", 4_000_000)];

    test("冬の賞与を入れた後で夏の賞与を開いても、夏の賞与は400万円で計算する（後で支払う冬の賞与は数えない）", () => {
        const summer = earlierBonusTotals(staff, others, { settingId: 1, paymentDate: "2026-07-10" });
        expect(summer.health).toBe(0);
        expect(cappedBonusStandard(4_000_000, summer.health, HEALTH_LIMIT)).toBe(4_000_000);
    });
    test("冬の賞与は、夏の400万円と合わせて573万円まで（173万円）", () => {
        const winter = earlierBonusTotals(staff, others, { settingId: 2, paymentDate: "2026-12-10" });
        expect(winter.health).toBe(4_000_000);
        expect(cappedBonusStandard(4_000_000, winter.health, HEALTH_LIMIT)).toBe(1_730_000);
        // 上限に届いた後の賞与は0円
        expect(cappedBonusStandard(500_000, 4_000_000 + 4_000_000, HEALTH_LIMIT)).toBe(0);
    });
    test("前の年度（3月まで）に支払った賞与は数えない", () => {
        const t = earlierBonusTotals(staff, [bonus(1, "2026-03-25", 3_000_000)], { settingId: 2, paymentDate: "2026-07-10" });
        expect(t.health).toBe(0);
    });
    test("育休で保険料が免除された賞与も数える（標準賞与額は決まる）", () => {
        const onLeave = { ...staff, leave_periods: JSON.stringify([{ type: "childcare", start: "2026-06-01", end: "2027-05-31" }]) };
        const t = earlierBonusTotals(onLeave, [bonus(1, "2026-07-10", 3_000_000)], { settingId: 2, paymentDate: "2026-12-10" });
        expect(t.health).toBe(3_000_000);
    });
    test("入社日より前・退職日の翌日以後・75歳の誕生日以後に支払った賞与は、この会社の健康保険の標準賞与額が決まらないので数えない", () => {
        const joined = { ...staff, join_date: "2026-08-01" };
        expect(earlierBonusTotals(joined, [bonus(1, "2026-07-10", 3_000_000)], { settingId: 2, paymentDate: "2026-12-10" }).health).toBe(0);
        // 7月31日に退職 → 8月1日に資格喪失。7月31日（資格喪失日の前日）に支払った賞与は数える
        const retired = { ...staff, retirement_date: "2026-07-31" };
        expect(isHealthInsuredOn(retired, "2026-07-31")).toBe(true);
        expect(isHealthInsuredOn(retired, "2026-08-01")).toBe(false);
        // 1951年8月20日生まれ → 2026年8月20日に75歳（後期高齢者医療制度へ）
        const old = { ...staff, birthday: "1951-08-20" };
        expect(isHealthInsuredOn(old, "2026-08-19")).toBe(true);
        expect(isHealthInsuredOn(old, "2026-08-20")).toBe(false);
        // 社会保険に入っていない月（標準報酬月額 0）も数えない
        expect(isHealthInsuredOn({ ...staff, standard_remuneration: 0 }, "2026-07-10")).toBe(false);
    });
});

describe("厚生年金の標準賞与額は、同じ月に合わせて150万円まで", () => {
    test("同じ月の前の賞与と合わせて150万円まで（ほかの月の賞与は関係ない）", () => {
        const others = [bonus(1, "2026-07-10", 1_000_000), bonus(3, "2026-06-30", 1_500_000)];
        const t = earlierBonusTotals(staff, others, { settingId: 2, paymentDate: "2026-07-25" });
        expect(t.pensionSameMonth).toBe(1_000_000);
        expect(cappedBonusStandard(1_000_000, t.pensionSameMonth, PENSION_LIMIT)).toBe(500_000);
        // 先に支払った方は150万円まで（後の賞与は数えない）
        const first = earlierBonusTotals(staff, [bonus(2, "2026-07-25", 1_000_000)], { settingId: 1, paymentDate: "2026-07-10" });
        expect(first.pensionSameMonth).toBe(0);
    });
    test("70歳に達した日（誕生日の前日）から、厚生年金の被保険者ではない", () => {
        // 1956年8月20日生まれ → 2026年8月19日に70歳に達する
        const seventy = { ...staff, birthday: "1956-08-20" };
        expect(isPensionInsuredOn(seventy, "2026-08-18")).toBe(true);
        expect(isPensionInsuredOn(seventy, "2026-08-19")).toBe(false);
    });
});

describe("賞与の所得税に使う、前月の給与の状況", () => {
    // 6月に支払う給与の計算期間（末締め・当月払いなら6月1日〜30日、翌月払いなら5月1日〜31日）
    const june = { startStr: "2026-06-01", endStr: "2026-06-30" };
    test("前月の給与を確定していれば confirmed", () => {
        expect(prevSalaryStatusOf(staff, true, june, 2026, 6)).toBe("confirmed");
    });
    test("前月に支払う給与の計算期間に在籍していたのに確定していなければ unconfirmed（前月の給与がないものとして計算してしまう）", () => {
        expect(prevSalaryStatusOf(staff, false, june, 2026, 6)).toBe("unconfirmed");
        expect(prevSalaryStatusOf({ join_date: "2026-06-20" }, false, june, 2026, 6)).toBe("unconfirmed");
    });
    test("前月に支払う給与の計算期間に在籍していなければ none（前月の給与がない。月額表を使う方法でよい）", () => {
        expect(prevSalaryStatusOf({ join_date: "2026-07-01" }, false, june, 2026, 6)).toBe("none");
        // 翌月払いで、6月に支払う給与は5月の勤務分 → 6月1日に入社した人には、6月に支払う給与はない
        expect(prevSalaryStatusOf({ join_date: "2026-06-01" }, false, { startStr: "2026-05-01", endStr: "2026-05-31" }, 2026, 6)).toBe("none");
        expect(prevSalaryStatusOf({ join_date: "2020-04-01", retirement_date: "2026-05-31" }, false, june, 2026, 6)).toBe("none");
    });
    test("計算期間がわからなければ、前月の1日〜末日で見る", () => {
        expect(prevSalaryStatusOf({ join_date: "2026-06-15" }, false, null, 2026, 6)).toBe("unconfirmed");
        expect(prevSalaryStatusOf({ join_date: "2026-07-01" }, false, null, 2026, 6)).toBe("none");
    });
});
