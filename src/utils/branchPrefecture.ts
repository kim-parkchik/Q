/**
 * 従業員の拠点（本店・支店）の都道府県
 *
 * 協会けんぽの健康保険料率は都道府県支部ごとに違い、最低賃金も都道府県ごとに違うので、拠点の都道府県で決める。
 * ・拠点を選んでいない人は本店（拠点の番号 1）とする（従業員の画面・給与明細・源泉徴収簿と同じ扱い）
 * ・拠点が見つからない・都道府県が登録されていない（読み取れない）ときは prefecture を null にし、
 *   problem に画面で知らせる文を入れる。ほかの都道府県（京都など）で仮に計算しない
 */
import { toKenpoPrefName, type PrefectureName0 } from "../constants/prefectures";

export interface BranchLike {
  id: number;
  name?: string | null;
  prefecture?: string | null;
}

export interface BranchPrefecture {
  /** 保険料率と同じ書き方の都道府県（東京・大阪・青森など）。わからなければ null */
  prefecture: PrefectureName0 | null;
  /** 都道府県がわからない理由と、直し方（わかるときは null） */
  problem: string | null;
}

export const branchPrefectureOf = (branches: BranchLike[], branchId: unknown): BranchPrefecture => {
  const id = Number(branchId) || 1;
  const branch = branches.find((b) => Number(b.id) === id);
  if (!branch) {
    return { prefecture: null, problem: `この人の拠点（番号 ${id}）が見つかりません。従業員の設定で拠点を選び直してください。` };
  }
  const prefecture = toKenpoPrefName(branch.prefecture);
  if (prefecture) return { prefecture, problem: null };
  const name = branch.name || `番号 ${id}`;
  return {
    prefecture: null,
    problem: branch.prefecture
      ? `拠点「${name}」の都道府県（${branch.prefecture}）を読み取れません。会社の設定で、拠点の都道府県を選び直してください。`
      : `拠点「${name}」の都道府県が登録されていません。会社の設定で、拠点の都道府県を登録してください。`,
  };
};

/** 都道府県がわからないときに、健康保険料・介護保険料をどうしたか（画面の知らせに使う） */
export const PREFECTURE_UNKNOWN_EFFECT =
  "健康保険料の料率は都道府県（協会けんぽの支部）ごとに違うので、健康保険料と介護保険料を計算していません（0円）。";
