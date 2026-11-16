/**
 * 被扶養者（異動）届・国民年金第3号被保険者関係届の画面の状態
 * ・従業員の画面の「健康保険の被扶養者」で、届け出ていない人（該当）・でなくなった日を入れた人（非該当）・氏名などを直した人（変更）を、
 *   届書の行にする（協会けんぽの人は被扶養者（異動）届。健康保険組合・国民健康保険組合の人は、第3号被保険者の配偶者だけ3号関係届）
 * ・ファイルを保存したら、届け出た内容を被扶養者に残す（staff.health_dependents の reported）
 * 届書の中身は utils/fuyouReport.ts、ファイルは useShahoFile、マイナンバー（本人と家族）は useShahoMyNumbers
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { writeLog } from "../../utils/logUtils";
import { buildFuyouRow, buildSangoRow, planFuyouRows, type FuyouRow } from "../../utils/fuyouReport";
import { insurerOf, loadHealthInsurers, type HealthInsurer } from "../../utils/healthInsurer";
import { parseHealthDependents, stringifyHealthDependents, suggestFuyouKind, type HealthDependent } from "../../utils/healthDependents";
import { getStandardRemuneration } from "../../utils/standardRemuneration";
import { familyKey } from "../../utils/myNumber";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { useShahoFile } from "./useShahoFile";
import { useShahoMyNumbers } from "./useShahoMyNumbers";

/** 画面で入れるもの（届書の行ごと） */
export interface FuyouEdit {
  include: boolean;
  receivedOn: string;
  employerChecked: boolean;
  /** 被保険者の年間収入の見込み（null は標準報酬月額の12か月分） */
  staffIncome: number | null;
  /** 被扶養者でない配偶者の年間収入（夫婦ともに収入があるとき） */
  spouseIncome: number | null;
}

/** 健康保険組合などに出す被扶養者の届け（このファイルでは作らない。組合の様式で出す） */
export interface UnionDependentItem {
  staff: any;
  insurer: HealthInsurer | null;
  dependent: HealthDependent;
  kind: string;
}

export function useFuyouReportManager(db: any, staffList: any[], user: MyNumberUser | null, onDataChange: () => Promise<void> | void) {
  const dialog = useMessageDialog();
  const file = useShahoFile(db);
  const my = useShahoMyNumbers(db, user);
  const [insurers, setInsurers] = useState<Map<number, HealthInsurer>>(new Map());
  const [edits, setEdits] = useState<Record<string, FuyouEdit>>({});
  const today = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const map = await loadHealthInsurers(db);
        if (!cancelled) setInsurers(map);
      } catch (e) {
        console.error("社会保険規定の読み込みエラー:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [db]);

  /** 被保険者の年間収入の見込みの初めの値（いまの標準報酬月額の12か月分。賞与があれば足して直してもらう） */
  const defaultIncome = useCallback((s: any) => {
    const [y, m] = today.split("-").map(Number);
    const standard = getStandardRemuneration(s, y, m);
    return standard > 0 ? standard * 12 : null;
  }, [today]);

  // 届書の行（従業員ごとに、届け出るものを異動の別ごとにまとめる）
  const plans = useMemo(() => staffList.flatMap((s) => {
    const dependents = parseHealthDependents(s.health_dependents);
    if (dependents.length === 0) return [];
    const type = insurerOf(insurers, s.social_insurance_group_id)?.type ?? "kyokai";
    return planFuyouRows(dependents, type, today).map((p) => ({ staff: s, ...p, key: `${s.id}:${p.form}:${p.kind}:${[p.spouse, ...p.others].filter(Boolean).map((d) => d!.id).join(",")}` }));
  }), [staffList, insurers, today]);

  const editOf = useCallback((key: string): FuyouEdit => edits[key] ?? {
    include: true, receivedOn: today, employerChecked: false, staffIncome: null, spouseIncome: null,
  }, [edits, today]);
  const update = (key: string, patch: Partial<FuyouEdit>) =>
    setEdits((prev) => ({ ...prev, [key]: { ...editOf(key), ...patch } }));

  const rows = useMemo(() => plans.map((p) => {
    const e = editOf(p.key);
    const staffId = String(p.staff.id);
    const input = {
      staff: p.staff, kind: p.kind, spouse: p.spouse, others: p.others, receivedOn: e.receivedOn, employerChecked: e.employerChecked,
      staffIncome: e.staffIncome ?? defaultIncome(p.staff), spouseIncome: e.spouseIncome, myNumber: my.writes(staffId),
      familyMyNumber: (d: HealthDependent) => my.writesFamily(staffId, familyKey(d.name, d.birthday)), today,
    };
    const row: FuyouRow = p.form === "fuyou" ? buildFuyouRow(input, file.office.values, p.key) : buildSangoRow(input, file.office.values, p.key);
    if (p.form === "fuyou" && p.kind === "該当" && e.staffIncome === null && input.staffIncome !== null) {
      row.notes.push(`被保険者の年間収入は、いまの標準報酬月額の12か月分（${input.staffIncome.toLocaleString()}円）を入れています。賞与などの見込みも足して直してください`);
    }
    return { plan: p, edit: e, row };
  }), [plans, editOf, defaultIncome, my.writes, my.writesFamily, today, file.office]);

  // 健康保険組合などの人の、組合に出す被扶養者の届け（このファイルには入れない）
  const unionItems: UnionDependentItem[] = useMemo(() => staffList.flatMap((s) => {
    const insurer = insurerOf(insurers, s.social_insurance_group_id);
    if (!insurer || insurer.type === "kyokai") return [];
    return parseHealthDependents(s.health_dependents)
      .map((d) => ({ staff: s, insurer, dependent: d, kind: suggestFuyouKind(d) ?? "" }))
      .filter((x) => x.kind);
  }), [staffList, insurers]);

  const included = rows.filter((r) => r.edit.include).map((r) => r.row);
  const blocked = [...new Set(included.flatMap((r) => r.problems.map((p) => `${r.name}：${p}`)))];
  if (included.length === 0) blocked.unshift("届ける被扶養者を選んでください");
  const dataLines = included.length > 0 ? included.map((r) => r.values.join(",")) : null;
  const label = "被扶養者（異動）届・国民年金第3号被保険者関係届";

  /** ファイルを保存し、届け出た内容を被扶養者に残す（次に氏名などを直したら、変更の届けを出せるように） */
  const save = useCallback(async () => {
    if (blocked.length > 0) {
      dialog.warning(blocked.join("\n"));
      return;
    }
    const ok = await my.saveFile(file, included.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values, persons: r.persons, personNames: r.personNames })), label, included.length);
    if (!ok) return;
    try {
      for (const staffId of [...new Set(included.map((r) => r.staffId))]) {
        const staff = staffList.find((s) => String(s.id) === staffId);
        const list = parseHealthDependents(staff?.health_dependents);
        const reported = Object.assign({}, ...included.filter((r) => r.staffId === staffId).map((r) => r.reported));
        const next = list.map((d) => (reported[d.id] ? { ...d, reported: reported[d.id] } : d));
        await db.execute("UPDATE staff SET health_dependents = ? WHERE id = ?", [stringifyHealthDependents(next) || null, staffId]);
      }
      await writeLog(db, "INFO", "staff", `${label}で届け出た内容を、被扶養者に残しました（${included.length}件）`);
      setEdits({});
      await onDataChange();
    } catch (e) {
      console.error(e);
      dialog.error(`ファイルは保存しましたが、届け出た内容を被扶養者に残せませんでした。\n${e}`);
    }
  }, [blocked, included, my, file, label, dialog, staffList, db, onDataChange]);

  return { file, my, today, rows, update, unionItems, included, blocked, dataLines, label, save, defaultIncome };
}
