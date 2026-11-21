/**
 * 週44時間の特例（特例措置対象事業場。労働基準法施行規則25条の2）
 *
 * ・労働基準法 別表第一の第8号（商業）・第10号（映画・演劇業。映画の製作の事業を除く）・第13号（保健衛生業）・第14号（接客娯楽業）の事業のうち、
 *   常時10人未満の労働者を使用する事業場は、1週間44時間・1日8時間まで働かせられる（週40時間を超えても、44時間までは時間外労働にならない）
 * ・決まりは事業場ごとなので、Q では拠点（会社設定の支店リスト）ごとに、特例の事業（別表第一の号）を選ぶ（branches.weekly44_business。
 *   NULL なら特例を使わない）。その拠点の人の給与は、週44時間を超えた時間を時間外労働にする
 * ・常時10人未満か・どの事業かは、会社が決める（市販の勤怠ソフトと同じく、Q は判断しない）。拠点に在籍している人（役員を除く。
 *   パート・アルバイトも数える）が10人以上なら知らせる
 * ・フレックスタイム制は、清算期間が1か月以内のときだけ特例を使う（3項：法定の総枠は 44時間 × 暦日数 ÷ 7）。
 *   清算期間が1か月を超えるフレックスタイム制には使わない（4項。40時間で数える）
 * 数（44時間・10人未満・号）は、条文から scripts/import_work_hours.py で作った constants/workHours.ts
 */
import { LEGAL_WORK_HOURS, WEEKLY_44, WEEKLY_44_BUSINESSES } from "../constants/workHours";

/** 特例の事業（別表第一の号）。特例を使わないなら null */
export const parseWeekly44Business = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return WEEKLY_44_BUSINESSES.some((b) => b.item === n) ? n : null;
};

/** 拠点の特例の事業（拠点がなければ本店。特例を使わないなら null） */
export const weekly44BusinessOf = (
  branches: { id: unknown; weekly44_business?: unknown }[],
  branchId: unknown,
): number | null => {
  const id = Number(branchId) || 1;
  return parseWeekly44Business(branches.find((b) => Number(b.id) === id)?.weekly44_business);
};

/** 「第8号：物品の販売、配給、保管若しくは賃貸又は理容の事業」（第10号は「（映画の製作の事業を除く）」も付ける） */
export const weekly44BusinessLabel = (item: number): string => {
  const b = WEEKLY_44_BUSINESSES.find((x) => x.item === item);
  if (!b) return "";
  return `第${b.item}号：${b.name}${b.excluded ? `（${b.excluded}を除く）` : ""}`;
};

/** 選べる特例の事業（会社設定の支店リストの選ぶ欄） */
export const WEEKLY_44_OPTIONS: { value: number; label: string }[] = WEEKLY_44_BUSINESSES.map((b) => ({
  value: b.item, label: weekly44BusinessLabel(b.item),
}));

export interface WeeklyLegalHours {
  /** 週の法定労働時間（40時間か44時間） */
  hours: number;
  /** 週44時間の特例を使ったか */
  special: boolean;
  /** 拠点は特例の事業場だが、清算期間が1か月を超えるフレックスタイム制なので使わなかった（4項） */
  flexIgnored: boolean;
}

/**
 * 週の法定労働時間：拠点が特例の事業場なら44時間（清算期間が1か月を超えるフレックスタイム制の人は40時間）、ほかは40時間
 * @param flexMonths フレックスタイム制の人の清算期間（か月）。フレックスタイム制でなければ省略
 */
export const weeklyLegalHoursFor = (business: unknown, flexMonths?: number): WeeklyLegalHours => {
  const item = parseWeekly44Business(business);
  if (item === null) return { hours: LEGAL_WORK_HOURS.weekly, special: false, flexIgnored: false };
  if (flexMonths !== undefined && flexMonths > WEEKLY_44.flexMaxMonths) {
    return { hours: LEGAL_WORK_HOURS.weekly, special: false, flexIgnored: true };
  }
  return { hours: WEEKLY_44.weekly, special: true, flexIgnored: false };
};

/** 拠点に在籍している人（退職していない人。役員を除く。拠点を選んでいない人は本店）の数 */
export const branchWorkerCount = (
  staff: { branch_id?: unknown; status?: unknown; is_executive?: unknown }[],
  branchId: unknown,
): number => {
  const id = Number(branchId) || 1;
  return staff.filter((s) => (Number(s.branch_id) || 1) === id && String(s.status ?? "active") !== "retired" && Number(s.is_executive) !== 1).length;
};

/** 特例の事業場なのに、在籍している人が10人以上なら知らせる（常時10人未満の事業場だけが特例を使える） */
export const weekly44Problem = (business: unknown, workers: number): string | null => {
  if (parseWeekly44Business(business) === null || workers < WEEKLY_44.workersBelow) return null;
  return `この拠点に在籍している人（役員を除く）が${workers}人います。週${WEEKLY_44.weekly}時間の特例は、常時${WEEKLY_44.workersBelow}人未満の労働者を使用する事業場だけです`
    + "（パート・アルバイトも数えます。労働基準法施行規則25条の2）。特例を使えるか確かめてください。";
};
