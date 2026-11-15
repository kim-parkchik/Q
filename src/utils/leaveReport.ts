/**
 * 健康保険・厚生年金保険 産前産後休業取得者申出書／変更（終了）届と、育児休業等取得者申出書（新規・延長）／終了届
 *
 * 従業員の画面の「休業・休職」に入れた産前産後休業・育児休業等の期間（staff.leave_periods）から作る。
 * ファイルを保存したら、届け出た内容を期間に残し（reported）、あとで期間を直したときに出す届書（変更・延長・終了）を決める。
 *
 * ■ 産前産後休業（日本年金機構「従業員が産前産後休業を取得したときの手続き」「…変更・終了したときなどの手続き」、
 *   詳細説明（ケース6-1・6-3）・記入例（出産前・出産後に提出・予定日より前／後に出産・終了予定日の前に終了）・電子申請の自動チェック csvsankyu）
 *   ・産前産後休業期間：出産の日（出産の日が出産予定日より後なら出産予定日）以前42日（多胎は98日）から、出産の日後56日までの間で、
 *     妊娠・出産を理由に働かなかった期間。出産予定日より前に出産したときは、出産の日以前42日の範囲で開始日が早まることがある
 *   ・申出は、産前産後休業の期間中か、終了日から起算して1か月以内に出す。開始日より前は e-Gov で受け付けない
 *   ・出産後に出すときは出産年月日も書く。出産予定日の前に出して、出産予定日と違う日に出産したとき・期間が変わったときは変更届
 *     （共通記載欄に申出のときの内容、変更欄に変更後の出産（予定）年月日・出産種別・開始年月日・終了予定年月日をすべて書く）、
 *     予定より早く終わったときは終了届（終了年月日。出産年月日も書く）。出産予定日どおりに出産したとき・出産後に申出したときは要らない
 * ■ 育児休業等（産後パパ育休を含む。「従業員が育児休業等を取得・延長したときの手続き」「…終了したときの手続き」、
 *   詳細説明（ケース6-4・6-6）・記入例（新規・延長・終了）・電子申請の自動チェック csvikukyu）
 *   ・育児休業等を取るたび（1歳まで・1歳6か月まで・2歳まで・3歳までの措置・産後パパ育休）に申出する。期間中か、終了日から起算して
 *     1か月以内に出す。開始日より前・子の生年月日より前は e-Gov で受け付けない
 *   ・開始日と終了（予定）日の翌日が同じ月のときは、育児休業等取得日数（14〜30日）と就業予定日数（0〜16日）を書く
 *     （14日に足りないと保険料が免除されないので、e-Gov で受け付けない）
 *   ・終了予定日を延ばすときは延長（共通記載欄に申出のときの開始日・終了予定日、延長欄に変更後の終了予定日）、
 *     予定より早く終わったときは終了届（終了年月日）
 *   ・終了（予定）日は、子が3歳に達する日より前。女性の実子の育児休業は、ふつう産後休業（出産の日後56日）のあとから
 *   ・役員（労働者に当たらない人）は、育児・介護休業法の育児休業等を取れないので、申出できない
 *   ・同じ月に2回以上取ったときの内訳（育休等取得内訳1〜4）は、まだ書けない（1つの期間ずつ届ける）
 * 項目の並び・種別・文字数・コードは src/constants/shahoTodoke.ts（仕様書の PDF から作ったもの）
 */
import dayjs from "dayjs";
import {
  SHAHO_BIRTH_KINDS, SHAHO_CHILD_RELATIONS, SHAHO_IKUKYU_FIELDS, SHAHO_IKUKYU_FORM_CODE, SHAHO_IKUKYU_SEXES, SHAHO_LEAVE_BIRTH_ERA_CODES,
  SHAHO_LEAVE_ERA_CODES, SHAHO_SANKYU_FIELDS, SHAHO_SANKYU_FORM_CODE, type ShahoField,
} from "../constants/shahoTodoke";
import type { LeavePeriod, LeaveReported } from "./leaveExemption";
import { MY_NUMBER_PLACEHOLDER, hasNameSpace, shahoDate, toShahoKana, toShahoKanji, unusableChars, valueProblem } from "./shahoCsv";
import { shahoPersonValues, type ShahoPersonPart } from "./shahoPerson";

/** 和暦の日付（産休・育休の届書の元号のコード）。書けなければ空 */
const leaveDate = (date: string | null | undefined) => (date ? shahoDate(date, SHAHO_LEAVE_ERA_CODES) : null) ?? { era: "", ymd: "" };
const BASIC_REASON = "マイナンバーを書かない人は、基礎年金番号（10けた）を従業員の画面に入れてください";

/**
 * 申出の期限：休業の期間中か、終了日から起算して1か月以内（終了日が決まっていなければ空）
 * 1か月後の同じ日の前日まで。1か月後に同じ日がなければ（3月31日など）、その月の末日まで（民法143条）
 */
export const leaveReportDeadline = (end: string): string => {
  if (!end) return "";
  const d = dayjs(end);
  const next = d.add(1, "month");
  return (next.date() === d.date() ? next.subtract(1, "day") : next).format("YYYY-MM-DD");
};

/** 産前産後休業の終了予定日の目安（出産の日（まだなら出産予定日）の56日後） */
export const maternityEndOf = (birthOrDue: string): string => (birthOrDue ? dayjs(birthOrDue).add(56, "day").format("YYYY-MM-DD") : "");

/** 開始日と、終了日の翌日が同じ月か（育児休業等取得日数を書く） */
const withinOneMonth = (start: string, end: string) => !!start && !!end && start.slice(0, 7) === dayjs(end).add(1, "day").format("YYYY-MM");
/** 日数（両端を入れる） */
const daysOf = (start: string, end: string) => dayjs(end).diff(dayjs(start), "day") + 1;

export type SankyuKind = "apply" | "change" | "end";
export type IkukyuKind = "apply" | "extend" | "end";
export const SANKYU_KIND_LABELS: Record<SankyuKind, string> = { apply: "申出", change: "変更", end: "終了" };
export const IKUKYU_KIND_LABELS: Record<IkukyuKind, string> = { apply: "申出（新規）", extend: "延長", end: "終了" };

/** 届書の1人分 */
export interface LeaveReportRow {
  staffId: string;
  name: string;
  kana: string;
  /** staff.leave_periods の何番目の期間か */
  leaveIndex: number;
  kind: string;
  myNumber: boolean;
  start: string;
  end: string;
  /** 申出の期限（期間中か、終了日から1か月以内） */
  deadline: string;
  values: string[];
  problems: string[];
  notes: string[];
  /** ファイルを保存したら期間に残す、届け出た内容 */
  reported: LeaveReported;
}

/** 項目の決まりで確かめる（事業所整理記号は事業所の情報で、ほかで知らせた項目は除く） */
const checkFields = (fields: ShahoField[], values: string[], skip: Set<number>): string[] => {
  const problems: string[] = [];
  fields.forEach((f, i) => {
    if ((i >= 1 && i <= 3) || skip.has(i)) return;
    const p = valueProblem(f, values[i] ?? "");
    if (p) problems.push(p);
  });
  if (values.length !== fields.length) problems.push(`届書の項目の数が合いません（${values.length}／${fields.length}）`);
  return problems;
};

const problemList = () => {
  const problems: string[] = [];
  const reported = new Set<number>();
  const add = (message: string, ...fields: number[]) => {
    problems.push(message);
    fields.forEach((i) => reported.add(i));
  };
  return { problems, reported, add };
};

/** 被保険者の項目（産休・育休の申出書で同じ並び：整理番号・氏名・個人番号・基礎年金番号・生年月日） */
const PERSON_FIELDS: Record<ShahoPersonPart, number[]> = { pensionNumber: [4], kana: [5], birth: [10, 11], basic: [8, 9] };
const personPart = (staff: any, kanjiField: ShahoField, myNumber: boolean, add: (m: string, ...f: number[]) => void, notes: string[]) => {
  const person = shahoPersonValues(staff, { kanjiField, withoutPensionNumber: false, needBasic: !myNumber, basicReason: BASIC_REASON, birthEras: SHAHO_LEAVE_BIRTH_ERA_CODES });
  person.problems.forEach((p) => add(p.message, ...PERSON_FIELDS[p.part]));
  notes.push(...person.notes);
  return [
    person.pensionNumber, person.kana, person.kanji, myNumber ? MY_NUMBER_PLACEHOLDER : "",
    person.basic?.[0] ?? "", person.basic?.[1] ?? "", person.birth?.era ?? "", person.birth?.ymd ?? "",
  ];
};

// ── 産前産後休業取得者申出書／変更（終了）届 ─────────────────────────

/** 申出のときに届けた内容（変更・終了の共通記載欄） */
export interface MaternityReported {
  dueDate: string;
  multiple: boolean;
  start: string;
  end: string;
}

export interface SankyuInput {
  staff: any;
  leaveIndex: number;
  leave: LeavePeriod;
  kind: SankyuKind;
  /** 申出のときに届けた内容（変更・終了のとき） */
  reported: MaternityReported | null;
  remarks: string;
  myNumber: boolean;
  today: string;
}

/** 次に出す届書（届け出ていなければ申出、早く終わったら終了、出産日・期間が変わったら変更。届けた内容のままなら null） */
export const suggestSankyuKind = (leave: LeavePeriod): SankyuKind | null => {
  const r = leave.reported;
  if (!r) return "apply";
  // 出産予定日の前に申出して、予定日と違う日に出産した・出産予定日が変わった（終了予定日も変わる）
  const changedBirth = !!leave.birthDate && !r.birthDate && leave.birthDate !== r.dueDate;
  const changedDue = !leave.birthDate && !!leave.dueDate && leave.dueDate !== r.dueDate;
  if (changedBirth || changedDue) return "change";
  // 終了日が入っていなければ、出産の日（まだなら出産予定日）の56日後（申出書に書いた終了予定日と同じ決め方）
  const end = leave.end || maternityEndOf(leave.birthDate || leave.dueDate || "");
  // 予定より早く終わった（出産したあと）
  if (end && r.end && end < r.end && (leave.birthDate || r.birthDate)) return "end";
  if (leave.start !== r.start || end !== r.end) return "change";
  return null;
};

/** 申出のときに届けた内容（期間に残したもの。なければ、いまの期間と出産予定日から） */
export const maternityReportedOf = (leave: LeavePeriod): MaternityReported => {
  const r = leave.reported;
  if (r) return { dueDate: r.dueDate ?? "", multiple: r.multiple === true, start: r.start, end: r.end };
  return { dueDate: leave.dueDate ?? "", multiple: leave.multiple === true, start: leave.start, end: leave.end || maternityEndOf(leave.dueDate ?? "") };
};

export const buildSankyuRow = (input: SankyuInput, office: string[]): LeaveReportRow => {
  const { staff, leave, kind } = input;
  const { problems, reported: skip, add } = problemList();
  const notes: string[] = [];
  const person = personPart(staff, SHAHO_SANKYU_FIELDS[6], input.myNumber, add, notes);

  const dueDate = leave.dueDate ?? "";
  const birthDate = leave.birthDate ?? "";
  // 終了予定日：入れていなければ、出産の日（まだなら出産予定日）の56日後
  const end = leave.end || maternityEndOf(birthDate || dueDate);
  if (!leave.end && end) notes.push(`終了日が入っていないので、終了予定日を${birthDate ? "出産の日" : "出産予定日"}の56日後（${end}）にします`);
  if (!dueDate) add("出産予定日を従業員の画面（休業・休職の産前産後休業）に入れてください", 12, 13, ...(end ? [] : [17, 18]));
  if (birthDate && birthDate > input.today) add(`出産の日（${birthDate}）が届け出る日より後です`, 21, 22);

  // 申出（共通記載欄）は申出のときの内容。変更・終了は、届けた内容を共通記載欄に書く
  const common: MaternityReported = kind === "apply"
    ? { dueDate, multiple: leave.multiple === true, start: leave.start, end }
    : input.reported ?? maternityReportedOf(leave);
  if (kind !== "apply" && !common.dueDate) add("申出のときに届けた出産予定日を入れてください", 12, 13);
  if (kind !== "apply" && !common.end) add("申出のときに届けた終了予定日を入れてください", 17, 18);
  if (common.start > input.today) add(`産前産後休業の開始日（${common.start}）になってから届け出ます（e-Gov は、開始日が届け出る日より後の申出書を受け付けません）`, 15, 16);
  if (common.end && common.end < common.start) add("終了予定日が開始日より前です", 17, 18);

  // 産前産後休業期間の目安（出産の日（予定日より後なら出産予定日）以前42日（多胎は98日）から、出産の日後56日まで）
  const base = birthDate && dueDate && birthDate < dueDate ? birthDate : dueDate || birthDate;
  const multiple = leave.multiple === true;
  if (base && leave.start) {
    const earliest = dayjs(base).subtract(multiple ? 97 : 41, "day").format("YYYY-MM-DD");
    if (leave.start < earliest) notes.push(`開始日が、${birthDate && birthDate < dueDate ? "出産の日" : "出産予定日"}以前${multiple ? 98 : 42}日（${earliest}から）より前です。産前休業の期間を確かめてください`);
  }
  if (birthDate && end && end > maternityEndOf(birthDate)) notes.push(`終了日が、出産の日後56日（${maternityEndOf(birthDate)}）より後です。産後休業の期間を確かめてください`);

  const due = leaveDate(common.dueDate);
  const s = leaveDate(common.start);
  const e = leaveDate(common.end);
  const born = leaveDate(birthDate);
  const multipleCode = (m: boolean) => (m ? SHAHO_BIRTH_KINDS["多胎"] : SHAHO_BIRTH_KINDS["単胎"]);
  let change = ["", "", "", "", "", "", ""];
  let ended = ["", ""];
  if (kind === "change") {
    // 変更欄は4つ（変更後の出産（予定）年月日・出産種別・開始年月日・終了予定年月日）をすべて書く
    const newDue = leaveDate(birthDate || dueDate);
    const ns = leaveDate(leave.start);
    const ne = leaveDate(end);
    change = [newDue.era, newDue.ymd, multipleCode(multiple), ns.era, ns.ymd, ne.era, ne.ymd];
    if (!birthDate && dueDate === common.dueDate && leave.start === common.start && end === common.end) {
      notes.push("届けた内容から変わっていません（出産予定日どおりに出産したときなどは、変更届は要りません）");
    }
    if (birthDate && birthDate === common.dueDate && leave.start === common.start && end === common.end) {
      notes.push("出産予定日どおりに出産したので、変更届は要りません");
    }
  }
  if (kind === "end") {
    // 予定より早く終わった：終了年月日（終了予定年月日より前）と、出産年月日
    if (!leave.end) add("終了日を従業員の画面に入れてください（予定より早く終わった日）", 31, 32);
    else if (common.end && leave.end >= common.end) add(`終了日（${leave.end}）が、届けた終了予定日（${common.end}）より前ではありません（予定より早く終わったときに出します）`, 31, 32);
    if (!birthDate) add("終了届には出産年月日も書きます（従業員の画面に出産の日を入れてください）", 21, 22);
    const done = leaveDate(leave.end);
    ended = [done.era, done.ymd];
  }

  const values = [
    SHAHO_SANKYU_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "",
    ...person,
    due.era, due.ymd, multipleCode(common.multiple), s.era, s.ymd, e.era, e.ymd,
    "", "",
    birthDate ? born.era : "", birthDate ? born.ymd : "",
    toShahoKanji(input.remarks),
    ...change, ...ended,
  ];
  problems.push(...checkFields(SHAHO_SANKYU_FIELDS, values, skip));
  const done: LeaveReported = kind === "end"
    ? { kind, on: input.today, start: common.start, end: leave.end, dueDate: common.dueDate, ...(common.multiple ? { multiple: true } : {}), ...(birthDate ? { birthDate } : {}) }
    : {
      kind, on: input.today, start: leave.start, end, dueDate: kind === "change" ? birthDate || dueDate : dueDate,
      ...(multiple ? { multiple: true } : {}), ...(birthDate ? { birthDate } : {}),
    };
  return {
    staffId: String(staff.id), name: String(staff.name ?? ""), kana: person[1], leaveIndex: input.leaveIndex, kind, myNumber: input.myNumber,
    start: leave.start, end, deadline: leaveReportDeadline(end), values, problems: [...new Set(problems)], notes, reported: done,
  };
};

// ── 育児休業等取得者申出書（新規・延長）／終了届 ─────────────────────

/** 申出のときに届けた内容（延長・終了の共通記載欄） */
export interface ChildcareReported {
  start: string;
  end: string;
}

export interface IkukyuInput {
  staff: any;
  leaveIndex: number;
  leave: LeavePeriod;
  kind: IkukyuKind;
  reported: ChildcareReported | null;
  /** 就業予定日数（開始日と終了予定日の翌日が同じ月のとき。産後パパ育休で働く予定の日数） */
  workDays: number;
  /** この期間の開始日と同じ月に始まる、同じ人の育児休業等の数（2つ以上なら、内訳を書けないことを知らせる） */
  sameMonthLeaves?: number;
  remarks: string;
  myNumber: boolean;
  today: string;
}

/** 次に出す届書（届け出ていなければ申出、終了日を延ばしたら延長、早く終わったら終了。届けた内容のままなら null） */
export const suggestIkukyuKind = (leave: LeavePeriod): IkukyuKind | null => {
  const r = leave.reported;
  if (!r) return "apply";
  if (leave.end && r.end && leave.end > r.end) return "extend";
  if (leave.end && r.end && leave.end < r.end) return "end";
  return null;
};

export const childcareReportedOf = (leave: LeavePeriod): ChildcareReported =>
  leave.reported ? { start: leave.reported.start, end: leave.reported.end } : { start: leave.start, end: leave.end };

export const buildIkukyuRow = (input: IkukyuInput, office: string[]): LeaveReportRow => {
  const { staff, leave, kind } = input;
  const { problems, reported: skip, add } = problemList();
  const notes: string[] = [];
  const person = personPart(staff, SHAHO_IKUKYU_FIELDS[6], input.myNumber, add, notes);
  if (Number(staff.is_executive) === 1) {
    add("役員は、育児・介護休業法の育児休業等を取れないので、保険料の免除の申出はできません（日本年金機構）");
  }
  const gender = String(staff.gender ?? "");
  const sex = gender === "male" ? SHAHO_IKUKYU_SEXES["男"] : gender === "female" ? SHAHO_IKUKYU_SEXES["女"] : "";
  if (!sex) add("性別を従業員の画面に入れてください", 12);

  // 養育する子（氏名はカナが必ず。漢字は書けない字がある・12文字を超えるときは書かない）
  const childKana = toShahoKana(leave.childKana);
  if (!childKana) add("養育する子の氏名のフリガナを、従業員の画面（休業・休職の育児休業）に入れてください", 13);
  else if (!hasNameSpace(childKana, " ")) add("養育する子のフリガナの、姓と名の間にスペースを入れてください", 13);
  let childKanji = toShahoKanji(leave.childName);
  const kanjiMax = SHAHO_IKUKYU_FIELDS[14].max;
  if (childKanji && (unusableChars(childKanji).length > 0 || [...childKanji].length > kanjiMax || !hasNameSpace(childKanji, "　"))) {
    notes.push(unusableChars(childKanji).length > 0
      ? `子の氏名に届書に書けない字（${unusableChars(childKanji).join("")}）があるので、漢字の氏名は書きません（カナの氏名で届きます）`
      : [...childKanji].length > kanjiMax ? `子の氏名が${kanjiMax}文字を超えるので、漢字の氏名は書きません（カナの氏名で届きます）`
      : "子の氏名の姓と名の間にスペースがないので、漢字の氏名は書きません（カナの氏名で届きます）");
    childKanji = "";
  }
  // 仕様書の項目説明は「漢字 1〜12」だが、書けない字があるときなどは省略する決まり（e-Gov の自動チェックも 0 文字から）なので、空も通す
  if (!childKanji) skip.add(14);
  const childBirthday = leave.childBirthday ?? "";
  const cb = leaveDate(childBirthday);
  if (!childBirthday) add("養育する子の生年月日を、従業員の画面（休業・休職の育児休業）に入れてください", 15, 16);
  else if (!cb.era) add(`子の生年月日（${childBirthday}）を和暦にできません`, 15, 16);
  else if (childBirthday > input.today) add("子の生年月日が届け出る日より後です", 15, 16);
  const adopted = leave.adopted === true;
  const relation = adopted ? SHAHO_CHILD_RELATIONS["その他"] : SHAHO_CHILD_RELATIONS["実子"];
  const custody = adopted ? leaveDate(leave.custodyStart) : { era: "", ymd: "" };
  if (adopted && !leave.custodyStart) add("養子など実子でない子は、養育を始めた日を従業員の画面に入れてください", 18, 19);

  const common: ChildcareReported = kind === "apply" ? { start: leave.start, end: leave.end } : input.reported ?? childcareReportedOf(leave);
  if (!common.end) add(kind === "apply" ? "終了日（予定）を従業員の画面に入れてください（育児休業等終了予定年月日を書きます）" : "申出のときに届けた終了予定日を入れてください", 22, 23);
  if (common.start > input.today) add(`育児休業等の開始日（${common.start}）になってから届け出ます（e-Gov は、開始日が届け出る日より後の申出書を受け付けません）`, 20, 21);
  if (common.end && common.end < common.start) add("終了予定日が開始日より前です", 22, 23);
  if (adopted && leave.custodyStart && leave.custodyStart > common.start) add("養育を始めた日が、育児休業等の開始日より後です", 18, 19);
  const limit = childBirthday ? dayjs(childBirthday).add(3, "year").format("YYYY-MM-DD") : "";
  const latestEnd = kind === "end" ? common.end : leave.end;
  if (limit && latestEnd && latestEnd >= limit) add(`終了（予定）日は、子が3歳に達する日（${dayjs(limit).subtract(1, "day").format("YYYY-MM-DD")}）より前にします`, 22, 23, 28, 29);
  if (gender === "female" && !adopted && childBirthday && common.start && common.start <= maternityEndOf(childBirthday)) {
    notes.push(`出産の日後56日（${maternityEndOf(childBirthday)}）までは産後休業なので、女性の育児休業は、ふつうその翌日から始まります`);
  }

  // 開始日と終了（予定）日の翌日が同じ月：育児休業等取得日数（14日以上）と就業予定日数
  const workDays = Math.max(0, Math.trunc(input.workDays || 0));
  let daysText = ["", ""];
  if (withinOneMonth(common.start, common.end)) {
    const days = daysOf(common.start, common.end);
    if (days < 14 && kind === "apply") add(`同じ月のうちに始まって終わる育児休業等が${days}日で、14日に足りないので、保険料は免除されません（申出書は出せません）`, 24);
    if (workDays > 16) add("就業予定日数は16日までです", 25);
    daysText = [String(days), String(workDays)];
    notes.push(`開始日と終了日の翌日が同じ月なので、育児休業等取得日数（${days}日）と就業予定日数（${workDays}日）を書きます`);
  }
  if ((input.sameMonthLeaves ?? 0) > 1) notes.push("同じ月に2回以上の育児休業等を取っています。月ごとの内訳（育休等取得内訳）は、まだ書けません");

  let extend = ["", "", ""];
  let ended = ["", "", ""];
  if (kind === "extend") {
    const ne = leaveDate(leave.end);
    if (!leave.end || (common.end && leave.end <= common.end)) add(`延長するときは、従業員の画面の終了日を、届けた終了予定日（${common.end}）より後にしてください`, 28, 29);
    const sameMonth = withinOneMonth(common.start, leave.end);
    extend = [ne.era, ne.ymd, sameMonth ? String(daysOf(common.start, leave.end)) : ""];
  }
  if (kind === "end") {
    const done = leaveDate(leave.end);
    if (!leave.end) add("終了日を従業員の画面に入れてください（予定より早く終わった日）", 31, 32);
    else if (common.end && leave.end >= common.end) add(`終了日（${leave.end}）が、届けた終了予定日（${common.end}）より前ではありません（予定より早く終わったときに出します）`, 31, 32);
    else if (leave.end < common.start) add("終了日が開始日より前です", 31, 32);
    const sameMonth = withinOneMonth(common.start, leave.end);
    ended = [done.era, done.ymd, sameMonth ? String(daysOf(common.start, leave.end)) : ""];
  }

  const s = leaveDate(common.start);
  const e = leaveDate(common.end);
  const values = [
    SHAHO_IKUKYU_FORM_CODE, office[0] ?? "", office[1] ?? "", office[2] ?? "",
    ...person, sex,
    childKana, childKanji, cb.era, cb.ymd, relation, custody.era, custody.ymd,
    s.era, s.ymd, e.era, e.ymd, ...daysText, leave.papaMama === true ? "1" : "", toShahoKanji(input.remarks),
    ...extend, ...ended,
    ...Array(SHAHO_IKUKYU_FIELDS.length - 34).fill(""),
  ];
  problems.push(...checkFields(SHAHO_IKUKYU_FIELDS, values, skip));
  const end = leave.end;
  return {
    staffId: String(staff.id), name: String(staff.name ?? ""), kana: person[1], leaveIndex: input.leaveIndex, kind, myNumber: input.myNumber,
    start: common.start, end, deadline: leaveReportDeadline(end), values, problems: [...new Set(problems)], notes,
    reported: { kind, on: input.today, start: common.start, end },
  };
};
