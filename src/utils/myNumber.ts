/**
 * マイナンバー（個人番号）の確かめ方・隠し方と、家族の番号の結び付け
 *
 * ■ 12桁目は検査用数字（番号法施行令 第6条）。算式は
 *   「行政手続における特定の個人を識別するための番号の利用等に関する法律に規定する個人番号、個人番号カード、
 *     特定個人情報の提供等に関する命令」（平成26年総務省令第85号）第5条
 *   https://laws.e-gov.go.jp/law/426M60000008085
 *     11 −（Σ Pn × Qn を11で割った余り）。ただし余りが1以下なら0
 *     Pn：検査用数字以外の11桁を、いちばん下の桁を1桁目として数えたn桁目の数字
 *     Qn：1≦n≦6 のとき n＋1、7≦n≦11 のとき n−5
 * ■ 扱い（個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」（別添1）安全管理措置）
 *   https://www.ppc.go.jp/legal/policy/my_number_guideline_jigyosha/
 *   ・扱える人を事務取扱担当者に限る（技術的安全管理措置 a アクセス制御）→ users.my_number_access の印がある人だけ
 *   ・取扱状況の分かる記録を残す。記録には番号を書かない（組織的安全管理措置 b・c）→ app_logs（category "mynumber"）
 *   ・要らなくなり、保存期間を過ぎたら、できるだけ早く消し、消した記録を残す（物理的安全管理措置 d）
 * ■ 番号は my_numbers の表に置く（従業員の一覧 staff.* に入って、どの画面にも読み込まれないように）。
 *   本人は "self"、家族は氏名と生年月日で結び付ける（年末調整の申告書は毎年入れ直すので、年をまたいで同じ人に使う）
 */

import type { NenchoDeclaration } from "./nenchoDeclaration";

/** 本人の番号の印 */
export const SELF_KEY = "self";

/** 家族の番号の印（氏名の空白を除いたものと生年月日。氏名が変わったら、登録し直す） */
export const familyKey = (name: string, birthday: string): string =>
  `family:${(birthday ?? "").trim()}:${(name ?? "").normalize("NFKC").replace(/\s/g, "")}`;

/** 書き方をそろえる（全角の数字は半角に。空白・ハイフンは除く） */
export const normalizeMyNumber = (s: string): string => (s ?? "").normalize("NFKC").replace(/[\s-]/g, "");

/** 上から11桁から、12桁目の検査用数字を出す */
export const myNumberCheckDigit = (first11: string): number => {
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    const p = Number(first11[11 - n]);
    const q = n <= 6 ? n + 1 : n - 5;
    sum += p * q;
  }
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
};

/** マイナンバーとして正しいか。正しければ null */
export const myNumberError = (s: string): string | null => {
  const v = normalizeMyNumber(s);
  if (!v) return "マイナンバーを入れてください";
  if (!/^\d+$/.test(v)) return "マイナンバーは数字で入れてください";
  if (v.length !== 12) return `マイナンバーは12桁です（いまは${v.length}桁）`;
  if (Number(v[11]) !== myNumberCheckDigit(v.slice(0, 11))) return "マイナンバーの12桁目（検査用数字）が合いません。打ち間違いがないか確かめてください";
  return null;
};

/** 画面に出すときは隠す */
export const MASKED_MY_NUMBER = "●●●● ●●●● ●●●●";

/** 見せるときの書き方（4桁ずつ） */
export const formatMyNumber = (v: string): string => `${v.slice(0, 4)} ${v.slice(4, 8)} ${v.slice(8)}`;

/** 画面の1行（本人か家族の1人） */
export interface MyNumberEntry {
  /** SELF_KEY か familyKey */
  key: string;
  name: string;
  /** 本人・配偶者・続柄 */
  relation: string;
  birthday: string;
  registered: boolean;
  /** 登録してあるのに、年末調整の申告書に見当たらない（氏名・生年月日が変わった、扶養から外れたなど）。家族だけ */
  orphan: boolean;
  /** 申告書に出てくる年（家族だけ） */
  years: number[];
}

export interface MyNumberStaffRow {
  staffId: string;
  name: string;
  retiredOn: string | null;
  entries: MyNumberEntry[];
}

/**
 * 従業員ごとに、本人と家族（年末調整の申告書に入れた配偶者・扶養親族）の一覧を作る。
 * 家族は氏名と生年月日で1人にまとめ、いちばん新しい年の申告書の氏名・続柄を出す
 */
export const buildMyNumberList = (
  staff: { id: string | number; name?: string | null; retirement_date?: string | null }[],
  declarations: { staffId: string; year: number; declaration: NenchoDeclaration }[],
  registered: { staffId: string; person: string; name?: string | null; relation?: string | null }[],
): MyNumberStaffRow[] =>
  staff.map((s) => {
    const staffId = String(s.id);
    const mine = new Map(registered.filter((r) => r.staffId === staffId).map((r) => [r.person, r]));
    const family = new Map<string, MyNumberEntry>();
    for (const d of declarations.filter((x) => x.staffId === staffId).sort((a, b) => a.year - b.year)) {
      const people = [
        ...(d.declaration.spouse ? [{ p: d.declaration.spouse, relation: "配偶者" }] : []),
        ...d.declaration.dependents.map((p) => ({ p, relation: (p.relation ?? "").trim() || "扶養親族" })),
      ];
      for (const { p, relation } of people) {
        const name = (p.name ?? "").trim();
        if (!name || !p.birthday) continue;
        const key = familyKey(name, p.birthday);
        const before = family.get(key);
        family.set(key, {
          key, name, relation, birthday: p.birthday, registered: mine.has(key), orphan: false,
          years: [...(before?.years ?? []), d.year].filter((y, i, a) => a.indexOf(y) === i),
        });
      }
    }
    for (const [key, r] of mine) {
      if (key === SELF_KEY || family.has(key)) continue;
      family.set(key, {
        key, name: (r.name ?? "").trim(), relation: (r.relation ?? "").trim(), birthday: key.split(":")[1] ?? "",
        registered: true, orphan: true, years: [],
      });
    }
    return {
      staffId,
      name: (s.name ?? "").trim(),
      retiredOn: s.retirement_date || null,
      entries: [
        { key: SELF_KEY, name: (s.name ?? "").trim(), relation: "本人", birthday: "", registered: mine.has(SELF_KEY), orphan: false, years: [] },
        ...family.values(),
      ],
    };
  });
