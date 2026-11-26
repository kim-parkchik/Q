/**
 * 最低賃金のチェック（地域別最低賃金と、拠点に入れた特定最低賃金）
 *
 * ■ 比べ方：最低賃金の対象になる賃金を時間あたりにして、最低賃金（時間額）以上か（最低賃金法4条）
 *   賃金が時間以外の期間などで決まっているときは、それぞれ時間あたりにして足す（最低賃金法施行規則2条）：
 *   ・時給：そのまま
 *   ・日給：1日の所定労働時間数（日によって違うときは、1週間における1日平均所定労働時間数）で割る（1項1号）
 *   ・月給：月の所定労働時間数（月によって違うときは、1年間における1月平均所定労働時間数）で割る（1項3号）
 *   ・出来高払制その他の請負制：その賃金算定期間の出来高の賃金の総額を、その期間に出来高で働いた総労働時間数で割る（1項5号）
 *   ・手当など、そのほかの賃金（時間で決まるものを除く）は、月で決まる賃金とみなす（2項）
 * ■ 比べるときに入れない賃金（最低賃金法4条3項・施行規則1条）：
 *   臨時の賃金、1か月を超える期間ごとの賃金（賞与など）、所定労働時間を超える労働・所定労働日以外の労働の賃金（残業代・休日手当）、
 *   深夜の割増分、その最低賃金で算入しないと定めた賃金（地域別最低賃金では、精皆勤手当・通勤手当・家族手当）
 * ■ 2つ以上の最低賃金が当たるときは、いちばん高いもので比べる（最低賃金法6条1項）。特定最低賃金は、会社が拠点に入れる
 *   （当たる産業・除かれる人（18歳未満など）は決定ごとに違うので、除かれる人は従業員の画面で外す）。
 * ■ 最低賃金は都道府県ごとに発効日が違う（同じ年度でも、10月から翌年3月まで）。
 * 出典：最低賃金法・最低賃金法施行規則（e-Gov 法令API）
 *       厚生労働省「最低賃金額以上かどうかを確認する方法」https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/chingin/newpage_43899.html
 *       厚生労働省 地域別最低賃金の全国一覧（constants/minimumWage.ts）
 *
 * Q では、基本給と、給与項目で「最低賃金に入れる」にした支給項目を時間あたりにして比べる（見直しの P12）。
 * 固定（毎月同額）の項目は月で決まる賃金にする。変動（毎月入力）の項目は、給与明細でだけ、平均賃金の区分で分ける：
 * 「月で決まる賃金」は1年間における1月平均所定労働時間で、「日・時間・出来高で決まる賃金」はその月に働いた時間で割る。
 * 平均賃金で「入れない」にした項目（臨時の賃金など）は入れない。通勤手当・固定残業代・残業代・休日や深夜の手当は入れない。
 */
import { MINIMUM_WAGES, type MinimumWageEntry } from "../constants/minimumWage";
import type { AverageWageKind } from "./averageWage";

/** その日に効力がある最低賃金（データがない都道府県・データより前の日は null） */
export const minimumWageOn = (prefecture: string | null | undefined, date: string): MinimumWageEntry | null => {
  const entries = prefecture ? MINIMUM_WAGES[prefecture] : undefined;
  if (!entries) return null;
  const applied = entries.filter((e) => e.from <= date);
  return applied.length > 0 ? applied[applied.length - 1] : null;
};

/** その日より後に発効する、次の最低賃金（まだなければ null） */
export const nextMinimumWage = (prefecture: string | null | undefined, date: string): MinimumWageEntry | null => {
  const entries = prefecture ? MINIMUM_WAGES[prefecture] : undefined;
  return entries?.find((e) => e.from > date) ?? null;
};

/**
 * 基本給を時間あたりにした金額（求められなければ null）
 * @param dailyHours          1日の所定労働時間
 * @param monthlyAverageHours 1年間における1月平均所定労働時間（月給のとき）
 */
export const baseWagePerHour = (
  wageType: string,
  baseWage: number,
  dailyHours: number,
  monthlyAverageHours: number | null,
): number | null => {
  const wage = Number(baseWage) || 0;
  if (wage <= 0) return null;
  if (wageType === "monthly") return monthlyAverageHours && monthlyAverageHours > 0 ? wage / monthlyAverageHours : null;
  if (wageType === "daily") return dailyHours > 0 ? wage / dailyHours : null;
  return wage;
};

/** 拠点に入れた特定最低賃金（branches.specific_minimum_wage の JSON） */
export interface SpecificMinimumWage {
  /** 名前（例：「○○県 ○○製造業最低賃金」） */
  name: string;
  /** 時間額と発効日（発効日の古い順） */
  wages: MinimumWageEntry[];
}

const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 拠点の特定最低賃金を読む（金額と発効日の行がなければ null） */
export const parseSpecificMinimumWage = (raw: unknown): SpecificMinimumWage | null => {
  let v: any = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const wages: MinimumWageEntry[] = (Array.isArray(v.wages) ? v.wages : [])
    .map((w: any) => ({ from: String(w?.from ?? ""), amount: Math.floor(Number(w?.amount)) }))
    .filter((w: MinimumWageEntry) => isYmd(w.from) && Number.isFinite(w.amount) && w.amount > 0)
    .sort((a: MinimumWageEntry, b: MinimumWageEntry) => a.from.localeCompare(b.from));
  if (wages.length === 0) return null;
  return { name: String(v.name ?? "").trim(), wages };
};

/** 拠点の特定最低賃金を、保存する形にする（金額と発効日の行がなければ null） */
export const stringifySpecificMinimumWage = (v: SpecificMinimumWage | null | undefined): string | null => {
  const parsed = parseSpecificMinimumWage(v ?? null);
  return parsed ? JSON.stringify(parsed) : null;
};

/** その人の拠点（拠点がなければ本店）の特定最低賃金（入れていなければ null） */
export const specificMinimumWageOf = (
  branches: { id: unknown; specific_minimum_wage?: unknown }[],
  branchId: unknown,
): SpecificMinimumWage | null => {
  const id = Number(branchId) || 1;
  return parseSpecificMinimumWage(branches.find((b) => Number(b.id) === id)?.specific_minimum_wage);
};

/** 比べる最低賃金（地域別か、拠点に入れた特定最低賃金） */
export interface AppliedMinimumWage extends MinimumWageEntry {
  kind: "regional" | "specific";
  /** 特定最低賃金の名前（地域別は空） */
  name: string;
}

/**
 * その日に比べる最低賃金：地域別最低賃金と特定最低賃金のうち、高いほう（最低賃金法6条1項。同じ額なら地域別）
 * @param specific 拠点に入れた特定最低賃金（入れていない・その人が除かれるときは null）
 */
export const applicableMinimumWageOn = (
  prefecture: string | null | undefined,
  date: string,
  specific?: SpecificMinimumWage | null,
): AppliedMinimumWage | null => {
  const regional = minimumWageOn(prefecture, date);
  const sp = specific ? [...specific.wages].reverse().find((w) => w.from <= date) ?? null : null;
  if (sp && (!regional || sp.amount > regional.amount)) return { ...sp, kind: "specific", name: specific!.name };
  return regional ? { ...regional, kind: "regional", name: "" } : null;
};

/** その日より後に、比べる最低賃金が変わる最初の日の最低賃金（まだなければ null） */
export const nextApplicableMinimumWage = (
  prefecture: string | null | undefined,
  date: string,
  specific?: SpecificMinimumWage | null,
): AppliedMinimumWage | null => {
  const current = applicableMinimumWageOn(prefecture, date, specific);
  const days = [
    ...((prefecture ? MINIMUM_WAGES[prefecture] : undefined) ?? []).map((e) => e.from),
    ...(specific?.wages ?? []).map((w) => w.from),
  ].filter((d) => d > date).sort();
  for (const d of days) {
    const m = applicableMinimumWageOn(prefecture, d, specific);
    if (m && (!current || m.amount !== current.amount || m.kind !== current.kind)) return m;
  }
  return null;
};

/** 最低賃金と比べる給与項目（給与項目設定の支給項目） */
export interface MinimumWageItem {
  name: string;
  amount: number;
  type: "earning" | "deduction";
  /** 固定（毎月同額）の項目か */
  fixed?: boolean;
  /** 平均賃金での扱い（変動の項目の分け方と、臨時の賃金などを除くのに使う） */
  averageWage?: AverageWageKind;
  /** 最低賃金に入れるか（給与項目設定。省略は入れる） */
  inMinimumWage?: boolean;
}

/** 最低賃金と比べる賃金を時間あたりにしたもの */
export interface MinimumWagePay {
  /** 合計（時間あたり） */
  perHour: number;
  /** 基本給の時間あたり */
  base: number;
  /** 月で決まる手当（固定の項目と、変動で「月で決まる賃金」の項目）の時間あたり */
  monthly: number;
  /** 出来高など（変動で「日・時間・出来高で決まる賃金」の項目）の時間あたり */
  piece: number;
  /** 月で決まる手当に入れた項目の名前 */
  monthlyItems: string[];
  /** 出来高などに入れた項目の名前 */
  pieceItems: string[];
  /** 時間あたりにできなかったので入れていない項目の名前（所定労働時間・働いた時間がわからない） */
  skipped: string[];
}

/**
 * 最低賃金と比べる賃金を時間あたりにする（比べられなければ null）
 * @param dailyHours          1日の所定労働時間（日給のとき）
 * @param monthlyAverageHours 1年間における1月平均所定労働時間（月給と、月で決まる手当のとき）
 * @param workedHours         その月に働いた時間（給与明細のとき。出来高などに使う）。省略すると、変動の項目は入れない（従業員の画面）
 */
export const minimumWagePayOf = (p: {
  wageType: string;
  baseWage: number;
  dailyHours: number;
  monthlyAverageHours: number | null;
  items?: MinimumWageItem[];
  workedHours?: number | null;
}): MinimumWagePay | null => {
  const wage = Number(p.baseWage) || 0;
  const base = wage > 0 ? baseWagePerHour(p.wageType, wage, p.dailyHours, p.monthlyAverageHours) : 0;
  if (base === null) return null;
  const monthlyHours = p.monthlyAverageHours && p.monthlyAverageHours > 0 ? p.monthlyAverageHours : null;
  const workedHours = p.workedHours && p.workedHours > 0 ? p.workedHours : null;
  let monthlyTotal = 0, pieceTotal = 0;
  const monthlyItems: string[] = [], pieceItems: string[] = [], skipped: string[] = [];
  for (const i of p.items ?? []) {
    const amount = Number(i.amount) || 0;
    if (i.type !== "earning" || amount <= 0 || i.inMinimumWage === false || i.averageWage === "none") continue;
    if (!i.fixed && p.workedHours === undefined) continue;
    const piece = !i.fixed && i.averageWage === "time";
    const hours = piece ? workedHours : monthlyHours;
    if (!hours) {
      skipped.push(i.name);
      continue;
    }
    if (piece) {
      pieceTotal += amount;
      pieceItems.push(i.name);
    } else {
      monthlyTotal += amount;
      monthlyItems.push(i.name);
    }
  }
  if (wage <= 0 && monthlyItems.length === 0 && pieceItems.length === 0) return null;
  const monthly = monthlyHours && monthlyTotal > 0 ? monthlyTotal / monthlyHours : 0;
  const piece = workedHours && pieceTotal > 0 ? pieceTotal / workedHours : 0;
  return { perHour: base + monthly + piece, base, monthly, piece, monthlyItems, pieceItems, skipped };
};

export interface MinimumWageCheck {
  minimum: AppliedMinimumWage;
  /** 最低賃金と比べる賃金の時間あたり */
  perHour: number;
  /** 最低賃金以上か */
  ok: boolean;
}

/** 最低賃金と比べる賃金（時間あたり）が、その日の最低賃金以上か（比べられなければ null） */
export const checkMinimumWage = (
  prefecture: string | null | undefined,
  date: string,
  perHour: number | null,
  specific?: SpecificMinimumWage | null,
): MinimumWageCheck | null => {
  const minimum = applicableMinimumWageOn(prefecture, date, specific);
  if (!minimum || perHour === null) return null;
  return { minimum, perHour, ok: perHour >= minimum.amount };
};

const ymdLabel = (ymd: string) => {
  const [y, mo, d] = ymd.split("-").map(Number);
  return `${y}年${mo}月${d}日`;
};

/** 「東京の最低賃金 1,226円（2025年10月3日から）」・「特定最低賃金「○○製造業最低賃金」 1,300円（2025年12月1日から）」 */
export const describeMinimumWage = (prefecture: string, m: MinimumWageEntry & { kind?: "regional" | "specific"; name?: string }): string => {
  const head = m.kind === "specific" ? `特定最低賃金${m.name ? `「${m.name}」` : ""}` : `${prefecture}の最低賃金`;
  return `${head} ${m.amount.toLocaleString()}円（${ymdLabel(m.from)}から）`;
};

/** 時間あたりの内訳：「基本給 800円＋手当 150円（職務手当）＋出来高など 250円（歩合給）」（基本給だけなら空） */
export const describeMinimumWagePay = (pay: MinimumWagePay): string => {
  if (pay.monthly === 0 && pay.piece === 0) return "";
  const yen = (v: number) => `${Math.floor(v).toLocaleString()}円`;
  const parts = [`基本給 ${yen(pay.base)}`];
  if (pay.monthly > 0) parts.push(`手当 ${yen(pay.monthly)}（${pay.monthlyItems.join("・")}）`);
  if (pay.piece > 0) parts.push(`出来高など ${yen(pay.piece)}（${pay.pieceItems.join("・")}）`);
  return parts.join("＋");
};
