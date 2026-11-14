/**
 * 社会保険の届書の電子申請用ファイル（SHFD0006.CSV。賞与支払届・算定基礎届・月額変更届で同じ形）を書き出すための状態
 * 事業所の情報（会社設定の事業所整理記号・事業所番号・所在地など。都道府県は本店の都道府県）・媒体通番（前に書き出した番号の次）・
 * 作成年月日を持ち、データレコードの行からファイルを作って保存する。作り方は utils/shahoCsv.ts
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { saveBinaryFile } from "../../utils/fileSaveUtils";
import { writeLog } from "../../utils/logUtils";
import { buildShahoLines, encodeShahoFile, nextMediaNumber, shahoOfficeValues } from "../../utils/shahoCsv";
import { SHAHO_FILE_NAME } from "../../constants/shahoTodoke";

export function useShahoFile(db: any) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [company, setCompany] = useState<any | null>(null);
  const [headPrefecture, setHeadPrefecture] = useState("");
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
          db.select("SELECT prefecture FROM branches WHERE id = 1") as Promise<{ prefecture: string | null }[]>,
        ]);
        if (cancelled) return;
        setCompany(c?.[0] ?? null);
        setHeadPrefecture(b?.[0]?.prefecture ?? "");
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
   */
  const exportFile = useCallback(async (dataLines: string[], label: string, count: number): Promise<boolean> => {
    const lines = linesFor(dataLines);
    if (!lines || fileProblems.length > 0) {
      dialog.warning(fileProblems.join("\n") || "電子申請用のファイルを作れません");
      return false;
    }
    try {
      const saved = await saveBinaryFile(encodeShahoFile(lines), SHAHO_FILE_NAME, { name: "電子申請用の届書ファイル", extensions: ["CSV", "csv"] });
      if (!saved) return false;
      await db.execute("UPDATE company SET shaho_media_seq = ? WHERE id = 1", [mediaNumber]);
      // 基礎年金番号などの番号は記録に書かない
      await writeLog(db, "INFO", "salary", `${label}（${count}人・媒体通番 ${String(mediaNumber).padStart(3, "0")}）の電子申請用ファイルを書き出しました（${saved.name}）`);
      toast.success(`${label}の電子申請用ファイルを保存しました（${saved.name}）`);
      setReloadKey((k) => k + 1);
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`電子申請用のファイルを書き出せませんでした。\n${e}`);
      return false;
    }
  }, [linesFor, fileProblems, db, mediaNumber, dialog, toast]);

  return {
    company, office, mediaNumber, setMediaNumber, createdOn, setCreatedOn, fileProblems, linesFor, exportFile, loadError,
    reload: () => setReloadKey((k) => k + 1),
  };
}

export type ShahoFile = ReturnType<typeof useShahoFile>;
