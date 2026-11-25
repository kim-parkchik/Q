/**
 * マイナンバーを書いた届書のファイル（年金事務所・健康保険組合・ハローワーク・eLTAX・e-Tax に出すもの）を保存するときの
 * 確かめと知らせ（見直しの P6。文とわけは utils/myNumberFiles.ts）
 * ・saveOptions(count)：保存の窓で選んだ場所が、クラウドと同期する場所なら、書く前に聞く
 *   （ほかの場所を選ぶ・このまま保存する・やめる。同期しているかわからなければ聞かない。utils/qFolder.ts の cloudPlaceOf）。
 *   utils/fileSaveUtils.ts の保存に渡す
 * ・notice(saved, count, kind)：保存したあとに、出し終わったら消すこと・控えの残し方を、OK を押すまで消えない窓で知らせる
 * どちらも、マイナンバーを書かないとき（count が 0）は何もしない
 */
import { useCallback, useMemo } from "react";
import { useMessageDialog } from "../../components/MessageDialog";
import type { SavedFile, SaveOptions } from "../../utils/fileSaveUtils";
import { cloudPlaceOf } from "../../utils/qFolder";
import {
  MY_NUMBER_CLOUD_CHOICES, MY_NUMBER_CLOUD_TITLE, MY_NUMBER_FILE_TITLE, myNumberCloudCheck, myNumberFileNotice, type MyNumberFileKind,
} from "../../utils/myNumberFiles";

export function useMyNumberFileGuard() {
  const dialog = useMessageDialog();

  /** 保存に渡すもの（count はファイルに書くマイナンバーの人数。0 なら確かめない） */
  const saveOptions = useCallback((count: number): SaveOptions | undefined => {
    if (count <= 0) return undefined;
    return { beforeWrite: myNumberCloudCheck(cloudPlaceOf, (message) => dialog.choose(message, MY_NUMBER_CLOUD_CHOICES, MY_NUMBER_CLOUD_TITLE, "やめる")) };
  }, [dialog]);

  /** 保存したあとの知らせ（count はファイルに書いたマイナンバーの人数。0 なら知らせない） */
  const notice = useCallback(async (saved: SavedFile, count: number, kind: MyNumberFileKind) => {
    if (count > 0) await dialog.warning(myNumberFileNotice({ name: saved.name, path: saved.path, count, kind }), MY_NUMBER_FILE_TITLE);
  }, [dialog]);

  return useMemo(() => ({ saveOptions, notice }), [saveOptions, notice]);
}
