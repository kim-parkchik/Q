/**
 * 健康保険の被扶養者（従業員の画面の「健康保険の被扶養者」。staff.health_dependents の JSON）
 *
 * 被扶養者（異動）届・国民年金第3号被保険者関係届（utils/fuyouReport.ts）に書く家族の情報と、届け出た内容を持つ。
 * ・配偶者（夫・妻。届出をしていない事実婚の夫・妻も）と、その他の被扶養者（子・父母・祖父母・孫・兄弟姉妹など）
 * ・被扶養者になった日と理由、被扶養者でなくなった日と理由（死亡・離婚・就職・収入増加・75歳到達・障害認定など）
 * ・同居か別居か・住所・職業・年間収入の見込み・海外に住んでいるとき（海外特例要件）
 * ・ファイルを保存したら、届け出た内容（該当・非該当・変更と、そのときの氏名・生年月日など）を残す（reported）。あとで氏名などを直すと、
 *   変更の届けを出す
 * 決まり：日本年金機構「従業員（健康保険・厚生年金保険の被保険者）が家族を被扶養者にするとき、被扶養者に異動があったときの手続き」
 * （被扶養者の範囲・収入要件・削除（非該当）・記録事項の変更）・「2-3」の詳細説明・記入例・電子申請（e-Gov）の入力例
 * 続柄・理由・職業のコードは、仕様書から作った src/constants/shahoTodoke.ts の SHAHO_FUYOU_CODES（名前で持つ）
 */
import dayjs from "dayjs";
import { SHAHO_FUYOU_CODES } from "../constants/shahoTodoke";
import { birthdayAt } from "./calcSalary";

/** 異動の別（該当：被扶養者にする／非該当：被扶養者から外す／変更：氏名・生年月日・性別などを直す） */
export type FuyouChangeKind = keyof typeof SHAHO_FUYOU_CODES.change;

/** 届け出た内容（ファイルを保存したときに残す） */
export interface DependentReported {
  kind: FuyouChangeKind;
  /** 届け出た日（ファイルを保存した日） */
  on: string;
  name: string;
  kana: string;
  birthday: string;
  gender: string;
  /** 3号被保険者として届けたか（配偶者） */
  sango?: boolean;
  /** 届け出た、海外特例要件に非該当となった日（国内転入など） */
  overseasUntil?: string;
}

/** 健康保険の被扶養者1人 */
export interface HealthDependent {
  /** 画面の行を見分ける印（作ったときの時刻など） */
  id: string;
  /** 配偶者（夫・妻）か、その他の被扶養者か */
  spouse: boolean;
  /**
   * 続柄：配偶者は SHAHO_FUYOU_CODES.spouseRelation の名前（夫・妻・夫(未届)・妻(未届)）、
   * その他は otherRelation の名前（実子・養子・1以外の子・父母・養父母・義父母・弟妹・兄姉・祖父母・曾祖父母・孫・その他）
   */
  relation: string;
  /** 続柄が「その他」のとき、具体的な続柄（伯父・甥など。3親等内で同居している人） */
  relationNote: string;
  /** 氏名（漢字。姓と名の間にスペース）とフリガナ */
  name: string;
  kana: string;
  birthday: string;
  gender: "male" | "female" | "";
  /** 被保険者（従業員）と同居しているか */
  together: boolean;
  /** 住所（郵便番号・都道府県から） */
  zip: string;
  address: string;
  /** 電話番号（配偶者）と、その種別（自宅・携帯・勤務先・その他） */
  phone: string;
  phoneKind: string;
  /** 基礎年金番号（配偶者で、マイナンバーを書かないとき。3号被保険者の届けに書く） */
  basicPensionNumber: string;
  /** 職業（SHAHO_FUYOU_CODES.spouseJob・otherJob の名前） */
  job: string;
  /** 今後1年間の年間収入の見込み（円。非課税の年金・失業給付・傷病手当金なども入れる） */
  income: number | null;
  /** 被扶養者になった日と理由（SHAHO_FUYOU_CODES.spouseReason・otherReason の名前。「その他」は reasonNote に） */
  from: string;
  reason: string;
  reasonNote: string;
  /** 被扶養者でなくなった日と理由（でなくなっていなければ空。spouseEndReason・otherEndReason の名前） */
  until: string;
  endReason: string;
  endReasonNote: string;
  /** 死亡したとき、死亡した日（被扶養者でなくなった日は、その翌日） */
  deathDate: string;
  /** 日本国内に住所がないが、留学などで被扶養者になる（海外特例要件に該当）。理由・該当した日 */
  overseas: boolean;
  overseasReason: string;
  overseasReasonNote: string;
  overseasFrom: string;
  /**
   * 海外特例要件に非該当となった日・理由（国内転入・その他）・国内転入日。被扶養者のまま日本に住むようになったときなど
   * （異動の別「変更」の届けで出す。被扶養者でなくなるときは、非該当の届けに海外特例は書かない。仕様書 表4.10.1-1）
   */
  overseasUntil: string;
  overseasEndReason: string;
  overseasEndReasonNote: string;
  returnedOn: string;
  /** 資格確認書の発行が要る（マイナ保険証を使わない人） */
  certificate: boolean;
  /** 事業主が、戸籍謄本・住民票で続柄を確かめた（マイナンバーと一緒なら、続柄の書類を省ける） */
  relationChecked: boolean;
  /**
   * 国民年金の第3号被保険者になるか（配偶者）。null は年齢から決める（20歳以上60歳未満の被扶養配偶者は、ふつう第3号被保険者）
   * 被保険者が65歳以上で老齢年金を受けられるときなどは、なれないので false にする
   */
  sango: boolean | null;
  /** 備考（変更の届けには、変更した項目と変更前の内容を書く） */
  remarks: string;
  /** 届け出た内容 */
  reported?: DependentReported;
}

export const emptyDependent = (spouse: boolean, id = String(Date.now())): HealthDependent => ({
  id, spouse, relation: spouse ? "妻" : "実子・養子", relationNote: "", name: "", kana: "", birthday: "", gender: "",
  together: true, zip: "", address: "", phone: "", phoneKind: "", basicPensionNumber: "",
  job: spouse ? "無職" : "小・中学生以下", income: 0,
  from: "", reason: spouse ? "婚姻" : "出生", reasonNote: "",
  until: "", endReason: "", endReasonNote: "", deathDate: "",
  overseas: false, overseasReason: "", overseasReasonNote: "", overseasFrom: "",
  overseasUntil: "", overseasEndReason: "", overseasEndReasonNote: "", returnedOn: "",
  certificate: false, relationChecked: false, sango: null, remarks: "",
});

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const date = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/** staff.health_dependents を読む（壊れていれば空） */
export const parseHealthDependents = (json: string | null | undefined): HealthDependent[] => {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((d) => d && typeof d === "object").map((d: any, i): HealthDependent => {
    const base = emptyDependent(d.spouse === true, str(d.id) || `d${i}`);
    const income = typeof d.income === "number" && Number.isFinite(d.income) ? Math.max(0, Math.floor(d.income)) : null;
    const r = d.reported;
    return {
      ...base,
      relation: str(d.relation) || base.relation, relationNote: str(d.relationNote), name: str(d.name), kana: str(d.kana),
      birthday: date(d.birthday), gender: d.gender === "male" || d.gender === "female" ? d.gender : "",
      together: d.together !== false, zip: str(d.zip), address: str(d.address), phone: str(d.phone), phoneKind: str(d.phoneKind),
      basicPensionNumber: str(d.basicPensionNumber), job: str(d.job) || base.job, income,
      from: date(d.from), reason: str(d.reason) || base.reason, reasonNote: str(d.reasonNote),
      until: date(d.until), endReason: str(d.endReason), endReasonNote: str(d.endReasonNote), deathDate: date(d.deathDate),
      overseas: d.overseas === true, overseasReason: str(d.overseasReason), overseasReasonNote: str(d.overseasReasonNote), overseasFrom: date(d.overseasFrom),
      overseasUntil: date(d.overseasUntil), overseasEndReason: str(d.overseasEndReason), overseasEndReasonNote: str(d.overseasEndReasonNote), returnedOn: date(d.returnedOn),
      certificate: d.certificate === true, relationChecked: d.relationChecked === true,
      sango: d.sango === true ? true : d.sango === false ? false : null, remarks: str(d.remarks),
      ...(r && typeof r === "object" && ["該当", "非該当", "変更"].includes(r.kind)
        ? { reported: {
          kind: r.kind, on: date(r.on), name: str(r.name), kana: str(r.kana), birthday: date(r.birthday), gender: str(r.gender),
          ...(typeof r.sango === "boolean" ? { sango: r.sango } : {}), ...(date(r.overseasUntil) ? { overseasUntil: date(r.overseasUntil) } : {}),
        } }
        : {}),
    };
  });
};

/** 保存する JSON（いなければ空） */
export const stringifyHealthDependents = (list: HealthDependent[]): string => (list.length > 0 ? JSON.stringify(list) : "");

/** 続柄・理由・職業の選べる名前（仕様書のコードの名前） */
export const relationOptions = (spouse: boolean): string[] => Object.keys(spouse ? SHAHO_FUYOU_CODES.spouseRelation : SHAHO_FUYOU_CODES.otherRelation);
export const reasonOptions = (spouse: boolean): string[] => Object.keys(spouse ? SHAHO_FUYOU_CODES.spouseReason : SHAHO_FUYOU_CODES.otherReason);
export const endReasonOptions = (spouse: boolean): string[] => Object.keys(spouse ? SHAHO_FUYOU_CODES.spouseEndReason : SHAHO_FUYOU_CODES.otherEndReason);
export const jobOptions = (spouse: boolean): string[] => Object.keys(spouse ? SHAHO_FUYOU_CODES.spouseJob : SHAHO_FUYOU_CODES.otherJob);

/**
 * 第3号被保険者になるか（配偶者だけ）：sango を入れていればそれ、入れていなければ、被扶養者になった日に20歳以上60歳未満なら true
 * （20歳以上60歳未満の、第2号被保険者（厚生年金の被保険者）に扶養される配偶者が第3号被保険者。国民年金法7条）
 */
export const isSango = (d: HealthDependent, on: string): boolean => {
  if (!d.spouse) return false;
  if (d.sango !== null) return d.sango;
  if (!d.birthday || !on) return false;
  // 20歳・60歳に達するのは、誕生日の前日
  const reach20 = birthdayAt(d.birthday, 20).subtract(1, "day").format("YYYY-MM-DD");
  const reach60 = birthdayAt(d.birthday, 60).subtract(1, "day").format("YYYY-MM-DD");
  return reach20 <= on && on < reach60;
};

/** 被扶養者の収入の目安（年間収入の見込み。60歳以上・障害者は180万円、19歳以上23歳未満（配偶者を除く）は150万円、そのほかは130万円未満） */
export const incomeLimitOf = (d: HealthDependent, on: string): number => {
  if (!d.birthday || !on) return 1_300_000;
  const age = dayjs(on).diff(dayjs(d.birthday), "year");
  if (age >= 60) return 1_800_000;
  if (!d.spouse && age >= 19 && age < 23) return 1_500_000;
  return 1_300_000;
};

/** 海外特例要件に非該当となった日を入れていて、まだ届けていないか（変更の届けで出す） */
export const overseasEnded = (d: HealthDependent): boolean =>
  !!d.overseas && !!d.overseasUntil && !d.until && !!d.reported && d.reported.kind !== "非該当" && d.reported.overseasUntil !== d.overseasUntil;

/** 氏名・生年月日・性別・海外特例要件の非該当が、届け出た内容と違うか（変更の届けを出す） */
export const changedFromReported = (d: HealthDependent): string[] => {
  const r = d.reported;
  if (!r || r.kind === "非該当") return [];
  const items: string[] = [];
  if (r.name !== d.name || r.kana !== d.kana) items.push("氏名");
  if (r.birthday !== d.birthday) items.push("生年月日");
  if (r.gender !== d.gender) items.push("性別");
  if (overseasEnded(d)) items.push("海外特例要件の非該当");
  return items;
};

/**
 * 次に出す届け（届け出ていなければ該当、でなくなった日を入れたら非該当、氏名などを直したら変更。届け出たままなら null）
 * Q を使う前に届けた人は、従業員の画面で「届け出ている」にしておく（reported の kind が「該当」で、届けた日は空）
 */
export const suggestFuyouKind = (d: HealthDependent): FuyouChangeKind | null => {
  if (d.until) return d.reported?.kind === "非該当" ? null : "非該当";
  if (!d.reported) return d.from ? "該当" : null;
  return changedFromReported(d).length > 0 ? "変更" : null;
};

/** Q を使う前に届けた被扶養者の印（いまの氏名などで、届け出ていることにする） */
export const markedReported = (d: HealthDependent): DependentReported =>
  ({ kind: "該当", on: "", name: d.name, kana: d.kana, birthday: d.birthday, gender: d.gender });

/** 入れた内容の間違い（従業員の画面で知らせる） */
export const dependentProblems = (d: HealthDependent): string[] => {
  const p: string[] = [];
  if (!d.name.trim()) p.push("氏名を入れてください");
  if (!d.kana.trim()) p.push("フリガナを入れてください");
  if (!d.birthday) p.push("生年月日を入れてください");
  if (!d.from && !d.reported) p.push("被扶養者になった日を入れてください");
  if (d.until && d.from && d.until < d.from) p.push("被扶養者でなくなった日が、なった日より前です");
  if (d.until && !d.endReason) p.push("被扶養者でなくなった理由を選んでください");
  if (d.endReason === "死亡" && !d.deathDate) p.push("死亡した日を入れてください");
  if (d.overseas && !d.overseasReason) p.push("海外特例要件に該当した理由を選んでください");
  if (d.overseasUntil && !d.overseas) p.push("海外特例要件に非該当となった日は、海外特例要件に該当している人だけ入れます");
  if (d.overseasUntil && !d.overseasEndReason) p.push("海外特例要件に非該当となった理由（国内転入・その他）を選んでください");
  if (d.overseasEndReason === "国内転入" && !d.returnedOn) p.push("国内転入日を入れてください");
  if (d.overseasEndReason === "その他" && !d.overseasEndReasonNote.trim()) p.push("海外特例要件に非該当となった理由（その他）を入れてください");
  return p;
};
