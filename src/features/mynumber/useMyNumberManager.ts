/**
 * 「マイナンバー」の画面の状態とデータ操作
 * 扱えるのは事務取扱担当者の印がある人だけ。番号はふだん隠し、表示・登録・変更・削除は記録に残す（番号は記録に書かない）
 * きまりと出典は utils/myNumber.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { buildMyNumberList, myNumberError, normalizeMyNumber, SELF_KEY, type MyNumberEntry, type MyNumberStaffRow } from "../../utils/myNumber";
import { parseDeclaration } from "../../utils/nenchoDeclaration";
import { hasMyNumberAccess, logMyNumber, type MyNumberUser } from "./myNumberStore";

export interface MyNumberLog {
  at: string;
  user: string;
  message: string;
}

/** 記録に書く「誰の番号か」（番号は書かない） */
const whoOf = (row: MyNumberStaffRow, e: MyNumberEntry) => (e.key === SELF_KEY ? `${row.name}（本人）` : `${row.name}の${e.relation}・${e.name}`);

export function useMyNumberManager(db: Database, staffList: any[], user: MyNumberUser | null) {
  const dialog = useMessageDialog();
  const toast = useToast();
  /** null は確かめている途中 */
  const [access, setAccess] = useState<boolean | null>(null);
  const [declarations, setDeclarations] = useState<{ staffId: string; year: number; declaration: ReturnType<typeof parseDeclaration> }[]>([]);
  const [registered, setRegistered] = useState<{ staffId: string; person: string; name: string; relation: string }[]>([]);
  const [logs, setLogs] = useState<MyNumberLog[]>([]);

  const load = async () => {
    const ok = await hasMyNumberAccess(db, user);
    setAccess(ok);
    if (!ok) return;
    const d = await db.select<any[]>("SELECT staff_id, year, declaration FROM year_end_adjustments");
    const r = await db.select<any[]>("SELECT staff_id, person, name, relation FROM my_numbers");
    const l = await db.select<any[]>("SELECT created_at, user_name, message FROM app_logs WHERE category = 'mynumber' ORDER BY id DESC LIMIT 100");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, user?.id]);

  const rows = useMemo(() => buildMyNumberList(staffList, declarations, registered), [staffList, declarations, registered]);

  /** 番号を見せる（記録に残す） */
  const reveal = async (row: MyNumberStaffRow, e: MyNumberEntry): Promise<string | null> => {
    if (!(await hasMyNumberAccess(db, user))) return null;
    const r = await db.select<any[]>("SELECT number FROM my_numbers WHERE staff_id = ? AND person = ?", [row.staffId, e.key]);
    if (!r[0]) return null;
    await logMyNumber(db, user, `マイナンバーを表示しました：${whoOf(row, e)}`);
    await load();
    return String(r[0].number);
  };

  /** 番号を登録する・直す（12桁目の検査用数字と、ほかの人と同じ番号でないかを確かめる） */
  const save = async (row: MyNumberStaffRow, e: MyNumberEntry, value: string): Promise<boolean> => {
    const error = myNumberError(value);
    if (error) {
      dialog.warning(error);
      return false;
    }
    if (!(await hasMyNumberAccess(db, user))) {
      dialog.warning("マイナンバーを扱える印がありません（管理者がシステム設定で付けます）");
      return false;
    }
    const number = normalizeMyNumber(value);
    try {
      const same = await db.select<any[]>(
        "SELECT staff_id, person, name FROM my_numbers WHERE number = ? AND NOT (staff_id = ? AND person = ?)",
        [number, row.staffId, e.key]
      );
      if (same[0]) {
        const owner = rows.find((x) => x.staffId === String(same[0].staff_id));
        const who = same[0].person === SELF_KEY ? `${owner?.name ?? same[0].staff_id}（本人）` : `${owner?.name ?? same[0].staff_id}の家族・${same[0].name}`;
        dialog.warning(`同じ番号が、${who}に登録されています。打ち間違いがないか確かめてください。`);
        return false;
      }
      await db.execute(
        `INSERT INTO my_numbers (staff_id, person, name, relation, number, updated_at)
         VALUES (?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
         ON CONFLICT(staff_id, person) DO UPDATE SET
           name = excluded.name, relation = excluded.relation, number = excluded.number, updated_at = excluded.updated_at`,
        [row.staffId, e.key, e.key === SELF_KEY ? null : e.name, e.key === SELF_KEY ? null : e.relation, number]
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

  return { access, rows, logs, reveal, save, remove };
}
