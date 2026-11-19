/**
 * 従業員の拠点（本店・支店）の都道府県
 *
 * ■ 働く場所の都道府県（branchPrefectureOf）：拠点の都道府県
 *   最低賃金（最低賃金法。事業場ごと）・現物給与の価額（被保険者の勤務地の都道府県の価額。厚生労働大臣が定める現物給与の価額）に使う。
 * ■ 協会けんぽの健康保険料率の都道府県（kenpoPrefectureOf）：その人が入っている社会保険の「適用事業所」の都道府県
 *   協会けんぽの保険料率は、適用事業所がある都道府県の支部の率（健康保険法160条。都道府県単位保険料率）。
 *   支店が本店の適用事業所にまとめて入っている（一括適用、または独立していない支店）なら、支店で働く人も本店の都道府県の率になる。
 *   Q では、拠点の「社会保険番号（支店固有の場合）」（branches.health_ins_num）が入っている拠点を別の適用事業所とし、その拠点の都道府県の率にする。
 *   入っていなければ本店（拠点の番号 1）の適用事業所とし、本店の都道府県の率にする（社会保険の届書も、会社設定の本店の事業所整理記号で作る）。
 * ・拠点を選んでいない人は本店（拠点の番号 1）とする（従業員の画面・給与明細・源泉徴収簿と同じ扱い）
 * ・拠点が見つからない・都道府県が登録されていない（読み取れない）ときは prefecture を null にし、
 *   problem に画面で知らせる文を入れる。ほかの都道府県（京都など）で仮に計算しない
 */
import { toKenpoPrefName, type PrefectureName0 } from "../constants/prefectures";

export interface BranchLike {
  id: number;
  name?: string | null;
  prefecture?: string | null;
  /** 社会保険番号（支店固有の場合）。入っていれば、この拠点は本店とは別の社会保険の適用事業所 */
  health_ins_num?: string | null;
}

export interface BranchPrefecture {
  /** 保険料率と同じ書き方の都道府県（東京・大阪・青森など）。わからなければ null */
  prefecture: PrefectureName0 | null;
  /** 都道府県がわからない理由と、直し方（わかるときは null） */
  problem: string | null;
}

/** 本店の拠点の番号 */
export const HEAD_BRANCH_ID = 1;

const prefectureOfBranch = (branches: BranchLike[], id: number, who: string): BranchPrefecture => {
  const branch = branches.find((b) => Number(b.id) === id);
  if (!branch) {
    return { prefecture: null, problem: `${who}（番号 ${id}）が見つかりません。従業員の設定で拠点を選び直してください。` };
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

/** 働く場所（拠点）の都道府県（最低賃金・現物給与の価額） */
export const branchPrefectureOf = (branches: BranchLike[], branchId: unknown): BranchPrefecture =>
  prefectureOfBranch(branches, Number(branchId) || HEAD_BRANCH_ID, "この人の拠点");

/** 拠点が、本店とは別の社会保険の適用事業所か（社会保険番号（支店固有の場合）が入っている） */
export const isSeparateShahoOffice = (branch: BranchLike | undefined): boolean =>
  !!branch && Number(branch.id) !== HEAD_BRANCH_ID && String(branch.health_ins_num ?? "").trim() !== "";

export interface KenpoPrefecture extends BranchPrefecture {
  /** その人が入っている適用事業所の拠点（本店にまとめていれば本店） */
  officeBranchId: number;
  /** 働く拠点が本店とは別の適用事業所か */
  separate: boolean;
}

/** 協会けんぽの健康保険料率に使う都道府県（その人が入っている社会保険の適用事業所の都道府県） */
export const kenpoPrefectureOf = (branches: BranchLike[], branchId: unknown): KenpoPrefecture => {
  const id = Number(branchId) || HEAD_BRANCH_ID;
  const branch = branches.find((b) => Number(b.id) === id);
  if (!branch) return { ...prefectureOfBranch(branches, id, "この人の拠点"), officeBranchId: id, separate: false };
  const separate = isSeparateShahoOffice(branch);
  const officeBranchId = separate ? id : HEAD_BRANCH_ID;
  return { ...prefectureOfBranch(branches, officeBranchId, officeBranchId === HEAD_BRANCH_ID ? "本店の拠点" : "この人の拠点"), officeBranchId, separate };
};

/** 都道府県がわからないときに、健康保険料・介護保険料をどうしたか（画面の知らせに使う） */
export const PREFECTURE_UNKNOWN_EFFECT =
  "健康保険料の料率は都道府県（協会けんぽの支部）ごとに違うので、健康保険料と介護保険料を計算していません（0円）。";
