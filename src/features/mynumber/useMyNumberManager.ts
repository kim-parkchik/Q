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
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { buildMyNumberList, myNumberError, normalizeMyNumber, SELF_KEY, type MyNumberEntry, type MyNumberStaffRow } from "../../utils/myNumber";
import { decryptNumber, encryptNumber, numberHash, passwordError, recoveryKeyError } from "../../utils/myNumberCrypto";
import { parseDeclaration } from "../../utils/nenchoDeclaration";
import { hasMyNumberAccess, logMyNumber, type MyNumberUser } from "./myNumberStore";
import { useMyNumberUnlock, useVaultState } from "./MyNumberUnlock";
import { changeVaultPassword, loadKeyRecord, lockVault, recoverVault, renewVaultRecoveryKey, setupVault } from "./myNumberVault";

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

export function useMyNumberManager(db: Database, staffList: any[], user: MyNumberUser | null) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const unlock = useMyNumberUnlock();
  const vault = useVaultState(db);
  /** null は確かめている途中 */
  const [access, setAccess] = useState<boolean | null>(null);
  /** 暗号化を始めているか（null は確かめている途中） */
  const [setUp, setSetUp] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [declarations, setDeclarations] = useState<{ staffId: string; year: number; declaration: ReturnType<typeof parseDeclaration> }[]>([]);
  const [registered, setRegistered] = useState<{ staffId: string; person: string; name: string; relation: string }[]>([]);
  const [logs, setLogs] = useState<MyNumberLog[]>([]);
  /** 見せる回復用キー（見せ終わったら消す） */
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const ok = await hasMyNumberAccess(db, user);
    setAccess(ok);
    if (!ok) return;
    setSetUp((await loadKeyRecord(db)) !== null);
    const c = await db.select<any[]>("SELECT name FROM company WHERE id = 1");
    const d = await db.select<any[]>("SELECT staff_id, year, declaration FROM year_end_adjustments");
    const r = await db.select<any[]>("SELECT staff_id, person, name, relation FROM my_numbers");
    const l = await db.select<any[]>("SELECT created_at, user_name, message FROM app_logs WHERE category = 'mynumber' ORDER BY id DESC LIMIT 100");
    setCompanyName(String(c[0]?.name ?? ""));
    setDeclarations(d.map((x) => ({ staffId: String(x.staff_id), year: Number(x.year), declaration: parseDeclaration(x.declaration) })));
    setRegistered(r.map((x) => ({ staffId: String(x.staff_id), person: String(x.person), name: String(x.name ?? ""), relation: String(x.relation ?? "") })));
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
      await logMyNumber(db, user, `マイナンバーを消しました：${whoOf(row, e)}`);
      toast.success("マイナンバーを消しました");
      await load();
    } catch (err) {
      console.error(err);
      dialog.error(`マイナンバーを消せませんでした。\n${err}`);
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
    access, setUp, vault, rows, logs, busy, companyName, recoveryKey,
    closeRecoveryKey: () => setRecoveryKey(null),
    reveal, save, remove, setup, recover, changePassword, renewRecovery, openVault, closeVault,
  };
}
