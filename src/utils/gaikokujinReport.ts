/**
 * 外国人雇用状況届出書（様式第3号。労働施策の総合的な推進並びに労働者の雇用の安定及び職業生活の充実等に関する法律28条1項）
 *
 * 雇用保険の被保険者にならない外国人の方（在留資格「外交」「公用」と特別永住者を除く）を雇い入れたとき・離職したときに、
 * 雇い入れた日・離職した日の翌月の末日までに、ハローワークに出す（雇用保険の被保険者は、資格取得届・資格喪失届に在留資格などを書けば、届け出たことになる）。
 * 欄は厚生労働省の様式第3号（表面と裏面の注意。令和8年6月14日からの様式と、令和9年4月1日からの様式）による。1人1枚。
 * 令和9年3月31日までの様式では、特定技能の人は特定産業分野を、特定活動の人は指定された活動を、在留資格に括弧書きで書き足す。
 * 外国人雇用状況届出システム（ハローワークインターネットサービス）で電子届出もできる。
 */
import dayjs from "dayjs";
import { KOYO_RESIDENCE_STATUSES } from "../constants/koyoTodoke";
import { foreignOf } from "./foreignInfo";
import type { KoyoPlace } from "./koyoReport";
import type { PrintForm, PrintItem } from "./printForms";

/** 令和9年4月1日からの様式（特定技能・特定活動の括弧書きが要らない） */
export const GAIKOKUJIN_FORM_2027_FROM = "2027-04-01";

const seireki = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` : "");
/** ひらがなをカタカナにする */
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export interface GaikokujinEvent {
  kind: "hire" | "leave";
  date: string;
}

/** その月に雇い入れた・離職した、雇用保険に入らない外国人の方 */
export const gaikokujinEventsIn = (staff: any, ym: string): GaikokujinEvent[] => {
  if (!foreignOf(staff) || Number(staff?.is_employment_ins_eligible ?? 1) === 1) return [];
  const out: GaikokujinEvent[] = [];
  const join = String(staff?.join_date ?? "");
  const leave = String(staff?.retirement_date ?? "");
  if (join.startsWith(ym)) out.push({ kind: "hire", date: join });
  if (leave.startsWith(ym)) out.push({ kind: "leave", date: leave });
  return out;
};

/** 届け出る期限（雇い入れた日・離職した日の翌月の末日） */
export const gaikokujinDueDate = (date: string): string => dayjs(date).add(1, "month").endOf("month").format("YYYY-MM-DD");

export interface GaikokujinFormInput {
  staff: any;
  events: GaikokujinEvent[];
  place: KoyoPlace;
  company: { name?: string | null; address?: string | null; phone?: string | null; representative?: string | null };
  /** 事業主が法人 */
  corporation: boolean;
  submittedOn: string;
}

export const gaikokujinForm = (input: GaikokujinFormInput): PrintForm & { due: string } => {
  const s = input.staff;
  const f = foreignOf(s)!;
  const hire = input.events.filter((e) => e.kind === "hire");
  const leave = input.events.filter((e) => e.kind === "leave");
  const status = KOYO_RESIDENCE_STATUSES.find((x) => x.code === f.status);
  const statusName = status?.free ? (f.statusText || status.name) : (status?.name ?? "");
  const old = input.events.some((e) => e.date < GAIKOKUJIN_FORM_2027_FROM);
  const supervised = /被監理者|仮滞在許可者/.test(statusName);
  const items: PrintItem[] = [
    { label: "届出の別", value: hire.length > 0 && leave.length > 0 ? "雇入れ・離職" : hire.length > 0 ? "雇入れ（「離職」を消す）" : "離職（「雇入れ」を消す）" },
    { label: "①外国人の氏名（ローマ字）", value: f.romaji },
    { label: "フリガナ（カタカナ）", value: toKatakana(String(s?.furigana ?? "")) },
    { label: "②在留資格", value: statusName },
    { label: "③在留期間（期限）（西暦）", value: supervised ? "（書かない）" : f.periodEnd ? `${seireki(f.periodEnd)}まで` : "" },
    { label: "④生年月日（西暦）", value: seireki(String(s?.birthday ?? "")) },
    { label: "⑤性別", value: s?.gender === "male" ? "1 男" : s?.gender === "female" ? "2 女" : "" },
    { label: "⑥国籍・地域", value: f.nationality },
  ];
  if (hire.length > 0) items.push({ label: "⑦資格外活動許可の有無", value: f.permission === "有" ? "1 有" : f.permission === "無" ? "2 無" : "（該当する人だけ）" });
  items.push({ label: "⑧在留カードの番号", value: supervised ? "（書かない）" : f.card });
  for (const e of hire) items.push({ label: "雇入れ年月日（西暦）", value: seireki(e.date) });
  for (const e of leave) items.push({ label: "離職年月日（西暦）", value: seireki(e.date) });
  items.push(
    { label: "雇入れ又は離職に係る事業所 雇用保険適用事業所番号", value: input.place.koyoNumber },
    { label: "事業所の名称", value: input.place.name },
    { label: "事業所の所在地", value: input.place.address },
    { label: "事業所の電話番号", value: input.place.phone },
  );
  if (input.corporation) {
    items.push(
      { label: "主たる事務所の名称（法人）", value: String(input.company.name ?? "") },
      { label: "主たる事務所の所在地", value: String(input.company.address ?? "") },
      { label: "主たる事務所の電話番号", value: String(input.company.phone ?? "") },
    );
  }
  items.push(
    { label: "①の者が主として左記以外の事業所で就労する場合（派遣・請負）", value: f.dispatch === "該当" ? "☑" : "☐" },
    { label: "事業主の氏名（法人は代表者の氏名）", value: String(input.company.representative ?? "") },
    { label: "提出日", value: seireki(input.submittedOn) },
    { label: "あて先", value: input.place.helloWork ? `${input.place.helloWork}公共職業安定所長 殿` : "公共職業安定所長 殿" },
  );
  const problems: string[] = [];
  if (!f.romaji.trim()) problems.push("ローマ字の氏名がありません（従業員の画面の「在留資格の情報」）");
  if (!f.nationality) problems.push("国籍・地域がありません");
  if (!statusName) problems.push("在留資格がありません");
  if (!supervised && !f.periodEnd) problems.push("在留期間（満了日）がありません");
  if (!supervised && !/^[A-Za-z]{2}\d{8}[A-Za-z]{2}$/.test(f.card.normalize("NFKC"))) problems.push("在留カード番号（英字2・数字8・英字2の12字）がありません");
  if (!s?.birthday) problems.push("生年月日がありません");
  if (s?.gender !== "male" && s?.gender !== "female") problems.push("性別がありません");
  const notes: string[] = [];
  if (old && /特定技能|特定活動/.test(statusName)) {
    notes.push("令和9年3月31日までの様式では、特定技能の人は特定産業分野を、特定活動の人は指定された活動を、在留資格に括弧書きで書き足します（例：特定技能１号（介護）、特定活動（ワーキングホリデー））。");
  }
  notes.push("在留カードで確かめて書きます（在留カードを持たない人は、旅券・在留資格証明書など）。外国人雇用状況届出システムで電子届出もできます。");
  const due = gaikokujinDueDate(input.events.map((e) => e.date).sort()[0] ?? input.submittedOn);
  return { key: `gaikokujin:${s?.id}`, title: "外国人雇用状況届出書（様式第3号）", who: String(s?.name ?? ""), items, problems, notes, due };
};
