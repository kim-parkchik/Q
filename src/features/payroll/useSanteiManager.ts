/**
 * 算定基礎（定時決定）画面の状態とデータ操作
 * 計算のきまりは utils/santei.ts。算定基礎届の電子申請用ファイル・印刷に出す内容は utils/remunerationReport.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { ask } from "@tauri-apps/plugin-dialog";
import * as Master from "../../constants";
import { getPeriodForPayMonth } from "../../utils/payrollPeriod";
import {
  SANTEI_MONTHS, buildSanteiInputs, decideTeiji, gradeOfStandard, groupOf,
  type SalaryRecord, type SanteiInput, type SanteiMonth, type SanteiResult, type SanteiWorkerKind,
} from "../../utils/santei";
import {
  buildAnnualEarlierMonths, decideTeijiAnnual, earlierMonthsOf, type AnnualMonth, type AnnualResult,
} from "../../utils/santeiAnnual";
import {
  latestStandardRemuneration, remunerationFromAt, remunerationHistoryOf, stringifyRemunerationHistory,
} from "../../utils/standardRemuneration";
import { fixedWageChange } from "../../utils/zuiji";
import { insurerOf, loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import { buildSanteiReport, payRuleText, type SanteiReportInput } from "../../utils/remunerationReport";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { useShahoFile } from "./useShahoFile";
import { useShahoMyNumbers } from "./useShahoMyNumbers";
import type { MyNumberUser } from "../mynumber/myNumberStore";

/**
 * 画面で選ぶ値（区分・登録するか・年間平均で申し立てるか・遡って支払った差額・届書の備考）と、
 * 年間平均に使う前年7月〜当年3月の値を足したもの
 */
type RowInput = SanteiInput & {
  kind: SanteiWorkerKind;
  selected: boolean;
  earlierMonths: AnnualMonth[];
  /** 年間報酬の平均で申し立てる（例年の差で、本人が同意している） */
  annualRequested: boolean;
  /** 4〜6月の報酬のうち、3月以前の分を遡って払った差額（月ごと。平均から除き、届書の遡及支払額に書く） */
  retro: Record<number, number>;
  /** 届書の備考欄（画面で直した文。直していなければ null） */
  remarks: string | null;
};

export interface SanteiRow extends RowInput {
  previousGrade: number | null;
  /** 4〜6月の平均で決めた結果（遡って払った差額を除いた報酬で） */
  result: SanteiResult;
  /** 前年7月〜当年6月の平均と比べた結果（utils/santeiAnnual.ts） */
  annual: AnnualResult;
  /** 登録する標準報酬月額（年間平均で申し立てて、2等級以上の差があるときは年間平均で決めた額） */
  decided: { standard: number; grade: number | null; byAnnual: boolean };
}

/** 4月以後なら今年、1〜3月なら前の年の算定を初めに開く */
const defaultYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

/** 遡って払った差額を除いた報酬（平均に使う） */
const withoutRetro = (months: SanteiMonth[], retro: Record<number, number>): SanteiMonth[] =>
  months.map((m) => (retro[m.month] && m.amount !== null ? { ...m, amount: Math.max(0, m.amount - retro[m.month]) } : m));

export function useSanteiManager(db: Database, staffList: any[], onDataChange: () => void, user: MyNumberUser | null = null) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const file = useShahoFile(db);
  /** 70歳以上被用者の個人番号（事務取扱担当者が「マイナンバーを書く」にしたとき。保存するときだけ番号を読む） */
  const my = useShahoMyNumbers(db, user);
  const [year, setYear] = useState(defaultYear());
  const [inputs, setInputs] = useState<RowInput[]>([]);
  const [data, setData] = useState<{ groups: any[]; salaries: SalaryRecord[]; insurers: Map<number, HealthInsurer> }>({ groups: [], salaries: [], insurers: new Map() });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 9月分から使う等級表（協会けんぽの保険料額表）
  const ins = Master.getInsuranceMaster(year, 9);
  const table = ins.HYOJUN_TABLE;

  useEffect(() => {
    const load = async () => {
      if (!db) return;
      setIsLoading(true);
      try {
        const groups = await db.select<any[]>("SELECT * FROM payroll_groups ORDER BY id ASC");
        // 年間平均と比べるため、前年7月〜当年6月に支払った給与を読む（基本給・固定残業代は、届書の昇(降)給月に使う）
        const salaries = await db.select<any[]>(
          // 欠勤控除の額・計算期間の所定労働日数は、月給制の人の支払基礎日数に使う（utils/santei.ts の monthFigures）
          "SELECT staff_id, target_year, target_month, total_earnings, non_remuneration, in_kind, in_kind_detail, absence_deduction, unpaid_leave_deduction, prescribed_work_days, leave_paid_days, " +
          "applied_base_wage, fixed_overtime_allowance FROM salary_results " +
          "WHERE (target_year = ? AND target_month >= 7) OR (target_year = ? AND target_month <= 6)",
          [year - 1, year]
        );
        // 前年7月〜当年6月に支払う給与の計算期間（給与規定グループごとに違う）をすべて含む範囲の、確定した勤怠
        const payMonths = [...earlierMonthsOf(year), ...SANTEI_MONTHS.map((month) => ({ year, month }))];
        const periods = groups.flatMap((g) => payMonths.map((p) => getPeriodForPayMonth(g, p.year, p.month)));
        const from = periods.map((p) => p.startStr).sort()[0];
        const to = periods.map((p) => p.endStr).sort().reverse()[0];
        const attendance = from && to
          ? await db.select<any[]>(
              "SELECT staff_id, work_date, work_type, work_hours, leave_paid FROM attendance WHERE is_finalized = 1 AND work_date BETWEEN ? AND ?",
              [from, to]
            )
          : [];
        const insurers = await loadHealthInsurers(db);
        setData({ groups, salaries, insurers });
        setInputs(buildSanteiInputs(staffList, year, groups, salaries, attendance)
          .map((r) => ({
            ...r, kind: "general", selected: r.exclusion === null, annualRequested: false, retro: {}, remarks: null,
            earlierMonths: buildAnnualEarlierMonths(r.staff, year, groupOf(r.staff, groups), salaries, attendance),
          })));
      } catch (e) {
        console.error("算定基礎の読み込みに失敗しました:", e);
        dialog.error(`算定基礎のデータを読み込めませんでした。\n${e}`);
      } finally {
        setIsLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, staffList, year]);

  const rows: SanteiRow[] = useMemo(
    () => inputs.map((r) => {
      // 遡って払った差額は、平均から除く（届書には、支払った額と遡及支払額を書き、差額を除いた平均を修正平均額に書く）
      const months = withoutRetro(r.months, r.retro);
      const result = decideTeiji(months, r.kind, r.previous, table);
      const annual = decideTeijiAnnual(year, r.earlierMonths, months, r.kind, result, table);
      const byAnnual = r.annualRequested && annual.status === "target";
      return {
        ...r,
        previousGrade: gradeOfStandard(table, r.previous),
        result,
        annual,
        decided: byAnnual
          ? { standard: annual.standard!, grade: annual.grade, byAnnual }
          : { standard: result.standard, grade: result.grade, byAnnual },
      };
    }),
    [inputs, table, year]
  );

  const updateRow = (staffId: string, patch: Partial<Pick<RowInput, "kind" | "selected" | "annualRequested" | "remarks">>) =>
    setInputs((prev) => prev.map((r) => (String(r.staff.id) === String(staffId) ? { ...r, ...patch } : r)));

  /** 支払基礎日数・報酬を手で直す（空にすると、その月は給与を支払っていない扱い） */
  const updateMonth = (staffId: string, month: number, patch: Partial<Pick<SanteiMonth, "days" | "amount" | "partialJoin">>) =>
    setInputs((prev) => prev.map((r) => String(r.staff.id) !== String(staffId) ? r : {
      ...r,
      months: r.months.map((m) => (m.month === month ? { ...m, ...patch } : m)),
    }));

  /** その月に遡って払った差額を入れる（0 は、なし） */
  const updateRetro = (staffId: string, month: number, amount: number) =>
    setInputs((prev) => prev.map((r) => String(r.staff.id) !== String(staffId) ? r : {
      ...r,
      retro: { ...r.retro, [month]: Math.max(0, Math.floor(amount) || 0) },
    }));

  /** 前年7月〜当年3月の支払基礎日数・報酬を手で直す（空にすると、その月は平均に入れない） */
  const updateEarlierMonth = (staffId: string, year: number, month: number, patch: Partial<Pick<AnnualMonth, "days" | "amount" | "partialJoin">>) =>
    setInputs((prev) => prev.map((r) => String(r.staff.id) !== String(staffId) ? r : {
      ...r,
      earlierMonths: r.earlierMonths.map((m) => (m.year === year && m.month === month ? { ...m, ...patch } : m)),
    }));

  const targets = rows.filter((r) => r.exclusion === null);
  const excluded = rows.filter((r) => r.exclusion !== null);
  const selectedRows = targets.filter((r) => r.selected);

  // 算定基礎届：チェックを付けた人（7月改定・8月か9月に月変の予定がある人は、電子申請ではチェックを外して届書から除く）
  const pensionMaster = Master.getInsuranceMaster(year, 8);
  const report = useMemo(() => {
    const inputsForReport: SanteiReportInput[] = selectedRows.map((r) => {
      const group = groupOf(r.staff, data.groups);
      const periods = Object.fromEntries(SANTEI_MONTHS.map((m) => [m, group ? getPeriodForPayMonth(group, year, m) : { startStr: "", endStr: "" }]));
      const change = SANTEI_MONTHS.map((m) => ({ m, c: fixedWageChange(r.staff, year, m, data.salaries) })).find((x) => x.c);
      const retroMonths = SANTEI_MONTHS.filter((m) => (r.retro[m] ?? 0) > 0);
      return {
        staff: r.staff, year, previous: r.previous, previousFrom: remunerationFromAt(r.staff, year, 8),
        months: r.months, kind: r.kind,
        ordinaryAverage: r.result.average,
        annualAverage: r.decided.byAnnual ? r.annual.average : null,
        unfinalizedMonths: r.unfinalizedMonths,
        wageChange: change ? { month: change.m, direction: change.c!.direction } : null,
        retro: retroMonths.length === 1 ? { month: retroMonths[0], amount: r.retro[retroMonths[0]] } : null,
        periods, payRule: payRuleText(group),
        insurerType: insurerOf(data.insurers, r.staff.social_insurance_group_id)?.type ?? "kyokai",
        insurer: insurerOf(data.insurers, r.staff.social_insurance_group_id),
        pensionRange: { min: pensionMaster.PENSION_MIN_HYOJUN, max: pensionMaster.PENSION_MAX_HYOJUN },
        remarks: r.remarks,
        myNumber: my.writes(String(r.staff.id)),
      };
    });
    const built = buildSanteiReport(inputsForReport, file.office.values);
    // 遡及支払額は1つの月だけ書ける
    for (const row of built) {
      const r = selectedRows.find((x) => String(x.staff.id) === row.staffId);
      if (r && SANTEI_MONTHS.filter((m) => (r.retro[m] ?? 0) > 0).length > 1) {
        row.problems.push("遡って払った差額（遡及支払額）は、届書に1つの月だけ書けます（年金事務所に確かめてください）");
      }
    }
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, data, file.office, year, pensionMaster.PENSION_MIN_HYOJUN, pensionMaster.PENSION_MAX_HYOJUN, my.writes]);

  /** 算定基礎届の電子申請用ファイルを保存する（70歳以上被用者のマイナンバーを書くときは、鍵を開けて番号を入れる） */
  const saveReport = () =>
    my.saveFile(file, report.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values })), `算定基礎届（${year}年）`, report.length);

  /** 算定基礎届の電子申請用ファイルを作れない理由 */
  const reportBlocked: string[] = [
    ...(report.length === 0 ? ["届け出る人がいません（登録のチェックを付けた人を届け出ます）"] : []),
    ...report.filter((r) => r.problems.length > 0).map((r) => `${r.name}：${r.problems.join("・")}`),
  ];

  /** 選んだ人の標準報酬月額を、この年の9月分から履歴に登録する（同じ月の分があれば置き換える） */
  const register = async () => {
    if (!db || selectedRows.length === 0) return;
    const annualCount = selectedRows.filter((r) => r.decided.byAnnual).length;
    const ok = await ask(
      `${selectedRows.length}人の標準報酬月額を、${year}年9月分から履歴に登録します。\n` +
      (annualCount > 0 ? `うち${annualCount}人は、年間報酬の平均で決めた額です。\n` : "") +
      `すでに${year}年9月分からの行がある人は、置き換えます。よろしいですか？`,
      { title: "算定基礎の登録", kind: "info" }
    );
    if (!ok) return;
    setIsSaving(true);
    try {
      const from = `${year}-09`;
      for (const r of selectedRows) {
        const history = [
          ...remunerationHistoryOf(r.staff).filter((e) => e.from !== from),
          { from, amount: r.decided.standard, reason: "teiji" as const },
        ];
        await db.execute(
          "UPDATE staff SET standard_remuneration_history = ?, standard_remuneration = ? WHERE id = ?",
          [stringifyRemunerationHistory(history), latestStandardRemuneration(history), r.staff.id]
        );
      }
      toast.success(`${selectedRows.length}人の標準報酬月額を、${year}年9月分から登録しました`);
      onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`登録できませんでした。\n${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    year, setYear, isLoading, isSaving,
    targets, excluded, selectedRows,
    updateRow, updateMonth, updateRetro, updateEarlierMonth, register,
    rateWarnings: ins.WARNINGS,
    file, report, reportBlocked, my, saveReport,
    insurers: data.insurers,
    /** 健康保険組合に出すファイルを保存したあと（組合の媒体通番を読み直す） */
    reloadInsurers: async () => {
      const insurers = await loadHealthInsurers(db);
      setData((d) => ({ ...d, insurers }));
    },
  };
}
