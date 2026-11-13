/**
 * 「マイナンバー」の画面の状態とデータ操作
 * 扱えるのは事務取扱担当者の印がある人だけ。番号はふだん隠し、表示・登録・変更・削除は記録に残す（番号は記録に書かない）
 * 番号は暗号化して置く。表示・登録のときに鍵が閉じていれば、パスワードを入れる窓を出す（MyNumberUnlock.tsx・myNumberVault.ts）
 * きまりと出典は utils/myNumber.ts・utils/myNumberCrypto.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
// remove は、番号を消す remove（この画面の操作）と名前が同じなので removeFile にする
import { readDir, remove as removeFile } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { APP_DIR_NAME, BACKUP_DIR_NAME } from "../../constants/appConfig";
import { backupsBeforeEncryption, companyBaseName } from "../../utils/backupFiles";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { buildMyNumberList, myNumberError, normalizeMyNumber, SELF_KEY, type MyNumberEntry, type MyNumberStaffRow } from "../../utils/myNumber";
import { decryptNumber, encryptNumber, numberHash, passwordError, recoveryKeyError } from "../../utils/myNumberCrypto";
import { jaDate, myNumberRetentions, todayYmd, type ExpiredMyNumber } from "../../utils/myNumberRetention";
import {
  declarationYearsOf, hasMyNumberAccess, loadDeclarations, loadLastPayYears, loadRegisteredPeople, logMyNumber, type MyNumberUser,
} from "./myNumberStore";
import { useMyNumberUnlock, useVaultState } from "./MyNumberUnlock";
import { changeVaultPassword, loadKeyRecord, lockVault, recoverVault, renewVaultRecoveryKey, setupVault } from "./myNumberVault";

/** 暗号化を始める前に作ったバックアップ（その会社ファイルのもの。暗号化していない番号が入っている） */
export interface PlainBackups {
  /** 暗号化を始めた日時（"YYYY-MM-DD HH:MM:SS"） */
  startedAt: string;
  /** バックアップのフォルダ（書類/Q/Backup） */
  dir: string;
  /** 暗号化を始める前に作ったもの（古い順） */
  before: string[];
  /** 暗号化を始めてから作ったもの */
  after: string[];
}

export interface MyNumberLog {
  at: string;
  user: string;
  message: string;
}

/** 記録に書く「誰の番号か」（番号は書かない） */
const whoOf = (row: MyNumberStaffRow, e: MyNumberEntry) => (e.key === SELF_KEY ? `${row.name}（本人）` : `${row.name}の${e.relation}・${e.name}`);

/** 新しいパスワードと、確認のために2回目に入れたものを確かめる */
const newPasswordError = (password: string, confirm: string) =>
  passwordError(password) ?? (password !== confirm ? "確認のために入れたパスワードが違います。" : null);

/**
 * @param companyPath 開いている会社ファイルの場所（暗号化を始める前のバックアップを探すため。わからなければ探さない）
 * @param onNumbersChanged 番号を消したとき（メニューの「保存期間が過ぎた番号」の知らせを数え直す）
 */
export function useMyNumberManager(
  db: Database, staffList: any[], user: MyNumberUser | null, companyPath: string | null = null, onNumbersChanged?: () => void,
) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const unlock = useMyNumberUnlock();
  const vault = useVaultState(db);
  /** null は確かめている途中 */
  const [access, setAccess] = useState<boolean | null>(null);
  /** 暗号化を始めているか（null は確かめている途中） */
  const [setUp, setSetUp] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [declarations, setDeclarations] = useState<Awaited<ReturnType<typeof loadDeclarations>>>([]);
  const [registered, setRegistered] = useState<{ staffId: string; person: string; name: string; relation: string }[]>([]);
  /** 従業員IDごとの、最後に給与か賞与を払った年（保存期間を数える） */
  const [lastPayYears, setLastPayYears] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<MyNumberLog[]>([]);
  /** 見せる回復用キー（見せ終わったら消す） */
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plainBackups, setPlainBackups] = useState<PlainBackups | null>(null);

  /** 暗号化を始める前に作った、この会社ファイルのバックアップを探す（名前の日時と、暗号化を始めた日時を比べる） */
  const loadPlainBackups = async (): Promise<PlainBackups | null> => {
    if (!companyPath) return null;
    const keyRows = await db.select<any[]>("SELECT created_at FROM my_number_keys WHERE id = 1");
    const startedAt = String(keyRows?.[0]?.created_at ?? "");
    if (!startedAt) return null;
    const dir = await join(await documentDir(), APP_DIR_NAME, BACKUP_DIR_NAME);
    let names: string[] = [];
    try {
      names = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name);
    } catch {
      names = []; // バックアップのフォルダがまだない
    }
    return { startedAt, dir, ...backupsBeforeEncryption(names, companyBaseName(companyPath), startedAt) };
  };

  const load = async () => {
    const ok = await hasMyNumberAccess(db, user);
    setAccess(ok);
    if (!ok) return;
    const keyRecord = await loadKeyRecord(db);
    setSetUp(keyRecord !== null);
    try {
      setPlainBackups(keyRecord ? await loadPlainBackups() : null);
    } catch (e) {
      console.error("暗号化を始める前のバックアップを探せませんでした", e);
      setPlainBackups(null);
    }
    const c = await db.select<any[]>("SELECT name FROM company WHERE id = 1");
    const l = await db.select<any[]>("SELECT created_at, user_name, message FROM app_logs WHERE category = 'mynumber' ORDER BY id DESC LIMIT 100");
    setCompanyName(String(c[0]?.name ?? ""));
    setDeclarations(await loadDeclarations(db));
    setRegistered(await loadRegisteredPeople(db));
    setLastPayYears(await loadLastPayYears(db));
    setLogs(l.map((x) => ({ at: String(x.created_at), user: String(x.user_name ?? ""), message: String(x.message) })));
  };

  useEffect(() => {
    if (!db) return;
    load().catch((e) => {
      console.error(e);
      dialog.error(`マイナンバーの画面を読み込めませんでした。\n${e}`);
    });
    // 鍵の開け閉め（15分で自動で閉じたときも）で、記録を読み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, user?.id, vault.open]);

  const rows = useMemo(() => buildMyNumberList(staffList, declarations, registered), [staffList, declarations, registered]);
  // 保存期間（本人は在籍中なら保管、退職した人は最後の扶養控除等申告書の保存期間まで。家族は最後に載った申告書の保存期間まで）と、過ぎた番号
  const retention = useMemo(
    () => myNumberRetentions(rows, staffList, lastPayYears, declarationYearsOf(declarations), todayYmd()),
    [rows, staffList, lastPayYears, declarations],
  );

  /** 番号を見せる（記録に残す） */
  const reveal = async (row: MyNumberStaffRow, e: MyNumberEntry): Promise<string | null> => {
    const keys = await unlock.ensureKeys(db, user);
    if (!keys) return null;
    try {
      const r = await db.select<any[]>("SELECT number FROM my_numbers WHERE staff_id = ? AND person = ?", [row.staffId, e.key]);
      if (!r[0]) return null;
      const number = await decryptNumber(keys, String(r[0].number), row.staffId, e.key);
      await logMyNumber(db, user, `マイナンバーを表示しました：${whoOf(row, e)}`);
      await load();
      return number;
    } catch (err) {
      console.error(err);
      dialog.error(`マイナンバーを表示できませんでした。\n${err}`);
      return null;
    }
  };

  /** 番号を登録する・直す（12桁目の検査用数字と、ほかの人と同じ番号でないかを確かめる） */
  const save = async (row: MyNumberStaffRow, e: MyNumberEntry, value: string): Promise<boolean> => {
    const error = myNumberError(value);
    if (error) {
      dialog.warning(error);
      return false;
    }
    const keys = await unlock.ensureKeys(db, user);
    if (!keys) return false;
    const number = normalizeMyNumber(value);
    try {
      const hash = await numberHash(keys, number);
      const same = await db.select<any[]>(
        "SELECT staff_id, person, name FROM my_numbers WHERE number_hash = ? AND NOT (staff_id = ? AND person = ?)",
        [hash, row.staffId, e.key]
      );
      if (same[0]) {
        // 夫婦・親子で同じ会社に勤め、扶養の家族にも入っているときは、同じ人の番号が2か所に入る
        const owner = rows.find((x) => x.staffId === String(same[0].staff_id));
        const who = same[0].person === SELF_KEY ? `${owner?.name ?? same[0].staff_id}（本人）` : `${owner?.name ?? same[0].staff_id}の家族・${same[0].name}`;
        const ok = await ask(
          `同じ番号が、${who}に登録されています。\n\n同じ人なら（夫婦や親子で同じ会社に勤めていて、扶養の家族にも入っているときなど）そのまま登録してください。打ち間違いなら、直してください。`,
          { title: "同じ番号があります", kind: "warning", okLabel: "同じ人なので登録する", cancelLabel: "直す" }
        );
        if (!ok) return false;
      }
      await db.execute(
        `INSERT INTO my_numbers (staff_id, person, name, relation, number, number_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(staff_id, person) DO UPDATE SET
           name = excluded.name, relation = excluded.relation, number = excluded.number, number_hash = excluded.number_hash,
           updated_at = excluded.updated_at`,
        [row.staffId, e.key, e.key === SELF_KEY ? null : e.name, e.key === SELF_KEY ? null : e.relation,
          await encryptNumber(keys, number, row.staffId, e.key), hash]
      );
      await logMyNumber(db, user, `マイナンバーを${e.registered ? "直しました" : "登録しました"}：${whoOf(row, e)}`);
      toast.success(`${e.key === SELF_KEY ? row.name : e.name}さんのマイナンバーを${e.registered ? "直しました" : "登録しました"}`);
      await load();
      return true;
    } catch (err) {
      console.error(err);
      dialog.error(`マイナンバーを保存できませんでした。\n${err}`);
      return false;
    }
  };

  /** 番号を消す（要らなくなり、保存期間を過ぎたとき。記録に残す） */
  const remove = async (row: MyNumberStaffRow, e: MyNumberEntry) => {
    const ok = await ask(
      `${whoOf(row, e)}のマイナンバーを消しますか？\n\n消した番号は元に戻せません（会社ファイルのバックアップには残ります）。消したことは記録に残します。`,
      { title: "マイナンバーを消す", kind: "warning" }
    );
    if (!ok) return;
    try {
      await db.execute("DELETE FROM my_numbers WHERE staff_id = ? AND person = ?", [row.staffId, e.key]);
      const r = retention.byStaff[row.staffId]?.[e.key];
      await logMyNumber(db, user, `マイナンバーを消しました：${whoOf(row, e)}${r?.expired && r.keepUntil ? `（保存期間が過ぎたため。${jaDate(r.keepUntil)}まで保管：${r.basis}）` : ""}`);
      toast.success("マイナンバーを消しました");
      await load();
      onNumbersChanged?.();
    } catch (err) {
      console.error(err);
      dialog.error(`マイナンバーを消せませんでした。\n${err}`);
    }
  };

  /**
   * 保存期間が過ぎた番号をまとめて消す（一覧を見せて確かめてから。1件ずつ、何の保存期間が過ぎたかを記録に残す。記録に番号は書かない）
   * 番号を読まずに消すので、鍵は開けなくてよい
   */
  const removeExpired = async (items: ExpiredMyNumber[]) => {
    if (items.length === 0) return;
    const ok = await ask(
      `保存期間が過ぎたマイナンバー${items.length}件を消します。\n\n`
      + items.map((x) => `・${whoOf(x.row, x.entry)}（${jaDate(x.retention.keepUntil ?? "")}まで保管）`).join("\n")
      + "\n\n消した番号は元に戻せません（それより前に作った会社ファイルのバックアップには残ります）。消したことは記録に残します。\n\n消しますか？",
      { title: "保存期間が過ぎたマイナンバーを消す", kind: "warning", okLabel: "消す", cancelLabel: "やめる" },
    );
    if (!ok) return;
    if (!(await hasMyNumberAccess(db, user))) {
      dialog.warning("マイナンバーを扱える印がありません（管理者がシステム設定で付けます）");
      return;
    }
    setBusy(true);
    let removed = 0;
    try {
      for (const x of items) {
        await db.execute("DELETE FROM my_numbers WHERE staff_id = ? AND person = ?", [x.row.staffId, x.entry.key]);
        await logMyNumber(db, user, `マイナンバーを消しました：${whoOf(x.row, x.entry)}（保存期間が過ぎたため。${jaDate(x.retention.keepUntil ?? "")}まで保管：${x.retention.basis}）`);
        removed++;
      }
      toast.success(`保存期間が過ぎたマイナンバー${removed}件を消しました`);
    } catch (err) {
      console.error(err);
      dialog.error(`マイナンバーを消せませんでした（${removed}件は消しました）。\n${err}`);
    } finally {
      setBusy(false);
      await load().catch((e) => console.error(e));
      onNumbersChanged?.();
    }
  };

  /** 鍵の操作の前に、扱える印があるか・入れたものが決まりに合うかを確かめ、終わったら読み直す */
  const keyAction = async (check: string | null, action: () => Promise<boolean>, failed: string): Promise<boolean> => {
    if (check) {
      dialog.warning(check);
      return false;
    }
    if (!(await hasMyNumberAccess(db, user))) {
      dialog.warning("マイナンバーを扱える印がありません（管理者がシステム設定で付けます）");
      return false;
    }
    setBusy(true);
    try {
      return await action();
    } catch (err) {
      console.error(err);
      dialog.error(`${failed}\n${err}`);
      return false;
    } finally {
      setBusy(false);
      await load().catch((e) => console.error(e));
    }
  };

  /**
   * 暗号化を始める前に作ったバックアップを消す（暗号化していない番号が入っているため。消したことは記録に残す）
   * 消したバックアップの日の会社ファイルには戻せなくなるので、一覧を見せて確かめてから消す
   */
  const removePlainBackups = async () => {
    const target = plainBackups;
    if (!target || target.before.length === 0) return;
    const ok = await ask(
      `暗号化を始める前に作ったバックアップ${target.before.length}個を消します。\n\n`
      + target.before.map((name) => `・${name}`).join("\n")
      + "\n\nこれらには、そのときに登録していたマイナンバーが、暗号化しないまま入っています。"
      + "消したバックアップは元に戻せず、その日の会社ファイルにも戻せなくなります。"
      + (target.after.length === 0
        ? "\n\n暗号化を始めてからのバックアップは、まだありません。消すと、この会社ファイルを閉じてバックアップが作られるまで、バックアップが1つもなくなります。"
        : "")
      + "\n\n消しますか？",
      { title: "暗号化を始める前のバックアップを消す", kind: "warning", okLabel: "消す", cancelLabel: "やめる" }
    );
    if (!ok) return;
    if (!(await hasMyNumberAccess(db, user))) {
      dialog.warning("マイナンバーを扱える印がありません（管理者がシステム設定で付けます）");
      return;
    }
    setBusy(true);
    const removed: string[] = [];
    const failed: string[] = [];
    try {
      for (const name of target.before) {
        try {
          await removeFile(await join(target.dir, name));
          removed.push(name);
        } catch (err) {
          console.error(err);
          failed.push(name);
        }
      }
      if (removed.length > 0) {
        await logMyNumber(db, user, `暗号化を始める前のバックアップを${removed.length}個消しました（${removed.join("、")}）`);
      }
      if (failed.length > 0) {
        dialog.error(`消せなかったバックアップがあります（ほかのアプリで開いていないか確かめてください）。\n${failed.join("\n")}`);
      } else {
        toast.success(`暗号化を始める前のバックアップを${removed.length}個消しました`);
      }
    } finally {
      setBusy(false);
      await load().catch((e) => console.error(e));
    }
  };

  /** 暗号化を始める（パスワードを決める。登録済みの番号は暗号化する） */
  const setup = (password: string, confirm: string) =>
    keyAction(newPasswordError(password, confirm), async () => {
      setRecoveryKey(await setupVault(db, user, password));
      toast.success("マイナンバーの暗号化を始めました");
      return true;
    }, "マイナンバーの暗号化を始められませんでした。");

  /** 回復用キーで開けて、新しいパスワードを決める（回復用キーも作り直す） */
  const recover = (key: string, password: string, confirm: string) =>
    keyAction(recoveryKeyError(key) ?? newPasswordError(password, confirm), async () => {
      const next = await recoverVault(db, user, key, password);
      if (!next) {
        dialog.warning("回復用キーが違います。打ち間違いがないか確かめてください（前に作り直した古いキーは使えません）。");
        return false;
      }
      setRecoveryKey(next);
      toast.success("新しいパスワードを決めました");
      return true;
    }, "回復用キーで開けられませんでした。");

  /** パスワードを変える */
  const changePassword = (current: string, password: string, confirm: string) =>
    keyAction(current ? newPasswordError(password, confirm) : "今のパスワードを入れてください。", async () => {
      if (!(await changeVaultPassword(db, user, current, password))) {
        dialog.warning("今のパスワードが違います。");
        return false;
      }
      toast.success("パスワードを変えました");
      return true;
    }, "パスワードを変えられませんでした。");

  /** 回復用キーを作り直す（前のキーは使えなくなる） */
  const renewRecovery = async (password: string) => {
    if (!password) {
      dialog.warning("パスワードを入れてください。");
      return false;
    }
    const ok = await ask("回復用キーを作り直しますか？\n\n作り直すと、前の回復用キー（しまってある紙）は使えなくなります。", {
      title: "回復用キーを作り直す", kind: "warning", okLabel: "作り直す", cancelLabel: "やめる",
    });
    if (!ok) return false;
    return keyAction(null, async () => {
      const next = await renewVaultRecoveryKey(db, user, password);
      if (!next) {
        dialog.warning("パスワードが違います。");
        return false;
      }
      setRecoveryKey(next);
      return true;
    }, "回復用キーを作り直せませんでした。");
  };

  /** 鍵を開ける（パスワードの窓を出す） */
  const openVault = async () => {
    await unlock.ensureKeys(db, user);
  };

  /** 鍵を閉じる */
  const closeVault = () => lockVault("manual");

  return {
    access, setUp, vault, rows, logs, busy, companyName, recoveryKey, plainBackups, retention,
    closeRecoveryKey: () => setRecoveryKey(null),
    reveal, save, remove, removeExpired, setup, recover, changePassword, renewRecovery, openVault, closeVault, removePlainBackups,
  };
}
