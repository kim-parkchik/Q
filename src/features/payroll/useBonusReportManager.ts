/**
 * 「賞与支払届」の画面の状態（健康保険・厚生年金保険 被保険者賞与支払届／70歳以上被用者賞与支払届。utils/bonusReport.ts）
 * 確定した賞与を選ぶと、その賞与を払った月に払った確定した賞与（同じ月の2回目以降も合わせる）から届書の1人ずつを作り、
 * 電子申請用のファイル（SHFD0006.CSV。e-Gov などに添付する）を書き出す。事業所の情報は会社設定から読む
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { saveBinaryFile } from "../../utils/fileSaveUtils";
import { writeLog } from "../../utils/logUtils";
import { buildBonusReport, bonusReportDeadline, paymentsForBonus, type BonusPayment } from "../../utils/bonusReport";
import { buildShahoLines, encodeShahoFile, nextMediaNumber, shahoOfficeValues } from "../../utils/shahoCsv";
import { SHAHO_FILE_NAME } from "../../constants/shahoTodoke";

/** 賞与（賞与の画面で作ったもの。finalized：確定した人数） */
export interface BonusSettingRow {
  id: number;
  name: string;
  target_year: number;
  target_month: number;
  payment_date: string | null;
  finalized: number;
}

export function useBonusReportManager(db: any) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const [settings, setSettings] = useState<BonusSettingRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [company, setCompany] = useState<any | null>(null);
  const [headPrefecture, setHeadPrefecture] = useState<string>("");
  const [staff, setStaff] = useState<any[]>([]);
  const [payments, setPayments] = useState<BonusPayment[] | null>(null);
  const [mediaNumber, setMediaNumber] = useState(1);
  const [createdOn, setCreatedOn] = useState(dayjs().format("YYYY-MM-DD"));
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 会社・本店の都道府県・従業員・賞与を読む
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const [c, b, s, st] = await Promise.all([
          db.select("SELECT * FROM company WHERE id = 1") as Promise<any[]>,
          db.select("SELECT prefecture FROM branches WHERE id = 1") as Promise<{ prefecture: string | null }[]>,
          db.select("SELECT * FROM staff") as Promise<any[]>,
          db.select(
            `SELECT s.id, s.name, s.target_year, s.target_month, s.payment_date,
                    (SELECT COUNT(*) FROM bonus_results r WHERE r.bonus_setting_id = s.id) AS finalized
             FROM bonus_settings s ORDER BY s.payment_date DESC, s.id DESC`,
          ) as Promise<BonusSettingRow[]>,
        ]);
        if (cancelled) return;
        setCompany(c?.[0] ?? null);
        setHeadPrefecture(b?.[0]?.prefecture ?? "");
        setStaff(s ?? []);
        setSettings(st ?? []);
        setMediaNumber(nextMediaNumber(c?.[0]?.shaho_media_seq));
        setSelectedId((prev) => prev ?? (st ?? []).find((x) => x.payment_date && Number(x.finalized) > 0)?.id ?? null);
        setLoadError(null);
      } catch (e) {
        console.error("賞与支払届に使うものの読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, reloadKey]);

  const selected = settings.find((s) => s.id === selectedId) ?? null;
  const month = selected?.payment_date ? selected.payment_date.slice(0, 7) : null;

  // 選んだ賞与を払った月に払った、確定した賞与（同じ月の2回目以降も合わせて届け出る）
  useEffect(() => {
    let cancelled = false;
    setPayments(null);
    (async () => {
      if (!db || !month) return;
      try {
        const rows = (await db.select(
          `SELECT r.bonus_setting_id AS settingId, s.name AS name, s.payment_date AS paymentDate, r.staff_id AS staffId, r.total_earnings AS totalEarnings
           FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id
           WHERE substr(s.payment_date, 1, 7) = ?`,
          [month],
        )) as BonusPayment[];
        if (!cancelled) {
          setPayments((rows ?? []).map((r) => ({ ...r, staffId: String(r.staffId), totalEarnings: Number(r.totalEarnings) || 0, settingId: Number(r.settingId) })));
        }
      } catch (e) {
        console.error("確定した賞与の読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, month, reloadKey]);

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

  // 選んだ賞与を払った人の、同じ月にその支給日までに払った賞与（前に払った分と合わせる）
  const report = useMemo(
    () => (payments && selected?.payment_date ? buildBonusReport(staff, paymentsForBonus(payments, selected.id, selected.payment_date), office.values) : null),
    [staff, payments, office, selected],
  );
  /** 同じ月にこの賞与の支給日までに払う賞与で、まだ確定していないもの（届書に入っていない） */
  const unfinalizedSameMonth = settings.filter((s) =>
    month && s.id !== selected?.id && s.payment_date?.slice(0, 7) === month && s.payment_date <= (selected?.payment_date ?? "") && Number(s.finalized) === 0);
  const deadline = selected?.payment_date ? bonusReportDeadline(selected.payment_date) : null;

  /** 電子申請用のファイルを作れない理由（なければ空） */
  const blocked: string[] = [
    ...(!selected ? ["賞与を選んでください"] : []),
    ...(selected && !selected.payment_date ? ["この賞与には支給日がありません（賞与の画面で支給日を入れてください）"] : []),
    ...(selected && Number(selected.finalized) === 0 ? ["この賞与は、まだ確定していません（賞与の画面で確定してください）"] : []),
    ...office.problems.map((p) => `事業所：${p}`),
    ...(report ? report.rows.filter((r) => r.problems.length > 0).map((r) => `${r.name}：${r.problems.join("・")}`) : []),
    ...(report && report.rows.length === 0 && selected && Number(selected.finalized) > 0 ? ["届け出る人がいません"] : []),
    ...(!(mediaNumber >= 1 && mediaNumber <= 999) ? ["媒体通番は 1〜999 です"] : []),
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(createdOn) ? ["作成年月日を入れてください"] : []),
  ];

  const label = selected ? `${selected.name}（${selected.payment_date ?? ""}支給）` : "";

  /** ファイルの中身（直すところがなければ。画面で確かめる） */
  const fileLines = useMemo(() => {
    if (!report || blocked.length > 0) return null;
    try {
      return buildShahoLines(office.values, mediaNumber, createdOn, report.rows.map((r) => r.values.join(",")));
    } catch {
      return null;
    }
  }, [report, blocked.length, office, mediaNumber, createdOn]);

  const exportFile = useCallback(async () => {
    if (!report || !fileLines || blocked.length > 0) return dialog.warning(blocked.join("\n"));
    try {
      const bytes = encodeShahoFile(fileLines);
      const saved = await saveBinaryFile(bytes, SHAHO_FILE_NAME, { name: "電子申請用の届書ファイル", extensions: ["CSV", "csv"] });
      if (!saved) return;
      // 次は、この媒体通番の次の番号にする（999 の次は 1）
      await db.execute("UPDATE company SET shaho_media_seq = ? WHERE id = 1", [mediaNumber]);
      // 基礎年金番号などの番号はログに書かない
      await writeLog(db, "INFO", "salary", `賞与支払届（${label}・${report.rows.length}人・媒体通番 ${String(mediaNumber).padStart(3, "0")}）の電子申請用ファイルを書き出しました（${saved.name}）`);
      toast.success(`賞与支払届の電子申請用ファイルを保存しました（${saved.name}）`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      console.error(e);
      dialog.error(`電子申請用のファイルを書き出せませんでした。\n${e}`);
    }
  }, [report, fileLines, blocked, mediaNumber, db, label, dialog, toast]);

  return {
    settings, selected, selectedId, setSelectedId, month, office, report, payments, unfinalizedSameMonth, deadline,
    mediaNumber, setMediaNumber, createdOn, setCreatedOn, blocked, exportFile, loadError, company, label, fileLines,
  };
}
