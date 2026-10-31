/**
 * 標準報酬月額の履歴（何年何月分から、いくらになったか）
 *
 * 標準報酬月額は、次のときに決まり、決まった月の分から次に変わるまで使う。
 * ・資格取得時決定：入社した月の分から
 * ・定時決定（算定基礎届）：4〜6月に支払った報酬から決め、9月分から翌年8月分まで
 * ・随時改定（月額変更届）：固定的賃金が変わった月から3か月の報酬で決め、4か月目の分から
 * ・産前産後休業・育児休業等の終了時改定：終了日の翌日がある月から3か月の報酬で決め、4か月目の分から
 * 出典：日本年金機構 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.html （定時決定）
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-02.html （随時改定）
 *
 * 履歴は従業員の standard_remuneration_history（JSON）に入れる。最初の1件は「入社したときから」（from が空）。
 * 履歴がまだない人（以前の会社ファイル）は、standard_remuneration の1つの値を入社したときから使う。
 * standard_remuneration には、いちばん新しい履歴の値も入れておく（従業員一覧の表示などで使う）。
 */

/**
 * shutoku: 資格取得時決定 / teiji: 定時決定 / zuiji: 随時改定 /
 * kyugyo: 産前産後休業・育児休業等の終了時改定 / other: その他（保険者決定・訂正など）
 */
export type RemunerationReason = 'shutoku' | 'teiji' | 'zuiji' | 'kyugyo' | 'other';

export const REMUNERATION_REASON_LABELS: Record<RemunerationReason, string> = {
  shutoku: '資格取得時',
  teiji: '定時決定（算定）',
  zuiji: '随時改定（月変）',
  kyugyo: '産休・育休の終了時改定',
  other: 'その他',
};

export interface RemunerationEntry {
  /** 何年何月分から使うか（YYYY-MM）。最初の1件だけは空でもよい（入社したときから） */
  from: string;
  /** 標準報酬月額（0 は未加入） */
  amount: number;
  reason: RemunerationReason;
}

const REASONS = Object.keys(REMUNERATION_REASON_LABELS) as RemunerationReason[];

/** 従業員の standard_remuneration_history（JSON の文字列）を読む。空・壊れているときは履歴なし */
export const parseRemunerationHistory = (json: unknown): RemunerationEntry[] => {
  if (typeof json !== 'string' || !json.trim()) return [];
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => typeof e?.from === 'string' && Number.isFinite(Number(e?.amount)))
      .map((e) => ({
        from: e.from,
        amount: Math.max(0, Math.floor(Number(e.amount))),
        reason: REASONS.includes(e.reason) ? e.reason : 'other',
      }));
  } catch {
    return [];
  }
};

/** 適用開始月の順に並べる（空＝入社したときから、がいちばん前） */
export const sortRemunerationHistory = (entries: RemunerationEntry[]): RemunerationEntry[] =>
  [...entries].sort((a, b) => a.from.localeCompare(b.from));

/** 保存用の JSON（適用開始月の順に並べる） */
export const stringifyRemunerationHistory = (entries: RemunerationEntry[]): string =>
  JSON.stringify(sortRemunerationHistory(entries).map(({ from, amount, reason }) => ({ from, amount, reason })));

/**
 * 従業員の履歴。まだ履歴がない人は、今の標準報酬月額を入社したときから使う1件として返す
 */
export const remunerationHistoryOf = (staff: any): RemunerationEntry[] => {
  const history = parseRemunerationHistory(staff?.standard_remuneration_history);
  if (history.length > 0) return sortRemunerationHistory(history);
  return [{ from: '', amount: Math.max(0, Math.floor(Number(staff?.standard_remuneration) || 0)), reason: 'shutoku' }];
};

/** いちばん新しい（適用開始月がいちばん後の）標準報酬月額 */
export const latestStandardRemuneration = (entries: RemunerationEntry[]): number => {
  const sorted = sortRemunerationHistory(entries);
  return sorted.length > 0 ? sorted[sorted.length - 1].amount : 0;
};

/**
 * その月の分の標準報酬月額（その月までに始まった、いちばん新しい履歴の値）
 * 最初の履歴より前の月は、最初の履歴の値を使う（それより前の値はわからないため）
 */
export const getStandardRemuneration = (staff: any, year: number, month: number): number => {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const history = remunerationHistoryOf(staff);
  const applied = history.filter((e) => e.from <= ym);
  return (applied.length > 0 ? applied[applied.length - 1] : history[0]).amount;
};

/** 入力の誤り（2件目からの適用開始月が空・同じ月が2回）。問題なければ null */
export const validateRemunerationHistory = (entries: RemunerationEntry[]): string | null => {
  const sorted = sortRemunerationHistory(entries);
  if (sorted.slice(1).some((e) => !e.from)) return '2件目からは「何年何月分から」を入れてください';
  const months = sorted.map((e) => e.from);
  if (new Set(months).size !== months.length) return '同じ月の分が2回あります';
  return null;
};
