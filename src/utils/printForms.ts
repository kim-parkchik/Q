/**
 * 電子申請用ファイル（CSV形式届書）の形がない届書の、書く内容（印刷する。紙の届書に書き写すか、e-Gov の画面で入れる）
 * ・厚生年金保険 被保険者資格喪失届／70歳以上被用者該当届（70歳到達届）
 * ・健康保険・厚生年金保険 産前産後休業終了時報酬月額変更届・育児休業等終了時報酬月額変更届
 * ・厚生年金保険 養育期間標準報酬月額特例申出書・終了届
 * ・健康保険・厚生年金保険 被保険者住所変更届・被保険者氏名変更（訂正）届
 * どれも、日本年金機構の手続きのページ・詳細説明・記入例（・e-Gov の自動チェック）にある項目を、記入例の番号の順に書く。
 * マイナンバーは画面・印刷に出さない（書くときは、事務取扱担当者が届書に書く）。
 */
import dayjs from "dayjs";
import * as Master from "../constants";
import { lookupGrade } from "./santei";
import { pensionStandardOf, warekiMonth } from "./remunerationReport";
import { getStandardRemuneration } from "./standardRemuneration";
import { reach70Date, splitBasicPensionNumber } from "./shahoPerson";
import { formatWareki } from "./wareki";

/** 届書に書く1項目 */
export interface PrintItem {
  label: string;
  value: string;
}

/** 印刷する届書1枚分 */
export interface PrintForm {
  key: string;
  /** 届書の名前 */
  title: string;
  /** だれの届書か（被保険者の氏名） */
  who: string;
  items: PrintItem[];
  /** 直すところ（届書を出す前に確かめる） */
  problems: string[];
  notes: string[];
}

const w = (date: string | null | undefined) => (date ? formatWareki(date) : "");
const yen = (n: number | null | undefined) => (n === null || n === undefined ? "" : `${Math.floor(n).toLocaleString()}円`);
const genderText = (g: string) => (g === "male" ? "男" : g === "female" ? "女" : "");
/** 個人番号（または基礎年金番号）の欄（マイナンバーは印刷しない） */
export const numberItem = (staff: any, myNumber: boolean): PrintItem => {
  const basic = splitBasicPensionNumber(staff.basic_pension_number);
  return {
    label: "個人番号（または基礎年金番号）",
    value: myNumber ? "マイナンバーを書く（印刷しません）" : basic ? `基礎年金番号 ${basic[0]}-${basic[1]}` : "",
  };
};
const personItems = (staff: any, myNumber: boolean): PrintItem[] => [
  { label: "被保険者整理番号", value: String(staff.pension_num ?? "") },
  numberItem(staff, myNumber),
  { label: "被保険者の氏名（フリガナ）", value: `${staff.name ?? ""}（${staff.furigana ?? ""}）` },
  { label: "生年月日", value: w(staff.birthday) },
];
const needNumber = (staff: any, myNumber: boolean, problems: string[]) => {
  if (!myNumber && !splitBasicPensionNumber(staff.basic_pension_number)) problems.push("マイナンバーか基礎年金番号を書きます（従業員の画面に基礎年金番号を入れるか、マイナンバーを書いてください）");
  if (!String(staff.pension_num ?? "").trim()) problems.push("被保険者整理番号がありません（従業員の画面の「厚生年金 整理番号」）");
};

// ── 70歳到達届 ─────────────────────────────────────────────

export interface Age70Input {
  staff: any;
  /** 届書を出す日 */
  submittedOn: string;
  /** 70歳到達日の報酬月額（通貨・現物）。通貨を入れていなければ null */
  wage: number | null;
  inKind: number;
  /** 備考：二以上事業所勤務者・短時間労働者・その他 */
  shortTime: boolean;
  remarks: string;
  myNumber: boolean;
}

/**
 * 70歳到達届（厚生年金保険 被保険者資格喪失届／70歳以上被用者該当届）
 * 決まり（日本年金機構「2-5：従業員が70歳になったとき」の詳細説明・記入例・e-Gov の自動チェック（70歳到達時））：
 * ・70歳に達した日（誕生日の前日）に厚生年金の資格を失い、70歳以上被用者になる（健康保険は続く）。喪失年月日と該当年月日は、その日
 * ・70歳到達日の標準報酬月額相当額（その日の報酬月額を、資格取得時と同じように等級表に当てはめた額）が、前日の標準報酬月額と
 *   違うときだけ、70歳到達日から5日以内に出す（同じときは年金機構が処理するので出さない）
 */
export const age70Form = (input: Age70Input): PrintForm & { reachedOn: string; equivalent: number | null; previous: number; needed: boolean | null } => {
  const { staff } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const reachedOn = staff.birthday ? reach70Date(staff.birthday) : "";
  const [y, m] = (reachedOn || dayjs().format("YYYY-MM-DD")).split("-").map(Number);
  const before = dayjs(reachedOn || undefined).subtract(1, "day");
  const master = Master.getInsuranceMaster(y, m);
  const range = { min: master.PENSION_MIN_HYOJUN, max: master.PENSION_MAX_HYOJUN };
  const previousRaw = getStandardRemuneration(staff, before.year(), before.month() + 1);
  const previous = previousRaw > 0 ? pensionStandardOf(previousRaw, range) : 0;
  const total = input.wage === null ? null : input.wage + Math.max(0, input.inKind);
  const equivalent = total === null ? null : pensionStandardOf(lookupGrade(master.HYOJUN_TABLE, total).standard, range);
  const needed = equivalent === null ? null : equivalent !== previous;
  if (!reachedOn) problems.push("生年月日を従業員の画面に入れてください");
  if (input.wage === null) problems.push("70歳到達日の報酬月額（通貨）を入れてください");
  needNumber(staff, input.myNumber, problems);
  if (needed === false) notes.push(`標準報酬月額相当額（${yen(equivalent)}）が、70歳到達日の前日の標準報酬月額（${yen(previous)}）と同じなので、届出は要りません（年金機構が厚生年金の資格喪失と70歳以上被用者該当の処理をします）`);
  if (needed) notes.push(`標準報酬月額相当額（${yen(equivalent)}）が、前日の標準報酬月額（${yen(previous)}）と違うので、70歳到達日から5日以内（${w(dayjs(reachedOn).add(5, "day").format("YYYY-MM-DD"))}まで）に出します`);
  return {
    key: `age70:${staff.id}`, title: "厚生年金保険 被保険者資格喪失届／厚生年金保険 70歳以上被用者該当届（70歳到達届）", who: String(staff.name ?? ""),
    items: [
      { label: "提出日", value: w(input.submittedOn) },
      ...personItems(staff, input.myNumber),
      { label: "備考", value: [Number(staff.multi_office) === 1 ? "1. 二以上事業所勤務者" : "", input.shortTime ? "2. 短時間労働者（特定適用事業所等）" : "", input.remarks ? `3. その他（${input.remarks}）` : ""].filter(Boolean).join("・") },
      { label: "喪失年月日（70歳の誕生日の前日）", value: w(reachedOn) },
      { label: "喪失原因", value: "6. 70歳到達（厚生年金保険のみ喪失）" },
      { label: "該当年月日（喪失年月日と同じ日）", value: w(reachedOn) },
      { label: "報酬月額（㋐通貨・㋑現物・㋒合計）", value: input.wage === null ? "" : `㋐ ${yen(input.wage)}・㋑ ${yen(input.inKind)}・㋒ ${yen(total)}` },
      { label: "（確かめ）標準報酬月額相当額・前日の標準報酬月額", value: `${yen(equivalent)}・${yen(previous)}` },
    ],
    problems, notes, reachedOn, equivalent, previous, needed,
  };
};

// ── 被保険者住所変更届・氏名変更（訂正）届 ───────────────────────

export interface AddressChangeInput {
  staff: any;
  submittedOn: string;
  /** 住所が変わった日 */
  changedOn: string;
  /** 備考（短期在留・海外居住・住民票住所以外の居所・その他） */
  remark: string;
  /** 同居の被扶養配偶者（第3号被保険者）の住所も変える（同居なら、配偶者の住所欄は書かなくてよい） */
  spouse: { name: string; kana: string; birthday: string; together: boolean; zip: string; address: string } | null;
  myNumber: boolean;
}

/**
 * 被保険者住所変更届（国民年金第3号被保険者住所変更届）
 * 決まり（日本年金機構「3-1：被保険者の住所に変更があったとき」）：マイナンバーと基礎年金番号が結びついている人は、届けは要らない
 * （住民票の住所で変わる）。結びついていない人・健康保険だけに入っている人・海外居住者・短期在留外国人・住民票以外の居所を
 * 登録する人は、事業主が出す
 */
export const addressChangeForm = (input: AddressChangeInput): PrintForm => {
  const { staff } = input;
  const problems: string[] = [];
  needNumber(staff, input.myNumber, problems);
  if (!input.changedOn) problems.push("住所が変わった日を入れてください");
  if (!staff.zip_code || !staff.address) problems.push("新しい郵便番号と住所を、従業員の画面に入れてください");
  const sp = input.spouse;
  return {
    key: `address:${staff.id}`, title: "健康保険・厚生年金保険 被保険者住所変更届（国民年金第3号被保険者住所変更届）", who: String(staff.name ?? ""),
    items: [
      { label: "提出日", value: w(input.submittedOn) },
      ...personItems(staff, input.myNumber),
      { label: "郵便番号（変更後）", value: String(staff.zip_code ?? "") },
      { label: "住所（変更後。フリガナ）", value: `${staff.address ?? ""}（${staff.address_kana ?? ""}）` },
      { label: "住所変更年月日", value: w(input.changedOn) },
      { label: "備考", value: input.remark },
      ...(sp ? [
        { label: "被扶養配偶者の住所変更", value: sp.together ? "被保険者と配偶者は同居している（配偶者の郵便番号・住所は書かなくてよい）" : "別居" },
        { label: "配偶者の氏名（フリガナ）・生年月日", value: `${sp.name}（${sp.kana}）・${w(sp.birthday)}` },
        ...(sp.together ? [] : [{ label: "配偶者の郵便番号・住所・住所変更年月日", value: `${sp.zip} ${sp.address}・${w(input.changedOn)}` }]),
      ] : []),
    ],
    problems,
    notes: ["マイナンバーと基礎年金番号が結びついている人は、届けは要りません（住民票の住所で変わります）"],
  };
};

export interface NameChangeInput {
  staff: any;
  submittedOn: string;
  /** 変更前の氏名（漢字）と、備考 */
  oldName: string;
  remark: string;
  myNumber: boolean;
}

/**
 * 被保険者氏名変更（訂正）届
 * 決まり（日本年金機構「3-2：被保険者の氏名に変更があったとき」）：マイナンバーと基礎年金番号が結びついている人は、原則、届けは要らない。
 * 結びついていない人・協会けんぽの健康保険だけに入っている人（結びついていても要る）・マイナンバーのない海外居住者・短期在留外国人は、
 * 申出を受けた事業主が、すみやかに出す
 */
export const nameChangeForm = (input: NameChangeInput): PrintForm => {
  const { staff } = input;
  const problems: string[] = [];
  needNumber(staff, input.myNumber, problems);
  if (!input.oldName.trim()) problems.push("変更前の氏名を入れてください");
  return {
    key: `name:${staff.id}`, title: "健康保険・厚生年金保険 被保険者氏名変更（訂正）届", who: String(staff.name ?? ""),
    items: [
      { label: "提出日", value: w(input.submittedOn) },
      { label: "被保険者整理番号", value: String(staff.pension_num ?? "") },
      numberItem(staff, input.myNumber),
      { label: "生年月日", value: w(staff.birthday) },
      { label: "被保険者の氏名（変更後。フリガナ）", value: `${staff.name ?? ""}（${staff.furigana ?? ""}）` },
      { label: "変更前の氏名", value: input.oldName },
      { label: "備考", value: input.remark },
    ],
    problems,
    notes: ["マイナンバーと基礎年金番号が結びついている人は、原則、届けは要りません（協会けんぽの健康保険だけに入っている人は要ります）"],
  };
};

/** 性別の書き方（養育特例の申出書など） */
export const genderLabel = genderText;

// ── 産前産後休業終了時・育児休業等終了時報酬月額変更届 ───────────────────

export interface LeaveEndFormInput {
  staff: any;
  /** maternity：産前産後休業終了時／childcare：育児休業等終了時 */
  type: "maternity" | "childcare";
  /** 休業を終えた日（終了日。その翌日の月から3か月） */
  leaveEnd: string;
  /** 養育する子の氏名（フリガナ）・生年月日 */
  childName: string;
  childBirthday: string;
  /** 3か月の給与（支払った月・支払基礎日数・報酬（現物を含む）・うち現物）と、平均に入れた月 */
  months: { year: number; month: number; days: number | null; amount: number | null; inKind?: number }[];
  usedIndexes: number[];
  average: number | null;
  /** 従前の標準報酬月額（健保。厚年は厚生年金の等級表の上限・下限の中） */
  previous: number;
  pensionRange: { min: number; max: number };
  gradeDiff: number | null;
  /** 改定年月（YYYY-MM） */
  revisionFrom: string;
  /** 給与の締め日と支払日（「末日締め翌月25日払い」） */
  payRule: string;
  short: boolean;
  part: boolean;
  submittedOn: string;
  /** 被保険者が事業主に申し出た日 */
  appliedOn: string;
  myNumber: boolean;
}

/**
 * 産前産後休業終了時報酬月額変更届・育児休業等終了時報酬月額変更届（70歳以上被用者の相当額変更届も同じ様式）
 * 決まり（日本年金機構「6-2」「6-5」の手続き・記入例）：本人の申出で、事業主がすみやかに出す。終了日の翌日の月から3か月の、
 * 支払基礎日数が17日以上（短時間労働者は11日、パートは3か月とも17日未満なら15日）の月の平均（1円未満切り捨て）で、
 * 4か月目から改定する。申出者の住所・氏名を書き、届出意思の確認の□に✔を付ける。終了日の翌日に引き続いて次の休業
 * （育休のあとの産休・産休のあとの育休）を始めたときは、申出できない
 */
export const leaveEndForm = (input: LeaveEndFormInput): PrintForm => {
  const { staff } = input;
  const problems: string[] = [];
  const name = input.type === "childcare" ? "育児休業等" : "産前産後休業";
  needNumber(staff, input.myNumber, problems);
  if (!input.appliedOn) problems.push("被保険者から申出を受けた日を入れてください（申出があったときだけ届け出ます）");
  if (!input.childName) problems.push("養育する子の氏名を入れてください");
  const rows = input.months.map((m, i) => {
    const total = Math.max(0, Math.floor(m.amount ?? 0));
    const inKind = Math.min(total, Math.max(0, Math.floor(m.inKind ?? 0)));
    return { label: `給与支給月 ${m.month}月（${input.usedIndexes.includes(i) ? "平均に入れる" : "入れない"}）`, value: `基礎日数 ${m.days ?? "—"}日・㋐通貨 ${yen(total - inKind)}・㋑現物 ${yen(inKind)}・㋒合計 ${yen(total)}`, total, used: input.usedIndexes.includes(i) };
  });
  const sum = rows.filter((r) => r.used).reduce((s, r) => s + r.total, 0);
  const [ry, rm] = input.revisionFrom.split("-").map(Number);
  const age70 = staff.birthday && reach70Date(staff.birthday) <= `${input.revisionFrom}-01`;
  return {
    key: `leaveEnd:${staff.id}:${input.type}:${input.leaveEnd}`, title: `健康保険・厚生年金保険 ${name}終了時報酬月額変更届（厚生年金保険 70歳以上被用者${name}終了時報酬月額相当額変更届）`,
    who: String(staff.name ?? ""),
    items: [
      { label: "提出日", value: w(input.submittedOn) },
      { label: "申出日・申出者の住所・氏名・電話（届出意思の確認の□に✔）", value: `${w(input.appliedOn)}・${staff.address ?? ""}・${staff.name ?? ""}・${staff.phone || staff.mobile || ""}` },
      ...personItems(staff, input.myNumber),
      { label: "子の氏名・生年月日", value: `${input.childName}・${w(input.childBirthday)}` },
      { label: `${name}終了年月日`, value: w(input.leaveEnd) },
      ...rows.map(({ label, value }) => ({ label, value })),
      { label: "総計（平均に入れた月）", value: yen(sum) },
      { label: "平均額（1円未満切り捨て）", value: yen(input.average) },
      { label: "従前の標準報酬月額（健保・厚年）", value: `${(input.previous / 1000).toLocaleString()}千円・${(pensionStandardOf(input.previous, input.pensionRange) / 1000).toLocaleString()}千円` },
      { label: "昇（降）給", value: input.gradeDiff === null ? "" : input.gradeDiff > 0 ? "1. 昇給" : "2. 降給" },
      { label: "改定年月", value: warekiMonth(input.revisionFrom) },
      { label: "給与締切日・支払日", value: input.payRule },
      { label: "備考", value: [age70 ? "1. 70歳以上被用者" : "", Number(staff.multi_office) === 1 ? "2. 二以上勤務被保険者" : "", input.short ? "3. 短時間労働者（特定適用事業所等）" : "", input.part ? "4. パート" : ""].filter(Boolean).join("・") },
      { label: "月変該当の確認（□に✔）", value: input.type === "childcare" ? "育児休業等を終了した日の翌日に引き続いて産前産後休業を開始していません" : "産前産後休業を終了した日の翌日に引き続いて育児休業等を開始していません" },
    ],
    problems,
    notes: Number.isFinite(rm) ? [`${ry}年${rm}月分から改定します。改定後の標準報酬月額が下がった人は、「養育期間標準報酬月額特例申出書」も一緒に出すと、年金額の計算では前の標準報酬月額を使えます`] : [],
  };
};

// ── 養育期間標準報酬月額特例申出書・終了届 ───────────────────────────

export interface YouikuFormInput {
  staff: any;
  kind: "申出" | "終了";
  childName: string;
  childKana: string;
  childBirthday: string;
  /** 養育開始年月日（子の生年月日など）と、養育特例開始年月日 */
  careStart: string;
  start: string;
  /** 養育特例終了年月日（終了届。子が死亡した・養育しなくなった日など） */
  end: string;
  /** この子について初めての申出か・養育し始めた月の前月に勤めていた事業所と、いまの事業所が同じか（前の事業所の名前） */
  first: boolean;
  sameOffice: boolean;
  previousOffice: string;
  submittedOn: string;
  appliedOn: string;
  myNumber: boolean;
}

/**
 * 厚生年金保険 養育期間標準報酬月額特例申出書・終了届
 * 決まり（日本年金機構「6-7」「6-8」の手続き・記入例）：3歳未満の子を養育する被保険者の申出で、養育期間の標準報酬月額が、
 * 養育を始めた月の前月の標準報酬月額を下回る月は、前の額とみなして年金額を計算する。申出書は事業主を経由して出す
 * （退職した人は、本人が直接出せる）。子を養育しなくなったとき・死亡したときなどは、終了届を出す
 */
export const youikuForm = (input: YouikuFormInput): PrintForm => {
  const { staff } = input;
  const problems: string[] = [];
  needNumber(staff, input.myNumber, problems);
  if (!input.childName || !input.childBirthday) problems.push("養育する子の氏名・生年月日を入れてください");
  if (!input.start) problems.push("養育特例開始年月日を入れてください");
  if (input.kind === "終了" && !input.end) problems.push("養育特例終了年月日を入れてください");
  const common: PrintItem[] = [
    { label: "提出日", value: w(input.submittedOn) },
    { label: "申出日・申出者の住所・氏名・電話", value: `${w(input.appliedOn)}・${staff.address ?? ""}・${staff.name ?? ""}・${staff.phone || staff.mobile || ""}` },
    ...personItems(staff, input.myNumber),
    { label: "性別", value: genderText(String(staff.gender ?? "")) },
    { label: "養育する子の氏名（フリガナ）", value: `${input.childName}${input.childKana ? `（${input.childKana}）` : ""}` },
    { label: "養育する子の生年月日", value: w(input.childBirthday) },
    { label: "養育する子の個人番号", value: "子のマイナンバーを書く（印刷しません）" },
  ];
  const items = input.kind === "申出"
    ? [
      ...common,
      { label: "A. 過去の申出の確認（この子について、初めて養育特例の申出をしますか）", value: input.first ? "1. はい" : "2. いいえ" },
      { label: "A. 事業所の確認（いまの事業所と、子を養育し始めた月の前月に勤めていた事業所は同じですか）", value: input.sameOffice ? "1. はい" : `2. いいえ（その月に勤めていた事業所：${input.previousOffice}）` },
      { label: "A. 養育開始年月日", value: w(input.careStart) },
      { label: "A. 養育特例開始年月日", value: w(input.start) },
    ]
    : [
      ...common,
      { label: "B. 養育特例開始年月日", value: w(input.start) },
      { label: "B. 養育特例終了年月日", value: w(input.end) },
    ];
  return {
    key: `youiku:${staff.id}:${input.kind}:${input.childBirthday}`, title: `厚生年金保険 養育期間標準報酬月額特例${input.kind === "申出" ? "申出書" : "終了届"}`,
    who: String(staff.name ?? ""), items, problems,
    notes: input.kind === "申出"
      ? ["戸籍謄（抄）本か戸籍記載事項証明書（申出者と子の身分関係。事業主が確かめて「確認済み」に✔を付けたとき・申出者と子のマイナンバーを書いたときは要りません）と、"
        + "住民票の写し（子の生年月日と同居していること。提出日から90日以内に発行されたもの。申出者と子のマイナンバーを書いたときは要りません）を添えます"]
      : [],
  };
};
