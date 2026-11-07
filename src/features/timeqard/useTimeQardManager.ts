/**
 * 「TimeQard（打刻）」の画面の動き（くわしくは timeqard/DESIGN.md の 5.1〜5.4）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { jstDate, jstIso, serializeStaffFile, staffFileName, type StaffForExport } from "../../../shared/timeqard";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { saveTextFile } from "../../utils/fileSaveUtils";
import { writeLog } from "../../utils/logUtils";
import {
  ensureCompanyMark,
  issueCards,
  loadActiveCards,
  loadTimeQardSettings,
  makeStaffFile,
  recordStaffFileExport,
  reissueCard,
  staffFileChangedSinceExport,
  staffInFile,
  type TimeQardCard,
  type TimeQardSettings,
} from "./timeqardStore";

/** TimeQard を置くページ（GitHub の Releases。TimeQard の版だけを出す） */
export const TIMEQARD_DOWNLOAD_URL = "https://github.com/kim-parkchik/Q/releases?q=TimeQard&expanded=true";
/** 入れ方の説明（timeqard/README.md） */
export const TIMEQARD_GUIDE_URL = "https://github.com/kim-parkchik/Q/blob/main/timeqard/README.md";

export interface CardStaff {
  id: string;
  name: string;
  status: string;
  joinDate: string;
  retirementDate: string;
  card: TimeQardCard | null;
}

interface Args {
  db: any;
  staffList: StaffForExport[];
  currentUser: { display_name?: string } | null;
}

export function useTimeQardManager({ db, staffList, currentUser }: Args) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const userName = currentUser?.display_name;
  const [settings, setSettings] = useState<TimeQardSettings | null>(null);
  const [cards, setCards] = useState<Map<string, TimeQardCard>>(new Map());
  const [companyName, setCompanyName] = useState("");
  /** 前に書き出したあとに中身が変わったか（まだ書き出していなければ null） */
  const [changed, setChanged] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!db) return;
    try {
      const company = (await db.select("SELECT name FROM company WHERE id = 1")) as { name: string }[];
      const name = company?.[0]?.name ?? "";
      setCompanyName(name);
      setSettings(await loadTimeQardSettings(db));
      setCards(await loadActiveCards(db));
      setChanged(await staffFileChangedSinceExport(db, name));
    } catch (e) {
      console.error(e);
      dialog.error(`TimeQard の設定を読み込めませんでした。\n${e}`);
    }
  }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload();
  }, [reload, staffList]);

  /** 従業員ファイルに入る人（今日、在籍している人と、これから入社する人） */
  const people: CardStaff[] = useMemo(() => {
    const today = jstDate(Date.now());
    return staffInFile(staffList, today)
      .map((s) => ({
        id: String(s.id),
        name: s.name,
        status: s.status ?? "active",
        joinDate: s.join_date ?? "",
        retirementDate: s.retirement_date ?? "",
        card: cards.get(String(s.id)) ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, "ja", { numeric: true }));
  }, [staffList, cards]);

  const withoutCard = people.filter((p) => !p.card);

  const openDownloadPage = async () => {
    try {
      await openUrl(TIMEQARD_DOWNLOAD_URL);
    } catch (e) {
      dialog.error(`ページを開けませんでした。\n${TIMEQARD_DOWNLOAD_URL}\n${e}`);
    }
  };

  const openGuide = async () => {
    try {
      await openUrl(TIMEQARD_GUIDE_URL);
    } catch (e) {
      dialog.error(`ページを開けませんでした。\n${TIMEQARD_GUIDE_URL}\n${e}`);
    }
  };

  /** カードのない人のカードを作る */
  const createMissingCards = async () => {
    if (withoutCard.length === 0) return;
    setBusy(true);
    try {
      await ensureCompanyMark(db);
      const n = await issueCards(db, withoutCard.map((p) => p.id), jstIso(Date.now()));
      await writeLog(db, "INFO", "staff", `TimeQard の打刻カードを作りました（${n}人）`, userName);
      toast.success(`${n}人のカードを作りました。印刷して配り、従業員ファイルを書き出し直してください`);
      setSelected(new Set([...selected, ...withoutCard.map((p) => p.id)]));
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`カードを作れませんでした（何も変えていません）。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  /** カードを作り直す（なくしたときなど） */
  const recreateCard = async (person: CardStaff) => {
    const ok = await ask(
      `${person.name}さん（ID ${person.id}）のカードを作り直しますか？\n\n` +
        `前のカードは、作り直したあとの従業員ファイルを TimeQard に読み込むと使えなくなります。\n` +
        `新しいカードを印刷して、従業員ファイルを書き出し直してください。`,
      { title: "カードを作り直す", kind: "warning", okLabel: "作り直す", cancelLabel: "やめる" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await reissueCard(db, person.id, jstIso(Date.now()));
      await writeLog(db, "INFO", "staff", `TimeQard の打刻カードを作り直しました（ID ${person.id}）`, userName);
      toast.success(`${person.name}さんのカードを作り直しました`);
      setSelected(new Set([...selected, person.id]));
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`カードを作り直せませんでした（何も変えていません）。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(people.filter((p) => p.card).map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  /** 印刷する人（選んだ人のうち、カードがある人） */
  const printTargets = people.filter((p) => p.card && selected.has(p.id));

  const printCards = () => {
    if (printTargets.length === 0) return dialog.warning("印刷する人を選んでください（カードがある人だけ選べます）。");
    window.print();
  };

  /** 従業員ファイルを書き出す */
  const exportStaffFile = async () => {
    setBusy(true);
    try {
      const exportedAt = jstIso(Date.now());
      const file = await makeStaffFile(db, companyName, exportedAt);
      if (file.staff.length === 0) {
        await dialog.warning("従業員ファイルに入れる人がいません（在籍している人か、これから入社する人を登録してください）。");
        return;
      }
      const saved = await saveTextFile(serializeStaffFile(file), staffFileName(companyName, jstDate(Date.now())), {
        name: "TimeQard の従業員ファイル",
        extensions: ["json"],
      });
      if (!saved) return;
      await recordStaffFileExport(db, file);
      const noCard = file.staff.filter((s) => s.cardHashes.length === 0).length;
      await writeLog(db, "INFO", "staff", `TimeQard の従業員ファイルを書き出しました：${saved.name}（${file.staff.length}人・会社の印 ${file.companyMark}）`, userName);
      await dialog.warning(
        `「${saved.name}」を保存しました（${file.staff.length}人${noCard > 0 ? `。カードのない人 ${noCard}人は、ID で押します` : ""}）。\n\n` +
          `USB メモリなどで入口のパソコンに運び、TimeQard の「管理」→「従業員ファイルを読み込む」で読み込んでください。\n\n` +
          `このファイルには従業員の名前が入っています。読み込んだら、USB メモリからは消してください。`,
        "従業員ファイルを書き出しました"
      );
      await reload();
    } catch (e) {
      console.error(e);
      dialog.error(`従業員ファイルを書き出せませんでした。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  return {
    settings,
    companyName,
    changed,
    people,
    withoutCard,
    selected,
    busy,
    printTargets,
    toggle,
    selectAll,
    clearSelection,
    openDownloadPage,
    openGuide,
    createMissingCards,
    recreateCard,
    printCards,
    exportStaffFile,
    reload,
  };
}
