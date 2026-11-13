/**
 * 保存期間が過ぎたマイナンバーの数（メニューの「マイナンバー」に出す知らせ。決まりは utils/myNumberRetention.ts）
 * 事務取扱担当者の印がある人だけに数える（ほかの人には null。数も見せない）。番号は読まない（鍵を開けなくてよい）
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { todayYmd } from "../../utils/myNumberRetention";
import { countExpiredMyNumbers, type MyNumberUser } from "./myNumberStore";

/**
 * @param refreshKey 変わったら数え直す（番号を消したとき・画面を切り替えたとき）
 */
export function useExpiredMyNumberCount(db: Database | null, user: MyNumberUser | null, staffList: any[], refreshKey: unknown): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!db || !user) {
      setCount(null);
      return;
    }
    countExpiredMyNumbers(db, user, staffList, todayYmd())
      .then((n) => { if (!cancelled) setCount(n); })
      .catch((e) => {
        console.error("保存期間が過ぎたマイナンバーを数えられませんでした", e);
        if (!cancelled) setCount(null);
      });
    return () => { cancelled = true; };
  }, [db, user?.id, staffList, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return count;
}
