/**
 * 18歳未満の人（年少者）の時間外労働・休日労働・深夜労働（見直しの P13）
 *
 * 労働基準法（数は constants/laborStandards.ts。条文から scripts/import_labor_standards.py で作る）：
 * ・60条1項：満18歳に満たない人には、変形労働時間制・フレックスタイム制（32条の2〜32条の5）・36条（36協定による時間外と休日の労働）・
 *   40条（週44時間の特例など）・41条の2 を使わない。→ 時間外労働（1日8時間・週40時間を超える労働）と法定休日の労働をさせられない
 * ・61条1項：満18歳に満たない人を、午後10時から午前5時までの間に使ってはならない（例外は MINOR_NIGHT_EXCEPTIONS と33条1項）
 * ・57条1項：満18歳に満たない人の年齢を証明する戸籍証明書を事業場に備え付ける
 * ・56条1項：満15歳に達した日以後の最初の3月31日が終わるまで使えない（2項の許可を受けたときを除く）
 *
 * 計算（utils/calcSalary.ts）は、18歳未満の日の週の法定労働時間を40時間にし（特例を使わない）、計算期間の初めの日に18歳未満の人は
 * フレックスタイム制を使わずに1日8時間・週40時間で数える。知らせは、勤怠のまとめ・給与明細（確定の前に確かめる）・従業員の画面に出す。
 * 例外に当たるかは Q では分からないので、知らせの文に書き、当たるときは確かめてそのまま確定してもらう（ユーザーの選択）。
 */
import { MINIMUM_WORK_AGE, MINOR_AGE, MINOR_NIGHT_EXCEPTIONS, MINOR_SHORTENED_DAY_HOURS, NIGHT_HOURS } from '../constants/laborStandards';
import { LEGAL_WORK_HOURS, WEEKLY_44 } from '../constants/workHours';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** その年齢になる誕生日（2月29日生まれで、うるう年でない年は3月1日）。生年月日がなければ null */
const birthdayOfAge = (birthday: unknown, age: number): string | null => {
  const m = ISO.exec(String(birthday ?? ''));
  if (!m) return null;
  return iso(new Date(Date.UTC(Number(m[1]) + age, Number(m[2]) - 1, Number(m[3]))));
};

/**
 * 18歳の誕生日。この日より前の日は「満18歳に満たない」日として数える（年齢は誕生日の前日が終わるときに上がるので、
 * 誕生日の前日の勤務（夜を含む）も18歳未満で数える）。生年月日がなければ null
 */
export const minorUntil = (birthday: unknown): string | null => birthdayOfAge(birthday, MINOR_AGE);

/** その日に18歳未満か（生年月日がなければ false） */
export const isMinorOn = (birthday: unknown, date: string): boolean => {
  const until = minorUntil(birthday);
  return !!until && !!date && date < until;
};

/**
 * 最低年齢（労働基準法56条1項）：使ってよい最初の日（満15歳に達した日（誕生日の前日）以後の最初の3月31日の次の日）。
 * 生年月日がなければ null
 */
export const minimumWorkDate = (birthday: unknown): string | null => {
  const fifteen = birthdayOfAge(birthday, MINIMUM_WORK_AGE);
  if (!fifteen) return null;
  const reach = new Date(Date.parse(`${fifteen}T00:00:00Z`) - 24 * 60 * 60 * 1000);
  const y = reach.getUTCMonth() + 1 > 3 || (reach.getUTCMonth() + 1 === 3 && reach.getUTCDate() > 31) ? reach.getUTCFullYear() + 1 : reach.getUTCFullYear();
  return `${y}-04-01`;
};

/** 18歳未満の日の、時間外労働・法定休日の労働・深夜労働の時間 */
export interface MinorWorkDay {
  date: string;
  /** 時間外労働（1日8時間・週40時間を超えた時間。法定内残業は入れない） */
  overtime: number;
  /** 法定休日の労働 */
  holiday: number;
  /** 深夜（午後10時から午前5時まで）の労働 */
  night: number;
}

/** 給与の計算（calcSalary）が返す、18歳未満の人の労働（計算期間に18歳未満の日がない人は null） */
export interface MinorWork {
  /** 18歳の誕生日（この日から18歳として数える） */
  until: string;
  /** 時間外・法定休日・深夜の労働がある、18歳未満の日（日付順） */
  days: MinorWorkDay[];
  /** フレックスタイム制の人だが、計算期間の初めの日に18歳未満なので、1日8時間・週40時間で数えた */
  flexIgnored: boolean;
  /** 拠点は週の法定労働時間の特例（週44時間）の事業場だが、18歳未満の日は週40時間で数えた */
  weekly44Ignored: boolean;
}

/** 日ごとの時間を足していく（18歳未満の日だけ。0の日は残さない） */
export const createMinorWorkCollector = (birthday: unknown) => {
  const until = minorUntil(birthday);
  const byDate: Record<string, MinorWorkDay> = {};
  return {
    until,
    isMinorDay: (date: string) => !!until && !!date && date < until,
    add(date: string, key: 'overtime' | 'holiday' | 'night', hours: number) {
      if (!until || !(date < until) || !(hours > 0)) return;
      const d = (byDate[date] ??= { date, overtime: 0, holiday: 0, night: 0 });
      d[key] += hours;
    },
    result(period: { start: string; end: string } | null, flags: { flexIgnored: boolean; weekly44Ignored: boolean }): MinorWork | null {
      if (!until) return null;
      // 計算期間に18歳未満の日があるか（期間がわからなければ、日ごとの時間か flags で見る）
      const inPeriod = period?.start ? period.start < until : (Object.keys(byDate).length > 0 || flags.flexIgnored || flags.weekly44Ignored);
      if (!inPeriod) return null;
      const round = (h: number) => Math.round(h * 1000) / 1000;
      const days = Object.values(byDate)
        .map(d => ({ date: d.date, overtime: round(d.overtime), holiday: round(d.holiday), night: round(d.night) }))
        .filter(d => d.overtime > 0 || d.holiday > 0 || d.night > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      return { until, days, ...flags };
    },
  };
};

/** 合計（時間と日数） */
export const minorWorkTotals = (m: MinorWork | null | undefined) => {
  const out = { overtime: 0, overtimeDays: 0, holiday: 0, holidayDays: 0, night: 0, nightDays: 0 };
  for (const d of m?.days ?? []) {
    if (d.overtime > 0) { out.overtime += d.overtime; out.overtimeDays++; }
    if (d.holiday > 0) { out.holiday += d.holiday; out.holidayDays++; }
    if (d.night > 0) { out.night += d.night; out.nightDays++; }
  }
  return out;
};

/** 知らせる労働（時間外・法定休日・深夜）があるか */
export const hasMinorWorkIssue = (m: MinorWork | null | undefined): boolean => (m?.days.length ?? 0) > 0;

const hm = (h: number) => {
  const min = Math.round(h * 60);
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
};
const jpDate = (date: string) => {
  const m = ISO.exec(date);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : date;
};
const mdDate = (date: string) => {
  const m = ISO.exec(date);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : date;
};

/** 別表第一の事業の名前を短くする（「…その他農林の事業」→「農林の事業」） */
const shortBusiness = (name: string) => {
  const i = name.lastIndexOf('その他');
  return i >= 0 ? name.slice(i + 'その他'.length).replace(/^の/, '') : name;
};

/** 例外の説明（知らせの下に出す） */
export const minorWorkExceptionsNote = (): string =>
  `例外：災害など避けられない理由で臨時の必要があり、労働基準監督署長の許可を受けた（急ぐときは事後に届け出た）とき（33条1項）は、時間外・休日・深夜も働かせられます。`
  + `深夜は、交替制で使う満${MINOR_NIGHT_EXCEPTIONS.shiftMaleAge}歳以上の男性（61条1項ただし書）、`
  + `${MINOR_NIGHT_EXCEPTIONS.businesses.map(b => shortBusiness(b.name)).join('・')}（別表第一${MINOR_NIGHT_EXCEPTIONS.businesses.map(b => `${b.item}号`).join('・')}）と電話交換の業務（61条4項）も働かせられます。`
  + `また、1週間の労働時間を${LEGAL_WORK_HOURS.weekly}時間以内にして1日を${MINOR_SHORTENED_DAY_HOURS.short}時間以内にした週は、ほかの日を${MINOR_SHORTENED_DAY_HOURS.long}時間まで延ばせます（60条3項1号。Q は1日${LEGAL_WORK_HOURS.daily}時間を超えた時間を時間外労働として数えて払います）。`
  + `例外に当たるときは、そのまま確定してかまいません。`;

/**
 * 知らせの文（1行目が見出し。勤怠のまとめ・給与明細・操作の記録に使う）。知らせることがなければ []
 */
export const describeMinorWork = (m: MinorWork | null | undefined): string[] => {
  if (!m) return [];
  const lines: string[] = [];
  const t = minorWorkTotals(m);
  if (hasMinorWorkIssue(m)) {
    const parts = [
      t.overtime > 0 ? `時間外労働 ${hm(t.overtime)}（${t.overtimeDays}日）` : '',
      t.holiday > 0 ? `法定休日の労働 ${hm(t.holiday)}（${t.holidayDays}日）` : '',
      t.night > 0 ? `深夜（午後${NIGHT_HOURS.start - 12}時から午前${NIGHT_HOURS.end}時まで）の労働 ${hm(t.night)}（${t.nightDays}日）` : '',
    ].filter(Boolean);
    lines.push(`18歳未満（${jpDate(m.until)}に${MINOR_AGE}歳）の人に、${parts.join('・')}があります。`);
    lines.push(
      `満${MINOR_AGE}歳に満たない人には、36協定による時間外労働・休日労働をさせられず（労働基準法60条1項）、`
      + `午後${NIGHT_HOURS.start - 12}時から午前${NIGHT_HOURS.end}時までの間は働かせられません（61条1項）。割増賃金は、働いた時間のとおりに払います。`,
    );
    lines.push(`日：${m.days.map(d => `${mdDate(d.date)}（${[
      d.overtime > 0 ? `時間外 ${hm(d.overtime)}` : '',
      d.holiday > 0 ? `法定休日 ${hm(d.holiday)}` : '',
      d.night > 0 ? `深夜 ${hm(d.night)}` : '',
    ].filter(Boolean).join('・')}）`).join('、')}`);
  }
  if (m.flexIgnored) {
    lines.push(`満${MINOR_AGE}歳に満たない人にはフレックスタイム制を使えないので（労働基準法60条1項）、この月は1日${LEGAL_WORK_HOURS.daily}時間・週${LEGAL_WORK_HOURS.weekly}時間で数えています。`);
  }
  if (m.weekly44Ignored) {
    lines.push(`満${MINOR_AGE}歳に満たない人には週${WEEKLY_44.weekly}時間の特例を使えないので（労働基準法60条1項・40条）、18歳未満の日は週${LEGAL_WORK_HOURS.weekly}時間で数えています。`);
  }
  return lines;
};

/** 操作の記録に残す短い文（例：「時間外労働 2:00・深夜 1:30」） */
export const minorWorkLogText = (m: MinorWork | null | undefined): string => {
  const t = minorWorkTotals(m);
  return [
    t.overtime > 0 ? `時間外労働 ${hm(t.overtime)}` : '',
    t.holiday > 0 ? `法定休日の労働 ${hm(t.holiday)}` : '',
    t.night > 0 ? `深夜の労働 ${hm(t.night)}` : '',
  ].filter(Boolean).join('・');
};

/**
 * 従業員の画面の知らせ（その日に18歳未満の人。最低年齢に満たない人も）。知らせることがなければ null
 * @param on 見る日（きょうか入社日の遅いほう）
 */
export const describeMinorStaff = (p: {
  birthday: unknown; on: string; isFlex: boolean; weekly44: boolean;
}): { lines: string[]; belowMinimumAge: boolean } | null => {
  const until = minorUntil(p.birthday);
  if (!until || !p.on || !(p.on < until)) return null;
  const lines: string[] = [];
  const firstDay = minimumWorkDate(p.birthday);
  const belowMinimumAge = !!firstDay && p.on < firstDay;
  if (belowMinimumAge) {
    const end = `${Number(firstDay!.slice(0, 4))}年3月31日`;
    lines.push(
      `満${MINIMUM_WORK_AGE}歳に達した日以後の最初の3月31日（${end}）が終わるまでは、使えません（労働基準法56条1項。`
      + `軽易な仕事について労働基準監督署長の許可を受けたときを除く。56条2項）。`,
    );
  }
  lines.push(`18歳未満の人です（${jpDate(until)}に${MINOR_AGE}歳）。`
    + `時間外労働（1日${LEGAL_WORK_HOURS.daily}時間・週${LEGAL_WORK_HOURS.weekly}時間を超える労働）・法定休日の労働と、`
    + `午後${NIGHT_HOURS.start - 12}時から午前${NIGHT_HOURS.end}時までの労働はさせられません（労働基準法60条1項・61条1項。例外は、勤怠の画面と給与明細の知らせに書きます）。`);
  lines.push(`年齢を証明する戸籍証明書を、事業場に備え付けてください（57条1項）。`);
  if (p.isFlex) {
    lines.push(`フレックスタイム制は使えません（60条1項）。給与の計算期間の初めの日に18歳未満の月は、1日${LEGAL_WORK_HOURS.daily}時間・週${LEGAL_WORK_HOURS.weekly}時間で計算します。`);
  }
  if (p.weekly44) {
    lines.push(`拠点は週${WEEKLY_44.weekly}時間の特例の事業場ですが、18歳未満の日は週${LEGAL_WORK_HOURS.weekly}時間で計算します（60条1項・40条）。`);
  }
  return { lines, belowMinimumAge };
};
