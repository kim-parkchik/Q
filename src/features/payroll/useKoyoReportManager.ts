/**
 * 雇用保険の届書の画面の状態
 * ・資格取得届：選んだ月に雇用保険の資格を取得した（入社した）人
 * ・資格喪失届：選んだ月に離職した（退職した・亡くなった）人。離職票の交付を希望する人と59歳以上の人は、離職証明書を書いた
 *   「離職票交付あり」の形（確定した給与・勤怠から賃金の欄を作る。utils/wageCertificate.ts）
 * ・転勤届：従業員の画面の「転勤」で、雇用保険適用事業所の違う支店に移った日（まだ届け出ていないもの）
 * ・個人番号登録届：マイナンバーを登録してあって、ハローワークにまだ届けていない被保険者
 * ファイルは雇用保険適用事業所ごと・届書ごとに作る（1つのファイルに、違う届書を混ぜない）。ＦＤ通番は会社で1つの通し番号。
 * マイナンバーは useShahoMyNumbers（事務取扱担当者だけ。保存するときだけ番号を読む）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMessageDialog } from "../../components/MessageDialog";
import { useToast } from "../../components/Toast";
import { saveBinaryFile } from "../../utils/fileSaveUtils";
import { writeLog } from "../../utils/logUtils";
import { KOYO_FILE_NAMES, type KoyoForm } from "../../constants/koyoTodoke";
import { buildKoyoLines, koyoOfficeValues, KOYO_FORM_TITLES } from "../../utils/koyoCsv";
import { encodeShahoFile, nextMediaNumber } from "../../utils/shahoCsv";
import { koyoAcquiredOn, parseKoyoInfo, stringifyKoyoInfo, wantsCertificate } from "../../utils/koyoInfo";
import { buildKoyoBango, buildKoyoShutoku, buildKoyoSoshitsu, buildKoyoTenkin, type KoyoRow } from "../../utils/koyoReport";
import { koyoOfficeOf, koyoPlaceOf, koyoPlaces } from "../../utils/koyoPlaces";
import { groupOfStaff, loadKoyoBase, loadWageData, type KoyoBase } from "../../utils/koyoData";
import { buildWageCertificate, type WageCertResult } from "../../utils/wageCertificate";
import { birthdayAt } from "../../utils/calcSalary";
import type { MyNumberUser } from "../mynumber/myNumberStore";
import { useShahoMyNumbers } from "./useShahoMyNumbers";

export type KoyoMode = "shutoku" | "soshitsu" | "tenkin" | "bango";
export const KOYO_MODE_LABELS: Record<KoyoMode, string> = {
  shutoku: "資格取得届", soshitsu: "資格喪失届・離職証明書", tenkin: "転勤届", bango: "個人番号登録届",
};

const ymOf = (date: string) => (date ? date.slice(0, 7) : "");
/** 離職日（死亡日が退職日より前か同じなら死亡日） */
export const koyoLossDateOf = (s: any): string => {
  const death = String(s?.death_date ?? "");
  const retire = String(s?.retirement_date ?? "");
  return death && (!retire || death <= retire) ? death : retire;
};
const eligible = (s: any) => Number(s?.is_employment_ins_eligible ?? 1) === 1;

export function useKoyoReportManager(db: any, staffList: any[], user: MyNumberUser | null) {
  const dialog = useMessageDialog();
  const toast = useToast();
  const my = useShahoMyNumbers(db, user);
  const [mode, setMode] = useState<KoyoMode>("shutoku");
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [base, setBase] = useState<KoyoBase | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mediaNumber, setMediaNumber] = useState(1);
  const [createdOn, setCreatedOn] = useState(dayjs().format("YYYY-MM-DD"));
  const [xmlReturn, setXmlReturn] = useState(false);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [certs, setCerts] = useState<Record<string, WageCertResult>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const today = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db) return;
      try {
        const b = await loadKoyoBase(db);
        if (cancelled) return;
        setBase(b);
        setMediaNumber(nextMediaNumber(b.company.koyo_media_seq));
        setLoadError(null);
      } catch (e) {
        console.error("雇用保険の届書の読み込みエラー:", e);
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [db, reloadKey]);

  const company = base?.company ?? {};
  const branches = base?.branches ?? [];
  const places = useMemo(() => koyoPlaces(company, branches), [company, branches]);
  const placeOf = useCallback((s: any) => koyoPlaceOf(company, branches, s.branch_id), [company, branches]);

  // 離職証明書の賃金の欄（離職票を交付する人だけ。確定した給与・勤怠を読む）
  const soshitsuStaff = useMemo(() => staffList.filter((s) => eligible(s) && ymOf(koyoLossDateOf(s)) === month), [staffList, month]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!db || !base) return;
      const next: Record<string, WageCertResult> = {};
      for (const s of soshitsuStaff) {
        const lossDate = koyoLossDateOf(s);
        if (!wantsCertificate(s, parseKoyoInfo(s.koyo_info), lossDate)) continue;
        try {
          const from = dayjs(lossDate).subtract(4, "year").format("YYYY-MM-DD");
          const data = await loadWageData(db, s, from, lossDate);
          const elderly = !!s.birthday && lossDate >= birthdayAt(s.birthday, 65).subtract(1, "day").format("YYYY-MM-DD");
          next[String(s.id)] = buildWageCertificate({
            endDate: lossDate, acquiredOn: koyoAcquiredOn(s), elderly, staff: s, group: groupOfStaff(s, base.groups),
            salaries: data.salaries, attendance: data.attendance, isWorkDay: data.isWorkDay,
          });
        } catch (e) {
          console.error("離職証明書の賃金を読めませんでした:", e);
        }
      }
      if (!cancelled) setCerts(next);
    })();
    return () => { cancelled = true; };
  }, [db, base, soshitsuStaff]);

  const rows: KoyoRow[] = useMemo(() => {
    if (!base) return [];
    if (mode === "shutoku") {
      return staffList.filter((s) => eligible(s) && ymOf(koyoAcquiredOn(s)) === month).map((s) => buildKoyoShutoku({
        staff: s, place: placeOf(s), myNumber: my.writes(String(s.id)), fixedItems: base.fixedItems[String(s.id)] ?? 0, today,
      }));
    }
    if (mode === "soshitsu") {
      return soshitsuStaff.map((s) => {
        const lossDate = koyoLossDateOf(s);
        const wants = wantsCertificate(s, parseKoyoInfo(s.koyo_info), lossDate);
        const cert = wants ? certs[String(s.id)] ?? { nextDay: "", insured: [], wages: [], fullMonths: 0, fullWageMonths: 0, problems: ["離職証明書の賃金を読んでいます"], notes: [] } : null;
        return buildKoyoSoshitsu({
          staff: s, place: placeOf(s), lossDate, myNumber: my.writes(String(s.id)), cert,
          employer: { name: String(company.name ?? ""), address: String(company.address ?? ""), owner: String(company.representative ?? "") }, today,
        });
      });
    }
    if (mode === "tenkin") {
      return staffList.filter(eligible).flatMap((s) => parseKoyoInfo(s.koyo_info).transfers
        .filter((t) => t.on && !t.reported)
        .map((t) => buildKoyoTenkin({ staff: s, on: t.on, from: koyoPlaceOf(company, branches, t.from), to: koyoPlaceOf(company, branches, t.to), today })));
    }
    // 個人番号登録届：マイナンバーを登録してあって、ハローワークにまだ届けていない被保険者（在籍している人）
    return staffList.filter((s) => eligible(s) && my.registered.has(String(s.id)) && !parseKoyoInfo(s.koyo_info).numberReported
      && !koyoLossDateOf(s) && String(s.employment_ins_num ?? "").trim())
      .map((s) => buildKoyoBango({ staff: s, place: placeOf(s), today }));
  }, [base, mode, staffList, month, placeOf, my.writes, my.registered, soshitsuStaff, certs, company, branches, today]);

  const isIncluded = (r: KoyoRow) => !excluded[r.key];
  const setIncluded = (key: string, include: boolean) => setExcluded((prev) => ({ ...prev, [key]: !include }));

  /** ファイルにまとめる組（雇用保険適用事業所 × 届書） */
  const groups = useMemo(() => {
    const out: { place: typeof places[number]; form: KoyoForm; rows: KoyoRow[]; officeProblems: string[]; officeValues: string[] }[] = [];
    for (const p of places) {
      for (const form of ["shutoku", "soshitsu", "rishoku", "tenkin", "bango"] as KoyoForm[]) {
        const list = rows.filter((r) => r.place === p.key && r.form === form);
        if (list.length === 0) continue;
        const office = koyoOfficeValues(koyoOfficeOf(company, p));
        out.push({ place: p, form, rows: list, officeProblems: office.problems, officeValues: office.values });
      }
    }
    return out;
  }, [places, rows, company]);

  const fileProblems = [
    ...(!(mediaNumber >= 1 && mediaNumber <= 999) ? ["ＦＤ通番は 1〜999 です"] : []),
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(createdOn) ? ["作成年月日を入れてください"] : []),
  ];

  /** 組のファイルを保存する */
  const save = useCallback(async (g: typeof groups[number]) => {
    const target = g.rows.filter(isIncluded);
    const blocked = [
      ...fileProblems, ...g.officeProblems.map((p) => `事業所：${p}`),
      ...target.flatMap((r) => r.problems.map((p) => `${r.name}：${p}`)),
      ...(target.length === 0 ? ["届ける人を選んでください"] : []),
      ...(g.form === "bango" && !my.access ? ["個人番号登録届は、マイナンバーの事務取扱担当者だけが作れます"] : []),
    ];
    if (blocked.length > 0) {
      dialog.warning(blocked.join("\n"));
      return false;
    }
    const resolved = await my.resolve(target.map((r) => ({ staffId: r.staffId, name: r.name, values: r.values })));
    if (!resolved) return false;
    const title = KOYO_FORM_TITLES[g.form];
    try {
      const lines = buildKoyoLines(g.form, g.officeValues, mediaNumber, createdOn, xmlReturn, resolved.lines);
      const saved = await saveBinaryFile(encodeShahoFile(lines), KOYO_FILE_NAMES[g.form], { name: "雇用保険の届書の電子申請用ファイル", extensions: ["csv"] });
      if (!saved) return false;
      await db.execute("UPDATE company SET koyo_media_seq = ? WHERE id = 1", [mediaNumber]);
      // 届け出たことを従業員の雇用保険の情報に残す（次に出す届書を決めるのに使う）
      for (const r of target) {
        const s = staffList.find((x) => String(x.id) === r.staffId);
        if (!s) continue;
        const info = parseKoyoInfo(s.koyo_info);
        if (g.form === "shutoku") {
          info.reported.shutoku = today;
          if (r.myNumber) info.numberReported = true;
        } else if (g.form === "soshitsu" || g.form === "rishoku") {
          info.reported.soshitsu = today;
        } else if (g.form === "tenkin") {
          info.transfers = info.transfers.map((t) => (t.on === r.date && !t.reported ? { ...t, reported: today } : t));
        } else if (g.form === "bango") {
          info.numberReported = true;
          info.reported.bango = today;
        }
        await db.execute("UPDATE staff SET koyo_info = ? WHERE id = ?", [stringifyKoyoInfo(info), s.id]);
      }
      const note = resolved.count > 0 ? `・マイナンバーあり ${resolved.count}人分` : "";
      await writeLog(db, "INFO", "salary", `${title}（${g.place.name}・${target.length}人・ＦＤ通番 ${String(mediaNumber).padStart(3, "0")}${note}）の電子申請用ファイルを書き出しました（${saved.name}）`);
      if (resolved.count > 0) await my.logWritten(title, resolved.count, KOYO_FILE_NAMES[g.form]);
      toast.success(`${title}の電子申請用ファイルを保存しました（${saved.name}）`);
      setReloadKey((k) => k + 1);
      return true;
    } catch (e) {
      console.error(e);
      dialog.error(`電子申請用のファイルを書き出せませんでした。\n${e}`);
      return false;
    }
  }, [fileProblems, my, mediaNumber, createdOn, xmlReturn, db, staffList, today, dialog, toast, excluded]);

  /** ファイルの中身（マイナンバーは「［マイナンバー］」のまま） */
  const preview = useCallback((g: typeof groups[number]): string[] | null => {
    try {
      return buildKoyoLines(g.form, g.officeValues, mediaNumber, createdOn, xmlReturn, g.rows.filter(isIncluded).map((r) => r.values));
    } catch {
      return null;
    }
  }, [mediaNumber, createdOn, xmlReturn, excluded]);

  return {
    mode, setMode, month, setMonth, rows, groups, my, mediaNumber, setMediaNumber, createdOn, setCreatedOn, xmlReturn, setXmlReturn,
    isIncluded, setIncluded, save, preview, fileProblems, loadError, today, company, reload: () => setReloadKey((k) => k + 1),
  };
}
