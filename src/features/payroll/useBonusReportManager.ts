/**
 * 「賞与支払届」の画面の状態（健康保険・厚生年金保険 被保険者賞与支払届／70歳以上被用者賞与支払届。utils/bonusReport.ts）
 * 確定した賞与を選ぶと、その賞与を払った人の届書（同じ月の前に払った分も合わせる）を作り、電子申請用のファイル（SHFD0006.CSV）を
 * 書き出す（useShahoFile）。年金機構に登録している賞与支払予定月と、その月に賞与を払ったか（賞与不支給報告書。utils/bonusNonPayment.ts）も持つ
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { writeLog } from "../../utils/logUtils";
import { buildBonusReport, bonusReportDeadline, paymentsForBonus, type BonusPayment } from "../../utils/bonusReport";
import { parseBonusPlanMonths, planMonthStatuses, stringifyBonusPlanMonths } from "../../utils/bonusNonPayment";
import { insurerOf, loadHealthInsurers, type HealthInsurer, type InsurerType } from "../../utils/healthInsurer";
import { useShahoFile } from "./useShahoFile";
import { useShahoMyNumbers } from "./useShahoMyNumbers";
import type { MyNumberUser } from "../mynumber/myNumberStore";

/** 賞与（賞与の画面で作ったもの。finalized：確定した人数） */
export interface BonusSettingRow {
  id: number;
  name: string;
  target_year: number;
  target_month: number;
  payment_date: string | null;
  finalized: number;
}

const PAYMENTS_SQL =
  `SELECT r.bonus_setting_id AS settingId, s.name AS name, s.payment_date AS paymentDate, r.staff_id AS staffId, r.total_earnings AS totalEarnings,
          r.in_kind AS inKind, r.shaho_houshu AS houshu
   FROM bonus_results r JOIN bonus_settings s ON s.id = r.bonus_setting_id`;
// houshu：年4回以上払う賞与で、確定したときに社会保険の報酬として扱った（賞与支払届に書かない。賞与不支給報告書では払っていない月。utils/shoyoHoushu.ts）
const toPayments = (rows: BonusPayment[] | null | undefined): BonusPayment[] =>
  (rows ?? []).map((r) => ({
    ...r, staffId: String(r.staffId), totalEarnings: Number(r.totalEarnings) || 0, inKind: Number(r.inKind) || 0, settingId: Number(r.settingId),
    houshu: Number(r.houshu) === 1,
  }));

export function useBonusReportManager(db: any, user: MyNumberUser | null = null) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const file = useShahoFile(db);
  /** 70歳以上被用者の個人番号（事務取扱担当者が「マイナンバーを書く」にしたとき。保存するときだけ番号を読む） */
  const my = useShahoMyNumbers(db, user);
  const [settings, setSettings] = useState<BonusSettingRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [insurers, setInsurers] = useState<Map<number, HealthInsurer>>(new Map());
  const [payments, setPayments] = useState<BonusPayment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [planYear, setPlanYear] = useState(dayjs().year());
  const [yearPayments, setYearPayments] = useState<BonusPayment[]>([]);

  // 従業員・健康保険の保険者・賞与を読む
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const [s, st, insurers] = await Promise.all([
          db.select("SELECT * FROM staff") as Promise<any[]>,
          db.select(
            `SELECT s.id, s.name, s.target_year, s.target_month, s.payment_date,
                    (SELECT COUNT(*) FROM bonus_results r WHERE r.bonus_setting_id = s.id) AS finalized
             FROM bonus_settings s ORDER BY s.payment_date DESC, s.id DESC`,
          ) as Promise<BonusSettingRow[]>,
          loadHealthInsurers(db),
        ]);
        if (cancelled) return;
        setStaff(s ?? []);
        setSettings(st ?? []);
        setInsurers(insurers);
        setSelectedId((prev) => prev ?? (st ?? []).find((x) => x.payment_date && Number(x.finalized) > 0)?.id ?? null);
        setLoadError(null);
      } catch (e) {
        console.error("賞与支払届に使うものの読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db]);

  const selected = settings.find((s) => s.id === selectedId) ?? null;
  const month = selected?.payment_date ? selected.payment_date.slice(0, 7) : null;

  // 選んだ賞与を払った月に払った、確定した賞与（同じ月の2回目以降も合わせて届け出る）
  useEffect(() => {
    let cancelled = false;
    setPayments(null);
    (async () => {
      if (!db || !month) return;
      try {
        const rows = (await db.select(`${PAYMENTS_SQL} WHERE substr(s.payment_date, 1, 7) = ?`, [month])) as BonusPayment[];
        if (!cancelled) setPayments(toPayments(rows));
      } catch (e) {
        console.error("確定した賞与の読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, month]);

  // 賞与不支給報告書：その年に払った、確定した賞与
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const rows = (await db.select(`${PAYMENTS_SQL} WHERE substr(s.payment_date, 1, 4) = ?`, [String(planYear)])) as BonusPayment[];
        if (!cancelled) setYearPayments(toPayments(rows));
      } catch (e) {
        console.error("その年の確定した賞与の読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, planYear]);

  /** 従業員の健康保険の保険者（協会けんぽ・健康保険組合・国民健康保険組合） */
  const insurerTypeOf = useCallback(
    (s: any): InsurerType => insurerOf(insurers, s?.social_insurance_group_id)?.type ?? "kyokai",
    [insurers],
  );

  // 選んだ賞与を払った人の、同じ月にその支給日までに払った賞与（前に払った分と合わせる）
  const report = useMemo(
    () => (payments && selected?.payment_date
      ? buildBonusReport(staff, paymentsForBonus(payments, selected.id, selected.payment_date), file.office.values, insurerTypeOf,
        (s) => insurerOf(insurers, s?.social_insurance_group_id), my.writes)
      : null),
    [staff, payments, file.office, selected, insurerTypeOf, insurers, my.writes],
  );
  /** 同じ月にこの賞与の支給日までに払う賞与で、まだ確定していないもの（届書に入っていない） */
  const unfinalizedSameMonth = settings.filter((s) =>
    month && s.id !== selected?.id && s.payment_date?.slice(0, 7) === month && s.payment_date <= (selected?.payment_date ?? "") && Number(s.finalized) === 0);
  const deadline = selected?.payment_date ? bonusReportDeadline(selected.payment_date) : null;

  /** 電子申請用のファイルを作れない理由（事業所・媒体通番・作成年月日のものは useShahoFile） */
  const blocked: string[] = [
    ...(!selected ? ["賞与を選んでください"] : []),
    ...(selected && !selected.payment_date ? ["この賞与には支給日がありません（賞与の画面で支給日を入れてください）"] : []),
    ...(selected && Number(selected.finalized) === 0 ? ["この賞与は、まだ確定していません（賞与の画面で確定してください）"] : []),
    ...(report ? report.rows.filter((r) => r.problems.length > 0).map((r) => `${r.name}：${r.problems.join("・")}`) : []),
    ...(report && report.rows.length === 0 && selected && Number(selected.finalized) > 0 ? ["届け出る人がいません"] : []),
  ];
  const label = selected ? `${selected.name}（${selected.payment_date ?? ""}支給）` : "";
  const dataLines = report && report.rows.length > 0 ? report.rows.map((r) => r.values.join(",")) : null;

  // 賞与支払予定月（会社に残す）と、その年の予定月ごとに賞与を払ったか
  const planMonths = parseBonusPlanMonths(file.company?.bonus_plan_months);
  const planStatuses = useMemo(
    () => planMonthStatuses(planYear, planMonths, staff, yearPayments, dayjs().format("YYYY-MM-DD")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planYear, planMonths.join(","), staff, yearPayments],
  );
  const savePlanMonths = useCallback(async (months: number[]) => {
    try {
      const value = stringifyBonusPlanMonths(months);
      await db.execute("UPDATE company SET bonus_plan_months = ? WHERE id = 1", [value || null]);
      await writeLog(db, "INFO", "salary", `賞与支払予定月を「${value ? value.split(",").map((m) => `${Number(m)}月`).join("・") : "なし"}」にしました`);
      toast.success("賞与支払予定月を保存しました");
      file.reload();
    } catch (e) {
      console.error(e);
      dialog.error(`賞与支払予定月を保存できませんでした。\n${e}`);
    }
  }, [db, toast, dialog, file]);

  /** 年金事務所に出すファイルを保存する（70歳以上被用者のマイナンバーを書くときは、鍵を開けて番号を入れる） */
  const save = useCallback(async () => {
    if (!report || !dataLines) return;
    await my.saveFile(file, report.rows.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values })), `賞与支払届 ${label}`, report.rows.length);
  }, [report, dataLines, my, file, label]);

  return {
    my, save,
    file, settings, selected, selectedId, setSelectedId, month, report, payments, unfinalizedSameMonth, deadline,
    blocked, dataLines, label, loadError,
    planMonths, planYear, setPlanYear, planStatuses, savePlanMonths,
    insurers,
    /** 健康保険組合に出すファイルを保存したあと（組合の媒体通番を読み直す） */
    reloadInsurers: async () => setInsurers(await loadHealthInsurers(db)),
  };
}
