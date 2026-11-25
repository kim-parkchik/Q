/**
 * 社会保険の届書の電子申請用ファイル（年金事務所に出す SHFD0006.CSV と、健康保険組合に出す KPFD0006.CSV。
 * 賞与支払届・算定基礎届・月額変更届・資格取得届・資格喪失届・産休と育休の申出書で同じ形）を書き出すための状態
 * 事業所の情報（会社設定の事業所整理記号・事業所番号・所在地など。都道府県は本店の都道府県）・媒体通番（前に書き出した番号の次）・
 * 作成年月日を持ち、データレコードの行からファイルを作って保存する。作り方は utils/shahoCsv.ts
 * 健康保険組合に出すファイルの媒体通番は、組合ごとに社会保険規定に残す（年金事務所の番号とは別に数える）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { useMyNumberFileGuard } from "../mynumber/useMyNumberFileGuard";
import { saveBinaryFile } from "../../utils/fileSaveUtils";
import { writeLog } from "../../utils/logUtils";
import { buildShahoLines, buildUnionShahoLines, encodeShahoFile, nextMediaNumber, shahoOfficeValues, unionOfficeValues } from "../../utils/shahoCsv";
import type { HealthInsurer } from "../../utils/healthInsurer";
import { SHAHO_FILE_NAME, SHAHO_UNION_FILE_NAME } from "../../constants/shahoTodoke";
import { isSeparateShahoOffice, type BranchLike } from "../../utils/branchPrefecture";

export function useShahoFile(db: any) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const guard = useMyNumberFileGuard();
  const [company, setCompany] = useState<any | null>(null);
  const [headPrefecture, setHeadPrefecture] = useState("");
  /** 本店とは別の適用事業所の拠点（社会保険番号が入っている支店）。届書のファイルは本店の事業所で作るので、画面で知らせる */
  const [separateOffices, setSeparateOffices] = useState<BranchLike[]>([]);
  const [mediaNumber, setMediaNumber] = useState(1);
  const [createdOn, setCreatedOn] = useState(dayjs().format("YYYY-MM-DD"));
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const [c, b] = await Promise.all([
          db.select("SELECT * FROM company WHERE id = 1") as Promise<any[]>,
          db.select("SELECT id, name, prefecture, health_ins_num FROM branches ORDER BY id") as Promise<BranchLike[]>,
        ]);
        if (cancelled) return;
        setCompany(c?.[0] ?? null);
        setHeadPrefecture((b ?? []).find((x) => Number(x.id) === 1)?.prefecture ?? "");
        setSeparateOffices((b ?? []).filter(isSeparateShahoOffice));
        setMediaNumber(nextMediaNumber(c?.[0]?.shaho_media_seq));
        setLoadError(null);
      } catch (e) {
        console.error("届書の事業所の情報の読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, reloadKey]);

  const office = useMemo(() => shahoOfficeValues({
    prefecture: headPrefecture,
    symbol: company?.shaho_office_symbol,
    number: company?.shaho_office_number,
    zip: company?.zip_code,
    address: company?.address,
    name: company?.name,
    owner: company?.representative,
    phone: company?.phone,
  }), [company, headPrefecture]);

  /** ファイルを作れない理由のうち、事業所・媒体通番・作成年月日のもの */
  const fileProblems: string[] = [
    ...office.problems.map((p) => `事業所：${p}`),
    ...(!(mediaNumber >= 1 && mediaNumber <= 999) ? ["媒体通番は 1〜999 です"] : []),
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(createdOn) ? ["作成年月日を入れてください"] : []),
  ];

  /** データレコードの行から、ファイルの行（媒体管理レコード・事業所の情報・データ）を作る。作れなければ null */
  const linesFor = useCallback((dataLines: string[]): string[] | null => {
    try {
      return buildShahoLines(office.values, mediaNumber, createdOn, dataLines);
    } catch {
      return null;
    }
  }, [office, mediaNumber, createdOn]);

  /**
   * ファイルを保存する（保存したら、次はこの媒体通番の次の番号にする。999 の次は 1）
   * @param label 記録に書く届書の名前（番号は書かない）
   * @param myNumbers ファイルに書いたマイナンバーの人数（記録には人数だけ書く。あれば、保存する場所を確かめ、保存したあとに知らせる）
   */
  const exportFile = useCallback(async (dataLines: string[], label: string, count: number, myNumbers = 0): Promise<boolean> => {
    const lines = linesFor(dataLines);
    if (!lines || fileProblems.length > 0) {
      dialog.warning(fileProblems.join("\n") || "電子申請用のファイルを作れません");
      return false;
    }
    try {
      const saved = await saveBinaryFile(encodeShahoFile(lines), SHAHO_FILE_NAME, { name: "電子申請用の届書ファイル", extensions: ["CSV", "csv"] }, guard.saveOptions(myNumbers));
      if (!saved) return false;
      await db.execute("UPDATE company SET shaho_media_seq = ? WHERE id = 1", [mediaNumber]);
      // 基礎年金番号などの番号は記録に書かない
      await writeLog(db, "INFO", "salary", `${label}（${count}人・媒体通番 ${String(mediaNumber).padStart(3, "0")}${myNumbers > 0 ? `・マイナンバーあり ${myNumbers}人分` : ""}）の電子申請用ファイルを書き出しました（${saved.name}）`);
      toast.success(`${label}の電子申請用ファイルを保存しました（${saved.name}）`);
      setReloadKey((k) => k + 1);
      // マイナンバーを書いたときは、出し終わったら消すことなどを知らせる（窓を閉じるのを待たずに返し、呼んだ側がマイナンバーの取扱いの記録を先に残す）
      void guard.notice(saved, myNumbers, "pension");
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`電子申請用のファイルを書き出せませんでした。\n${e}`);
      return false;
    }
  }, [linesFor, fileProblems, db, mediaNumber, dialog, toast, guard]);

  /** 健康保険組合に出すファイルを作れない理由（年金事務所の事業所の情報・組合の事業所番号・作成年月日） */
  const unionProblems = useCallback((insurer: HealthInsurer, mediaNo: number): string[] => [
    ...office.problems.map((p) => `事業所：${p}`),
    ...unionOfficeValues(office.values, insurer.officeNumber).problems.map((p) => `${insurer.name}：${p}`),
    ...(!(mediaNo >= 1 && mediaNo <= 999) ? [`${insurer.name}：媒体通番は 1〜999 です`] : []),
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(createdOn) ? ["作成年月日を入れてください"] : []),
  ], [office, createdOn]);

  /** 健康保険組合に出すファイルの行（作れなければ null） */
  const unionLinesFor = useCallback((insurer: HealthInsurer, mediaNo: number, dataLines: string[]): string[] | null => {
    try {
      return buildUnionShahoLines(unionOfficeValues(office.values, insurer.officeNumber).values, mediaNo, createdOn, dataLines);
    } catch {
      return null;
    }
  }, [office, createdOn]);

  /**
   * 健康保険組合に出すファイル（KPFD0006.CSV）を保存する（保存したら、組合の媒体通番を残す）
   * @param myNumbers ファイルに書いたマイナンバーの人数（記録には人数だけ書く。あれば、保存する場所を確かめ、保存したあとに知らせる）
   */
  const exportUnionFile = useCallback(async (
    insurer: HealthInsurer, mediaNo: number, dataLines: string[], label: string, count: number, myNumbers = 0,
  ): Promise<boolean> => {
    const problems = unionProblems(insurer, mediaNo);
    const lines = unionLinesFor(insurer, mediaNo, dataLines);
    if (!lines || problems.length > 0) {
      dialog.warning(problems.join("\n") || "健康保険組合に出すファイルを作れません");
      return false;
    }
    try {
      const saved = await saveBinaryFile(encodeShahoFile(lines), SHAHO_UNION_FILE_NAME, { name: "健康保険組合に出す届書ファイル", extensions: ["CSV", "csv"] }, guard.saveOptions(myNumbers));
      if (!saved) return false;
      await db.execute("UPDATE social_insurance_groups SET union_media_seq = ? WHERE id = ?", [mediaNo, insurer.id]);
      await writeLog(db, "INFO", "salary", `${label}（${insurer.name}・${count}人・媒体通番 ${String(mediaNo).padStart(3, "0")}${myNumbers > 0 ? `・マイナンバーあり ${myNumbers}人分` : ""}）の健康保険組合に出すファイルを書き出しました（${saved.name}）`);
      toast.success(`${insurer.name}に出す${label}のファイルを保存しました（${saved.name}）`);
      // マイナンバーを書いたときの知らせ（待たずに返し、呼んだ側がマイナンバーの取扱いの記録を先に残す）
      void guard.notice(saved, myNumbers, "healthUnion");
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`健康保険組合に出すファイルを書き出せませんでした。\n${e}`);
      return false;
    }
  }, [unionProblems, unionLinesFor, db, dialog, toast, guard]);

  return {
    company, office, mediaNumber, setMediaNumber, createdOn, setCreatedOn, fileProblems, linesFor, exportFile, loadError, separateOffices,
    unionProblems, unionLinesFor, exportUnionFile,
    reload: () => setReloadKey((k) => k + 1),
  };
}

export type ShahoFile = ReturnType<typeof useShahoFile>;
