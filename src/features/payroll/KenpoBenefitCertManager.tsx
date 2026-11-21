/**
 * 「傷病手当金・出産手当金の証明」の画面：健康保険の傷病手当金・出産手当金の支給申請書の「事業主記入用」（事業主が証明するところ）に
 * 書く内容（勤務状況・賃金支給状況・事業所）を、勤怠と確定した給与から出して印刷する（申請書は協会けんぽ・健康保険組合の様式に書き写す）。
 * 作り方は utils/kenpoBenefitCert.ts
 */
import { useEffect, useMemo, useState } from "react";
// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import dayjs from "dayjs";
import { buildBenefitCert, CERT_KIND_LABELS, defaultCertPeriod, type CertAttendance, type CertKind, type CertPayRow, type CertSalary } from "../../utils/kenpoBenefitCert";
import { parseLeavePeriods } from "../../utils/leaveExemption";
import { baseHoursOf, dayScheduledHours } from "../../utils/scheduledHours";
import { parseLedger } from "../../utils/legalBooks";
import { formatWareki } from "../../utils/wareki";
import * as S from "./reportStyles";

interface Props {
  db: Database;
  staffList: any[];
}

interface Loaded {
  attendance: CertAttendance[];
  salaries: CertSalary[];
  leaveProration: string;
  absenceDeduction: string;
}

const PRINT_ID = "kenpo-benefit-cert-print";
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

export default function KenpoBenefitCertManager({ db, staffList }: Props) {
  const [staffId, setStaffId] = useState("");
  const [kind, setKind] = useState<CertKind>("shoubyou");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [certDate, setCertDate] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [company, setCompany] = useState({ name: "", address: "", phone: "", representative: "" });
  /** 行ごとに選び直した印・直した額と期間（行の key ごと） */
  const [edits, setEdits] = useState<Record<string, Partial<CertPayRow>>>({});
  const [manual, setManual] = useState<CertPayRow[]>([]);
  const staff = staffList.find((s) => String(s.id) === staffId) ?? null;
  const periods = useMemo(() => parseLeavePeriods(staff?.leave_periods), [staff]);

  useEffect(() => {
    (async () => {
      try {
        const c = await db.select<any[]>("SELECT name, address, phone, representative FROM company WHERE id = 1");
        setCompany({ name: String(c?.[0]?.name ?? ""), address: String(c?.[0]?.address ?? ""), phone: String(c?.[0]?.phone ?? ""), representative: String(c?.[0]?.representative ?? "") });
      } catch (e) {
        console.error("会社の情報の読み込みエラー:", e);
      }
    })();
  }, [db]);

  // 従業員・種類を選んだら、申請期間の初めの値（休業・休職の期間）
  useEffect(() => {
    const p = defaultCertPeriod(kind, periods);
    setFrom(p?.from ?? "");
    setTo(p?.to ?? "");
    setEdits({});
    setManual([]);
  }, [staffId, kind, periods]);
  useEffect(() => {
    if (!to) return;
    const next = dayjs(to).add(1, "day").format("YYYY-MM-DD");
    const today = dayjs().format("YYYY-MM-DD");
    setCertDate(next > today ? next : today);
  }, [to]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    if (!staff || !from || !to || from > to) return;
    (async () => {
      try {
        // 計算期間は前後にずれるので、申請期間の前後1か月の勤怠と、前後2か月に支給した給与を読む
        const a = await db.select<any[]>(
          `SELECT work_date, work_type, work_hours, paid_leave_hours, special_leave_hours, leave_paid, scheduled_hours FROM attendance
           WHERE staff_id = ? AND work_date BETWEEN ? AND ?`,
          [staff.id, dayjs(from).subtract(1, "month").format("YYYY-MM-DD"), dayjs(to).add(1, "month").format("YYYY-MM-DD")],
        );
        const lo = dayjs(from).subtract(1, "month");
        const hi = dayjs(to).add(2, "month");
        const r = await db.select<any[]>(
          `SELECT target_year, target_month, ledger, prescribed_work_days, leave_paid_days, applied_fixed_overtime FROM salary_results
           WHERE staff_id = ? AND (target_year * 100 + target_month) BETWEEN ? AND ?`,
          [staff.id, lo.year() * 100 + lo.month() + 1, hi.year() * 100 + hi.month() + 1],
        );
        const g = await db.select<any[]>("SELECT leave_proration_method, absence_deduction_method FROM payroll_groups WHERE id = ?", [Number(staff.payroll_group_id) || 1]);
        if (cancelled) return;
        const salaries: CertSalary[] = [];
        for (const x of r ?? []) {
          const ledger = parseLedger(x.ledger);
          if (!ledger?.periodStart || !ledger.periodEnd || ledger.periodEnd < from || ledger.periodStart > to) continue;
          salaries.push({
            periodStart: ledger.periodStart, periodEnd: ledger.periodEnd, ledger,
            prescribedDays: x.prescribed_work_days === null || x.prescribed_work_days === undefined ? null : Number(x.prescribed_work_days),
            leavePaidDays: x.leave_paid_days === null || x.leave_paid_days === undefined ? null : Number(x.leave_paid_days),
            // 固定残業代の月額（払った額と同じなら、休業の日も日割りせずに払った。utils/kenpoBenefitCert.ts）
            fixedOvertimeMonthly: x.applied_fixed_overtime === null || x.applied_fixed_overtime === undefined ? null : Number(x.applied_fixed_overtime),
          });
        }
        setLoaded({
          attendance: (a ?? []).map((x) => ({
            date: String(x.work_date), workType: String(x.work_type ?? ""), workHours: Number(x.work_hours) || 0,
            paidLeaveHours: Number(x.paid_leave_hours) || 0, specialLeaveHours: Number(x.special_leave_hours) || 0, leavePaid: Number(x.leave_paid) === 1,
            // その日の所定労働時間（勤怠で直した時間 → 曜日の時間 → 1日の所定労働時間。utils/scheduledHours.ts）
            scheduledHours: dayScheduledHours(staff, String(x.work_date), x.scheduled_hours),
          })),
          salaries,
          leaveProration: String(g?.[0]?.leave_proration_method ?? "workdays"),
          absenceDeduction: String(g?.[0]?.absence_deduction_method ?? "workdays"),
        });
      } catch (e) {
        console.error("勤怠・給与の読み込みエラー:", e);
        if (!cancelled) setLoaded({ attendance: [], salaries: [], leaveProration: "workdays", absenceDeduction: "workdays" });
      }
    })();
    return () => { cancelled = true; };
  }, [db, staff, from, to]);

  const cert = useMemo(() => (loaded && staff && from && to && from <= to ? buildBenefitCert({
    from, to, wageType: String(staff.wage_type ?? "monthly"), scheduledHours: baseHoursOf(staff) ?? 8,
    ...loaded, leavePeriods: periods,
  }) : null), [loaded, staff, from, to, periods]);

  const rows = useMemo(() => [...(cert?.rows ?? []), ...manual].map((r) => ({ ...r, ...edits[r.key] })), [cert, manual, edits]);
  const chosen = rows.filter((r) => r.checked && r.from && r.to && (r.amount ?? 0) > 0);
  const patch = (key: string, p: Partial<CertPayRow>) => setEdits({ ...edits, [key]: { ...edits[key], ...p } });

  const people = staffList.filter((s) => s.status !== "deleted");
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{S.printStyle(PRINT_ID, false)}</style>
      <div className="no-print" style={S.card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>傷病手当金・出産手当金の証明（事業主記入用）</h3>
        <div style={{ ...S.note, marginBottom: 10 }}>
          健康保険の傷病手当金・出産手当金の支給申請書の「事業主が証明するところ」に書く、申請期間の勤務状況（出勤した日）と賃金支給状況（出勤しなかった日に払った報酬）を、
          勤怠と確定した給与から出します。申請書（協会けんぽ・健康保険組合の様式）に書き写してください。書き方は、協会けんぽ「傷病手当金 支給申請書 記入の手引き」「出産手当金 支給申請書 記入の手引き」によります。
          証明日は、申請期間が過ぎた後の日付にします。出勤簿や賃金台帳の写しは添付しません。
        </div>
        <div style={S.controls}>
          <label style={S.field}>
            <span style={S.label}>従業員</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ ...S.input, minWidth: 180 }}>
              <option value="">選んでください</option>
              {people.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>申請書</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as CertKind)} style={S.input}>
              {(Object.keys(CERT_KIND_LABELS) as CertKind[]).map((k) => <option key={k} value={k}>{CERT_KIND_LABELS[k]}</option>)}
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>申請期間（{kind === "shussan" ? "労務に服さなかった期間" : "労務に服することができなかった期間"}）</span>
            <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.input} />〜
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.input} />
            </span>
          </label>
          <label style={S.field}>
            <span style={S.label}>証明日</span>
            <input type="date" value={certDate} onChange={(e) => setCertDate(e.target.value)} style={S.input} />
          </label>
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} disabled={!cert} style={S.button("#2563eb", !cert)}>🖨 印刷・PDF保存</button>
        </div>
        {staff && !from && <div style={{ ...S.small }}>従業員の画面の休業・休職（{kind === "shussan" ? "産前産後休業" : "その他の休職"}）がないので、申請期間を入れてください。</div>}
      </div>

      {cert && staff && (
        <>
          <div className="no-print" style={S.card}>
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>賃金支給状況（出勤しなかった日に払った報酬）</h3>
            <div style={{ ...S.note, marginBottom: 8 }}>
              有給休暇の賃金、出勤の有無に関わらず払っている手当（通勤手当・扶養手当・住宅手当など）、食事・住居などの現物を書きます。
              残業手当など出勤した日の報酬、見舞金など一時的なもの、社会保険適用促進手当は書きません。印を付けた行（10行まで）を印刷します。額・期間は直せます。
            </div>
            <table style={S.table}>
              <thead><tr>{["書く", "支給した日（期間）", "金額", "何の報酬か"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td style={S.td}><input type="checkbox" checked={!!r.checked} onChange={(e) => patch(r.key, { checked: e.target.checked })} /></td>
                    <td style={S.td}>
                      <input type="date" value={r.from} onChange={(e) => patch(r.key, { from: e.target.value })} style={{ ...S.input, padding: "2px 4px" }} /> 〜{" "}
                      <input type="date" value={r.to} onChange={(e) => patch(r.key, { to: e.target.value })} style={{ ...S.input, padding: "2px 4px" }} />
                    </td>
                    <td style={S.td}>
                      <input value={r.amount === null ? "" : String(r.amount)} placeholder="円"
                        onChange={(e) => { const v = e.target.value.replace(/[,，\s]/g, ""); patch(r.key, { amount: v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)) }); }}
                        style={{ ...S.input, width: 110, textAlign: "right", padding: "2px 4px" }} /> 円
                    </td>
                    <td style={S.td}>{r.label}{r.hint && <div style={{ ...S.small, color: "#b45309" }}>{r.hint}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => setManual([...manual, { key: `manual:${manual.length + 1}`, from, to: from, amount: null, label: "手で足した行", checked: true }])}
              style={{ ...S.button("#64748b"), marginTop: 8, padding: "4px 10px", fontSize: 12 }}
            >
              ＋ 行を足す
            </button>
            {cert.notes.length > 0 && <div style={{ ...S.warnBox, marginTop: 8 }}>{cert.notes.map((n, i) => <div key={i}>・{n}</div>)}</div>}
            {chosen.length > 10 && <div style={{ ...S.errorBox, marginTop: 8 }}>印を付けた行が10行を超えています（申請書を分けます）。</div>}
          </div>

          <div style={S.card}>
            <div id={PRINT_ID}>
              <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>健康保険 {CERT_KIND_LABELS[kind]} 支給申請書（事業主記入用）に書く内容</h2>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                被保険者氏名（カタカナ）：<b>{String(staff.furigana ?? "")}</b>（{staff.name}）　申請期間：{formatWareki(from)}〜{formatWareki(to)}
              </div>
              <div style={{ fontSize: 13, fontWeight: "bold", margin: "8px 0 4px" }}>勤務状況（出勤した日に〇。早退した日は「早」）</div>
              <table style={{ ...S.table, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width: 90 }}>年月</th>
                    {Array.from({ length: 31 }, (_, i) => <th key={i} style={{ ...S.th, textAlign: "center", padding: "2px 0" }}>{i + 1}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cert.months.map((m) => {
                    const last = dayjs(`${m.year}-${String(m.month).padStart(2, "0")}-01`).daysInMonth();
                    const inRange = (d: number) => {
                      const date = `${m.year}-${String(m.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      return d <= last && date >= from && date <= to;
                    };
                    return (
                      <tr key={`${m.year}-${m.month}`}>
                        <td style={S.td}>{formatWareki(`${m.year}-${String(m.month).padStart(2, "0")}-01`).replace(/1日$/, "")}</td>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <td key={d} style={{ ...S.td, textAlign: "center", padding: "2px 0", backgroundColor: inRange(d) ? undefined : "#f1f5f9" }}>
                            {m.worked.includes(d) ? "〇" : ""}
                            {m.short.includes(d) && <div style={{ fontSize: 8, color: "#b45309" }}>早?</div>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ ...S.small, marginTop: 4 }}>
                {cert.months.every((m) => m.worked.length === 0) ? "申請期間に出勤した日はありません（年月だけ書きます）。" : "灰色は申請期間の外の日です。"}
                「早?」は所定労働時間より短い日です。早退なら「早」と書きます（遅刻なら〇だけ）。有給休暇・公休日は書きません。
              </div>
              <div style={{ fontSize: 13, fontWeight: "bold", margin: "12px 0 4px" }}>賃金支給状況（出勤していない日に対して支給した報酬等）</div>
              {chosen.length === 0 ? (
                <div style={{ fontSize: 12 }}>なし（支給していない報酬は、期間や金額（0円）を書きません）</div>
              ) : (
                <table style={{ ...S.table, maxWidth: 560 }}>
                  <tbody>
                    {chosen.slice(0, 10).map((r, i) => (
                      <tr key={r.key}>
                        <td style={{ ...S.td, width: 24 }}>{CIRCLED[i]}</td>
                        <td style={S.td}>{formatWareki(r.from)} から {r.to === r.from ? formatWareki(r.to) : (r.to.slice(0, 4) === r.from.slice(0, 4) ? md(r.to) : formatWareki(r.to))} まで</td>
                        <td style={S.tdNum}>{(r.amount ?? 0).toLocaleString()} 円</td>
                        <td style={{ ...S.td, color: "#64748b", fontSize: 11 }}>{r.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ fontSize: 13, fontWeight: "bold", margin: "12px 0 4px" }}>事業主が証明するところ</div>
              <table style={{ ...S.table, maxWidth: 560 }}>
                <tbody>
                  <tr><td style={{ ...S.td, width: 110 }}>証明日</td><td style={S.td}>{formatWareki(certDate)}</td></tr>
                  <tr><td style={S.td}>事業所所在地</td><td style={S.td}>{company.address}</td></tr>
                  <tr><td style={S.td}>事業所名称</td><td style={S.td}>{company.name}</td></tr>
                  <tr><td style={S.td}>事業主氏名</td><td style={S.td}>{company.representative}</td></tr>
                  <tr><td style={S.td}>電話番号</td><td style={S.td}>{company.phone}</td></tr>
                </tbody>
              </table>
              {certDate && to && certDate <= to && <div style={{ ...S.warnBox, marginTop: 8 }}>証明日は、申請期間が過ぎた後の日付にします。</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
