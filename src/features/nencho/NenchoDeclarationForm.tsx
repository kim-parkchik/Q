/**
 * 年末調整：申告書の内容を入れる欄
 * （扶養控除等申告書・基礎控除申告書・配偶者控除等申告書・保険料控除申告書・住宅借入金等特別控除申告書・前の勤め先の源泉徴収票）
 * sourceOnly：年末調整をしない人の扶養控除等申告書（本人・配偶者・扶養親族）だけ。源泉徴収票の配偶者・扶養親族の欄に書く（utils/withholdingSlip.ts）
 *   年末調整の表がない、手引が出る前の年分（令和9年分）は、これだけを入れられる（区分は前の年分の手引の書き方。getProvisionalSlipMaster）
 * secondary：乙欄の人の従たる給与についての扶養控除等申告書（配偶者・扶養親族だけ。所得税法195条）
 */
import { Plus, Trash2 } from "lucide-react";
import { getProvisionalSlipMaster, getWithholdingSlipMaster, type NenchoMaster } from "../../constants/nencho";
import {
  DEPENDENT_KIND_LABELS, ageAtYearEnd, classifyDependent,
  type DeclaredDependent, type DisabilityKind, type DependentKind, type HousingLoan, type NenchoDeclaration, type YearTotals,
} from "../../utils/nenchoDeclaration";
import { specificRelativeDeduction } from "../../utils/nencho";
import { classifySourceDependent, housingLoanKindDescription } from "../../utils/withholdingSlip";

interface Props {
  year: number;
  /** 年末調整の表（ない年分は null。そのときは sourceOnly・secondary だけで使う） */
  master: NenchoMaster | null;
  draft: NenchoDeclaration;
  setDraft: (d: NenchoDeclaration) => void;
  totals: YearTotals;
  /** 年末調整をしない人の扶養控除等申告書だけを入れる */
  sourceOnly?: boolean;
  /** 乙欄の人の、従たる給与についての扶養控除等申告書（本人の欄はない） */
  secondary?: boolean;
}

const section: React.CSSProperties = { borderTop: "1px solid #e2e8f0", paddingTop: 12, marginTop: 12 };
const h: React.CSSProperties = { fontSize: 13, fontWeight: "bold", color: "#334155", margin: "0 0 8px 0" };
const label: React.CSSProperties = { fontSize: 11, color: "#64748b", display: "block", marginBottom: 2 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 };
const grid = (cols: number): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 });
const note: React.CSSProperties = { fontSize: 11, color: "#64748b", margin: "6px 0 0 0", lineHeight: 1.6 };
const yen = (n: number) => `${n.toLocaleString()}円`;

function NumField({ title, value, onChange }: { title: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label style={label}>{title}</label>
      <input type="number" min={0} value={value || ""} placeholder="0" onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        style={{ ...input, textAlign: "right" }} />
    </div>
  );
}

function DisabilitySelect({ value, onChange }: { value: DisabilityKind; onChange: (v: DisabilityKind) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as DisabilityKind)} style={input}>
      <option value="none">障害なし</option>
      <option value="general">一般の障害者</option>
      <option value="special">特別障害者</option>
    </select>
  );
}

/** 扶養親族の区分ごとの控除額（表示用） */
const kindAmount = (kind: DependentKind, d: DeclaredDependent, m: NenchoMaster): number | null => {
  switch (kind) {
    case "general": return m.deductions.dependentGeneral;
    case "specific": return m.deductions.dependentSpecific;
    case "elderlyTogether": return m.deductions.dependentElderlyLivingTogether;
    case "elderlyOther": return m.deductions.dependentElderlyOther;
    case "specificRelative": return specificRelativeDeduction([Number(d.totalIncome) || 0], m);
    default: return null;
  }
};

export default function NenchoDeclarationForm({ year, master, draft, setDraft, totals, sourceOnly: sourceOnlyProp = false, secondary = false }: Props) {
  const sourceOnly = sourceOnlyProp || secondary;
  const set = (patch: Partial<NenchoDeclaration>) => setDraft({ ...draft, ...patch });
  const setSelf = (patch: Partial<NenchoDeclaration["self"]>) => set({ self: { ...draft.self, ...patch } });
  const setIns = (patch: Partial<NenchoDeclaration["insurance"]>) => set({ insurance: { ...draft.insurance, ...patch } });
  const setPrev = (patch: Partial<NenchoDeclaration["previousJob"]>) => set({ previousJob: { ...draft.previousJob, ...patch } });
  const setDependent = (i: number, patch: Partial<DeclaredDependent>) =>
    set({ dependents: draft.dependents.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  const setLoan = (i: number, patch: Partial<HousingLoan>) =>
    set({ housingLoans: draft.housingLoans.map((h, k) => (k === i ? { ...h, ...patch } : h)) });
  // 手引から作った区分（手引が出る前の年分は、前の年分の手引の書き方）
  const slipMaster = getWithholdingSlipMaster(year) ?? getProvisionalSlipMaster(year);
  const housingLoanKinds = slipMaster?.housingLoanKinds ?? [];
  const w = slipMaster?.withoutAdjustment;
  /** 扶養親族の分け方（年末調整をしない人は、源泉控除対象親族かどうか） */
  const kindOf = (d: DeclaredDependent): DependentKind =>
    sourceOnly && slipMaster ? classifySourceDependent(d, year, slipMaster) : master ? classifyDependent(d, year, master) : "none";
  const missingMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter((mo) => !totals.salaryMonths.includes(mo));
  const reiwa = year - 2018;

  return (
    <div>
      {/* 1年分の給与 */}
      {!sourceOnly && <div>
        <p style={h}>{year}年に支払った給与・賞与（Q で確定したもの）</p>
        <div style={{ ...grid(3), fontSize: 13 }}>
          <div><span style={label}>給与・賞与の総額</span><b>{yen(totals.salary)}</b></div>
          <div><span style={label}>社会保険料等</span><b>{yen(totals.socialInsurance)}</b></div>
          <div><span style={label}>源泉徴収した税額</span><b>{yen(totals.withheldTax)}</b></div>
        </div>
        <p style={note}>
          給与 {totals.salaryMonths.length}か月分（{totals.salaryMonths.length > 0 ? totals.salaryMonths.join("・") + "月" : "なし"}）、賞与 {totals.bonusCount}回。
          給与は非課税の通勤手当を除いた額です。
        </p>
        {missingMonths.length > 0 && (
          <p style={{ ...note, color: "#b45309" }}>
            ※ {missingMonths.join("・")}月に支払う給与がまだ確定していません（入社前の月なら問題ありません）。年末調整は、その年最後の給与を確定してから行います。
          </p>
        )}
        <p style={{ ...h, marginTop: 10, fontSize: 12 }}>前の勤め先の給与（{year}年に転職した人。前の勤め先の源泉徴収票の金額）</p>
        <div style={grid(3)}>
          <NumField title="支払金額" value={draft.previousJob.salary} onChange={(v) => setPrev({ salary: v })} />
          <NumField title="社会保険料等の金額" value={draft.previousJob.socialInsurance} onChange={(v) => setPrev({ socialInsurance: v })} />
          <NumField title="源泉徴収税額" value={draft.previousJob.withheldTax} onChange={(v) => setPrev({ withheldTax: v })} />
        </div>
        {draft.previousJob.salary > 0 && (
          <div style={{ ...grid(3), marginTop: 8 }}>
            <div><label style={label}>前の勤め先の名称</label><input value={draft.previousJob.payerName} onChange={(e) => setPrev({ payerName: e.target.value })} style={input} /></div>
            <div><label style={label}>前の勤め先の所在地</label><input value={draft.previousJob.payerAddress} onChange={(e) => setPrev({ payerAddress: e.target.value })} style={input} /></div>
            <div><label style={label}>前の勤め先を退職した日</label><input type="date" value={draft.previousJob.retiredOn} onChange={(e) => setPrev({ retiredOn: e.target.value })} style={input} /></div>
          </div>
        )}
        {draft.previousJob.salary > 0 && <p style={note}>名称・所在地・退職日は、源泉徴収票の摘要欄に書きます。</p>}
      </div>}

      {/* 本人 */}
      {!secondary && <div style={sourceOnly ? undefined : section}>
        <p style={h}>本人（扶養控除等申告書{sourceOnly ? "" : "・基礎控除申告書"}）</p>
        <div style={grid(4)}>
          <div><label style={label}>障害者</label><DisabilitySelect value={draft.self.disability} onChange={(v) => setSelf({ disability: v })} /></div>
          <div>
            <label style={label}>寡婦・ひとり親</label>
            <select
              value={draft.self.widow ? "widow" : draft.self.singleParent ? "single" : "none"}
              onChange={(e) => setSelf({ widow: e.target.value === "widow", singleParent: e.target.value === "single" })}
              style={input}
            >
              <option value="none">該当しない</option>
              <option value="widow">寡婦</option>
              <option value="single">ひとり親</option>
            </select>
          </div>
          <div>
            <label style={label}>勤労学生</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingTop: 6 }}>
              <input type="checkbox" checked={draft.self.workingStudent} onChange={(e) => setSelf({ workingStudent: e.target.checked })} />
              該当する
            </label>
          </div>
          {!sourceOnly && <NumField title="給与所得以外の所得の合計" value={draft.self.otherIncome} onChange={(v) => setSelf({ otherIncome: v })} />}
        </div>
      </div>}

      {/* 配偶者 */}
      <div style={secondary ? undefined : section}>
        <p style={h}>配偶者（{secondary ? "従たる給与についての扶養控除等申告書の源泉控除対象配偶者" : sourceOnly ? "扶養控除等申告書の源泉控除対象配偶者" : "配偶者控除等申告書・扶養控除等申告書"}）</p>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={draft.spouse !== null}
            onChange={(e) => set({ spouse: e.target.checked ? { name: "", birthday: "", totalIncome: 0, disability: "none", livingTogether: true } : null })}
          />
          {secondary ? "源泉控除対象配偶者を、この給与で控除する" : sourceOnly ? "源泉控除対象配偶者がいる（または同一生計配偶者が障害者）" : "配偶者控除・配偶者特別控除を受ける（または同一生計配偶者が障害者）"}
        </label>
        {draft.spouse && (
          <div style={{ ...grid(6), marginTop: 8 }}>
            <div><label style={label}>氏名</label><input value={draft.spouse.name} onChange={(e) => set({ spouse: { ...draft.spouse!, name: e.target.value } })} style={input} /></div>
            <div><label style={label}>フリガナ</label><input value={draft.spouse.furigana ?? ""} onChange={(e) => set({ spouse: { ...draft.spouse!, furigana: e.target.value } })} style={input} /></div>
            <div><label style={label}>生年月日</label><input type="date" value={draft.spouse.birthday} onChange={(e) => set({ spouse: { ...draft.spouse!, birthday: e.target.value } })} style={input} /></div>
            <NumField title="合計所得金額（見積額）" value={draft.spouse.totalIncome} onChange={(v) => set({ spouse: { ...draft.spouse!, totalIncome: v } })} />
            <div><label style={label}>障害者</label><DisabilitySelect value={draft.spouse.disability} onChange={(v) => set({ spouse: { ...draft.spouse!, disability: v } })} /></div>
            <div>
              <label style={label}>同居</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingTop: 6 }}>
                <input type="checkbox" checked={draft.spouse.livingTogether} onChange={(e) => set({ spouse: { ...draft.spouse!, livingTogether: e.target.checked } })} />
                同居している
              </label>
            </div>
          </div>
        )}
        {draft.spouse && (ageAtYearEnd(draft.spouse.birthday, year) ?? 0) >= 70 && (
          <p style={note}>{year}年12月31日に70歳以上なので、老人控除対象配偶者です。</p>
        )}
        {sourceOnly && w && draft.spouse && draft.spouse.totalIncome > w.spouseIncomeLimit && (
          <p style={{ ...note, color: "#b45309" }}>所得の見積額が{yen(w.spouseIncomeLimit)}を超えるので、源泉控除対象配偶者にはなりません。</p>
        )}
      </div>

      {/* 扶養親族 */}
      <div style={section}>
        <p style={h}>扶養親族・特定親族（{secondary ? "従たる給与についての扶養控除等申告書" : sourceOnly ? "扶養控除等申告書" : "扶養控除等申告書・特定親族特別控除申告書"}）</p>
        {draft.dependents.map((d, i) => {
          const kind = kindOf(d);
          const amount = sourceOnly || !master ? null : kindAmount(kind, d, master);
          const age = ageAtYearEnd(d.birthday, year);
          return (
            <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, marginBottom: 8 }}>
              <div style={{ ...grid(5) }}>
                <div><label style={label}>氏名</label><input value={d.name} onChange={(e) => setDependent(i, { name: e.target.value })} style={input} /></div>
                <div><label style={label}>フリガナ</label><input value={d.furigana ?? ""} onChange={(e) => setDependent(i, { furigana: e.target.value })} style={input} /></div>
                <div><label style={label}>続柄</label><input value={d.relation} placeholder="子・父・母など" onChange={(e) => setDependent(i, { relation: e.target.value })} style={input} /></div>
                <div><label style={label}>生年月日</label><input type="date" value={d.birthday} onChange={(e) => setDependent(i, { birthday: e.target.value })} style={input} /></div>
                <NumField title="合計所得金額（見積額）" value={d.totalIncome} onChange={(v) => setDependent(i, { totalIncome: v })} />
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                <div style={{ width: 150 }}><label style={label}>障害者</label><DisabilitySelect value={d.disability} onChange={(v) => setDependent(i, { disability: v })} /></div>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  <input type="checkbox" checked={d.livingTogether} onChange={(e) => setDependent(i, { livingTogether: e.target.checked })} />同居
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                  <input type="checkbox" checked={d.linealAscendant} onChange={(e) => setDependent(i, { linealAscendant: e.target.checked })} />本人・配偶者の父母・祖父母
                </label>
                <div style={{ flex: 1, fontSize: 12, color: kind === "none" ? "#b45309" : "#2563eb", textAlign: "right" }}>
                  {age !== null && `${year}年12月31日に${age}歳：`}{sourceOnly && kind === "specificRelative" ? "特定親族（源泉控除対象親族）" : DEPENDENT_KIND_LABELS[kind]}{amount !== null && ` ${yen(amount)}`}
                </div>
                <button
                  type="button" title="この人を消す"
                  onClick={() => set({ dependents: draft.dependents.filter((_, k) => k !== i) })}
                  style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: 6, cursor: "pointer", color: "#94a3b8" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => set({ dependents: [...draft.dependents, { name: "", relation: "", birthday: "", totalIncome: 0, disability: "none", livingTogether: true, linealAscendant: false }] })}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px dashed #cbd5e1", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#475569" }}
        >
          <Plus size={14} /> 扶養親族を追加
        </button>
        {sourceOnly && w ? (
          <p style={note}>
            {secondary
              ? "この給与で控除する源泉控除対象親族を入れてください（16歳未満の子は、従たる給与の申告書には書かないので、入れても源泉徴収票には書きません）。"
              : "16歳未満の子も入れてください（源泉徴収票の16歳未満の扶養親族の欄に書きます）。"}
            区分は{year}年12月31日の年齢と所得の見積額で決まります。
            {w.earlierIncomeLimit !== w.currentIncomeLimit
              ? `年末調整をしない人は、${year}年${w.earlierUntil.replace("-", "月").replace(/^0/, "")}日以前に出された申告書の線で読み、`
              : "年末調整をしない人も、"}
            扶養親族の所得要件は{yen(w.earlierIncomeLimit)}以下、特定親族は見積額が{yen(w.specificRelativeLimit)}以下の人だけ書きます
            （国税庁「法定調書の作成と提出の手引」 源泉徴収票の記載要領
            {slipMaster?.provisional && `。令和${reiwa}年分の手引が出るまでは、令和${slipMaster.provisional.basedOn - 2018}年分の手引の書き方`}）。
          </p>
        ) : (
          <p style={note}>
            16歳未満の子（年少扶養親族）も入れてください（障害者控除・所得金額調整控除・生命保険料控除の特例の判定に使います）。
            区分は{year}年12月31日の年齢と合計所得金額で決まります
            {master && `（令和${reiwa}年分の扶養親族の所得要件は${yen(master.spouse.spouseIncomeLimit)}以下）`}。
          </p>
        )}
      </div>

      {!sourceOnly && <>

      {/* 保険料 */}
      <div style={section}>
        <p style={h}>保険料（保険料控除申告書。{year}年中に支払った金額）</p>
        <div style={grid(5)}>
          <NumField title="一般・新生命保険料" value={draft.insurance.lifeGeneralNew} onChange={(v) => setIns({ lifeGeneralNew: v })} />
          <NumField title="一般・旧生命保険料" value={draft.insurance.lifeGeneralOld} onChange={(v) => setIns({ lifeGeneralOld: v })} />
          <NumField title="介護医療保険料" value={draft.insurance.lifeMedical} onChange={(v) => setIns({ lifeMedical: v })} />
          <NumField title="新個人年金保険料" value={draft.insurance.lifePensionNew} onChange={(v) => setIns({ lifePensionNew: v })} />
          <NumField title="旧個人年金保険料" value={draft.insurance.lifePensionOld} onChange={(v) => setIns({ lifePensionOld: v })} />
        </div>
        <div style={{ ...grid(5), marginTop: 8 }}>
          <NumField title="地震保険料" value={draft.insurance.earthquake} onChange={(v) => setIns({ earthquake: v })} />
          <NumField title="旧長期損害保険料" value={draft.insurance.oldLongTerm} onChange={(v) => setIns({ oldLongTerm: v })} />
          <NumField title="社会保険料（申告分）" value={draft.insurance.socialInsurance} onChange={(v) => setIns({ socialInsurance: v })} />
          <NumField title="うち国民年金保険料等" value={draft.insurance.nationalPension} onChange={(v) => setIns({ nationalPension: v })} />
          <NumField title="小規模企業共済等掛金" value={draft.insurance.smallBusinessMutualAid} onChange={(v) => setIns({ smallBusinessMutualAid: v })} />
        </div>
        <p style={note}>
          新は平成24年1月1日以後、旧は平成23年12月31日以前に結んだ契約です。社会保険料（申告分）は、国民年金・国民健康保険など給与から引いていないものです。
          そのうち国民年金の保険料・国民年金基金の掛金は「うち国民年金保険料等」にも入れてください（源泉徴収票に書きます）。
        </p>
      </div>

      {/* 住宅ローン */}
      <div style={section}>
        <p style={h}>住宅借入金等特別控除（住宅借入金等特別控除申告書）</p>
        <div style={{ maxWidth: 240 }}>
          <NumField title="控除額（申告書で計算した金額）" value={draft.housingLoanCredit} onChange={(v) => set({ housingLoanCredit: v })} />
        </div>
        {draft.housingLoanCredit > 0 && (
          <div style={{ marginTop: 8 }}>
            {draft.housingLoans.map((h, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 160px auto", gap: 8, alignItems: "end", marginBottom: 6 }}>
                <div><label style={label}>{i + 1}つ目：居住開始年月日</label><input type="date" value={h.residenceStart} onChange={(e) => setLoan(i, { residenceStart: e.target.value })} style={input} /></div>
                <div>
                  <label style={label}>住宅借入金等特別控除区分</label>
                  <select value={h.kindCode} onChange={(e) => setLoan(i, { kindCode: e.target.value })} style={input}>
                    <option value="">選んでください</option>
                    {housingLoanKinds.map((k) => <option key={k.code} value={k.code}>{housingLoanKindDescription(k.label)}</option>)}
                  </select>
                </div>
                <NumField title="住宅借入金等年末残高" value={h.yearEndBalance} onChange={(v) => setLoan(i, { yearEndBalance: v })} />
                <button
                  type="button" title="消す"
                  onClick={() => set({ housingLoans: draft.housingLoans.filter((_, k) => k !== i) })}
                  style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: 6, cursor: "pointer", color: "#94a3b8" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ housingLoans: [...draft.housingLoans, { residenceStart: "", kindCode: "", yearEndBalance: 0 }] })}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px dashed #cbd5e1", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#475569" }}
            >
              <Plus size={14} /> 住宅の取得等を追加
            </button>
            <p style={note}>
              源泉徴収票の「住宅借入金等特別控除の額の内訳」に書きます。居住開始年月日と区分は、申告書（控除証明書）を見て入れてください。
              区分の（特）（特特）（特特特）は、居住開始が令和5年1月1日以後の住宅にはありません。年末残高は、2つ以上の控除を受けるときに書きます。
            </p>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
