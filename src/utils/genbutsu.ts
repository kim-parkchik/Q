/**
 * 現物で払う報酬（食事・住宅・その他）の価額
 *
 * 給与の一部を、食事・住宅（社宅・寮など）・自社製品などで払っているとき、その価額を通貨に換算して、
 * 社会保険の報酬（標準報酬月額の決め方と、資格取得届・算定基礎届・月額変更届の「現物によるもの」の額）に入れる。
 * 従業員の画面で、従業員ごとに「現物で払う報酬」を入れてもらう（staff.in_kind の JSON。期間ごとに1行）。
 *
 * ■ 価額（厚生労働大臣が定める現物給与の価額。constants/genbutsu.ts）
 *   ・食事：都道府県ごとの1人1月当たり・1日当たり・朝食のみ・昼食のみ・夕食のみの額
 *   ・住宅：令和8年9月分までは居住用の室（居間・寝室など。玄関・台所・トイレ・浴室・廊下は含めない）の畳1畳につきの額
 *          （洋室など畳を敷いていない室は 1.65平方メートルを1畳）、令和8年10月分からは住宅の総面積1平方メートルにつきの額
 *          （同じ住宅に被保険者が何人か住んでいれば、総面積をその人数で割る）
 *   ・その他（自社製品など）：時価（労働協約に定めがあればその価額）
 *   ・都道府県は勤務地のもの（本社と支店が1つの適用事業所なら、それぞれの拠点の都道府県。派遣の人は派遣元）
 *   ・給与の締め日にかかわらず、月の1日〜末日の1か月分を、その月分の給与（給与の計算期間の終わりの日がある月）の報酬にする
 *   ・計算の結果の1円未満は切り捨てる
 * ■ 本人が払う額（家賃・食費など）
 *   ・食事：表の価額の3分の2以上を払っていれば、食事を出していないものとして0円。3分の2未満なら、価額から払った額を引いた額
 *   ・住宅・その他：価額から払った額を引いた額
 * ■ 月の途中から・までの月：住宅・その他は1か月分の額を日割り（1か月分 × 日数 ÷ その月の日数。1円未満切り捨て）、
 *   食事（毎日3食）は1日当たりの額 × 日数。本人が払う額（1か月）も、同じ日数で日割りする
 * ■ 食事を出勤した日ごとに出すとき（社員食堂の昼食など）は、給与の計算期間に出勤した日（働いた時間がある日）の数で数える
 *   （1日当たりの額は、その月分の表の額。本人が払う額も1日の額）
 * ■ 所得税：食事・住宅は、かかる額を入れてもらうか（manual）、国税庁の決まりで計算する（auto。constants/genbutsuTax.ts。
 *   タックスアンサーの「現在法令等」の日（令和8年4月1日）の月の分から。それより前の月は入れた額）。その他は、価額（から本人が払う額を引いた額）にかかる
 *   ・食事（No.2594）：食事の価額は社会保険の表の額ではなく、業者に払う額・材料費などの実際の費用。本人が半分以上を払い、（食事の価額 − 本人が払う額）を
 *     消費税を除いた額（10円未満切り捨て）が1か月7,500円以下なら課税しない。満たさなければ（食事の価額 − 本人が払う額）が課税される
 *   ・社宅（No.2597・No.2600）：賃貸料相当額（1か月）＝ 建物の固定資産税の課税標準額 × 0.2％ ＋ 12円 ×（総床面積 ÷ 3.3㎡）＋ 敷地の課税標準額 × 0.22％
 *     （1円未満切り捨て。タックスアンサーに端数の決まりがないので Q の決まり）。使用人は本人が50％以上を払えば課税しない（満たさなければ差額）。
 *     役員は、小規模な住宅（法定耐用年数30年以下は132㎡以下、30年超は99㎡以下）なら同じ式、それ以外は（建物 × 12％（30年超は10％）＋ 敷地 × 6％）÷ 12、
 *     借り上げは家主に払う家賃の50％と比べて多い方。賃貸料相当額との差額が課税される。240㎡を超えれば豪華社宅（時価）かどうかを知らせる
 * ■ 雇用保険：その他（自社製品など）は、労働の対償として払うものなので入れる。食事・住宅は、初めは入れない（労働保険では、福利厚生とみなされる
 *   ものや代金を徴収するものは原則として賃金にならない）。現金の給与の代わりに出すなど賃金にするとき（empWage）は、実際費用を入れてもらい、
 *   無償なら実際費用、代金を徴収していれば、徴収金額が実際費用の3分の1を下回るときだけ「実際費用 × 3分の1 − 徴収金額」を賃金にする
 *   （雇用保険事務手続きの手引き 第2編「賃金の範囲に算入される現物給与とは」。constants/genbutsuTax.ts の EMP_IN_KIND）
 * ■ 月変：現物の価額が変わったら（告示の改正・社宅に入った・出た・本人が払う額が変わったなど）固定的賃金の変動になる。
 *   変わった後の額が1か月分そろった月を変動月にするので、月の途中から・までの行がある月は比べない（settled が false）
 *
 * 出典：日本年金機構「全国現物給与価額一覧表（厚生労働大臣が定める現物給与の価額）」と一覧表の PDF の Q&A
 *       https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150511.html
 *       （Q4 締め日にかかわらず1か月分・Q6 勤務地の価額・Q7 月の途中の入居は日割り・Q8 住宅の広さ・Q9 平方メートル・Q10 食事の3分の2）
 *       厚生労働省「厚生労働大臣が定める現物給与の価額の取扱いについて」（令和8年3月17日 基徴収発0317第1号・保保発0317第2号・年管管発0317第13号）
 *       https://www.mhlw.go.jp/web/t_doc?dataId=00tc9871&dataType=1&pageNo=1 （住宅の総面積・同居の被保険者数・時価・健康保険組合の規約）
 *       「標準報酬月額の定時決定及び随時改定の事務取扱いに関する事例集」問1（現物給与も報酬）・問6（1か月分そろった月）・問12（告示の改正は
 *       固定的賃金の変動） https://www.mhlw.go.jp/web/t_doc?dataId=00tc7791&dataType=1&pageNo=1
 *       日本年金機構「標準報酬月額の対象となる報酬とは何ですか」（通勤定期券・食事・住宅など現物で支給されるものも報酬）
 * ※ 健康保険組合は、規約で別の価額を決めていることがある（Q は、この表の価額で計算する）
 */
import dayjs from "dayjs";
import { GENBUTSU_PERIODS, type GenbutsuPeriod } from "../constants/genbutsu";
import { EMP_IN_KIND, GENBUTSU_TAX_SINCE, HOUSING_TAX, MEAL_TAX } from "../constants/genbutsuTax";
import { toKenpoPrefName } from "../constants/prefectures";

/** meal: 食事 / housing: 住宅（社宅・寮など） / other: その他（自社製品など。時価） */
export type InKindKind = "meal" | "housing" | "other";

export const IN_KIND_KIND_LABELS: Record<InKindKind, string> = {
  meal: "食事",
  housing: "住宅（社宅・寮など）",
  other: "その他（自社製品など）",
};

/** month: 毎日3食（寮など。1か月の額） / workday: 出勤した日ごと（朝食・昼食・夕食から選ぶ） */
export type MealPattern = "month" | "workday";

export const MEAL_PATTERN_LABELS: Record<MealPattern, string> = {
  month: "毎日3食（寮など）",
  workday: "出勤した日ごと（社員食堂の昼食など）",
};

/** 現物で払う報酬の1行（期間ごと） */
export interface InKindEntry {
  kind: InKindKind;
  /** 名前（明細に出す。空なら種類の名前） */
  name: string;
  /** 始めた日（社宅に入った日・食事を出し始めた日など。YYYY-MM-DD） */
  start: string;
  /** やめた日（社宅を出た日・最後に食事を出した日など。空ならいまも） */
  end: string;
  /** 食事の出し方 */
  mealPattern: MealPattern;
  /** 出勤した日ごとに出す食事 */
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  /** 住宅：居住用の室の畳数（令和8年9月分まで。和室など） */
  tatami: number;
  /** 住宅：居住用の室のうち、畳を敷いていない室（洋室など）の広さ（平方メートル。1.65平方メートルを1畳。令和8年9月分まで） */
  roomSqm: number;
  /** 住宅：住宅の総面積（平方メートル。玄関・台所・トイレ・浴室・廊下も含め、別棟の物置・車庫と共用部分は除く。令和8年10月分から） */
  area: number;
  /** 住宅：同じ住宅に住む被保険者の数（本人を含む。令和8年10月分から、総面積をこの数で割る） */
  sharers: number;
  /** その他：時価（1か月の額） */
  value: number;
  /** 本人が払う額（家賃・食費など。食事を出勤した日ごとに出すときは1日の額、ほかは1か月の額） */
  selfPay: number;
  /** 食事・住宅：所得税がかかる額（食事を出勤した日ごとに出すときは1日の額、ほかは1か月の額。かからなければ 0） */
  taxable: number;
  /** その他：所得税がかからない（制服など、所得税法で非課税のもの） */
  taxFree: boolean;
  /** 食事・住宅：所得税がかかる額の決め方（manual：taxable に入れた額、auto：国税庁の決まりで計算） */
  taxMode: "manual" | "auto";
  /** 食事（auto）：食事の価額（業者に払う額・材料費など。消費税を含む。食事を出勤した日ごとに出すときは1日、ほかは1か月の額） */
  taxPrice: number;
  /** 食事（auto）：食事の消費税の率（％。軽減税率か標準税率） */
  taxRate: number;
  /** 住宅（auto）：その年度の建物の固定資産税の課税標準額 */
  bldgBase: number;
  /** 住宅（auto）：その年度の敷地の固定資産税の課税標準額 */
  landBase: number;
  /** 住宅（auto）：建物の総床面積（平方メートル。区分所有なら共用部分をあん分して加える） */
  floorArea: number;
  /** 住宅（auto・役員）：法定耐用年数が30年を超える建物（鉄筋コンクリート造など） */
  longLife: boolean;
  /** 住宅（auto・役員）：他から借りて貸すとき、会社が家主に払う家賃（1か月。自社所有なら0） */
  leasedRent: number;
  /** 食事・住宅：雇用保険の賃金にする（現金の給与の代わりに出すなど、福利厚生でないとき） */
  empWage: boolean;
  /** 食事・住宅（empWage）：実際費用（食事を出勤した日ごとに出すときは1日、ほかは1か月の額） */
  actualCost: number;
}

export const emptyInKindEntry = (kind: InKindKind = "housing"): InKindEntry => ({
  kind, name: "", start: "", end: "", mealPattern: "month", breakfast: false, lunch: true, dinner: false,
  tatami: 0, roomSqm: 0, area: 0, sharers: 1, value: 0, selfPay: 0, taxable: 0, taxFree: false,
  taxMode: "manual", taxPrice: 0, taxRate: MEAL_TAX.rates.reduced, bldgBase: 0, landBase: 0, floorArea: 0, longLife: false, leasedRent: 0,
  empWage: false, actualCost: 0,
});

const nonNeg = (v: unknown) => Math.max(0, Number(v) || 0);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayjs(v).isValid();
const toKind = (v: unknown): InKindKind => (v === "meal" || v === "other" ? v : "housing");

/** 従業員の in_kind（JSON の文字列）を読む。空・壊れているときは空 */
export const parseInKind = (json: unknown): InKindEntry[] => {
  if (typeof json !== "string" || !json.trim()) return [];
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    return list.map((v) => ({
      ...emptyInKindEntry(toKind(v?.kind)),
      name: typeof v?.name === "string" ? v.name : "",
      start: isDate(v?.start) ? v.start : "",
      end: isDate(v?.end) ? v.end : "",
      mealPattern: v?.mealPattern === "workday" ? "workday" : "month",
      breakfast: !!v?.breakfast, lunch: !!v?.lunch, dinner: !!v?.dinner,
      tatami: nonNeg(v?.tatami), roomSqm: nonNeg(v?.roomSqm), area: nonNeg(v?.area),
      sharers: Math.max(1, Math.floor(Number(v?.sharers) || 1)),
      value: Math.floor(nonNeg(v?.value)), selfPay: Math.floor(nonNeg(v?.selfPay)), taxable: Math.floor(nonNeg(v?.taxable)),
      taxFree: !!v?.taxFree,
      taxMode: v?.taxMode === "auto" ? "auto" : "manual",
      taxPrice: Math.floor(nonNeg(v?.taxPrice)),
      taxRate: Number(v?.taxRate) === MEAL_TAX.rates.standard ? MEAL_TAX.rates.standard : MEAL_TAX.rates.reduced,
      bldgBase: Math.floor(nonNeg(v?.bldgBase)), landBase: Math.floor(nonNeg(v?.landBase)), floorArea: nonNeg(v?.floorArea),
      longLife: !!v?.longLife, leasedRent: Math.floor(nonNeg(v?.leasedRent)),
      empWage: !!v?.empWage, actualCost: Math.floor(nonNeg(v?.actualCost)),
    }));
  } catch {
    return [];
  }
};

/** 保存用の JSON（行がなければ空） */
export const stringifyInKind = (entries: InKindEntry[]): string => {
  const list = parseInKind(JSON.stringify(entries));
  return list.length > 0 ? JSON.stringify(list) : "";
};

/** 行の名前（入れた名前。空なら種類の名前） */
export const inKindNameOf = (e: InKindEntry): string => e.name.trim() || (e.kind === "other" ? "その他の現物" : e.kind === "meal" ? "食事" : "住宅");

/** 入れた行の間違い（保存できないもの。なければ null） */
export const validateInKindEntry = (e: InKindEntry): string | null => {
  if (!isDate(e.start)) return "始めた日を入れてください";
  if (e.end && !isDate(e.end)) return "やめた日の書き方が違います";
  if (e.end && e.end < e.start) return "やめた日が、始めた日より前です";
  if (e.kind === "meal" && e.mealPattern === "workday" && !e.breakfast && !e.lunch && !e.dinner) return "出す食事（朝食・昼食・夕食）を選んでください";
  if (e.kind === "other" && e.value <= 0) return "時価（1か月の額）を入れてください";
  return null;
};

/** 入れた行の注意（保存はできるが、給与の計算で価額を出せない月があるもの） */
export const inKindEntryWarnings = (e: InKindEntry): string[] => {
  if (e.kind !== "housing" || !isDate(e.start)) return [];
  const out: string[] = [];
  const sqmFrom = GENBUTSU_PERIODS.find((p) => p.housingUnit === "sqm")?.from ?? "9999-12-31";
  if (e.start < sqmFrom && e.tatami + e.roomSqm <= 0) {
    out.push("令和8年9月分までの価額は、居住用の室の畳数（洋室は平方メートル）で決まるので、入れてください");
  }
  if ((!e.end || e.end >= sqmFrom) && e.area <= 0) {
    out.push("令和8年10月分からの価額は、住宅の総面積（平方メートル）で決まるので、入れてください");
  }
  return out;
};

// ── 価額の表 ─────────────────────────────────────────────

/** その月（YYYY-MM）の分に使う価額の表（その月の1日までに使い始めている、いちばん新しいもの。表より前の月は null） */
export const genbutsuPeriodOf = (ym: string): GenbutsuPeriod | null => {
  const first = `${ym}-01`;
  const applied = GENBUTSU_PERIODS.filter((p) => p.from <= first);
  return applied.length > 0 ? applied[applied.length - 1] : null;
};

/** 日の和暦の年月（令和8年10月 など） */
const warekiMonth = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return y >= 2019 && !(y === 2019 && m < 5) ? `令和${y - 2018 === 1 ? "元" : y - 2018}年${m}月` : `平成${y - 1988}年${m}月`;
};

/**
 * その価額をいつから使っているか（前の表と同じ額のあいだはさかのぼる。食事は令和8年4月から、住宅（総面積）は令和8年10月から、など）
 * @param pick 比べる値（食事の額か住宅の額）
 */
const sinceLabel = (period: GenbutsuPeriod, pick: (p: GenbutsuPeriod) => string) => {
  let i = GENBUTSU_PERIODS.indexOf(period);
  while (i > 0 && pick(GENBUTSU_PERIODS[i - 1]) === pick(period)) i--;
  return warekiMonth(GENBUTSU_PERIODS[Math.max(0, i)].from);
};

const yen = (n: number) => `${n.toLocaleString()}円`;
/** 小数を、入れた桁のまま出す（4.5 畳・26.4 平方メートル） */
const num = (n: number) => String(Math.round(n * 100) / 100);

// ── 1か月分の計算 ─────────────────────────────────────────────

/** 明細に出す1行 */
export interface InKindLine {
  name: string;
  kind: InKindKind | "commute";
  /** 社会保険の報酬に入れる額 */
  amount: number;
  /** 所得税がかかる額 */
  taxable: number;
  /** 雇用保険の賃金に入れる額 */
  emp: number;
  /** 計算の説明 */
  detail: string;
}

export interface InKindMonth {
  /** 何年何月分（YYYY-MM） */
  month: string;
  lines: InKindLine[];
  /** 社会保険の報酬に入れる額・所得税がかかる額・雇用保険の賃金に入れる額（行の合計） */
  amount: number;
  taxable: number;
  emp: number;
  /**
   * 固定的賃金としての額（月変で、現物の価額の変動を見つけるため）：その月を通して出している行の、1か月分の額（monthly）と、
   * 出勤した日ごとの食事の1日の額（daily）。settled が false の月（月の途中から・までの行がある）は比べない
   */
  fixed: { monthly: number; daily: number };
  settled: boolean;
  /** 価額を出せない理由（都道府県がわからない・広さがないなど。あれば給与を確定できない） */
  problems: string[];
}

/** 食事の本人が払う額の決まり：表の価額の3分の2以上なら0円、未満なら価額から払った額を引いた額 */
export const mealAmount = (price: number, selfPay: number): number => (selfPay * 3 >= price * 2 ? 0 : Math.max(0, price - selfPay));

/** 住宅の1か月分の価額（1円未満切り捨て） */
export const housingMonthValue = (e: Pick<InKindEntry, "tatami" | "roomSqm" | "area" | "sharers">, period: GenbutsuPeriod, price: number): number => {
  if (period.housingUnit === "sqm") {
    // 総面積1平方メートルにつき。同じ住宅に住む被保険者の数で割る（小数を使わないように、100倍して計算する）
    return Math.floor((price * Math.round(e.area * 100)) / (100 * Math.max(1, e.sharers)));
  }
  // 居住用の室の畳1畳につき。畳を敷いていない室は 1.65平方メートルを1畳（Q&A Q9：30㎡ ÷ 1.65㎡ × 2,830円 ＝ 51,454円）
  return Math.floor((price * (Math.round(e.tatami * 100) * 165 + Math.round(e.roomSqm * 100) * 100)) / 16500);
};

// ── 所得税（auto）と雇用保険（empWage）の額 ─────────────────────────────

/** [分子, 分母] の額をいくつか足して、1円未満を切り捨てる（小数を使わないように、分母をそろえて整数で足す） */
const sumFloor = (terms: [number, number][]): number => {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const den = terms.reduce((l, [, d]) => (l / gcd(l, d)) * d, 1);
  return Math.floor(terms.reduce((s, [n, d]) => s + n * (den / d), 0) / den);
};
const pct = ([n, d]: readonly [number, number]) => `${Math.round((n * 100 * 10000) / d) / 10000}％`;

/** 食事の所得税がかかる額（No.2594。price・self はその月（出勤した日ごとなら、その月の日数分）の額） */
export const mealTaxOf = (price: number, self: number, rate: number) => {
  const [sn, sd] = MEAL_TAX.selfShare;
  const half = self * sd >= price * sn;
  const diff = Math.max(0, price - self);
  // 消費税を除いた額（10円未満切り捨て）で、1か月の額以下かを見る
  const excl = Math.floor((diff * 100) / ((100 + rate) * MEAL_TAX.roundTo)) * MEAL_TAX.roundTo;
  const ok = half && excl <= MEAL_TAX.monthlyLimit;
  return { taxable: ok ? 0 : diff, half, excl, ok };
};

/** 社宅の賃貸料相当額（1か月。使用人は No.2597、役員は No.2600） */
export const rentEquivalentOf = (
  e: Pick<InKindEntry, "bldgBase" | "landBase" | "floorArea" | "longLife" | "leasedRent">, executive: boolean,
): { value: number; formula: string; notes: string[] } => {
  const H = HOUSING_TAX;
  const area100 = Math.round(e.floorArea * 100);
  const [an, ad] = H.areaUnit;
  // 12円 × 総床面積 ÷ 3.3㎡（面積は100倍した整数で持つ）
  const small = sumFloor([[e.bldgBase * H.building[0], H.building[1]], [H.perArea * area100 * ad, 100 * an], [e.landBase * H.land[0], H.land[1]]]);
  const smallFormula = `建物 ${yen(e.bldgBase)} × ${pct(H.building)} ＋ ${H.perArea}円 × ${num(e.floorArea)}㎡ ÷ ${an / ad}㎡ ＋ 敷地 ${yen(e.landBase)} × ${pct(H.land)}`;
  if (!executive) return { value: small, formula: smallFormula, notes: [] };
  const O = H.officer;
  const notes: string[] = [];
  if (e.floorArea > O.luxuryArea) notes.push(`床面積が${O.luxuryArea}㎡を超えるので、豪華社宅（通常支払うべき使用料（時価）が賃貸料相当額）かどうかを確かめてください（タックスアンサー No.2600）`);
  const limit = e.longLife ? O.smallArea.long : O.smallArea.short;
  if (e.floorArea <= limit) return { value: small, formula: `小規模な住宅（${limit}㎡以下）：${smallFormula}`, notes };
  const b = e.longLife ? O.building.long : O.building.short;
  const own = sumFloor([[e.bldgBase * b[0], b[1] * O.months], [e.landBase * O.land[0], O.land[1] * O.months]]);
  const ownFormula = `（建物 ${yen(e.bldgBase)} × ${pct(b)} ＋ 敷地 ${yen(e.landBase)} × ${pct(O.land)}）÷ ${O.months}`;
  if (e.leasedRent > 0) {
    const half = Math.floor((e.leasedRent * O.leasedShare[0]) / O.leasedShare[1]);
    return half > own
      ? { value: half, formula: `家主に払う家賃 ${yen(e.leasedRent)} × ${pct(O.leasedShare)}（${ownFormula} ＝ ${yen(own)} より多い）`, notes }
      : { value: own, formula: `${ownFormula}（家主に払う家賃 ${yen(e.leasedRent)} × ${pct(O.leasedShare)} ＝ ${yen(half)} 以上）`, notes };
  }
  return { value: own, formula: ownFormula, notes };
};

/** 社宅の所得税がかかる額（使用人は本人が賃貸料相当額の50％以上を払えば0。役員は差額） */
export const housingTaxOf = (equivalent: number, self: number, executive: boolean): number => {
  if (executive) return Math.max(0, equivalent - self);
  const [n, d] = HOUSING_TAX.employeeShare;
  return self * d >= equivalent * n ? 0 : Math.max(0, equivalent - self);
};

/** 雇用保険の賃金に入れる現物の額（cost は実際費用、self は徴収金額。無償なら実際費用、徴収金額が実際費用の3分の1を下回れば、その差額） */
export const empInKindOf = (cost: number, self: number): number => {
  if (self <= 0) return cost;
  const [n, d] = EMP_IN_KIND.share;
  return self * d >= cost * n ? 0 : Math.max(0, Math.floor((cost * n) / d) - self);
};

/** その月（YYYY-MM）の、行の期間に入る日数 */
const daysIn = (e: InKindEntry, ym: string, monthDays: number): number => {
  if (!isDate(e.start)) return 0;
  const first = `${ym}-01`;
  const last = `${ym}-${String(monthDays).padStart(2, "0")}`;
  const from = e.start > first ? e.start : first;
  const to = e.end && e.end < last ? e.end : last;
  return from > to ? 0 : dayjs(to).diff(dayjs(from), "day") + 1;
};

/**
 * その月分の現物の額
 * @param ym          何年何月分か（給与の計算期間の終わりの日がある月。utils/genbutsu.ts の inKindMonthOf）
 * @param prefecture  勤務地（拠点）の都道府県（東京・大阪・北海道など。わからなければ空）
 * @param workedDates 給与の計算期間に出勤した日（働いた時間がある日。食事を出勤した日ごとに出すときに数える）
 */
export const inKindOfMonth = (
  entries: InKindEntry[], ym: string, prefecture: string | null | undefined, workedDates: string[] = [], opts: { executive?: boolean } = {},
): InKindMonth => {
  const result: InKindMonth = { month: ym, lines: [], amount: 0, taxable: 0, emp: 0, fixed: { monthly: 0, daily: 0 }, settled: true, problems: [] };
  const monthDays = dayjs(`${ym}-01`).daysInMonth();
  const period = genbutsuPeriodOf(ym);
  const pref = toKenpoPrefName(prefecture ?? "");
  const values = period && pref ? period.values[pref] : null;
  for (const e of entries) {
    const days = daysIn(e, ym, monthDays);
    // 出勤した日ごとの食事は、給与の計算期間に出勤した日で数える（計算期間は、その月の1日〜末日と少しずれることがある）
    const workdayMeal = e.kind === "meal" && e.mealPattern === "workday";
    const count = workdayMeal && isDate(e.start) ? workedDates.filter((d) => d >= e.start && (!e.end || d <= e.end)).length : 0;
    if (days === 0 && count === 0) continue;
    const full = days === monthDays;
    if (!full) result.settled = false;
    const name = inKindNameOf(e);
    // 月の途中から・までの月は、1か月の額を日数で日割りする（1円未満切り捨て）
    const prorate = (monthly: number) => (full ? monthly : Math.floor((monthly * days) / monthDays));
    const partNote = full ? "" : `（${days}日 ÷ ${monthDays}日で日割り）`;
    // 所得税を国税庁の決まりで計算するのは、タックスアンサーの「現在法令等」の日の月の分から（それより前は入れた額）
    const autoTax = e.kind !== "other" && e.taxMode === "auto" && ym >= GENBUTSU_TAX_SINCE.slice(0, 7);
    const autoBefore = e.kind !== "other" && e.taxMode === "auto" && !autoTax;
    if (autoTax && e.kind === "meal" && e.taxPrice <= 0) {
      result.problems.push(`${name}：所得税の計算に使う食事の価額（業者に払う額・材料費など）を入れてください`);
      continue;
    }
    if (autoTax && e.kind === "housing" && e.floorArea <= 0) {
      result.problems.push(`${name}：所得税の賃貸料相当額に使う建物の総床面積（平方メートル）を入れてください`);
      continue;
    }
    if (e.kind !== "other" && e.empWage && e.actualCost <= 0) {
      result.problems.push(`${name}：雇用保険の賃金にする額の計算に使う実際費用を入れてください`);
      continue;
    }
    const empNote = (emp: number, cost: number, self: number) => !e.empWage ? ""
      : `。雇用保険：${self <= 0 ? `無償なので実際費用 ${yen(cost)}`
        : emp === 0 ? `徴収金額 ${yen(self)} が実際費用 ${yen(cost)} の${EMP_IN_KIND.share[0]}/${EMP_IN_KIND.share[1]}以上なので0円`
        : `実際費用 ${yen(cost)} × ${EMP_IN_KIND.share[0]}/${EMP_IN_KIND.share[1]} − 徴収金額 ${yen(self)} ＝ ${yen(emp)}`}`;
    const mealTaxNote = (t: ReturnType<typeof mealTaxOf>, price: number, self: number) =>
      `。所得税：食事の価額 ${yen(price)}${self > 0 ? ` − 本人 ${yen(self)}` : ""}${t.ok
        ? `（本人が半分以上を払い、消費税を除いて ${yen(t.excl)} が月${yen(MEAL_TAX.monthlyLimit)}以下なので0円）`
        : ` ＝ ${yen(t.taxable)}（${t.half ? `消費税を除いて ${yen(t.excl)} が月${yen(MEAL_TAX.monthlyLimit)}を超える` : "本人が半分以上を払っていない"}）`}`;
    const beforeNote = autoBefore ? `。所得税：${GENBUTSU_TAX_SINCE.slice(0, 4)}年${Number(GENBUTSU_TAX_SINCE.slice(5, 7))}月分より前は入れた額` : "";
    if (e.kind === "other") {
      const value = prorate(e.value);
      const self = prorate(e.selfPay);
      const amount = Math.max(0, value - self);
      result.lines.push({
        name, kind: e.kind, amount, taxable: e.taxFree ? 0 : amount, emp: amount,
        detail: `時価 ${yen(e.value)}${partNote}${self > 0 ? ` − 本人が払う額 ${yen(self)}` : ""}`,
      });
      if (full) result.fixed.monthly += Math.max(0, e.value - e.selfPay);
      continue;
    }
    // 食事・住宅は、都道府県ごとの表の価額
    if (!period) {
      result.problems.push(`${name}：${ym.replace(/^(\d+)-0?(\d+)$/, "$1年$2月")}分の現物給与の価額の表がありません（平成31年4月分からあります）`);
      continue;
    }
    if (!values) {
      result.problems.push(`${name}：勤務地（拠点）の都道府県がわからないので、${e.kind === "meal" ? "食事" : "住宅"}の価額を出せません（会社設定で拠点の都道府県を登録してください）`);
      continue;
    }
    // 価額の出どころ（いつからの表の額か。前の表と同じ額のあいだはさかのぼる）
    const source = e.kind === "meal"
      ? `${pref}の${sinceLabel(period, (p) => JSON.stringify(p.values[pref!].meal))}からの価額`
      : `${pref}の${sinceLabel(period, (p) => `${p.housingUnit}:${p.values[pref!].housing}`)}からの価額`;
    if (e.kind === "meal") {
      if (e.mealPattern === "workday") {
        const unit = e.breakfast && e.lunch && e.dinner
          ? values.meal.day
          : (e.breakfast ? values.meal.breakfast : 0) + (e.lunch ? values.meal.lunch : 0) + (e.dinner ? values.meal.dinner : 0);
        if (unit === 0) {
          result.problems.push(`${name}：出す食事（朝食・昼食・夕食）を選んでください`);
          continue;
        }
        const price = unit * count;
        const self = e.selfPay * count;
        const amount = mealAmount(price, self);
        const meals = [e.breakfast && "朝食", e.lunch && "昼食", e.dinner && "夕食"].filter(Boolean).join("・");
        const tax = autoTax ? mealTaxOf(e.taxPrice * count, self, e.taxRate) : null;
        const emp = e.empWage ? empInKindOf(e.actualCost * count, self) : 0;
        result.lines.push({
          name, kind: e.kind, amount, taxable: tax ? tax.taxable : e.taxable * count, emp,
          detail: `${meals} ${yen(unit)} × 出勤した日 ${count}日 ＝ ${yen(price)}（${source}）`
            + (self > 0 ? (amount === 0 ? `。本人が払う額 ${yen(self)} が価額の3分の2以上なので0円` : ` − 本人が払う額 ${yen(self)}`) : "")
            + (tax ? mealTaxNote(tax, e.taxPrice * count, self) : beforeNote) + empNote(emp, e.actualCost * count, self),
        });
        // 1日の額（本人が払う1日の額を引いた額。3分の2の決まりも1日で見る）が固定的賃金
        if (full) result.fixed.daily += mealAmount(unit, e.selfPay);
        continue;
      }
      const price = full ? values.meal.month : values.meal.day * days;
      const self = prorate(e.selfPay);
      const amount = mealAmount(price, self);
      const tax = autoTax ? mealTaxOf(prorate(e.taxPrice), self, e.taxRate) : null;
      const emp = e.empWage ? empInKindOf(prorate(e.actualCost), self) : 0;
      result.lines.push({
        name, kind: e.kind, amount, taxable: tax ? tax.taxable : prorate(e.taxable), emp,
        detail: (full ? `1か月の食事の額 ${yen(price)}` : `1日の食事の額 ${yen(values.meal.day)} × ${days}日 ＝ ${yen(price)}`) + `（${source}）`
          + (self > 0 ? (amount === 0 ? `。本人が払う額 ${yen(self)} が価額の3分の2以上なので0円` : ` − 本人が払う額 ${yen(self)}`) : "")
          + (tax ? mealTaxNote(tax, prorate(e.taxPrice), self) : beforeNote) + empNote(emp, prorate(e.actualCost), self),
      });
      if (full) result.fixed.monthly += mealAmount(values.meal.month, e.selfPay);
      continue;
    }
    // 住宅
    const price = values.housing;
    const sqm = period.housingUnit === "sqm";
    if (sqm ? e.area <= 0 : e.tatami + e.roomSqm <= 0) {
      result.problems.push(sqm
        ? `${name}：令和8年10月分からの住宅の価額は、住宅の総面積で決まります。従業員の画面で、総面積（平方メートル）を入れてください`
        : `${name}：住宅の価額は、居住用の室の畳数で決まります。従業員の画面で、畳数（洋室は平方メートル）を入れてください`);
      continue;
    }
    const monthValue = housingMonthValue(e, period, price);
    const value = prorate(monthValue);
    const self = prorate(e.selfPay);
    const amount = Math.max(0, value - self);
    const executive = !!opts.executive;
    const rent = autoTax ? rentEquivalentOf(e, executive) : null;
    const equivalent = rent ? prorate(rent.value) : 0;
    const houseTax = rent ? housingTaxOf(equivalent, self, executive) : prorate(e.taxable);
    const emp = e.empWage ? empInKindOf(prorate(e.actualCost), self) : 0;
    const taxNote = rent
      ? `。所得税：賃貸料相当額 ${yen(rent.value)}（${rent.formula}）${partNote}${self > 0 ? ` − 本人 ${yen(self)}` : ""}`
        + (houseTax === 0 ? (executive ? "（差額なし）" : `（本人が${pct(HOUSING_TAX.employeeShare)}以上を払っているので0円）`) : ` → ${yen(houseTax)}`)
        + rent.notes.map((n) => `。${n}`).join("")
      : beforeNote;
    const size = sqm
      ? `総面積 ${num(e.area)}㎡${e.sharers > 1 ? ` ÷ ${e.sharers}人` : ""}`
      : [e.tatami > 0 ? `${num(e.tatami)}畳` : "", e.roomSqm > 0 ? `${num(e.roomSqm)}㎡ ÷ 1.65㎡` : ""].filter(Boolean).join(" ＋ ");
    result.lines.push({
      name, kind: e.kind, amount, taxable: houseTax, emp,
      detail: `${sqm ? "1㎡" : "1畳"} ${yen(price)} × ${size} ＝ ${yen(monthValue)}（${source}）${partNote}`
        + (self > 0 ? ` − 本人が払う額 ${yen(self)}` : "") + taxNote + empNote(emp, prorate(e.actualCost), self),
    });
    if (full) result.fixed.monthly += Math.max(0, monthValue - e.selfPay);
  }
  for (const l of result.lines) {
    result.amount += l.amount;
    result.taxable += l.taxable;
    result.emp += l.emp;
  }
  return result;
};

/**
 * 定期券・回数券などを現物で渡した通勤手当の行（社会保険の報酬と雇用保険の賃金に入れ、非課税限度額を超えた分に所得税がかかる）
 * @param nonTaxable 通勤手当のうち所得税がかからない額（非課税限度額まで。utils/commuteAllowance.ts）
 */
export const commuteInKindLine = (amount: number, nonTaxable: number): InKindLine => ({
  name: "通勤手当（定期券など）", kind: "commute", amount, taxable: Math.max(0, amount - nonTaxable), emp: amount,
  detail: nonTaxable >= amount
    ? "通勤手当の非課税限度額の中なので、所得税はかかりません"
    : `通勤手当の非課税限度額 ${yen(nonTaxable)} を超えた ${yen(amount - nonTaxable)} に所得税がかかります`,
});

/** 行を足す（合計にも足す。月変で比べる固定的な額には入れない） */
export const addInKindLine = (m: InKindMonth, line: InKindLine): InKindMonth => ({
  ...m, lines: [...m.lines, line], amount: m.amount + line.amount, taxable: m.taxable + line.taxable, emp: m.emp + line.emp,
});

/**
 * 現物は、その月分の給与（給与の計算期間の終わりの日がある月）と合わせる（締め日にかかわらず、月の1日〜末日の1か月分）
 * 計算期間がわからないときは、給与を支払う月
 */
export const inKindMonthOf = (period: { start: string; end: string } | null | undefined, payYear: number, payMonth: number): string =>
  period?.end && /^\d{4}-\d{2}/.test(period.end) ? period.end.slice(0, 7) : `${payYear}-${String(payMonth).padStart(2, "0")}`;

/**
 * 資格取得届の報酬月額に書く、現物の見込みの額（資格取得日にしている行の1か月分の額。出勤した日ごとの食事は、1か月の所定労働日数で数える）
 * @param date 資格取得日
 */
export const inKindEstimateOf = (
  entries: InKindEntry[], date: string, prefecture: string | null | undefined, workDays: number,
): { amount: number; lines: InKindLine[]; problems: string[] } => {
  if (!isDate(date)) return { amount: 0, lines: [], problems: [] };
  const ym = date.slice(0, 7);
  // 資格取得日にしている行を、その月を通して出しているものとして計算する
  const active = entries
    .filter((e) => isDate(e.start) && e.start <= date && (!e.end || e.end >= date))
    .map((e) => ({ ...e, start: `${ym}-01`, end: "" }));
  const first = dayjs(`${ym}-01`);
  const dates = Array.from({ length: Math.max(0, Math.floor(workDays)) }, (_, i) => first.add(i, "day").format("YYYY-MM-DD"));
  const m = inKindOfMonth(active, ym, prefecture, dates);
  return { amount: m.amount, lines: m.lines, problems: m.problems };
};

/** 確定した給与に残した現物の記録（salary_results.in_kind_detail の JSON） */
export interface InKindRecord {
  month: string;
  lines: InKindLine[];
  fixed: { monthly: number; daily: number };
  settled: boolean;
}

export const inKindRecordOf = (m: InKindMonth, extraLines: InKindLine[] = []): InKindRecord => ({
  month: m.month, lines: [...m.lines, ...extraLines], fixed: m.fixed, settled: m.settled,
});

/** 確定した給与の in_kind_detail を読む（ない・読めないときは null） */
export const parseInKindRecord = (json: unknown): InKindRecord | null => {
  if (typeof json !== "string" || !json.trim()) return null;
  try {
    const v = JSON.parse(json);
    if (!v || !Array.isArray(v.lines) || typeof v.fixed !== "object") return null;
    return {
      month: String(v.month ?? ""), lines: v.lines,
      fixed: { monthly: Number(v.fixed?.monthly) || 0, daily: Number(v.fixed?.daily) || 0 }, settled: v.settled !== false,
    };
  } catch {
    return null;
  }
};
