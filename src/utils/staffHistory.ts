/**
 * 基本給（給与形態と金額）・扶養人数の履歴（何年何月分から、いくら・何人になったか）
 *
 * 昇給や、給与形態（時給制・日給制・月給制）の変更、扶養親族等の数の変更を、何年何月分の給与からかで残す。
 * 給与は、その月の分（支給する月）に当たる履歴の値で計算する。過去の月を計算し直しても、その月の値で計算する
 * （標準報酬月額の履歴 utils/standardRemuneration.ts と同じ考え方）。
 *
 * 履歴は従業員の wage_history・dependents_history（JSON）に入れる。最初の1件は「入社したときから」（from が空）。
 * 履歴がまだない人（以前の会社ファイル）は、今の base_wage・wage_type・dependents を入社したときから使う。
 * base_wage・wage_type・dependents には、いちばん新しい履歴の値も入れておく（従業員一覧の表示などで使う）。
 *
 * 時給制・日給制の人は、勤怠を確定した日に、その日の時給（日給）を勤怠に残している（attendance.actual_base_wage）。
 * 給与の計算は勤怠に残した時給を使うので、確定した後に履歴を変えたときは、勤怠を確定し直す（給与明細に注意を出す）。
 */

export type WageType = 'monthly' | 'daily' | 'hourly';

export const WAGE_TYPE_LABELS: Record<WageType, string> = { hourly: '時給制', daily: '日給制', monthly: '月給制' };

export const toWageType = (v: unknown): WageType => (v === 'monthly' || v === 'daily' ? v : 'hourly');

export interface WageEntry {
  /** 何年何月分から使うか（YYYY-MM）。最初の1件だけは空でもよい（入社したときから） */
  from: string;
  wageType: WageType;
  /** 時給・日給・月給の金額 */
  amount: number;
}

export interface DependentsEntry {
  /** 何年何月分から使うか（YYYY-MM）。最初の1件だけは空でもよい（入社したときから） */
  from: string;
  /** 源泉徴収税額表の扶養親族等の数 */
  count: number;
}

const nonNeg = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

const parseList = (json: unknown): any[] => {
  if (typeof json !== 'string' || !json.trim()) return [];
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.filter((e) => typeof e?.from === 'string') : [];
  } catch {
    return [];
  }
};

const sortByFrom = <T extends { from: string }>(entries: T[]): T[] => [...entries].sort((a, b) => a.from.localeCompare(b.from));

/** 従業員の wage_history（JSON の文字列）を読む。空・壊れているときは履歴なし */
export const parseWageHistory = (json: unknown): WageEntry[] =>
  parseList(json)
    .filter((e) => Number.isFinite(Number(e.amount)))
    .map((e) => ({ from: e.from, wageType: toWageType(e.wageType), amount: nonNeg(e.amount) }));

/** 従業員の dependents_history（JSON の文字列）を読む。空・壊れているときは履歴なし */
export const parseDependentsHistory = (json: unknown): DependentsEntry[] =>
  parseList(json)
    .filter((e) => Number.isFinite(Number(e.count)))
    .map((e) => ({ from: e.from, count: nonNeg(e.count) }));

/** 保存用の JSON（適用開始月の順に並べる） */
export const stringifyWageHistory = (entries: WageEntry[]): string =>
  JSON.stringify(sortByFrom(entries).map(({ from, wageType, amount }) => ({ from, wageType, amount: nonNeg(amount) })));

export const stringifyDependentsHistory = (entries: DependentsEntry[]): string =>
  JSON.stringify(sortByFrom(entries).map(({ from, count }) => ({ from, count: nonNeg(count) })));

/** 従業員の基本給の履歴。まだ履歴がない人は、今の給与形態・基本給を入社したときから使う1件として返す */
export const wageHistoryOf = (staff: any): WageEntry[] => {
  const history = parseWageHistory(staff?.wage_history);
  if (history.length > 0) return sortByFrom(history);
  return [{ from: '', wageType: toWageType(staff?.wage_type), amount: nonNeg(staff?.base_wage) }];
};

/** 従業員の扶養人数の履歴。まだ履歴がない人は、今の扶養人数を入社したときから使う1件として返す */
export const dependentsHistoryOf = (staff: any): DependentsEntry[] => {
  const history = parseDependentsHistory(staff?.dependents_history);
  if (history.length > 0) return sortByFrom(history);
  return [{ from: '', count: nonNeg(staff?.dependents) }];
};

/**
 * その月の分の履歴（その月までに始まった、いちばん新しい履歴）
 * 最初の履歴より前の月は、最初の履歴を使う（それより前の値はわからないため）
 */
export const entryAsOf = <T extends { from: string }>(history: T[], year: number, month: number): T => {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const sorted = sortByFrom(history);
  const applied = sorted.filter((e) => e.from <= ym);
  return applied.length > 0 ? applied[applied.length - 1] : sorted[0];
};

/**
 * その月の分の給与に使う従業員（給与形態・基本給・扶養人数を、その月の履歴の値にしたもの）
 * 給与・賞与の計算や勤怠の画面では、従業員をこれに通してから使う
 */
export const staffAsOf = <S extends Record<string, any>>(staff: S, year: number, month: number): S => {
  if (!staff) return staff;
  const w = entryAsOf(wageHistoryOf(staff), year, month);
  const d = entryAsOf(dependentsHistoryOf(staff), year, month);
  return { ...staff, wage_type: w.wageType, base_wage: w.amount, dependents: d.count };
};

/** 履歴が2件以上ある（昇給・変更を入れている）か */
export const hasWageChanges = (staff: any): boolean => wageHistoryOf(staff).length > 1;

/** 入力の誤り（2件目からの適用開始月が空・上の行より前の月）。問題なければ null */
export const validateHistory = (entries: { from: string }[]): string | null => {
  if (entries.slice(1).some((e) => !/^\d{4}-\d{2}$/.test(e.from))) return '2件目からは「何年何月分から」を入れてください';
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].from <= entries[i - 1].from) return '上から古い順に、前の行より後の月を入れてください';
  }
  return null;
};
