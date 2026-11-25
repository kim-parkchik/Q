/**
 * マイナンバーを書いた届書のファイル（年金事務所・健康保険組合・ハローワーク・eLTAX・e-Tax に出すもの）の知らせの文（見直しの P6）
 *
 * ・届書のファイルには、出す先が決めた形で、マイナンバーを暗号化せずに書く。会社ファイルの中の番号は暗号化してあるが、
 *   書き出したファイルは Q の外に残る。そこで、保存したあとに、出し終わったら消すこと・控えの残し方を窓で知らせ、
 *   保存する場所がクラウドと同期する場所なら、書く前に聞く（features/mynumber/useMyNumberFileGuard.ts）。
 * ・個人情報保護委員会「特定個人情報の適正な取扱いに関するガイドライン（事業者編）」
 *   第4-3-(3)B：番号法で決められた事務を処理する必要がなくなり、所管法令で決められた保存期間を過ぎたら、
 *   個人番号をできるだけ速やかに廃棄・削除する（保存期間のあいだは保管できる）。
 *   別添1 E-c：個人番号が入った電子媒体を持ち運ぶときは、容易に個人番号が判明しないようにする。
 *   別添1 E-d：個人番号を削除したら、その記録を残す（中小規模事業者は、削除・廃棄したことを、責任ある立場の者が確かめる）。
 * ・届書の書類を残す期間（e-Gov 法令検索で確かめた）：健康保険法施行規則34条・厚生年金保険法施行規則28条は、完結の日から2年。
 *   雇用保険法施行規則143条は、完結の日から2年（被保険者に関する書類は4年。ハローワークに出す届書は、どれも被保険者に関するもの）。
 *   税（eLTAX・e-Tax）の届書の控えは、残す期間を確かめていないので、期間を書かない。
 */
import type { BeforeWrite } from "./fileSaveUtils";

/** どこに出すファイルか（控えを残す期間の書き方が変わる） */
export type MyNumberFileKind = "pension" | "healthUnion" | "employment" | "tax";

/** 届書の控えを、法令で残す期間（確かめていないものは null） */
export const KEEP_PERIODS: Record<MyNumberFileKind, string | null> = {
  pension: "健康保険・厚生年金保険の書類は、完結の日から2年",
  healthUnion: "健康保険の書類は、完結の日から2年",
  employment: "雇用保険の被保険者に関する書類は、完結の日から4年",
  tax: null,
};

/** 保存したあとの知らせの見出し */
export const MY_NUMBER_FILE_TITLE = "マイナンバーが入ったファイルです";

/** クラウドと同期する場所を選んだときの確かめの見出しと、選べるもの（選ばないときは「やめる」） */
export const MY_NUMBER_CLOUD_TITLE = "クラウドと同期する場所です";
export const MY_NUMBER_CLOUD_CHOICES = ["ほかの場所を選ぶ", "このまま保存する"];

/** パスからファイル名だけを取り出す（Mac / Windows 両対応） */
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** 保存したあとの知らせ（count はマイナンバーを書いた人数） */
export const myNumberFileNotice = (o: { name: string; path: string; count: number; kind: MyNumberFileKind }): string => {
  const keep = KEEP_PERIODS[o.kind];
  return [
    `「${o.name}」に、マイナンバーを${o.count}人分、暗号化せずに書きました。`,
    "保存した場所：",
    o.path,
    "",
    "・出し終わったら、このファイルを消してください。ごみ箱に入れたときは、ごみ箱も空にしてください。",
    `・控えとして残すときは、ほかの人が見られない場所に置き、${keep ? `法令で残す期間（${keep}）が過ぎたら` : "要らなくなったら"}、早めに消してください。`,
    "・USB メモリやほかのパソコンに写したときは、そちらからも消してください。",
  ].join("\n");
};

/**
 * 書く前の確かめ（utils/fileSaveUtils.ts に渡す）：選んだ場所がクラウドと同期する場所なら聞く。
 * 「ほかの場所を選ぶ」なら保存の窓をもう一度出し、「このまま保存する」なら書き、「やめる」なら書かない。
 * 同期しない場所・同期しているかわからないとき（会社ファイルを開くときと同じ）は、聞かずに書く
 * @param cloudOf 場所がクラウドと同期していれば、そのクラウドの名前（utils/qFolder.ts の cloudPlaceOf）
 * @param ask 確かめの文を出して、選んだものの番号（MY_NUMBER_CLOUD_CHOICES の順。やめるなら null）を返す
 */
export const myNumberCloudCheck = (
  cloudOf: (path: string) => Promise<string | null>, ask: (message: string) => Promise<number | null>,
): BeforeWrite => async (path) => {
  const cloud = await cloudOf(path).catch((e) => {
    console.error("保存する場所がクラウドと同期しているかを確かめられませんでした:", e);
    return null;
  });
  if (!cloud) return true;
  const answer = await ask(myNumberCloudMessage(cloud, path));
  return answer === 0 ? "again" : answer === 1;
};

/** 保存の窓で選んだ場所が、クラウドと同期する場所のときの確かめ（service はクラウドの名前） */
export const myNumberCloudMessage = (service: string, path: string): string =>
  `選んだ場所は、${service} と同期するフォルダの中です。\n` +
  `「${baseName(path)}」には、マイナンバーを暗号化せずに書くので、このまま保存すると、マイナンバーがクラウドに上がります` +
  "（このパソコンで消しても、クラウドのごみ箱などに、しばらく残ることがあります）。\n" +
  "同期しない場所を選び直してください。";
