/**
 * 住民税（特別徴収）の納入：納付先の市区町村ごとの額と、納期限
 *
 * ■ 毎月：給与の支払をする際に毎月徴収し、徴収した月の翌月10日までに市町村に納入する（地方税法321条の5第1項）
 * ■ 納期の特例：給与の支払を受ける者が常時10人未満の事務所等で、市町村長の承認を受けたときは、
 *   6月〜11月・12月〜翌年5月の各期間に徴収した額を、各期間の最終月の翌月10日（12月10日・6月10日）までに納入できる
 *   （承認を受けた日の属する期間は、その日の属する月から。321条の5の2）→ 市区町村ごとの印（resident_tax_municipalities.special_due）
 * ■ 期限が土曜日・日曜日・祝日・12月29日〜31日のときは、その翌日（地方税法20条の5第2項、施行令6条の18第2項）。
 *   祝日は holiday_master（内閣府「国民の祝日」の一覧）
 * ■ 額は、確定した給与で引いた住民税（salary_results.resident_tax。退職する人の一括徴収も入る）。
 *   納付先は、その月の年度の納付先（utils/residentTax.ts の paymentMunicipalityOf）
 * 出典：地方税法 https://laws.e-gov.go.jp/law/325AC0000000226 ・地方税法施行令 https://laws.e-gov.go.jp/law/325CO0000000245
 */
import { localGovByCode, type LocalGov } from "./localGov";
import { fiscalYearOf, paymentMunicipalityOf, residentTaxFor } from "./residentTax";

export type YearMonth = [number, number];

const ym = (y: number, m: number): YearMonth => (m > 12 ? [y + 1, m - 12] : m < 1 ? [y - 1, m + 12] : [y, m]);
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 納期の特例の期間（6月〜11月・12月〜翌年5月）で、その月が入る期間の6か月 */
export const specialPeriodOf = (year: number, month: number): YearMonth[] => {
  const start = month >= 6 && month <= 11 ? ym(year, 6) : month === 12 ? ym(year, 12) : ym(year - 1, 12);
  return Array.from({ length: 6 }, (_, i) => ym(start[0], start[1] + i));
};

/** 法律で決まった納期限（土日・祝日で延ばす前）：毎月なら翌月10日、納期の特例なら期間の最終月の翌月10日 */
export const statutoryDueOf = (year: number, month: number, special: boolean): string => {
  const [y, m] = special ? (() => { const last = specialPeriodOf(year, month)[5]; return ym(last[0], last[1] + 1); })() : ym(year, month + 1);
  return `${y}-${pad(m)}-10`;
};

/** 土曜日・日曜日・祝日・12月29日〜31日なら、次の日にする（何日続いても） */
export const rollForward = (date: string, holidays: Set<string>): string => {
  const d = new Date(`${date}T00:00:00`);
  const closed = (x: Date) => {
    const key = dateKey(x);
    return x.getDay() === 0 || x.getDay() === 6 || holidays.has(key) || (x.getMonth() === 11 && x.getDate() >= 29);
  };
  while (closed(d)) d.setDate(d.getDate() + 1);
  return dateKey(d);
};

export interface MunicipalitySetting {
  designation: string;
  atena: string;
  specialDue: boolean;
}

export interface PaymentPerson {
  staffId: string;
  name: string;
  /** 対象の月ごとの、引いた額（確定していない月は null） */
  byMonth: (number | null)[];
  total: number;
}

export interface PaymentGroup {
  /** 納付先の団体コード（未設定なら空） */
  code: string;
  municipality: LocalGov | null;
  setting: MunicipalitySetting;
  /** 合計する月（毎月なら選んだ月だけ。納期の特例なら期間の6か月） */
  months: YearMonth[];
  people: PaymentPerson[];
  total: number;
  /** 法律で決まった納期限と、土日・祝日で延ばした納期限 */
  statutoryDue: string;
  due: string;
}

export interface PendingPerson {
  staffId: string;
  name: string;
  code: string;
  /** 年度の額（引く予定の額） */
  expected: number;
}

export interface PaymentSummary {
  groups: PaymentGroup[];
  /** 選んだ月に住民税を引く予定なのに、給与がまだ確定していない人 */
  pending: PendingPerson[];
}

interface SalaryRow { staff_id: string | number; target_year: number; target_month: number; resident_tax: number | null }

/** その月に在籍していた（入社前・退職した月より後でない） */
const employedIn = (staff: any, year: number, month: number) => {
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-31`;
  return !(staff.join_date && staff.join_date > last) && !(staff.retirement_date && staff.retirement_date < first);
};

/** 選んだ月（給与を支給した月）の、納付先ごとの納入額 */
export const buildPaymentSummary = (
  staff: any[],
  salaries: SalaryRow[],
  settings: Record<string, MunicipalitySetting>,
  year: number,
  month: number,
  holidays: Set<string>,
): PaymentSummary => {
  const settingOf = (code: string): MunicipalitySetting => settings[code] ?? { designation: "", atena: "", specialDue: false };
  const paid = new Map<string, number>();
  for (const s of salaries) paid.set(`${s.staff_id}:${s.target_year}:${s.target_month}`, Number(s.resident_tax) || 0);

  const groups = new Map<string, PaymentGroup>();
  const pending: PendingPerson[] = [];
  for (const st of staff) {
    const staffId = String(st.id);
    // 選んだ月の年度の納付先（納期の特例の期間が年度をまたぐことはない：6〜11月・12〜5月）
    const code = paymentMunicipalityOf(st, fiscalYearOf(year, month));
    const setting = settingOf(code);
    const months = setting.specialDue ? specialPeriodOf(year, month) : [[year, month] as YearMonth];
    const byMonth = months.map(([y, m]) => {
      const v = paid.get(`${staffId}:${y}:${m}`);
      return v === undefined ? null : v;
    });
    const total = byMonth.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    const thisMonth = paid.get(`${staffId}:${year}:${month}`);
    if (thisMonth === undefined && employedIn(st, year, month)) {
      const expected = residentTaxFor(st, year, month);
      if (expected > 0) pending.push({ staffId, name: String(st.name ?? ""), code, expected });
    }
    if (total === 0) continue;
    const g = groups.get(code) ?? {
      code, municipality: localGovByCode(code), setting, months, people: [], total: 0,
      statutoryDue: statutoryDueOf(year, month, setting.specialDue),
      due: rollForward(statutoryDueOf(year, month, setting.specialDue), holidays),
    };
    g.people.push({ staffId, name: String(st.name ?? ""), byMonth, total });
    g.total += total;
    groups.set(code, g);
  }
  return { groups: [...groups.values()].sort((a, b) => a.code.localeCompare(b.code)), pending };
};
