/**
 * 郵便番号から住所を引く（日本郵便の郵便番号データを Q の中で引く。郵便番号を外のサイトに送らない）
 *
 * データは public/zipcode/zip0.tsv 〜 zip9.tsv。scripts/import_zipcode.py が、日本郵便「住所の郵便番号（1レコード1行、UTF-8形式）」の
 * utf_ken_all.zip から作る（入手元・大きさ・SHA-256 は zipcode/README.md）。町域は住所に書く形にしてある
 * （かっこ書き・「以下に掲載がない場合」などを除く）。郵便番号の1けためのファイルだけを読み、読んだものは覚えておく。
 */

export interface ZipAddress {
  /** 郵便番号（7けた） */
  zip: string;
  /** 全国地方公共団体コード（5けた） */
  cityCode: string;
  pref: string;
  city: string;
  /** 町域（町域がない郵便番号は空） */
  town: string;
  prefKana: string;
  cityKana: string;
  townKana: string;
}

/** 郵便番号の入力を7けたの数字にする（全角の数字・ハイフンも読む）。7けたでなければ null */
export const normalizeZip = (input: string | null | undefined): string | null => {
  const digits = String(input ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");
  return digits.length === 7 ? digits : null;
};

/** 7けたの郵便番号を「123-4567」の形にする */
export const formatZip = (zip7: string): string => `${zip7.slice(0, 3)}-${zip7.slice(3)}`;

/** 郵便番号の1けためのデータのファイルの名前 */
export const zipDataFileOf = (zip7: string): string => `zip${zip7[0]}.tsv`;

/** データのファイル（「C」の行が市区町村、ほかの行が郵便番号）を、郵便番号 → 住所の候補 にする */
export const parseZipData = (text: string): Map<string, ZipAddress[]> => {
  const cities = new Map<string, string[]>();
  const map = new Map<string, ZipAddress[]>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f[0] === "C") {
      cities.set(f[1], f.slice(2));
      continue;
    }
    const c = cities.get(f[1]);
    if (!c) throw new Error(`郵便番号のデータに、市区町村 ${f[1]} がありません（${f[0]}）`);
    const a: ZipAddress = {
      zip: f[0], cityCode: f[1], pref: c[0], city: c[1], town: f[2] ?? "",
      prefKana: c[2], cityKana: c[3], townKana: f[3] ?? "",
    };
    const list = map.get(f[0]);
    if (list) list.push(a);
    else map.set(f[0], [a]);
  }
  return map;
};

/** データのファイルの読み方（アプリでは Q の中の public/zipcode/ を読む。テストでは差しかえる） */
export type ZipDataLoader = (file: string) => Promise<string>;

const appLoader: ZipDataLoader = async (file) => {
  const res = await fetch(`/zipcode/${file}`);
  if (!res.ok) throw new Error(`郵便番号のデータ（${file}）を読めませんでした（${res.status}）`);
  return res.text();
};

const caches = new WeakMap<ZipDataLoader, Map<string, Promise<Map<string, ZipAddress[]>>>>();

/** 郵便番号の住所の候補（ないときは空。町域がいくつもある郵便番号は、いくつも返す） */
export const lookupZip = async (zip7: string, load: ZipDataLoader = appLoader): Promise<ZipAddress[]> => {
  const zip = normalizeZip(zip7);
  if (!zip) return [];
  let cache = caches.get(load);
  if (!cache) caches.set(load, (cache = new Map()));
  const file = zipDataFileOf(zip);
  let data = cache.get(file);
  if (!data) {
    data = load(file).then(parseZipData);
    cache.set(file, data);
    // 読めなかったときは、次にもう一度読めるように覚えない
    data.catch(() => cache.delete(file));
  }
  return (await data).get(zip) ?? [];
};

/** 住所（都道府県・市区町村・町域） */
export const zipAddressText = (a: ZipAddress): string => `${a.pref}${a.city}${a.town}`;

/** 住所のフリガナ（都道府県・市区町村・町域をスペースで区切る。従業員の画面の「住所（フリガナ）」の書き方） */
export const zipAddressKanaText = (a: ZipAddress): string =>
  [a.prefKana, a.cityKana, a.townKana].filter(Boolean).join(" ");

/** 町域を選ぶ窓に出す名前（市区町村がみな同じなら町域だけ。町域の読みも出す。同じ字で読みが違う町域があるので） */
export const zipCandidateLabel = (a: ZipAddress, all: ZipAddress[]): string => {
  const sameCity = all.every((b) => b.cityCode === a.cityCode);
  const place = sameCity ? a.town || `${a.city}（町域なし）` : `${a.city}${a.town}`;
  return a.townKana ? `${place}（${a.townKana}）` : place;
};

/**
 * 候補が1つならそれ。いくつもあれば choose で選んでもらう（choose は選んだ番号、選ばなければ null を返す）。
 * 選ばなかったときは null
 */
export const pickZipAddress = async (
  candidates: ZipAddress[],
  choose: (labels: string[]) => Promise<number | null>,
): Promise<ZipAddress | null> => {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const i = await choose(candidates.map((c) => zipCandidateLabel(c, candidates)));
  return i === null || i < 0 || i >= candidates.length ? null : candidates[i];
};

/**
 * 町域を選ばなかったときに入れる、どの候補にも同じ部分（都道府県がみな同じなら都道府県、市区町村もみな同じなら市区町村まで）。
 * 都道府県が違う候補があれば null
 */
export const commonZipAddress = (candidates: ZipAddress[]): ZipAddress | null => {
  const a = candidates[0];
  if (!a || !candidates.every((b) => b.pref === a.pref)) return null;
  const sameCity = candidates.every((b) => b.cityCode === a.cityCode);
  return {
    ...a,
    cityCode: sameCity ? a.cityCode : "",
    city: sameCity ? a.city : "",
    cityKana: sameCity ? a.cityKana : "",
    town: "",
    townKana: "",
  };
};

/** 町域を選ぶ窓の文 */
export const ZIP_CHOOSE_MESSAGE =
  "この郵便番号には、町域がいくつかあります。住所の町域を選んでください（選ばないときは、どれにも同じ部分だけを入れます）。";
export const ZIP_CHOOSE_TITLE = "町域を選ぶ";

/** 郵便番号のデータにないときの文 */
export const ZIP_NOT_FOUND_MESSAGE =
  "この郵便番号は、日本郵便の郵便番号データにありません。郵便番号を確かめて、住所を入れてください（大きな会社などの個別の郵便番号は、データにありません）。";
