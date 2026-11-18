/**
 * 健康保険・厚生年金保険の、電子申請用ファイル（CSV形式届書）の形がない届書の「書く内容」（紙の届書に書き写すか、e-Gov の画面で入れる）
 * どれも日本年金機構（任意継続は全国健康保険協会）の届書・記入例の欄の番号と並びによる。マイナンバーは画面・印刷に出さない。
 *
 * ・厚生年金保険被保険者 ローマ字氏名届：外国籍の人で、マイナンバーと基礎年金番号が結びついていない人などを資格取得するときに、
 *   資格取得届と一緒に出す（5日以内）
 * ・健康保険・厚生年金保険 被保険者所属選択／二以上事業所勤務届：2つ以上の適用事業所で働く人が、主たる事業所を選ぶ（本人が10日以内に出す）
 * ・健康保険・厚生年金保険 被保険者区分変更届（厚生年金保険 70歳以上被用者区分変更届）：特定適用事業所などで、通常の労働者・短時間労働者・
 *   特定減額特例対象者のあいだで区分が変わったとき（5日以内）
 * ・介護保険 適用除外等該当・非該当届：国外居住・施設入居・在留資格3か月以下で介護保険の第2号被保険者でなくなった・戻ったとき（遅滞なく）
 * ・健康保険 任意継続被保険者資格取得申出書（協会けんぽ）：退職した人が本人で出す（資格喪失日から20日以内）。勤務していた事業所と、
 *   事業主が書ける「資格喪失証明欄」の内容を出す
 * ・健康保険・厚生年金保険 新規適用届、事業所関係変更（訂正）届、適用事業所名称／所在地変更（訂正）届（会社の届書。5日以内）
 */
import dayjs from "dayjs";
import { parseCommuteSetting } from "./commuteAllowance";
import { parseInKind } from "./genbutsu";
import { KAIGO_EXEMPT_REASONS, type KaigoExemptReason } from "./kaigoExempt";
import { foreignOf } from "./foreignInfo";
import { numberItem, type PrintForm, type PrintItem } from "./printForms";
import { splitBasicPensionNumber } from "./shahoPerson";
import { getStandardRemuneration } from "./standardRemuneration";
import { formatWareki } from "./wareki";

const w = (date: string | null | undefined) => (date ? formatWareki(date) : "");
const seireki = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` : "");
const yen = (n: number | null | undefined) => (n === null || n === undefined ? "" : `${Math.floor(n).toLocaleString()}円`);
const gender = (g: unknown) => (g === "male" ? "1．男" : g === "female" ? "2．女" : "");
const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const nameItem = (staff: any): PrintItem => ({ label: "氏名（フリガナ）", value: `${staff?.name ?? ""}（${toKatakana(String(staff?.furigana ?? ""))}）` });
const form = (key: string, title: string, staff: any, items: PrintItem[], problems: string[], notes: string[]): PrintForm => ({
  key, title, who: String(staff?.name ?? ""), items, problems, notes,
});
const needPensionNum = (staff: any, problems: string[]) => {
  if (!String(staff?.pension_num ?? "").trim()) problems.push("被保険者整理番号がありません（従業員の画面の「厚生年金 整理番号」）");
};

// ── ローマ字氏名届 ─────────────────────────────────────────

export interface RomajiInput {
  staff: any;
  submittedOn: string;
  /** 日本で住民登録をしているか */
  resident: "" | "無" | "有";
  /** 関連届書（資格取得届など）に使っている氏名 */
  usedName: "romaji" | "kanji" | "common";
  kanjiName: string;
  kanjiKana: string;
  commonName: string;
  commonKana: string;
  /** ローマ字氏名を持たない理由 */
  reason: "" | "短期在留者であるため" | "海外に住所を有している者であるため" | "在留カード（または特別永住者証明書）にローマ字氏名が記載されていないため" | string;
}

export const romajiForm = (i: RomajiInput): PrintForm => {
  const s = i.staff;
  const romaji = (foreignOf(s)?.romaji ?? "").normalize("NFKC").toUpperCase();
  const basic = splitBasicPensionNumber(s?.basic_pension_number);
  const items: PrintItem[] = [
    { label: "届書提出日", value: w(i.submittedOn) },
    { label: "①基礎年金番号", value: basic ? `${basic[0]}-${basic[1]}` : "" },
    { label: "②性別", value: gender(s?.gender) },
    { label: "③生年月日（西暦）", value: seireki(String(s?.birthday ?? "")) },
    { label: "④住民登録の有無", value: i.resident === "無" ? "1．無" : i.resident === "有" ? "2．有" : "" },
    { label: "⑤ローマ字氏名（フリガナ）", value: toKatakana(String(s?.furigana ?? "")) },
    { label: "⑤ローマ字氏名（ローマ字。大文字）", value: romaji || (i.reason ? toKatakana(String(s?.furigana ?? "")) : "") },
    { label: "⑥漢字氏名（任意）", value: i.kanjiName ? `${i.kanjiName}（${toKatakana(i.kanjiKana)}）` : "" },
    { label: "⑦通称名（任意）", value: i.commonName ? `${i.commonName}（${toKatakana(i.commonKana)}）` : "" },
    { label: "関連届書使用氏名（資格取得届などに使っている氏名に☑）", value: i.usedName === "kanji" ? "⑥漢字氏名" : i.usedName === "common" ? "⑦通称名" : "⑤ローマ字氏名" },
  ];
  if (!romaji) items.push({ label: "C 理由記入欄（ローマ字氏名を持たないとき）", value: i.reason });
  const problems: string[] = [];
  if (!romaji && !i.reason) problems.push("ローマ字氏名がありません（従業員の画面の「在留資格の情報」）。持っていないときは理由を選んでください");
  if (!i.resident) problems.push("住民登録の有無を選んでください");
  if (s?.gender !== "male" && s?.gender !== "female") problems.push("性別がありません");
  const notes = [
    "外国籍の人で、マイナンバーと基礎年金番号が結びついていない人・マイナンバーを持たない人（海外在住者・短期在留者など）を資格取得するときに、資格取得届と一緒に出します（5日以内）。",
    "フリガナは資格取得届と同じものにします。ローマ字氏名は、在留カード（または特別永住者証明書・住民票）のとおり大文字で書きます。",
  ];
  return form(`romaji:${s?.id}`, "厚生年金保険被保険者 ローマ字氏名届", s, items, problems, notes);
};

// ── 二以上事業所勤務届 ───────────────────────────────────────

export interface NijouOffice {
  /** 事業所整理記号（「杉並 ケマ」のように）と被保険者整理番号 */
  symbol: string;
  insuredNumber: string;
  name: string;
  address: string;
  /** 被保険者資格の取得・喪失年月日 */
  acquiredOn: string;
  lostOn: string;
  /** 報酬月額（通貨・現物） */
  currency: number | null;
  inKind: number | null;
  /** 厚生年金基金に加入しているときの名称と番号 */
  fund: string;
}

export interface NijouInput {
  staff: any;
  submittedOn: string;
  myNumber: boolean;
  /** この会社を選択事業所にする */
  oursSelected: boolean;
  ours: NijouOffice;
  other: NijouOffice;
}

const officeItems = (prefix: string, o: NijouOffice): PrintItem[] => [
  { label: `${prefix} 事業所整理記号・被保険者整理番号`, value: [o.symbol, o.insuredNumber].filter(Boolean).join("　") },
  { label: `${prefix} 事業所名称`, value: o.name },
  { label: `${prefix} 事業所所在地`, value: o.address },
  { label: `${prefix} 被保険者資格 得喪年月日`, value: [o.acquiredOn ? `取得 ${w(o.acquiredOn)}` : "", o.lostOn ? `喪失 ${w(o.lostOn)}` : ""].filter(Boolean).join("　") },
  { label: `${prefix} 報酬月額（通貨・現物・合計）`, value: o.currency === null ? "" : `通貨 ${yen(o.currency)}・現物 ${yen(o.inKind ?? 0)}・合計 ${yen((o.currency ?? 0) + (o.inKind ?? 0))}` },
  { label: `${prefix} 厚生年金基金（加入しているとき）`, value: o.fund },
];

export const nijouForm = (i: NijouInput): PrintForm => {
  const s = i.staff;
  const selected = i.oursSelected ? i.ours : i.other;
  const unselected = i.oursSelected ? i.other : i.ours;
  const items: PrintItem[] = [
    nameItem(s),
    { label: "生年月日", value: w(s?.birthday) },
    numberItem(s, i.myNumber),
    ...officeItems("選択事業所", selected),
    ...officeItems("非選択事業所", unselected),
    { label: "被保険者 住所", value: `〒${s?.zip_code ?? ""} ${s?.address ?? ""}` },
    { label: "被保険者 氏名・電話番号", value: `${s?.name ?? ""}　${s?.phone || s?.mobile || ""}` },
    { label: "提出日", value: w(i.submittedOn) },
  ];
  const problems: string[] = [];
  if (!i.other.name.trim()) problems.push("もう1つの事業所の名称を入れてください");
  if (i.other.currency === null) problems.push("もう1つの事業所で受ける報酬月額を入れてください");
  const notes = [
    "被保険者本人が、2つ以上の事業所で働くことになった日から10日以内に、選択事業所の管轄の事務センター（年金事務所）に出します。新しく加入するときは、それぞれの事業所の資格取得届も出します。",
    "標準報酬月額は2つの事業所の報酬の合計で決まり、保険料は報酬の割合で按分されます（年金事務所から事業所ごとに通知されます）。",
  ];
  return form(`nijou:${s?.id}`, "健康保険・厚生年金保険 被保険者所属選択／二以上事業所勤務届", s, items, problems, notes);
};

// ── 区分変更届 ──────────────────────────────────────────────

export type KubunAfter = "0" | "1" | "2";
export const KUBUN_LABELS: Record<KubunAfter, string> = { "0": "０．一般", "1": "１．短時間労働者（3/4未満）", "2": "２．特定減額特例対象者" };

export interface KubunInput {
  staff: any;
  submittedOn: string;
  myNumber: boolean;
  after: KubunAfter;
  changedOn: string;
  remarks: string;
}

/** 70歳に達した日（誕生日の前日）より後か */
const age70On = (birthday: string, on: string) => !!birthday && !!on && dayjs(on).isAfter(dayjs(birthday).add(70, "year").subtract(2, "day"));

export const kubunForm = (i: KubunInput): PrintForm => {
  const s = i.staff;
  const over70 = age70On(String(s?.birthday ?? ""), i.changedOn);
  const items: PrintItem[] = [
    { label: "届書提出日", value: w(i.submittedOn) },
    { label: "②被保険者整理番号", value: String(s?.pension_num ?? "") },
    nameItem(s),
    { label: "③個人番号（または基礎年金番号）", value: numberItem(s, i.myNumber).value },
    { label: "④生年月日", value: w(s?.birthday) },
    { label: "住所（個人番号を書いたときは要らない）", value: i.myNumber ? "" : `〒${s?.zip_code ?? ""} ${s?.address ?? ""}` },
    { label: "⑤処理区分", value: over70 ? "１．70歳以上被用者" : "（書かない）" },
    { label: "⑥変更後区分", value: KUBUN_LABELS[i.after] },
    { label: "⑦変更年月日", value: w(i.changedOn) },
    { label: "備考", value: i.remarks },
  ];
  const problems: string[] = [];
  needPensionNum(s, problems);
  if (!i.changedOn) problems.push("変更年月日を入れてください");
  if (over70 && i.after === "2") problems.push("特定減額特例対象者は70歳以上被用者に当たらないので、70歳以上被用者区分変更届は要りません");
  const notes = [
    "特定適用事業所・任意特定適用事業所・国や地方公共団体の事業所で、通常の労働者・短時間労働者（週の所定労働時間か月の所定労働日数が通常の労働者の4分の3未満）・特定減額特例対象者のあいだで区分が変わったときに、5日以内に出します（1枚に5人まで）。",
    "特定減額特例対象者：70歳未満の短時間労働者のうち、最低賃金の減額の特例許可を受けていて、所定内賃金（基本給と諸手当）が月8.8万円未満の人（申出をすると加入できる）。",
  ];
  return form(`kubun:${s?.id}`, over70 ? "厚生年金保険 70歳以上被用者区分変更届" : "健康保険・厚生年金保険 被保険者区分変更届", s, items, problems, notes);
};

// ── 介護保険 適用除外等該当・非該当届 ─────────────────────────

export interface KaigoInput {
  staff: any;
  submittedOn: string;
  /** 被扶養者の届のときは、その人（氏名・続柄・生年月日・住所） */
  dependent: { name: string; kana: string; relation: string; birthday: string; zip: string; address: string } | null;
  kind: "該当" | "非該当";
  reason: KaigoExemptReason;
  date: string;
  /** 国外に転居したときの最後の住所（空なら従業員の住所） */
  lastAddress: string;
  facility: string;
  facilityAddress: string;
  remarks: string;
}

export const kaigoForm = (i: KaigoInput): PrintForm => {
  const s = i.staff;
  const d = i.dependent;
  const items: PrintItem[] = [
    { label: "届書提出日", value: w(i.submittedOn) },
    { label: "該当・非該当の別（表題）", value: i.kind },
    { label: "②被保険者整理番号", value: String(s?.pension_num ?? "") },
    { label: "③被保険者の氏名（フリガナ）", value: `${s?.name ?? ""}（${toKatakana(String(s?.furigana ?? ""))}）` },
    { label: "被保険者の生年月日", value: w(s?.birthday) },
  ];
  if (d) {
    items.push(
      { label: "被扶養者の氏名（フリガナ）", value: `${d.name}（${toKatakana(d.kana)}）` },
      { label: "続柄", value: d.relation },
      { label: "被扶養者の生年月日", value: w(d.birthday) },
    );
  }
  items.push(
    { label: "④適用除外等の理由", value: `${i.reason}．${KAIGO_EXEMPT_REASONS[i.reason]}` },
    { label: "⑤該当・非該当の別", value: i.kind === "該当" ? "1．該当" : "2．非該当" },
    { label: "⑥該当・非該当の年月日", value: w(i.date) },
    d
      ? { label: "被扶養者の住所", value: i.lastAddress || `〒${d.zip} ${d.address}` }
      : { label: "被保険者の住所（国外へ転居したときは最後の住所）", value: i.lastAddress || `〒${s?.zip_code ?? ""} ${s?.address ?? ""}` },
  );
  if (i.reason === "2") items.push({ label: "入居施設の名称・所在地", value: [i.facility, i.facilityAddress].filter(Boolean).join("　") });
  items.push({ label: "備考", value: i.remarks });
  const problems: string[] = [];
  needPensionNum(s, problems);
  if (!i.date) problems.push("該当・非該当の年月日を入れてください");
  if (i.reason === "2" && !i.facility.trim()) problems.push("入居施設の名称を入れてください");
  const attach = i.reason === "1" ? "住民票の除票（コピー不可・個人番号の記載がないもの）" : i.reason === "2" ? "施設に入所・入院していることを証明する書類" : "在留期間を証明する書類と、雇用契約期間を証明できる雇用契約書など";
  const notes = [
    "被保険者または被扶養者ごとに1枚ずつ作ります。被保険者が事業主に出し、事業主が遅滞なく事務センター（年金事務所）に出します（40歳・65歳になったときは出しません）。",
    `添付書類：${attach}。`,
  ];
  if (!d) notes.push(i.kind === "該当" ? "該当した日がある月の分から、介護保険料をかけません（健康保険法156条2項）。" : "非該当になった日がある月の分から、介護保険料をかけます。");
  return form(`kaigo:${s?.id}:${d?.name ?? ""}`, "介護保険 適用除外等該当・非該当届", s, items, problems, notes);
};

// ── 任意継続被保険者資格取得申出書（協会けんぽ） ───────────────────

export interface NinkeiInput {
  staff: any;
  company: { name?: string | null; address?: string | null; phone?: string | null; representative?: string | null };
  certifiedOn: string;
  /** 健康保険の被扶養者（在職時から続けて被扶養者になる人） */
  dependents: { name: string; kana: string; relation: string; birthday: string }[];
}

export const ninkeiForm = (i: NinkeiInput): PrintForm => {
  const s = i.staff;
  const retire = String(s?.retirement_date ?? "");
  const lossOn = retire ? dayjs(retire).add(1, "day").format("YYYY-MM-DD") : "";
  const std = retire ? getStandardRemuneration(s, dayjs(retire).year(), dayjs(retire).month() + 1) : 0;
  const items: PrintItem[] = [
    { label: "❶記号・番号（退職前の資格確認書・保険証のとおり）", value: String(s?.health_ins_num ?? "") },
    nameItem(s),
    { label: "生年月日・性別", value: `${w(s?.birthday)}　${s?.gender === "male" ? "男" : s?.gender === "female" ? "女" : ""}` },
    { label: "住所（郵便番号）・電話番号", value: `〒${s?.zip_code ?? ""} ${s?.address ?? ""}　${s?.phone || s?.mobile || ""}` },
    { label: "資格喪失年月日（退職日の翌日）", value: w(lossOn) },
    { label: "勤務していた事業所 名称", value: String(i.company.name ?? "") },
    { label: "勤務していた事業所 所在地", value: String(i.company.address ?? "") },
    { label: "保険料の納付方法", value: "（本人が選ぶ：1．口座振替（毎月納付のみ）・2．毎月納付・3．6か月前納・4．12か月前納）" },
    ...i.dependents.map((d, n) => ({ label: `被扶養者${n + 1}（氏名・続柄・生年月日）`, value: `${d.name}（${toKatakana(d.kana)}）・${d.relation}・${w(d.birthday)}` })),
    { label: "健康保険 資格喪失証明欄：資格喪失年月日", value: w(lossOn) },
    { label: "健康保険 資格喪失証明欄：事業所名称・所在地・電話番号", value: `${i.company.name ?? ""}　${i.company.address ?? ""}　${i.company.phone ?? ""}` },
    { label: "健康保険 資格喪失証明欄：事業主氏名・証明日", value: `${i.company.representative ?? ""}　${w(i.certifiedOn)}` },
  ];
  const problems: string[] = [];
  if (!retire) problems.push("退職日がありません（従業員の画面）");
  if (!String(s?.health_ins_num ?? "").trim()) problems.push("健康保険の記号・番号がありません（従業員の画面の「健康保険 番号」）");
  const notes = [
    `本人が、資格喪失日から20日以内（必着）に、住所の協会けんぽの都道府県支部に出します${lossOn ? `（${w(dayjs(lossOn).add(19, "day").format("YYYY-MM-DD"))}まで）` : ""}。会社は「資格喪失証明欄」を書いて渡すと、手続きが早くなります。`,
    `退職したときの標準報酬月額は ${yen(std)} です（任意継続の標準報酬月額は、これと協会けんぽの全被保険者の平均の低いほう）。`,
  ];
  return form(`ninkei:${s?.id}`, "健康保険 任意継続被保険者資格取得申出書（勤務していた事業所・資格喪失証明欄）", s, items, problems, notes);
};

// ── 会社の届書（新規適用届・事業所関係変更（訂正）届・名称／所在地変更（訂正）届） ─────

export type CompanyFormKind = "shinki" | "henko" | "meisho";
export const COMPANY_FORM_TITLES: Record<CompanyFormKind, string> = {
  shinki: "健康保険・厚生年金保険 新規適用届",
  henko: "健康保険・厚生年金保険 事業所関係変更（訂正）届",
  meisho: "健康保険・厚生年金保険 適用事業所名称／所在地変更（訂正）届",
};

/** 会社の届書の欄（記入例の番号の順）。初めの値は companyFormDefaults で作り、画面で直す */
export const COMPANY_FORM_FIELDS: Record<CompanyFormKind, { key: string; label: string }[]> = {
  shinki: [
    { key: "submittedOn", label: "届書提出日" },
    { key: "address", label: "事業所所在地（フリガナ）" },
    { key: "name", label: "事業所名称（フリガナ。株式会社は「カ」）" },
    { key: "phone", label: "電話番号" },
    { key: "owner", label: "①事業主（または代表者）氏名（フリガナ）" },
    { key: "contact", label: "②問合せ先担当者名（内線）" },
    { key: "ownerAddress", label: "③事業主（または代表者）住所" },
    { key: "agent", label: "④⑤事業主代理人 氏名・住所" },
    { key: "business", label: "⑥事業の種類" },
    { key: "category", label: "⑦業態区分（事業所業態分類票の番号と名前）" },
    { key: "corporateKind", label: "⑧個人・法人等区分" },
    { key: "corporateNumber", label: "⑨法人番号等" },
    { key: "headOffice", label: "⑩本店・支店区分" },
    { key: "domestic", label: "⑪内・外国区分" },
    { key: "union", label: "⑬健康保険組合名称" },
    { key: "closing", label: "⑮給与計算の締切日" },
    { key: "raise", label: "⑯昇給月" },
    { key: "santeiMedia", label: "⑰算定基礎届 媒体作成" },
    { key: "payDay", label: "⑱給与支払日" },
    { key: "bonusMonths", label: "⑲賞与支払予定月" },
    { key: "bonusMedia", label: "⑳賞与支払届 媒体作成" },
    { key: "wageForms", label: "㉑給与形態" },
    { key: "allowances", label: "㉒諸手当の種類" },
    { key: "inKind", label: "㉓現物給与の種類" },
    { key: "workers", label: "㉔従業員情報（従業員数・社会保険に加入する従業員数・加入しない従業員）" },
    { key: "prescribed", label: "㉕所定労働日数・所定労働時間" },
    { key: "remarks", label: "㉖備考" },
  ],
  henko: [
    { key: "submittedOn", label: "届書提出日" },
    { key: "ownerBefore", label: "①変更前の事業主 氏名（フリガナ）・住所" },
    { key: "ownerAfter", label: "②変更後の事業主 氏名（フリガナ）・住所" },
    { key: "ownerOn", label: "③変更年月日" },
    { key: "phone", label: "④事業所電話番号（変更後）" },
    { key: "union", label: "⑤健康保険組合名称" },
    { key: "agentAppoint", label: "⑥⑦事業主代理人の選任（氏名・住所・選任年月日）" },
    { key: "agentDismiss", label: "⑧⑨事業主代理人の解任（氏名・住所・解任年月日）" },
    { key: "sharoushi", label: "⑩〜⑫社会保険労務士（登録・解除、コード、氏名）" },
    { key: "pensionCommittee", label: "⑬⑭年金委員（登録・解除、氏名）" },
    { key: "inKind", label: "⑮現物給与の種類（変更後）" },
    { key: "category", label: "⑯業態区分" },
    { key: "raise", label: "⑰昇給月（変更後）" },
    { key: "santeiMedia", label: "⑱算定基礎届 媒体作成" },
    { key: "bonusMonths", label: "⑲賞与支払予定月（変更後）" },
    { key: "bonusMedia", label: "⑳賞与支払届 媒体作成" },
    { key: "corporateNumber", label: "㉑〜㉖会社法人等番号・法人番号（変更前・変更後・変更年月日）" },
    { key: "corporateKind", label: "㉗㉘個人・法人等区分（変更前・変更後）" },
    { key: "headOffice", label: "㉙㉚本店・支店区分（変更前・変更後）" },
    { key: "domestic", label: "㉛㉜内・外国区分（変更前・変更後）" },
  ],
  meisho: [
    { key: "submittedOn", label: "届書提出日" },
    { key: "jurisdiction", label: "管轄（同じ年金事務所の管轄内か、管轄外か）" },
    { key: "kind", label: "変更区分（1．事業所名称のみ・2．事業所所在地のみ・3．名称及び所在地）" },
    { key: "nameBefore", label: "①変更前の事業所名称" },
    { key: "addressBefore", label: "②変更前の事業所所在地" },
    { key: "changedOn", label: "③変更年月日" },
    { key: "nameAfter", label: "④変更後の事業所名称（フリガナ）" },
    { key: "addressAfter", label: "⑤変更後の事業所所在地（フリガナ）" },
    { key: "phoneAfter", label: "⑥変更後の電話番号" },
    { key: "transfer", label: "⑦⑧保険料口座振替の継続・振替口座の変更（管轄外のとき）" },
  ],
};

export interface CompanyFormContext {
  company: any;
  /** 給与規定グループ（締め日・支払日） */
  groups: { closing_day?: number; is_next_month?: number; payment_day?: number }[];
  staffList: any[];
  /** 支給の固定の項目の名前 */
  allowanceNames: string[];
  /** 協会けんぽでない（健康保険組合の）社保規定の名前 */
  unionNames: string[];
  today: string;
}

const dayText = (d: unknown) => (Number(d) === 99 ? "末日" : `${Number(d)}日`);

/** 会社の届書の初めの値（Q の会社設定・給与規定・従業員から） */
export const companyFormDefaults = (kind: CompanyFormKind, ctx: CompanyFormContext): Record<string, string> => {
  const c = ctx.company ?? {};
  const out: Record<string, string> = { submittedOn: ctx.today };
  if (kind === "shinki") {
    out.address = `〒${c.zip_code ?? ""} ${c.address ?? ""}`;
    out.name = String(c.name ?? "");
    out.phone = String(c.phone ?? "");
    out.owner = String(c.representative ?? "");
    const corp = String(c.corporate_number ?? "").replace(/\D/g, "");
    out.corporateKind = corp.length === 13 ? "１．法人事業所" : "";
    out.corporateNumber = corp.length === 13 ? `１．法人番号 ${corp}` : "";
    out.headOffice = "１．本店";
    out.domestic = corp.length === 13 ? "１．内国法人" : "";
    out.union = ctx.unionNames.join("・");
    out.closing = [...new Set(ctx.groups.map((g) => dayText(g.closing_day)))].join("・");
    out.payDay = [...new Set(ctx.groups.map((g) => `${Number(g.is_next_month) === 1 ? "翌月" : "当月"}${dayText(g.payment_day)}`))].join("・");
    out.bonusMonths = String(c.bonus_plan_months ?? "").split(/[,、]/).filter(Boolean).map((m) => `${Number(m)}月`).join("・");
    out.santeiMedia = "１．不要（自社作成）";
    out.bonusMedia = "１．不要（自社作成）";
    const active = ctx.staffList.filter((s) => (s.status || "active") !== "retired");
    const types = new Set(active.map((s) => String(s.wage_type ?? "")));
    out.wageForms = [types.has("monthly") ? "１．月給" : "", types.has("daily") ? "２．日給" : "", types.has("hourly") ? "５．時間給" : ""].filter(Boolean).join("・");
    out.allowances = ctx.allowanceNames.join("・");
    const kinds = new Set<string>();
    for (const s of active) {
      for (const r of parseInKind(s.in_kind)) kinds.add(r.kind === "housing" ? "２．住宅" : r.kind === "meal" ? "１．食事" : "５．その他");
      if (parseCommuteSetting(s.commute_setting).inKind) kinds.add("４．定期券");
    }
    out.inKind = [...kinds].sort().join("・");
    const insured = active.filter((s) => Number(s.standard_remuneration) > 0 && Number(s.social_insurance_group_id ?? 1) > 0);
    const executives = active.filter((s) => Number(s.is_executive) === 1).length;
    out.workers = `１．従業員数（役員を含む）${active.length}人　２．社会保険に加入する従業員数 ${insured.length}人`
      + (active.length > insured.length ? `　３．加入しない従業員 ${active.length - insured.length}人（役員 ${executives}人を含む。勤務日数・時間を書く）` : "");
    const hours = active.find((s) => s.wage_type === "monthly" && Number(s.scheduled_work_hours) > 0)?.scheduled_work_hours;
    if (hours) out.prescribed = `１日 ${Number(hours)}時間（１月の日数・１週の時間を書く）`;
  } else if (kind === "henko") {
    out.phone = "";
  } else {
    out.nameBefore = String(c.name ?? "");
    out.addressBefore = `〒${c.zip_code ?? ""} ${c.address ?? ""}`;
    out.jurisdiction = "管轄内";
  }
  return out;
};

export const companyForm = (kind: CompanyFormKind, values: Record<string, string>, company: any): PrintForm => {
  const fields = COMPANY_FORM_FIELDS[kind];
  const items: PrintItem[] = fields
    .filter((f) => kind === "shinki" || f.key === "submittedOn" || (values[f.key] ?? "").trim() !== "")
    .map((f) => ({ label: f.label, value: /^\d{4}-\d{2}-\d{2}$/.test(values[f.key] ?? "") ? w(values[f.key]) : (values[f.key] ?? "") }));
  const problems: string[] = [];
  const notes: string[] = [];
  if (kind === "shinki") {
    if (!values.category) problems.push("業態区分は、日本年金機構の「事業所業態分類票」で確かめて書いてください");
    notes.push("事業所が健康保険・厚生年金保険の適用事業所になったときに、5日以内に出します。法人は登記簿謄本（90日以内に発行）または法人番号指定通知書のコピーを添えます。同時に、従業員の資格取得届も出します。");
  } else if (kind === "henko") {
    if (items.length <= 1) problems.push("変更（訂正）した欄だけを入れてください（事業主・法人番号などを変えるときは、変更前も書きます）");
    notes.push("事業主の変更や、電話番号・昇給月・賞与支払予定月・現物給与などの事業所の登録内容が変わったときに、5日以内に出します。");
  } else {
    if (!values.changedOn) problems.push("変更年月日を入れてください");
    notes.push(values.jurisdiction === "管轄外"
      ? "管轄の年金事務所が変わる所在地の変更です。変更前の管轄の年金事務所に5日以内に出します（法人は登記簿謄本のコピーを添えます）。"
      : "同じ年金事務所の管轄内で、事業所の名称・所在地が変わったときに、5日以内に出します（法人は登記簿謄本のコピーを添えます）。");
  }
  return { key: `company:${kind}`, title: COMPANY_FORM_TITLES[kind], who: String(company?.name ?? ""), items, problems, notes };
};
