/**
 * 市区町村（全国地方公共団体コード）を探す
 *
 * 給与支払報告書は、1月1日現在の住所（年の途中で退職した人は、退職した日の住所）の市区町村に出す（地方税法317条の6第1項・第3項）。
 * eLTAX の CSV には、その市区町村の団体コード（6桁）を入れる。政令指定都市は区ではなく市のコード。
 * コードの一覧は constants/localGovCodes.ts（総務省の Excel から自動生成）
 */
import { LOCAL_GOV_CODES, LOCAL_GOV_CODES_AS_OF } from '../constants/localGovCodes';

export interface LocalGov {
  /** 団体コード（6桁） */
  code: string;
  prefecture: string;
  name: string;
}

export const LOCAL_GOVS: LocalGov[] = LOCAL_GOV_CODES.map(([code, prefecture, name]) => ({ code, prefecture, name }));
export { LOCAL_GOV_CODES_AS_OF };

const byCode = new Map(LOCAL_GOVS.map((g) => [g.code, g]));

/** 団体コードから市区町村（一覧にないコードは null） */
export const localGovByCode = (code: string | null | undefined): LocalGov | null => byCode.get(String(code ?? '').trim()) ?? null;

/** 「神奈川県横浜市」 */
export const localGovLabel = (g: LocalGov | null | undefined) => (g ? `${g.prefecture}${g.name}` : '');

/** 都道府県の一覧（コードの順） */
export const PREFECTURE_NAMES: string[] = [...new Set(LOCAL_GOVS.map((g) => g.prefecture))];

/** 住所の書き方の違い（空白・ヶとケ）をそろえる */
const normalize = (s: string) => s.replace(/[\s　]/g, '').replace(/[ヶヵ]/g, 'ケ');

/**
 * 住所から市区町村を探す（見つからない・決められないときは null）
 * ・都道府県名から始まる住所は、その都道府県の中で探す。始まらないときは全国で探し、1つに決まるときだけ返す
 * ・「〇〇郡〇〇町」の郡は飛ばす（一覧の町村名に郡は入っていない）
 * ・いちばん長く一致する名前を選ぶ（市川市と市川三郷町など）
 * ・政令指定都市は、区まで書いてあっても市を返す
 */
export const findLocalGovByAddress = (address: string | null | undefined): LocalGov | null => {
  const a = normalize(String(address ?? ''));
  if (!a) return null;
  const pref = PREFECTURE_NAMES.find((p) => a.startsWith(p));
  const candidates = pref ? LOCAL_GOVS.filter((g) => g.prefecture === pref) : LOCAL_GOVS;
  const rest = pref ? a.slice(pref.length) : a;
  const match = (s: string) => {
    const hits = candidates.filter((g) => s.startsWith(normalize(g.name)));
    const longest = Math.max(0, ...hits.map((g) => g.name.length));
    return hits.filter((g) => g.name.length === longest);
  };
  let hits = match(rest);
  if (hits.length === 0) {
    const county = /^(.+?郡)/.exec(rest);
    if (county) hits = match(rest.slice(county[1].length));
  }
  return hits.length === 1 ? hits[0] : null;
};
