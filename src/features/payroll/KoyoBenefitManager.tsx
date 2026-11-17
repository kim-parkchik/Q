/**
 * 「雇用保険の給付の書類」の画面：育児休業給付金・出生時育児休業給付金・介護休業給付金・高年齢雇用継続給付金・
 * 育児時短就業給付金の申請に事業主が書く内容（休業開始時賃金月額証明書などの賃金の欄と、支給単位期間・支給対象月ごとの
 * 就業日数・就業時間・支払われた賃金額）を出して印刷する（e-Gov の画面で入れるか、紙の申請書に書き写す）
 * 計算は utils/koyoBenefits.ts・utils/wageCertificate.ts
 */
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { parseLeavePeriods, type LeavePeriod } from "../../utils/leaveExemption";
import { LEAVE_TYPE_NAMES } from "../../utils/leaveOfAbsence";
import {
  buildElderlyBenefit, buildLeaveBenefit, buildShortTimeBenefit, reach60Date, BENEFIT_TITLES, type BenefitData, type BenefitDoc, type BenefitKind,
} from "../../utils/koyoBenefits";
import { groupOfStaff, loadKoyoBase, loadWageData, type KoyoBase, type WageData } from "../../utils/koyoData";
import { koyoPlaceOf } from "../../utils/koyoPlaces";
import { formatWareki } from "../../utils/wareki";
import { md } from "../../utils/wageCertificate";
import { button, card, controls, fieldStyle, input, labelStyle, note, shahoPrintStyle, small, table, td, th, title } from "./ShahoFilePanel";
import { WageCertificateTable } from "./WageCertificateTable";

const PRINT_ID = "koyo-benefit-print";

type Choice = { kind: BenefitKind; leave?: LeavePeriod };

export default function KoyoBenefitManager({ db, staffList }: { db: any; staffList: any[] }) {
  const today = dayjs().format("YYYY-MM-DD");
  const people = useMemo(() => staffList.filter((s) => Number(s.is_employment_ins_eligible ?? 1) === 1), [staffList]);
  const [staffId, setStaffId] = useState<string>("");
  const [base, setBase] = useState<KoyoBase | null>(null);
  const [wage, setWage] = useState<WageData | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [shortStart, setShortStart] = useState("");
  const [shortEnd, setShortEnd] = useState("");
  const [shortChild, setShortChild] = useState("");
  const [elderlyFrom, setElderlyFrom] = useState("");
  const [elderlyTo, setElderlyTo] = useState("");
  const [printRequest, setPrintRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (printRequest > 0) window.print(); }, [printRequest]);
  const staff = people.find((s) => String(s.id) === staffId) ?? null;

  useEffect(() => {
    if (!db) return;
    loadKoyoBase(db).then(setBase).catch((e) => setError(String(e)));
  }, [db]);
  useEffect(() => {
    let cancelled = false;
    setWage(null);
    setChoice(null);
    if (!db || !staff) return;
    const from = dayjs(staff.join_date || "2000-01-01").subtract(1, "day").format("YYYY-MM-DD");
    loadWageData(db, staff, from > dayjs().subtract(6, "year").format("YYYY-MM-DD") ? from : dayjs().subtract(6, "year").format("YYYY-MM-DD"), today)
      .then((d) => { if (!cancelled) setWage(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [db, staff, today]);

  const leaves = useMemo(() => (staff ? parseLeavePeriods(staff.leave_periods).filter((l) => l.type === "childcare" || l.type === "family_care") : []), [staff]);
  const reached60 = staff?.birthday ? reach60Date(staff.birthday) : "";
  const data: BenefitData | null = staff && wage && base ? {
    staff, group: groupOfStaff(staff, base.groups), salaries: wage.salaries, attendance: wage.attendance, isWorkDay: wage.isWorkDay,
    koyoNumber: koyoPlaceOf(base.company, base.branches, staff.branch_id).koyoNumber, today,
  } : null;
  const doc: BenefitDoc | null = useMemo(() => {
    if (!data || !choice) return null;
    if (choice.kind === "elderly") return buildElderlyBenefit(data, elderlyFrom, elderlyTo);
    if (choice.kind === "short_time") return buildShortTimeBenefit(data, shortStart, shortEnd, shortChild);
    return choice.leave ? buildLeaveBenefit(data, choice.leave, choice.kind) : null;
  }, [data, choice, elderlyFrom, elderlyTo, shortStart, shortEnd, shortChild]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{shahoPrintStyle(PRINT_ID, true)}</style>
      <div style={card} className="no-print">
        <h2 style={title}>雇用保険の給付の書類</h2>
        <p style={note}>
          育児休業給付・介護休業給付・高年齢雇用継続給付・育児時短就業給付の申請に、事業主が書く内容を出します。
          休業開始時賃金月額証明書などの賃金の欄は、確定した給与と勤怠から作ります（離職証明書と同じ書き方）。
          支払われた賃金額は、その期間に支払日のある、休業期間の分の賃金です。e-Gov の画面で入れるか、紙の申請書に書き写してください。
        </p>
        <div style={controls}>
          <label style={fieldStyle}>
            <span style={labelStyle}>従業員</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={input}>
              <option value="">（選ぶ）</option>
              {people.map((s) => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
            </select>
          </label>
        </div>
        {error && <div style={{ color: "#b91c1c", fontSize: 12 }}>⚠ 読み込めませんでした：{error}</div>}
        {staff && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {leaves.map((l) => {
              const kinds: BenefitKind[] = l.type === "childcare" ? ["childcare", "papa"] : ["family_care"];
              return kinds.map((k) => (
                <button key={`${k}:${l.start}`} onClick={() => setChoice({ kind: k, leave: l })} style={button(choice?.leave === l && choice.kind === k ? "#2563eb" : "#64748b")}>
                  {k === "papa" ? "出生時育児休業給付金" : k === "childcare" ? "育児休業給付金" : "介護休業給付金"}（{LEAVE_TYPE_NAMES[l.type]} {md(l.start)}〜{l.end ? md(l.end) : ""}）
                </button>
              ));
            })}
            {reached60 && reached60 <= today && (
              <button onClick={() => setChoice({ kind: "elderly" })} style={button(choice?.kind === "elderly" ? "#2563eb" : "#64748b")}>高年齢雇用継続給付（60歳 {formatWareki(reached60)}）</button>
            )}
            <button onClick={() => setChoice({ kind: "short_time" })} style={button(choice?.kind === "short_time" ? "#2563eb" : "#64748b")}>育児時短就業給付</button>
          </div>
        )}
        {staff && leaves.length === 0 && <div style={{ ...small, marginTop: 6 }}>育児休業・介護休業の期間は、従業員の画面の「休業・休職」に入れます。</div>}
        {choice?.kind === "short_time" && (
          <div style={{ ...controls, marginTop: 8 }}>
            <label style={fieldStyle}><span style={labelStyle}>育児時短就業を始めた日</span><input type="date" value={shortStart} onChange={(e) => setShortStart(e.target.value)} style={input} /></label>
            <label style={fieldStyle}><span style={labelStyle}>終えた日（まだなら空）</span><input type="date" value={shortEnd} onChange={(e) => setShortEnd(e.target.value)} style={input} /></label>
            <label style={fieldStyle}><span style={labelStyle}>子の生年月日</span><input type="date" value={shortChild} onChange={(e) => setShortChild(e.target.value)} style={input} /></label>
          </div>
        )}
        {choice?.kind === "elderly" && (
          <div style={{ ...controls, marginTop: 8 }}>
            <label style={fieldStyle}><span style={labelStyle}>支給対象月の初め（空なら60歳に達した月）</span><input type="date" value={elderlyFrom} onChange={(e) => setElderlyFrom(e.target.value)} style={input} /></label>
            <label style={fieldStyle}><span style={labelStyle}>終わり（空なら今月）</span><input type="date" value={elderlyTo} onChange={(e) => setElderlyTo(e.target.value)} style={input} /></label>
          </div>
        )}
      </div>

      {doc && (
        <div style={card} id={PRINT_ID}>
          <div className="no-print" style={{ ...controls, justifyContent: "space-between" }}>
            <h3 style={{ ...title, fontSize: 14, margin: 0 }}>{doc.title}</h3>
            <button onClick={() => setPrintRequest((k) => k + 1)} style={button("#2563eb")}>印刷する</button>
          </div>
          <div style={{ fontSize: 14, fontWeight: "bold", margin: "6px 0" }} className="print-only">{doc.title}（{doc.who}）</div>
          <table style={table}>
            <tbody>
              {doc.items.map((it) => (
                <tr key={it.label}><th style={{ ...th, width: "32%" }}>{it.label}</th><td style={td}>{it.value || <span style={small}>（書く）</span>}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 13, fontWeight: "bold", margin: "12px 0 4px" }}>{doc.unitTitle}ごとの就業日数・就業時間・支払われた賃金額</div>
          <table style={table}>
            <thead>
              <tr><th style={th}>{doc.unitTitle}</th><th style={th}>就業日数</th><th style={th}>就業時間</th><th style={th}>支払われた賃金額</th><th style={th}>知らせ</th></tr>
            </thead>
            <tbody>
              {doc.units.map((u) => (
                <tr key={u.from}>
                  <td style={td}>{formatWareki(u.from)}〜{formatWareki(u.to)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{u.workDays}日</td>
                  <td style={{ ...td, textAlign: "right" }}>{u.workHours}時間</td>
                  <td style={{ ...td, textAlign: "right" }}>{u.paid.toLocaleString()}円</td>
                  <td style={{ ...td, fontSize: 11 }} className="no-print">{u.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.cert && (
            <>
              <div style={{ fontSize: 13, fontWeight: "bold", margin: "12px 0 4px" }}>{doc.certTitle}（{doc.certEnd ? `${formatWareki(doc.certEnd)}までの賃金` : ""}）</div>
              <WageCertificateTable cert={doc.cert} endLabel={doc.kind === "elderly" ? "60歳に達した日" : "休業等を開始した日の前日"} />
            </>
          )}
          {(doc.problems.length > 0 || doc.notes.length > 0) && (
            <div className="no-print" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
              {doc.problems.map((p) => <div key={p} style={{ color: "#b91c1c" }}>・{p}</div>)}
              {doc.notes.map((x) => <div key={x} style={{ color: "#475569" }}>・{x}</div>)}
            </div>
          )}
          <div style={{ ...small, marginTop: 8 }}>
            書き方は、厚生労働省「雇用保険事務手続きの手引き【第３編】育児休業給付・介護休業給付・高年齢雇用継続給付編」による。{BENEFIT_TITLES[doc.kind].title}
          </div>
        </div>
      )}
    </div>
  );
}
