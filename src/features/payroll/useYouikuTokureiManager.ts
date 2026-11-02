/**
 * 養育期間の標準報酬月額の特例（養育期間の従前標準報酬月額のみなし措置）画面の状態とデータ操作
 * 判定のきまりは utils/youikuTokurei.ts
 */
import { useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import dayjs from "dayjs";
import {
  emptyYouikuEntry, findYouikuCandidates, judgeYouikuEntries, parseYouikuEntries, stringifyYouikuEntries, validateYouikuEntry,
  type YouikuCandidate, type YouikuEntry,
} from "../../utils/youikuTokurei";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";

export function useYouikuTokureiManager(db: Database, staffList: any[], onDataChange: () => void) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const today = dayjs().format("YYYY-MM-DD");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<YouikuEntry[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  /** 登録した特例の一覧（保存した値で判定する） */
  const overview = useMemo(() =>
    staffList.flatMap((staff) =>
      judgeYouikuEntries(staff, parseYouikuEntries(staff.youiku_tokurei), today).map((judgement) => ({ staff, judgement }))),
    [staffList, today]);

  const candidates = useMemo(() => findYouikuCandidates(staffList, today), [staffList, today]);

  const selectedStaff = staffList.find((s) => String(s.id) === selectedId) ?? null;
  /** 選んだ人の特例（画面で直している途中の値で判定する） */
  const judgements = useMemo(
    () => (selectedStaff ? judgeYouikuEntries(selectedStaff, draft, today) : []),
    [selectedStaff, draft, today]);

  /** 人を選ぶ。prefill を渡すと、その内容の行を足す（保存はしない） */
  const selectStaff = async (id: string, prefill?: Partial<YouikuEntry>) => {
    if (id !== selectedId && isDirty) {
      const ok = await ask("保存していない変更があります。変更を捨てて、ほかの人を開きますか？", { title: "養育期間の特例", kind: "warning" });
      if (!ok) return;
    }
    const staff = staffList.find((s) => String(s.id) === id);
    const base = id === selectedId && isDirty ? draft : parseYouikuEntries(staff?.youiku_tokurei);
    setSelectedId(id);
    setDraft(prefill ? [...base, emptyYouikuEntry(prefill)] : base);
    setIsDirty(!!prefill || (id === selectedId && isDirty));
  };

  /** 申出ができそうな人を、休業の終了日の翌日を養育特例開始年月日にして登録する */
  const registerCandidate = (c: YouikuCandidate) => selectStaff(String(c.staff.id), { start: c.nextDay });

  const updateEntry = (index: number, patch: Partial<YouikuEntry>) => {
    setDraft((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    setIsDirty(true);
  };
  const addEntry = () => { setDraft((prev) => [...prev, emptyYouikuEntry()]); setIsDirty(true); };
  const removeEntry = (index: number) => { setDraft((prev) => prev.filter((_, i) => i !== index)); setIsDirty(true); };
  const cancel = () => { setDraft(parseYouikuEntries(selectedStaff?.youiku_tokurei)); setIsDirty(false); };

  const save = async () => {
    if (!db || !selectedStaff) return;
    const error = draft.map(validateYouikuEntry).find((e) => e !== null);
    if (error) return dialog.warning(error);
    setIsSaving(true);
    try {
      const json = stringifyYouikuEntries(draft);
      await db.execute("UPDATE staff SET youiku_tokurei = ? WHERE id = ?", [json, selectedStaff.id]);
      setDraft(parseYouikuEntries(json));
      setIsDirty(false);
      toast.success(`${selectedStaff.name}さんの養育期間の特例を保存しました`);
      onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`保存できませんでした。\n${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    today, overview, candidates, selectedId, selectedStaff, draft, judgements, isDirty, isSaving,
    selectStaff, registerCandidate, updateEntry, addEntry, removeEntry, cancel, save,
  };
}
