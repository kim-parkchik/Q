/**
 * 社会保険の届書（資格取得届・資格喪失届・産休と育休の申出書）にマイナンバー（個人番号）を書くための状態
 * ・書けるのは、事務取扱担当者の印がある人だけ（users.my_number_access。features/mynumber）
 * ・届書の行には、番号の代わりに MY_NUMBER_PLACEHOLDER を入れておき（画面・印刷・中身を見るには番号を出さない）、
 *   ファイルを保存するときだけ、鍵を開けて番号を読んで入れる（utils/shahoCsv.ts の fillMyNumbers）
 * ・番号を書いたことは、マイナンバーの取扱いの記録にも残す（番号は書かない）
 * ・保存するときに番号を読めない人がいれば（画面を開いたあとで、マイナンバーの画面で番号を消したときなど）、
 *   ファイルを保存せずに、名前を知らせる
 */
import { useCallback, useEffect, useState } from "react";
import { useMessageDialog } from "../../components/MessageDialog";
import { SELF_KEY } from "../../utils/myNumber";
import { MY_NUMBER_PLACEHOLDER, fillMyNumbers, missingMyNumbers } from "../../utils/shahoCsv";
import { useMyNumberUnlock } from "../mynumber/MyNumberUnlock";
import { hasMyNumberAccess, loadRegisteredPeople, logMyNumber, type MyNumberUser } from "../mynumber/myNumberStore";

/** 本人のマイナンバーを登録してある従業員ID（番号は読まない） */
const selfIdsOf = (people: { staffId: string; person: string }[]) => new Set(people.filter((p) => p.person === SELF_KEY).map((p) => p.staffId));

export function useShahoMyNumbers(db: any, user: MyNumberUser | null) {
  const unlock = useMyNumberUnlock();
  const dialog = useMessageDialog();
  /** 事務取扱担当者か */
  const [access, setAccess] = useState(false);
  /** 本人のマイナンバーを登録してある従業員 */
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  /** 届書に書く（事務取扱担当者が選ぶ。初めは書く） */
  const [use, setUse] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const ok = await hasMyNumberAccess(db, user);
        const people = ok ? await loadRegisteredPeople(db) : [];
        if (cancelled) return;
        setAccess(ok);
        setRegistered(selfIdsOf(people));
      } catch (e) {
        console.error("マイナンバーの登録を読めませんでした:", e);
        if (!cancelled) setAccess(false);
      }
    })();
    return () => { cancelled = true; };
  }, [db, user]);

  /** この人の届書にマイナンバーを書くか */
  const writes = useCallback((staffId: string) => access && use && registered.has(String(staffId)), [access, use, registered]);

  /**
   * 保存するときに、行の MY_NUMBER_PLACEHOLDER を番号にする（鍵が閉じていれば、パスワードを聞く）
   * 番号を書く人がいなければ、そのまま返す。鍵を開けなかった・番号を読めなかったときは null（読めなかったときは知らせる）
   * 画面を開いたあとで番号を消した人がいれば、鍵を開ける前に知らせ、登録を読み直す（その人は基礎年金番号で届ける）
   * @param rows name は、番号を読めなかったときに知らせる名前
   */
  const resolve = useCallback(async (rows: { staffId: string; name?: string; values: string[] }[]): Promise<{ lines: string[][]; count: number } | null> => {
    const ids = [...new Set(rows.filter((r) => r.values.includes(MY_NUMBER_PLACEHOLDER)).map((r) => r.staffId))];
    if (ids.length === 0) return { lines: rows.map((r) => r.values), count: 0 };
    const namesOf = (list: string[]) => list.map((id) => rows.find((r) => r.staffId === id)?.name || `従業員ID ${id}`).join("、");
    try {
      // 番号を消した人がいないか（番号は読まずに、登録してある人だけ読み直す）
      const now = selfIdsOf(await loadRegisteredPeople(db));
      const gone = ids.filter((id) => !now.has(id));
      if (gone.length > 0) {
        setRegistered(now);
        await dialog.warning(
          `次の人のマイナンバーが登録されていないので、ファイルを保存しませんでした：${namesOf(gone)}\n` +
          "この画面を開いたあとで、マイナンバーの画面で番号を消したときなどに起きます。登録を読み直したので、この人は基礎年金番号で届けます。" +
          "届書を確かめてから、もう一度保存してください。",
        );
        return null;
      }
      const numbers = await unlock.readNumbers(db, user, ids);
      if (!numbers) return null;
      const self = Object.fromEntries(ids.map((id) => [id, numbers[id]?.[SELF_KEY] ?? ""]));
      const missing = missingMyNumbers(rows, self);
      if (missing.length > 0) {
        await dialog.warning(
          `次の人のマイナンバーを読めなかったので、ファイルを保存しませんでした：${namesOf(missing)}\n` +
          "マイナンバーの画面で登録を確かめてください。マイナンバーを書かずに届けるときは、「マイナンバーを書く」のチェックを外してください（基礎年金番号で届けます）。",
        );
        return null;
      }
      return { lines: fillMyNumbers(rows, self), count: ids.length };
    } catch (e) {
      console.error("マイナンバーを読めませんでした:", e);
      await dialog.error(`マイナンバーを読めなかったので、ファイルを保存しませんでした。\n${e}`);
      return null;
    }
  }, [db, user, unlock, dialog]);

  /** 番号を書いたファイルを保存したことを、マイナンバーの取扱いの記録に残す（番号は書かない） */
  const logWritten = useCallback((label: string, count: number, fileName: string) =>
    logMyNumber(db, user, `${label}の電子申請用ファイル（${fileName}。マイナンバー ${count}人分）を書き出しました`), [db, user]);

  return { access, registered, use, setUse, writes, resolve, logWritten };
}

export type ShahoMyNumbers = ReturnType<typeof useShahoMyNumbers>;
