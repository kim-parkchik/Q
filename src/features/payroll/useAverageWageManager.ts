/**
 * 「平均賃金」の画面：1人の、ある日のできごとの平均賃金（労働基準法12条）と、それを使う額（休業手当・休業補償・解雇予告手当）を出す
 * 計算は utils/averageWage.ts、読むのは utils/averageWageStore.ts。Q で計算できないときは、平均賃金を手で入れられる
 */
import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { formatSen, toShutdownRate, ymdJa, type AverageWageResult } from "../../utils/averageWage";
import { deleteAverageWageOverride, loadAverageWage, saveAverageWageOverride } from "../../utils/averageWageStore";
import { writeLog } from "../../utils/logUtils";

/** 何に使う平均賃金か（できごとの日の決め方が違う） */
export type AverageWagePurpose = "shutdown" | "injury" | "dismissal" | "other";

export const AVERAGE_WAGE_PURPOSE_LABELS: Record<AverageWagePurpose, string> = {
  shutdown: "休業手当（会社の都合で休ませた日）",
  injury: "休業補償（業務上のけが・病気の最初の3日）",
  dismissal: "解雇予告手当",
  other: "そのほか（年次有給休暇の賃金・減給の制裁など）",
};

/** できごとの日（算定事由の発生した日）の名前（神奈川労働局「平均賃金について」） */
export const AVERAGE_WAGE_EVENT_LABELS: Record<AverageWagePurpose, string> = {
  shutdown: "休業の初めの日",
  injury: "事故の日（病気は診断で決まった日）",
  dismissal: "解雇を伝えた日",
  other: "できごとの日",
};

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function useAverageWageManager(db: any, staffList: any[]) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [staffId, setStaffId] = useState("");
  const [purpose, setPurpose] = useState<AverageWagePurpose>("shutdown");
  const [eventDate, setEventDate] = useState("");
  /** 解雇予告手当：解雇の日 */
  const [dismissalDate, setDismissalDate] = useState("");
  /** 休業手当：休ませた日数 */
  const [shutdownDays, setShutdownDays] = useState(1);
  const [result, setResult] = useState<AverageWageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [shutdownRate, setShutdownRate] = useState(60);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const staff = useMemo(() => staffList.find((s) => String(s.id) === staffId) ?? null, [staffList, staffId]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (!db || !staff || !isDate(eventDate)) return;
    setLoading(true);
    (async () => {
      try {
        const [r, groups] = await Promise.all([
          loadAverageWage(db, staff, eventDate),
          db.select("SELECT shutdown_allowance_rate FROM payroll_groups WHERE id = ?", [Number(staff.payroll_group_id) || 1]) as Promise<{ shutdown_allowance_rate?: number }[]>,
        ]);
        if (cancelled) return;
        setResult(r);
        setShutdownRate(toShutdownRate(groups?.[0]?.shutdown_allowance_rate));
      } catch (e) {
        console.error("平均賃金の計算エラー:", e);
        if (!cancelled) dialog.error(`平均賃金を計算できませんでした。\n${e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff, eventDate, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = () => (staff ? `${staff.name}さん（${staff.id}）` : "");

  /** 平均賃金を手で入れる（Q で計算できないとき・労働基準監督署などが決めた額を使うとき） */
  const saveManual = async (amountSen: number, note: string) => {
    if (!db || !staff || !isDate(eventDate)) return;
    if (!(amountSen > 0)) {
      dialog.warning("平均賃金を入れてください（円と銭）。");
      return;
    }
    if (!note.trim()) {
      dialog.warning("なぜ手で入れるか（例：労働基準監督署に確かめた額）を、メモに書いてください。");
      return;
    }
    setBusy(true);
    try {
      await saveAverageWageOverride(db, staff.id, eventDate, amountSen, note.trim());
      await writeLog(db, "INFO", "salary", `${who()}の平均賃金（${ymdJa(eventDate)}のできごと）を手で入れました：${formatSen(amountSen)}（${note.trim()}）`);
      toast.success("平均賃金を手で入れました。給与明細の休業手当・休業補償にも、この額を使います");
      setReloadKey((n) => n + 1);
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  /** 手で入れた平均賃金を消して、Q の計算に戻す */
  const deleteManual = async () => {
    if (!db || !staff || !isDate(eventDate) || !result?.manual) return;
    const ok = await ask(
      `${who()}の、${ymdJa(eventDate)}のできごとの平均賃金（手で入れた ${formatSen(result.manual.amountSen)}）を消して、Q の計算に戻します。\n\nよろしいですか？`,
      { title: "手で入れた平均賃金を消す", kind: "warning", okLabel: "消す", cancelLabel: "やめる" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteAverageWageOverride(db, staff.id, eventDate);
      await writeLog(db, "INFO", "salary", `${who()}の平均賃金（${ymdJa(eventDate)}のできごと）の、手で入れた額を消しました`);
      toast.success("手で入れた平均賃金を消しました");
      setReloadKey((n) => n + 1);
    } catch (e) {
      console.error(e);
      dialog.error(`消せませんでした。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  return {
    staff, staffId, setStaffId, purpose, setPurpose, eventDate, setEventDate, dismissalDate, setDismissalDate,
    shutdownDays, setShutdownDays, result, loading, shutdownRate, busy, saveManual, deleteManual,
  };
}
