/**
 * 健康保険組合に出す届書の電子申請用ファイル（KPFD0006.CSV）のデータレコード
 *
 * 健康保険組合の人の届書は、年金事務所（厚生年金）と健康保険組合（健康保険）の両方に出す。
 * 健康保険組合提出のデータレコードは、年金事務所提出と同じ項目のうしろに、健康保険組合の項目
 * （事業所番号（健保組合）・被保険者等番号（健保組合）・健保固有項目）が付き、年金の項目（基礎年金番号・70歳以上被用者届のみ提出など）は
 * 書かない（項目説明で「省略する」。種別が「-」の項目）。
 * Q は、年金事務所に出す行の項目をもとに、組合で書かない項目を空け、組合で書く項目（健康保険の従前の標準報酬月額・被保険者整理番号など）を
 * 入れ、健康保険組合の項目を足す。健保固有項目は書かない（組合から知らされたときに書くもの）。
 * 75歳以上の人（健康保険の資格がない）と、国民健康保険組合の人（健康保険に入っていない）は、組合に出すファイルに入れない。
 * 出典：厚生労働省・日本年金機構「CSV形式届書作成仕様書（電子申請）」の 4.x.2（健康保険組合提出）の項目構成・項目説明
 *       （src/constants/shahoTodoke.ts の SHAHO_*_UNION_FIELDS）
 */
import type { ShahoField } from "../constants/shahoTodoke";
import type { HealthInsurer } from "./healthInsurer";
import { valueProblem } from "./shahoCsv";

/** 健康保険組合に出す行（どの組合に出すか・項目・直すところ） */
export interface UnionRecord {
  insurerId: number;
  insurerName: string;
  values: string[];
  problems: string[];
}

/** 被保険者等番号（健保組合）：従業員の画面の「健康保険 被保険者番号」（組合の被保険者証の番号。英数字だけにする） */
export const unionMemberNumber = (staff: any): string => String(staff?.health_ins_num ?? "").normalize("NFKC").replace(/[^0-9A-Za-z]/g, "");

/**
 * 年金事務所に出す行の項目から、健康保険組合に出す行の項目を作る
 * @param values 年金事務所提出の項目（健康保険組合提出の、健康保険組合の項目より前の項目と同じ並び）
 * @param unionFields 健康保険組合提出の項目の決まり（SHAHO_*_UNION_FIELDS）
 * @param set 組合で書く項目（0 から数えた番号 → 値。年金事務所には書かない健康保険の値など）
 * @param memberRequired 被保険者等番号（健保組合）が要る届書か（資格取得届は、まだ番号がなければ空でよい）
 */
export const unionRecordOf = (
  insurer: HealthInsurer,
  staff: any,
  values: string[],
  unionFields: ShahoField[],
  set: Record<number, string>,
  memberRequired: boolean,
): UnionRecord => {
  const own = unionFields.length - 3;
  const out = unionFields.slice(0, own).map((f, i) => (f.kinds.includes("-") ? "" : values[i] ?? ""));
  for (const [i, v] of Object.entries(set)) out[Number(i)] = v;
  const member = unionMemberNumber(staff);
  out.push(insurer.officeNumber, member, "");
  const problems: string[] = [];
  if (memberRequired && !member) {
    problems.push(`${insurer.name}の被保険者等番号がありません（従業員の画面の「健康保険 被保険者番号」に、組合の被保険者証の番号を入れてください）`);
  }
  unionFields.forEach((f, i) => {
    // 事業所整理記号は事業所の情報で、事業所番号（健保組合）は会社設定の社会保険規定で知らせる。被保険者等番号は上で知らせた
    if ((i >= 1 && i <= 3) || i === own || (i === own + 1 && !member)) return;
    const p = valueProblem(f, out[i] ?? "");
    if (p) problems.push(`${insurer.name}に出す届書の${p}`);
  });
  return { insurerId: insurer.id, insurerName: insurer.name, values: out, problems };
};

/** 組合ごとにまとめる（組合に出すファイルは、組合ごとに1つ） */
export const groupByUnion = <T extends { union: UnionRecord | null }>(rows: T[]): { insurerId: number; insurerName: string; rows: T[] }[] => {
  const groups = new Map<number, { insurerId: number; insurerName: string; rows: T[] }>();
  for (const r of rows) {
    if (!r.union) continue;
    const g = groups.get(r.union.insurerId) ?? { insurerId: r.union.insurerId, insurerName: r.union.insurerName, rows: [] };
    g.rows.push(r);
    groups.set(r.union.insurerId, g);
  }
  return [...groups.values()].sort((a, b) => a.insurerId - b.insurerId);
};
