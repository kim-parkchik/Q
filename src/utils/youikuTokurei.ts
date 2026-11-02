/**
 * 養育期間の従前標準報酬月額のみなし措置（養育期間標準報酬月額特例。厚生年金保険法26条）
 *
 * 3歳未満の子を養育する人の標準報酬月額が、短時間勤務などで養育を始める前より下がっても、
 * 本人が申し出れば、将来の年金額は下がる前の標準報酬月額（従前標準報酬月額）で計算する。
 * 保険料は、実際の（下がった）標準報酬月額で計算するので、給与から引く額は変わらない。健康保険には関係しない。
 *
 * ■ 対象になる月
 *   養育を始めた日がある月から、次のどれかに当たった日の翌日がある月の前月までのうち、
 *   その月の標準報酬月額が基準月の標準報酬月額を下回る月（厚生年金保険法26条1項）
 *   1号 子が3歳に達した（3歳の誕生日の前日）→ 3歳の誕生日がある月の前月まで
 *   2号 資格を失った（退職・70歳到達など。14条各号）
 *   3号 ほかの子の養育を始めて、その子について特例を受ける
 *   4号 子が死亡した・子を養育しなくなった（終了届が要る。施行規則10条の2の2第3項）
 *   5号 保険料が免除される育児休業等を始めた
 *   6号 保険料が免除される産前産後休業を始めた
 * ■ 養育を始めた日（申出書の「養育特例開始年月日」）
 *   子の出生日などのほか、次の事実が生じた日も開始日になる（施行規則10条の3）
 *   ・3歳未満の子を養育する人が、新たに被保険者の資格を取った（資格取得日）
 *   ・保険料が免除される育児休業等・産前産後休業が終わった（終了日の翌日がある月の初日。申出書には終了日の翌日を書く）
 *   ・ほかの子の特例の期間が終わった（その最後の月の翌月の初日）
 *   日本年金機構は、休業が終わった人の申出書に子の生年月日を書く誤りが多いと注意している。
 * ■ 基準月
 *   養育を始めた日がある月の前月。その月に被保険者でなかったときは、その月前1年以内の直近の被保険者であった月。
 *   1年以内に被保険者だった月がなければ、特例は受けられない。
 *   基準月に、ほかの子の特例で標準報酬月額がみなされているときは、そのみなされた額を使う（26条1項かっこ書）。
 *   ほかの子の特例が産前産後休業を始めて終わったとき（6号）は、終わらなかったとしたらみなされる額を使う（26条3項）。
 * ■ さかのぼれる月
 *   申出をした月より前の月は、申出をした月の前月までの2年間にある月だけ（26条1項かっこ書）
 * ■ そのほか
 *   産前産後休業・育児休業等で保険料が免除される期間は、特例を受けられない（申出書は休業が終わった日の翌日以後に出す）。
 *   特例が終わった後に、同じ子についてまた特例を受けるときは、改めて申出書を出す。
 * 出典：厚生年金保険法26条、厚生年金保険法施行規則10条の2の2・10条の3（e-Gov法令検索 https://laws.e-gov.go.jp/law/329AC0000000115 ・
 *       https://laws.e-gov.go.jp/law/329M50000100037）
 *       日本年金機構「養育期間の従前標準報酬月額のみなし措置」https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/20150120.html
 *       日本年金機構「養育期間が終了したときの手続き」https://www.nenkin.go.jp/service/kounen/hokenryo/menjo/20120803.html
 *       日本年金機構「厚生年金保険養育期間標準報酬月額特例申出書の申し出不備や誤りの多い事例」
 *       https://www.nenkin.go.jp/service/kounen/info/jireishokai/henreiyouiku.html
 *
 * Q では、従業員ごとに申出の内容（子・養育特例開始年月日・申出日など）を staff.youiku_tokurei（JSON）に入れ、
 * 標準報酬月額の履歴（厚生年金の上限・下限に合わせた額）と比べて、どの月がみなされるかを出す。
 * 「1年以内」は、前月より前の12か月（前月の1〜12か月前）で探す。
 */
import dayjs from 'dayjs';
import * as Master from '../constants';
import { birthdayAt, checkInsuredMonth, checkSocialInsEnrolled, getInsuranceByAge } from './calcSalary';
import { checkLeaveExemptMonth, parseLeavePeriods, type LeavePeriod } from './leaveExemption';
import { getStandardRemuneration } from './standardRemuneration';

export interface YouikuEntry {
  /** 子の氏名 */
  childName: string;
  /** 子の生年月日（YYYY-MM-DD） */
  childBirthday: string;
  /** 養育特例開始年月日（YYYY-MM-DD。申出書に書く日） */
  start: string;
  /** 申出書を出した日（YYYY-MM-DD）。まだなら空 */
  appliedOn: string;
  /** 子が死亡した日・子を養育しなくなった日（26条1項4号。YYYY-MM-DD）。なければ空 */
  endDate: string;
  /** 基準月がこの会社に入る前のときの、その月の厚生年金の標準報酬月額。使わなければ null */
  basisOverride: number | null;
}

export const emptyYouikuEntry = (o: Partial<YouikuEntry> = {}): YouikuEntry => ({
  childName: '', childBirthday: '', start: '', appliedOn: '', endDate: '', basisOverride: null, ...o,
});

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** 従業員の youiku_tokurei（JSON の文字列）を読む。空・壊れているときはなし */
export const parseYouikuEntries = (json: unknown): YouikuEntry[] => {
  if (typeof json !== 'string' || !json.trim()) return [];
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        childName: str(e.childName),
        childBirthday: str(e.childBirthday),
        start: str(e.start),
        appliedOn: str(e.appliedOn),
        endDate: str(e.endDate),
        basisOverride: Number(e.basisOverride) > 0 ? Math.floor(Number(e.basisOverride)) : null,
      }));
  } catch {
    return [];
  }
};

/** 保存用の JSON（養育特例開始年月日の順に並べる）。なければ空文字 */
export const stringifyYouikuEntries = (entries: YouikuEntry[]): string =>
  entries.length > 0
    ? JSON.stringify([...entries].sort((a, b) => a.start.localeCompare(b.start))
        .map(({ childName, childBirthday, start, appliedOn, endDate, basisOverride }) =>
          ({ childName, childBirthday, start, appliedOn, endDate, basisOverride })))
    : '';

/** 3歳の誕生日（2月29日生まれで、うるう年でない年は3月1日）。この日の前日に3歳に達する */
const thirdBirthday = (childBirthday: string) => birthdayAt(childBirthday, 3).format('YYYY-MM-DD');

/** 入力の誤り。問題なければ null */
export const validateYouikuEntry = (e: YouikuEntry): string | null => {
  if (!e.childBirthday) return '子の生年月日を入れてください';
  if (!e.start) return '養育特例開始年月日を入れてください';
  if (e.start < e.childBirthday) return '養育特例開始年月日が、子の生年月日より前です';
  if (e.start >= thirdBirthday(e.childBirthday)) return '子が3歳に達した後の日です（3歳未満の子を養育する期間だけ申し出られます）';
  if (e.endDate && e.endDate < e.start) return '養育しなくなった日が、養育特例開始年月日より前です';
  if (e.appliedOn && e.appliedOn < e.start) return '申出日が、養育特例開始年月日より前です';
  return null;
};

/** 同じ子の申出か（休業の後に申し出直したときなど。双子は氏名で分ける） */
const isSameChild = (a: YouikuEntry, b: YouikuEntry) => a.childBirthday === b.childBirthday && a.childName === b.childName;

/** 年と月の通し番号（月どうしの前後を比べるため） */
const idxOf = (year: number, month: number) => year * 12 + (month - 1);
const idxOfDate = (date: string) => { const [y, m] = date.split('-').map(Number); return idxOf(y, m); };
const ymOfIdx = (i: number) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
/** その日に当たった → 翌日がある月の前月（26条1項の「該当するに至った日の翌日の属する月の前月」） */
const lastIdxByEvent = (date: string) => idxOfDate(dayjs(date).add(1, 'day').format('YYYY-MM-DD')) - 1;

/** その月に、この会社で厚生年金の被保険者だったか（標準報酬月額があり、入社〜退職の月で、70歳に達する前） */
export const isPensionInsuredMonth = (staff: any, year: number, month: number): boolean =>
  checkSocialInsEnrolled(staff, year, month)
  && checkInsuredMonth(staff.join_date, staff.retirement_date, year, month)
  && getInsuranceByAge(staff.birthday || '', year, month).pension;

/** その月の厚生年金の標準報酬月額（健康保険と同じ値を、その月の厚生年金の上限・下限に合わせる）。被保険者でない月は null */
export const pensionStandardAt = (staff: any, year: number, month: number): number | null => {
  if (!isPensionInsuredMonth(staff, year, month)) return null;
  const ins = Master.getInsuranceMaster(year, month);
  return Math.max(ins.PENSION_MIN_HYOJUN, Math.min(getStandardRemuneration(staff, year, month), ins.PENSION_MAX_HYOJUN));
};

/** 保険料が免除される休業か（1か月でも免除される月がある。役員は育児休業等の免除を受けられない） */
const isExemptLeave = (staff: any, leave: LeavePeriod) => {
  if (leave.type === 'childcare' && Number(staff.is_executive) === 1) return false;
  const from = idxOfDate(leave.start);
  const to = leave.end ? idxOfDate(dayjs(leave.end).add(1, 'day').format('YYYY-MM-DD')) : from;
  for (let i = from; i <= to; i++) {
    const { year, month } = ymOfIdx(i);
    if (checkLeaveExemptMonth([leave], year, month)) return true;
  }
  return false;
};

/**
 * age3: 子が3歳に達した / loss: 資格を失った（退職・70歳） / other_child: ほかの子の特例を受ける /
 * not_raising: 子が死亡した・養育しなくなった / childcare_leave: 育児休業等を始めた / maternity_leave: 産前産後休業を始めた
 */
export type YouikuEndReason = 'age3' | 'loss' | 'other_child' | 'not_raising' | 'childcare_leave' | 'maternity_leave';

export const YOUIKU_END_REASON_LABELS: Record<YouikuEndReason, string> = {
  age3: '子が3歳に達する',
  loss: '厚生年金の資格を失う（退職・70歳）',
  other_child: 'ほかの子の養育を始めた（その子の特例を受ける）',
  not_raising: '子が死亡した・子を養育しなくなった',
  childcare_leave: '保険料が免除される育児休業等を始めた',
  maternity_leave: '保険料が免除される産前産後休業を始めた',
};

/** prev_month: 養育開始月の前月 / within_year: 前月より前の1年以内 / override: 入社前の会社の額（手で入れた） / other_child: ほかの子の特例でみなされた額 */
export type YouikuBasisSource = 'prev_month' | 'within_year' | 'override' | 'other_child';

export interface YouikuMonth {
  year: number;
  month: number;
  /** その月の厚生年金の標準報酬月額。null は、この会社で厚生年金に入っていない月 */
  actual: number | null;
  /** 産休・育休で保険料が免除される月（特例は受けられない） */
  exempt: boolean;
  /** 基準月の標準報酬月額を下回る */
  lower: boolean;
  /** 申出をした月（まだなら今月）の前月までの2年間より前の月（下回っていても、みなされない） */
  tooOld: boolean;
  /** 年金額の計算で、従前標準報酬月額とみなされる月 */
  deemed: boolean;
}

export interface YouikuJudgement {
  /** entries の何番目か */
  index: number;
  entry: YouikuEntry;
  error: string | null;
  /** 養育開始月 */
  startYm: { year: number; month: number } | null;
  /** 基準月（入社前の会社の額を手で入れたときは null） */
  basisYm: { year: number; month: number } | null;
  /** 従前標準報酬月額（基準月の標準報酬月額）。基準月がなければ null */
  basis: number | null;
  basisSource: YouikuBasisSource | null;
  /** ほかの子の特例でみなされた額を使ったときの、その子の氏名 */
  basisFromChild: string | null;
  /** 特例の最後の月と、その理由 */
  lastYm: { year: number; month: number } | null;
  endReason: YouikuEndReason | null;
  /** 養育開始月から、最後の月（まだ先なら今月）まで */
  months: YouikuMonth[];
  deemedCount: number;
  /** 下回っているのに2年より前なので、みなされない月の数 */
  tooOldCount: number;
  /** 最後の月が今月より前（もう終わった） */
  ended: boolean;
  /** 終了届が要る（子が死亡した・養育しなくなったことで終わり、申出書を出していた） */
  needsEndReport: boolean;
}

interface Period {
  startIdx: number;
  lastIdx: number;
  endReason: YouikuEndReason;
  /** 産前産後休業を始めたこと（6号）がなかったとしたときの最後の月（26条3項で使う） */
  lastIdxWithoutMaternity: number;
}

/** 特例の期間（養育開始月から、終わる理由に当たった日の翌日がある月の前月まで） */
const periodOf = (staff: any, entry: YouikuEntry, others: YouikuEntry[], leaves: LeavePeriod[]): Period => {
  const ends: { reason: YouikuEndReason; idx: number }[] = [
    // 3歳に達した日（誕生日の前日）の翌日＝3歳の誕生日がある月の前月まで
    { reason: 'age3', idx: idxOfDate(thirdBirthday(entry.childBirthday)) - 1 },
  ];
  // 資格喪失：退職日（使用されなくなった日）の翌日がある月の前月まで。70歳に達した日の翌日（70歳の誕生日）がある月の前月まで
  if (staff.retirement_date) ends.push({ reason: 'loss', idx: lastIdxByEvent(staff.retirement_date) });
  if (staff.birthday) ends.push({ reason: 'loss', idx: idxOfDate(birthdayAt(staff.birthday, 70).format('YYYY-MM-DD')) - 1 });
  for (const o of others) {
    if (o.start > entry.start) ends.push({ reason: 'other_child', idx: lastIdxByEvent(o.start) });
  }
  for (const leave of leaves) {
    if (leave.start >= entry.start && isExemptLeave(staff, leave)) {
      ends.push({ reason: leave.type === 'childcare' ? 'childcare_leave' : 'maternity_leave', idx: lastIdxByEvent(leave.start) });
    }
  }
  // 子が死亡した・養育しなくなったのは、ほかの理由で先に終わっていなければ終了届が要るので、同じ月なら後に回す
  if (entry.endDate) ends.push({ reason: 'not_raising', idx: lastIdxByEvent(entry.endDate) });

  const earliest = (list: typeof ends) => list.reduce((a, b) => (b.idx < a.idx ? b : a));
  const first = earliest(ends);
  return {
    startIdx: idxOfDate(entry.start),
    lastIdx: first.idx,
    endReason: first.reason,
    lastIdxWithoutMaternity: earliest(ends.filter((e) => e.reason !== 'maternity_leave')).idx,
  };
};

/**
 * 従業員の特例の申出ごとに、基準月・期間・みなされる月を出す
 * @param entries その従業員の申出（staff.youiku_tokurei。画面で直している途中の値でもよい）
 * @param today   今日（YYYY-MM-DD）。今月までの月を出し、申出をまだしていないときは今月に申し出たとして2年を数える
 */
export const judgeYouikuEntries = (staff: any, entries: YouikuEntry[], today: string): YouikuJudgement[] => {
  const leaves = parseLeavePeriods(staff.leave_periods);
  const todayIdx = idxOfDate(today);
  const valid = entries.filter((e) => validateYouikuEntry(e) === null);
  const judged = new Map<YouikuEntry, { judgement: YouikuJudgement; period: Period }>();

  // 基準月にほかの子の特例が掛かっているかを見るため、養育を始めた順に判定する
  const order = entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.start.localeCompare(b.entry.start));
  for (const { entry, index } of order) {
    const error = validateYouikuEntry(entry);
    if (error) {
      judged.set(entry, {
        judgement: {
          index, entry, error, startYm: null, basisYm: null, basis: null, basisSource: null, basisFromChild: null,
          lastYm: null, endReason: null, months: [], deemedCount: 0, tooOldCount: 0, ended: false, needsEndReport: false,
        },
        period: { startIdx: 0, lastIdx: -1, endReason: 'age3', lastIdxWithoutMaternity: -1 },
      });
      continue;
    }
    const period = periodOf(staff, entry, valid.filter((o) => o !== entry && !isSameChild(o, entry)), leaves);

    // 基準月：養育開始月の前月。被保険者でなければ、入社前の会社の額（手で入れたとき）か、その前1年以内の直近の月
    const prevIdx = period.startIdx - 1;
    let basisIdx: number | null = null;
    let basis: number | null = null;
    let basisSource: YouikuBasisSource | null = null;
    const atPrev = pensionStandardAt(staff, ymOfIdx(prevIdx).year, ymOfIdx(prevIdx).month);
    if (atPrev !== null) {
      basisIdx = prevIdx; basis = atPrev; basisSource = 'prev_month';
    } else if (entry.basisOverride) {
      basis = entry.basisOverride; basisSource = 'override';
    } else {
      for (let k = 1; k <= 12; k++) {
        const { year, month } = ymOfIdx(prevIdx - k);
        const v = pensionStandardAt(staff, year, month);
        if (v !== null) { basisIdx = prevIdx - k; basis = v; basisSource = 'within_year'; break; }
      }
    }

    // 基準月に、ほかの子の特例で標準報酬月額がみなされているときは、そのみなされた額（26条1項かっこ書・3項）
    let basisFromChild: string | null = null;
    if (basisIdx !== null && basis !== null) {
      for (const [other, { judgement: j, period: p }] of judged) {
        if (other === entry || isSameChild(other, entry) || j.error || j.basis === null || other.start >= entry.start) continue;
        const m = j.months.find((x) => idxOf(x.year, x.month) === basisIdx);
        const deemedNow = m?.deemed === true;
        // 産前産後休業を始めて終わった特例は、終わらなかったとしたらみなされるか（26条3項）
        const deemedIf6 = p.endReason === 'maternity_leave'
          && basisIdx > p.lastIdx && basisIdx >= p.startIdx && basisIdx <= p.lastIdxWithoutMaternity
          && basis < j.basis;
        if ((deemedNow || deemedIf6) && j.basis > basis) {
          basis = j.basis; basisSource = 'other_child'; basisFromChild = other.childName || '（氏名なし）';
        }
      }
    }

    // 申出をした月より前の月は、申出をした月の前月までの2年間にある月だけ（まだなら今月に申し出たとして数える）
    const claimIdx = entry.appliedOn ? idxOfDate(entry.appliedOn) : todayIdx;
    const months: YouikuMonth[] = [];
    for (let i = period.startIdx; i <= Math.min(period.lastIdx, todayIdx); i++) {
      const { year, month } = ymOfIdx(i);
      const actual = pensionStandardAt(staff, year, month);
      const exempt = checkLeaveExemptMonth(leaves, year, month);
      const lower = basis !== null && actual !== null && actual < basis;
      const tooOld = i < claimIdx - 24;
      months.push({ year, month, actual, exempt, lower, tooOld, deemed: lower && !exempt && !tooOld });
    }

    judged.set(entry, {
      judgement: {
        index, entry, error: null,
        startYm: ymOfIdx(period.startIdx),
        basisYm: basisIdx === null ? null : ymOfIdx(basisIdx),
        basis, basisSource, basisFromChild,
        lastYm: ymOfIdx(period.lastIdx),
        endReason: period.endReason,
        months,
        deemedCount: months.filter((m) => m.deemed).length,
        tooOldCount: months.filter((m) => m.lower && !m.exempt && m.tooOld).length,
        ended: period.lastIdx < todayIdx,
        needsEndReport: period.endReason === 'not_raising' && !!entry.appliedOn,
      },
      period,
    });
  }
  return entries.map((e) => judged.get(e)!.judgement);
};

export interface YouikuCandidate {
  staff: any;
  leave: LeavePeriod;
  /** 休業の終了日の翌日（申出書の養育特例開始年月日） */
  nextDay: string;
  /** 基準月（休業の終了日の翌日がある月の前月）の厚生年金の標準報酬月額 */
  basis: number;
  /** 今月（いちばん新しい月）の厚生年金の標準報酬月額 */
  current: number;
  /** 基準月を下回る月の数（休業の終了日の翌日がある月から今月まで） */
  lowerCount: number;
}

/**
 * 申出ができそうな人：保険料が免除される産休・育休が3年以内に終わり、その後の厚生年金の標準報酬月額が、
 * 休業が終わった月の前月より下がっていて、まだその日からの特例を登録していない人
 * （休業を取らずに短時間勤務などで給与が下がった人は、休業の記録がないので出ない）
 */
export const findYouikuCandidates = (staffList: any[], today: string): YouikuCandidate[] => {
  const todayIdx = idxOfDate(today);
  const result: YouikuCandidate[] = [];
  for (const staff of staffList) {
    const leaves = parseLeavePeriods(staff.leave_periods);
    const registered = parseYouikuEntries(staff.youiku_tokurei).map((e) => (e.start ? idxOfDate(e.start) : null));
    for (const leave of leaves) {
      if (!leave.end || !isExemptLeave(staff, leave)) continue;
      const nextDay = dayjs(leave.end).add(1, 'day').format('YYYY-MM-DD');
      // 翌日から次の休業を続けて始めたときは、続けた休業が終わってから
      if (leaves.some((l) => l !== leave && l.start === nextDay)) continue;
      const startIdx = idxOfDate(nextDay);
      if (startIdx > todayIdx || startIdx < todayIdx - 36) continue;
      if (registered.includes(startIdx)) continue;
      // 終わった月に産前産後休業を始めたときは、その日からは特例を始められない（施行規則10条の3第2号かっこ書）
      if (leaves.some((l) => l.type === 'maternity' && idxOfDate(l.start) === startIdx)) continue;
      const prev = ymOfIdx(startIdx - 1);
      const basis = pensionStandardAt(staff, prev.year, prev.month);
      if (basis === null) continue;
      let lowerCount = 0;
      let current: number | null = null;
      for (let i = startIdx; i <= todayIdx; i++) {
        const { year, month } = ymOfIdx(i);
        const actual = pensionStandardAt(staff, year, month);
        if (actual === null) continue;
        current = actual;
        if (actual < basis && !checkLeaveExemptMonth(leaves, year, month)) lowerCount++;
      }
      if (lowerCount > 0 && current !== null) result.push({ staff, leave, nextDay, basis, current, lowerCount });
    }
  }
  return result.sort((a, b) => a.nextDay.localeCompare(b.nextDay) || String(a.staff.id).localeCompare(String(b.staff.id)));
};
