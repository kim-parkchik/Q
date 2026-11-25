/**
 * 社会保険の届書（資格取得届・資格喪失届・産休と育休の申出書と、70歳以上被用者の賞与支払届・算定基礎届・月額変更届）に
 * マイナンバー（個人番号）を書くための状態
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
import { SHAHO_FILE_NAME } from "../../constants/shahoTodoke";
import { fillMyNumbers, missingMyNumberPeople, myNumberPeople, type MyNumberRow } from "../../utils/shahoCsv";
import { useMyNumberUnlock } from "../mynumber/MyNumberUnlock";
import { hasMyNumberAccess, loadRegisteredPeople, logMyNumber, type MyNumberUser } from "../mynumber/myNumberStore";
import type { ShahoFile } from "./useShahoFile";

/** 本人のマイナンバーを登録してある従業員ID（番号は読まない） */
const selfIdsOf = (people: { staffId: string; person: string }[]) => new Set(people.filter((p) => p.person === SELF_KEY).map((p) => p.staffId));
/** マイナンバーを登録してある人（「従業員ID|人」。番号は読まない） */
const peopleKeysOf = (people: { staffId: string; person: string }[]) => new Set(people.map((p) => `${p.staffId}|${p.person}`));

export function useShahoMyNumbers(db: any, user: MyNumberUser | null) {
  const unlock = useMyNumberUnlock();
  const dialog = useMessageDialog();
  /** 事務取扱担当者か */
  const [access, setAccess] = useState(false);
  /** 本人のマイナンバーを登録してある従業員 */
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  /** マイナンバーを登録してある人（家族も。「従業員ID|人」） */
  const [registeredPeople, setRegisteredPeople] = useState<Set<string>>(new Set());
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
        setRegisteredPeople(peopleKeysOf(people));
      } catch (e) {
        console.error("マイナンバーの登録を読めませんでした:", e);
        if (!cancelled) setAccess(false);
      }
    })();
    return () => { cancelled = true; };
  }, [db, user]);

  /** この人の届書にマイナンバーを書くか */
  const writes = useCallback((staffId: string) => access && use && registered.has(String(staffId)), [access, use, registered]);
  /** 家族（被扶養者）のマイナンバーを書くか（person は utils/myNumber.ts の familyKey） */
  const writesFamily = useCallback((staffId: string, person: string) =>
    access && use && registeredPeople.has(`${staffId}|${person}`), [access, use, registeredPeople]);

  /**
   * 保存するときに、行の MY_NUMBER_PLACEHOLDER を番号にする（鍵が閉じていれば、パスワードを聞く）
   * 番号を書く人がいなければ、そのまま返す。鍵を開けなかった・番号を読めなかったときは null（読めなかったときは知らせる）
   * 画面を開いたあとで番号を消した人がいれば、鍵を開ける前に知らせ、登録を読み直す（その人は基礎年金番号で届ける）
   * @param rows name は、番号を読めなかったときに知らせる名前
   */
  const resolve = useCallback(async (rows: (MyNumberRow & { name?: string; personNames?: Record<string, string> })[]): Promise<{ lines: string[][]; count: number } | null> => {
    const needed = myNumberPeople(rows);
    const ids = [...new Set(needed.map((p) => p.staffId))];
    if (needed.length === 0) return { lines: rows.map((r) => r.values), count: 0 };
    /** 知らせる名前（家族は「従業員の名前の家族（家族の名前）」） */
    const nameOf = (p: { staffId: string; person: string }) => {
      const r = rows.find((x) => x.staffId === p.staffId);
      const staffName = r?.name || `従業員ID ${p.staffId}`;
      if (p.person === SELF_KEY) return staffName;
      const family = rows.map((x) => x.personNames?.[p.person]).find(Boolean);
      return `${staffName}の家族（${family || "氏名不明"}）`;
    };
    const namesOf = (list: { staffId: string; person: string }[]) => list.map(nameOf).join("、");
    try {
      // 番号を消した人がいないか（番号は読まずに、登録してある人だけ読み直す）
      const people = await loadRegisteredPeople(db);
      const nowKeys = peopleKeysOf(people);
      const gone = needed.filter((p) => !nowKeys.has(`${p.staffId}|${p.person}`));
      if (gone.length > 0) {
        setRegistered(selfIdsOf(people));
        setRegisteredPeople(nowKeys);
        await dialog.warning(
          `次の人のマイナンバーが登録されていないので、ファイルを保存しませんでした：${namesOf(gone)}\n` +
          "この画面を開いたあとで、マイナンバーの画面で番号を消したときなどに起きます。登録を読み直したので、この人は基礎年金番号で届けます。" +
          "届書を確かめてから、もう一度保存してください。",
        );
        return null;
      }
      const numbers = await unlock.readNumbers(db, user, ids);
      if (!numbers) return null;
      const missing = missingMyNumberPeople(rows, numbers);
      if (missing.length > 0) {
        await dialog.warning(
          `次の人のマイナンバーを読めなかったので、ファイルを保存しませんでした：${namesOf(missing)}\n` +
          "マイナンバーの画面で登録を確かめてください。マイナンバーを書かずに届けるときは、「マイナンバーを書く」のチェックを外してください（基礎年金番号で届けます）。",
        );
        return null;
      }
      return { lines: fillMyNumbers(rows, numbers), count: needed.length };
    } catch (e) {
      console.error("マイナンバーを読めませんでした:", e);
      await dialog.error(`マイナンバーを読めなかったので、ファイルを保存しませんでした。\n${e}`);
      return null;
    }
  }, [db, user, unlock, dialog]);

  /** 番号を書いたファイルを保存したことを、マイナンバーの取扱いの記録に残す（番号は書かない） */
  const logWritten = useCallback((label: string, count: number, fileName: string) =>
    logMyNumber(db, user, `${label}の電子申請用ファイル（${fileName}。マイナンバー ${count}人分）を書き出しました`), [db, user]);

  /**
   * 年金事務所に出すファイル（SHFD0006.CSV）を保存する（マイナンバーを書く人がいれば、鍵を開けて番号を入れ、記録に人数だけ残す）
   * @param label 記録に書く届書の名前
   */
  const saveFile = useCallback(async (
    file: ShahoFile, rows: (MyNumberRow & { name?: string; personNames?: Record<string, string> })[], label: string, count: number,
  ): Promise<boolean> => {
    const resolved = await resolve(rows);
    if (!resolved) return false;
    const ok = await file.exportFile(resolved.lines.map((v) => v.join(",")), label, count, resolved.count);
    if (ok && resolved.count > 0) await logWritten(label, resolved.count, SHAHO_FILE_NAME);
    return ok;
  }, [resolve, logWritten]);

  return { access, registered, use, setUse, writes, writesFamily, resolve, logWritten, saveFile };
}

export type ShahoMyNumbers = ReturnType<typeof useShahoMyNumbers>;
