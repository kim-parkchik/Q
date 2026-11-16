/**
 * 休業終了時改定（産前産後休業終了時改定・育児休業等終了時改定）
 * 産休・育休が終わった後3か月の給与で、標準報酬月額が1等級以上変わる人を探し、4か月目の分から履歴に登録する。
 * 判定のきまりは utils/leaveEndRevision.ts
 */
import { useEffect, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import * as Master from "../../constants";
import { useLeaveEndRevisionManager, type LeaveEndRow } from "./useLeaveEndRevisionManager";
import { groupOf } from "../../utils/santei";
import { payRuleText } from "../../utils/remunerationReport";
import { leaveEndForm } from "../../utils/printForms";
import { useShahoFile } from "./useShahoFile";
import { PrintFormSheet } from "./PrintFormSheet";
import { shahoPrintStyle } from "./ShahoFilePanel";
import { LEAVE_END_STATUS_LABELS, LEAVE_TYPE_LABELS } from "../../utils/leaveEndRevision";
import { SANTEI_WORKER_KIND_LABELS, type SanteiWorkerKind } from "../../utils/santei";

interface Props {
  db: Database;
  staffList: any[];
  onDataChange: () => void;
}

const card: React.CSSProperties = { backgroundColor: "white", padding: 20, borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 16 };
const th: React.CSSProperties = { padding: "8px 6px", fontSize: 12, color: "#64748b", borderBottom: "2px solid #eee", textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 13, borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const numInput: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12, textAlign: "right" };
const select: React.CSSProperties = { padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 };
const yen = (n: number | null) => (n === null ? "—" : `${n.toLocaleString()}円`);
const toNumberOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
const md = (date: string) => { const [y, m, d] = date.split("-").map(Number); return `${y}年${m}月${d}日`; };

const STATUS_COLORS: Record<string, string> = {
  target: "#2563eb", same: "#64748b", days: "#64748b", followed: "#64748b", pending: "#b45309", not_enrolled: "#94a3b8",
};

/** 届書の内容を出す行で、画面で入れるもの（申出日・提出日・子の氏名と生年月日） */
interface ReportEdit {
  appliedOn: string;
  submittedOn: string;
  childName: string;
  childBirthday: string;
}
const PRINT_ID = "leave-end-report-print";

export default function LeaveEndRevisionManager({ db, staffList, onDataChange }: Props) {
  const z = useLeaveEndRevisionManager(db, staffList, onDataChange);
  const file = useShahoFile(db);
  // 届書の内容を出す行（本人から申出があった人）
  const [reports, setReports] = useState<Record<string, ReportEdit>>({});
  const [printRequest, setPrintRequest] = useState(0);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);
  const today = dayjs().format("YYYY-MM-DD");
  const startReport = (r: LeaveEndRow) => setReports((prev) => ({
    ...prev,
    [r.key]: prev[r.key] ?? {
      appliedOn: today, submittedOn: today,
      childName: r.leave.type === "childcare" ? r.leave.childName ?? "" : "",
      childBirthday: r.leave.type === "childcare" ? r.leave.childBirthday ?? "" : r.leave.birthDate ?? "",
    },
  }));
  const reportRows = z.rows.filter((r) => reports[r.key]);
  const forms = reportRows.map((r) => {
    const e = reports[r.key];
    const [ry, rm] = r.revisionFrom.split("-").map(Number);
    const master = Master.getInsuranceMaster(ry, rm);
    return {
      row: r,
      form: leaveEndForm({
        staff: r.staff, type: r.leave.type, leaveEnd: r.leave.end, childName: e.childName, childBirthday: e.childBirthday,
        months: r.months, usedIndexes: r.judgement.usedIndexes, average: r.judgement.average, previous: r.previous,
        pensionRange: { min: master.PENSION_MIN_HYOJUN, max: master.PENSION_MAX_HYOJUN }, gradeDiff: r.judgement.gradeDiff,
        revisionFrom: r.revisionFrom, payRule: payRuleText(groupOf(r.staff, z.groups)), short: r.kind === "short", part: r.kind === "part",
        submittedOn: e.submittedOn, appliedOn: e.appliedOn, myNumber: false,
      }),
    };
  });
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2020 + 2 }, (_, i) => 2020 + i);

  return (
    <div style={{ maxWidth: 1250, margin: "0 auto" }}>
      <style>{shahoPrintStyle(PRINT_ID, false)}</style>
      <div style={card} className="no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select value={z.year} onChange={(e) => z.setYear(Number(e.target.value))} style={select}>
            {years.map((y) => <option key={y} value={y}>{y}年に産休・育休が終わった人</option>)}
          </select>
          {z.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>読み込み中…</span>}
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "10px 0 0 0", lineHeight: 1.7 }}>
          従業員画面に入れた産休・育休の期間から、終了日の翌日がこの年にある人を出します。終了日の翌日が属する月から3か月に支払った給与（通勤手当を含む）のうち、
          支払基礎日数が17日以上（短時間労働者は11日以上）の月の平均で判定し、従前の標準報酬月額と1等級以上の差があれば、4か月目の分から改定できます
          （短時間就労者は、3か月とも17日未満なら15日以上の月で平均します）。随時改定と違い、1等級の差でも、固定的賃金が変わっていなくても改定できます。
          <br />この改定は、本人から申出があったときだけ届け出ます（育休は3歳未満の子、産休はその産休に係る子を養育していることが条件）。
          届出は「育児休業等終了時報酬月額変更届」「産前産後休業終了時報酬月額変更届」を速やかに出します。
          あわせて、厚生年金の「養育期間標準報酬月額特例」（3歳未満の子を養育する期間、将来の年金額を下がる前の標準報酬月額で計算する申出）も、「養育期間の特例」タブで確かめてください。
        </p>
      </div>

      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>氏名・働き方</th>
                <th style={th}>休業</th>
                <th style={{ ...th, minWidth: 360 }}>終了日の翌日の月から3か月の給与（日数／報酬）</th>
                <th style={th}>平均</th>
                <th style={th}>従前 → 改定後</th>
                <th style={th}>判定</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {z.rows.length === 0 && !z.isLoading && (
                <tr><td style={{ ...td, color: "#94a3b8" }} colSpan={7}>{z.year}年に産休・育休が終わった人はいません（従業員画面の「休業・休職」に、産前産後休業・育児休業の終了日を入れた人が出ます）</td></tr>
              )}
              {z.rows.map((r) => <LeaveEndTableRow key={r.key} r={r} z={z} onReport={reports[r.key] ? undefined : () => startReport(r)} />)}
            </tbody>
          </table>
        </div>
      </div>

      {forms.length > 0 && (
        <div style={card} id={PRINT_ID}>
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>届書の内容（産前産後休業・育児休業等終了時報酬月額変更届）</b>
            <button onClick={() => setPrintRequest((n) => n + 1)} style={{ padding: "6px 12px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", fontSize: 12, backgroundColor: "#2563eb", cursor: "pointer" }}>印刷する</button>
          </div>
          <p className="no-print" style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px", lineHeight: 1.7 }}>
            この届書は電子申請用のファイルの形がないので、紙の届書に書き写すか、e-Gov の画面で入れます。マイナンバーを書くときは、届書に手で書きます（印刷しません）。
          </p>
          {forms.map(({ row: r, form }) => {
            const e = reports[r.key];
            const set = (patch: Partial<ReportEdit>) => setReports((prev) => ({ ...prev, [r.key]: { ...prev[r.key], ...patch } }));
            return (
              <div key={r.key}>
                <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, marginBottom: 6, alignItems: "center" }}>
                  <label>申出日 <input type="date" value={e.appliedOn} onChange={(ev) => set({ appliedOn: ev.target.value })} style={select} /></label>
                  <label>提出日 <input type="date" value={e.submittedOn} onChange={(ev) => set({ submittedOn: ev.target.value })} style={select} /></label>
                  <label>子の氏名 <input value={e.childName} onChange={(ev) => set({ childName: ev.target.value })} style={select} /></label>
                  <label>子の生年月日 <input type="date" value={e.childBirthday} onChange={(ev) => set({ childBirthday: ev.target.value })} style={select} /></label>
                  <button onClick={() => setReports((prev) => { const next = { ...prev }; delete next[r.key]; return next; })} style={{ fontSize: 12, cursor: "pointer" }}>閉じる</button>
                </div>
                <PrintFormSheet form={form} office={file.office.values} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeaveEndTableRow({ r, z, onReport }: { r: LeaveEndRow; z: ReturnType<typeof useLeaveEndRevisionManager>; onReport?: () => void }) {
  const j = r.judgement;
  const [ry, rm] = r.revisionFrom.split("-").map(Number);
  const canRegister = j.status === "target" && j.standard !== null;

  return (
    <tr>
      <td style={td}>
        <div style={{ fontWeight: "bold" }}>{r.staff.name}</div>
        <select value={r.kind} onChange={(e) => z.setKind(r.key, e.target.value as SanteiWorkerKind)} style={{ ...select, fontSize: 11, padding: "3px 4px", marginTop: 4 }}>
          {(Object.keys(SANTEI_WORKER_KIND_LABELS) as SanteiWorkerKind[]).map((k) => <option key={k} value={k}>{SANTEI_WORKER_KIND_LABELS[k]}</option>)}
        </select>
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {LEAVE_TYPE_LABELS[r.leave.type]}
        <div style={{ fontSize: 11, color: "#64748b" }}>{md(r.leave.start)}〜{md(r.leave.end)}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>終了日の翌日 {md(r.nextDay)}</div>
      </td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6 }}>
          {r.months.map((m, i) => (
            <div key={i} style={{ flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 11, color: j.usedIndexes.includes(i) ? "#2563eb" : "#64748b", marginBottom: 2 }}>
                {m.year}年{m.month}月{j.usedIndexes.includes(i) ? "（平均に使う）" : ""}
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                <input type="number" min={0} value={m.days ?? ""} placeholder="日数"
                  onChange={(e) => z.updateMonth(r.key, i, { days: toNumberOrNull(e.target.value) })} style={{ ...numInput, width: 40 }} />
                <input type="number" min={0} value={m.amount ?? ""} placeholder="報酬"
                  onChange={(e) => z.updateMonth(r.key, i, { amount: toNumberOrNull(e.target.value) })} style={numInput} />
              </div>
            </div>
          ))}
          {r.months.length < 3 && (
            <div style={{ flex: 1, minWidth: 110, fontSize: 11, color: "#64748b" }}>退職した月の後は入れません</div>
          )}
        </div>
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {yen(j.average)}
        {j.method === "part15" && <div style={{ fontSize: 11, color: "#64748b" }}>15日以上の月で平均</div>}
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {yen(r.previous)} → <b>{yen(j.standard)}</b>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {j.previousGrade ?? "—"}等級 → {j.grade ?? "—"}等級
          {j.gradeDiff !== null && `（${j.gradeDiff > 0 ? "+" : ""}${j.gradeDiff}）`}
        </div>
      </td>
      <td style={{ ...td, color: STATUS_COLORS[j.status], fontWeight: j.status === "target" ? "bold" : "normal", maxWidth: 240 }}>
        {LEAVE_END_STATUS_LABELS[j.status]}
        {j.status === "target" && <div style={{ fontSize: 11, fontWeight: "normal" }}>{ry}年{rm}月分から改定（本人の申出があるとき）</div>}
        {r.followedBy && <div style={{ fontSize: 11, fontWeight: "normal" }}>{r.followedBy}</div>}
        {r.registered !== null && <div style={{ fontSize: 11, color: "#16a34a", fontWeight: "normal" }}>登録済み（{yen(r.registered)}）</div>}
      </td>
      <td style={td}>
        {canRegister && (
          <button
            onClick={() => z.register(r)}
            disabled={z.savingKey === r.key}
            style={{ padding: "6px 10px", border: "none", borderRadius: 6, color: "white", fontWeight: "bold", fontSize: 12, backgroundColor: "#2563eb", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {ry}年{rm}月分から登録
          </button>
        )}
        {canRegister && onReport && (
          <button onClick={onReport} style={{ display: "block", marginTop: 6, padding: "5px 8px", border: "1px solid #2563eb", borderRadius: 6, color: "#2563eb", backgroundColor: "white", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            届書の内容を出す
          </button>
        )}
      </td>
    </tr>
  );
}
