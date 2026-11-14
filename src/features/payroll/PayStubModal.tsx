import * as S from "./PayStubModal.styles";
import { usePayStubModal } from './usePayStubModal';
import * as Master from '../../constants';
import { ABSENCE_DEDUCTION_METHOD_LABELS, PREFECTURES, TARDY_DEDUCTION_METHOD_LABELS } from '../../utils/calcSalary';
import { flexHoursLabel } from '../../utils/flexTime';
import { TAX_CALC_METHOD_LABELS } from '../../utils/incomeTax';
import { describeMinimumWage } from '../../utils/minimumWage';
import { PREFECTURE_UNKNOWN_EFFECT } from '../../utils/branchPrefecture';
import { COMMUTE_METHOD_LABELS } from '../../utils/commuteAllowance';
import { describeUnionRate, INSURER_TYPE_LABELS } from '../../utils/healthInsurer';
import { describeFlatTaxPayment } from '../../utils/flatTaxReduction';
import { LEAVE_PRORATION_METHOD_LABELS, LEAVE_TYPE_NAMES } from '../../utils/leaveOfAbsence';

interface Props {
  db: any;
  staff: any;
  attendanceData: any[];
  year: number;
  month: number;
  companySettings: any; // これを追加
  onClose: () => void;
}

export default function PayStubModal(props: Props) {
  const {
    salary, extras, setExtras, isSaved, loadingParts, loadErrors, handleSaveResult, handleCancelResult,
    wageLabel, customEarningItems, customDeductionItems,
    earningItemsCount, deductionItemsCount, targetRows, insMaster, rateWarnings, minimumWageCheck, yearEndYear, flatTaxTotal, flatTaxLaterUsed, fmtH,
    monthStaff, wageMismatchDays, empInsMaster, workOnCalendarHolidays, absentOnCalendarHolidays, branchPrefectureProblem,
  } = usePayStubModal(props);
  /** "2026-11-29" → "11月29日" */
  const md = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  // この給与から引いた社会保険料の月（翌月徴収なら前月の分）
  const insMonthLabel = salary.socialInsMonths.map(ym => { const [y, m] = ym.split('-').map(Number); return `${y}年${m}月分`; }).join("と");
  // 給与形態・基本給・扶養人数は、この月の分の履歴の値
  const staff = monthStaff;

  const padRows = (current: number, target: number) =>
  Array.from({ length: Math.max(0, target - current) }, (_, i) => (
    <tr key={`pad-${i}`} style={{ height: 34 }}>
      <td style={S.tdS} /><td style={S.tdS} />
    </tr>
  ));

  return (
    <div style={S.overlayS}>
      <div style={S.containerS}>
        <button onClick={props.onClose} className="no-print" style={S.closeBtnS}>✕</button>

        {/* ─── 操作パネル ─── */}
        <div className="no-print" style={S.panelS}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: 15 }}>給与明細 設定</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            {salary.insurer.type === "kyokai" ? (
              <div>
                <label style={S.labelS}>都道府県</label>
                <select value={extras.prefecture} onChange={e => setExtras(p => ({ ...p, prefecture: e.target.value }))} style={S.inputS}>
                  {!extras.prefecture && <option value="">（選んでください）</option>}
                  {PREFECTURES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label style={S.labelS}>健康保険（{INSURER_TYPE_LABELS[salary.insurer.type]}）</label>
                <div style={{ ...S.inputS, backgroundColor: "#f8fafc" }} title="従業員の画面の「適用する社保規定」。料率は会社設定の「社会保険規定」">{salary.insurer.name}</div>
              </div>
            )}
            <div>
              <label style={S.labelS}>{salary.taxColumn === "hei" ? "扶養人数（丙欄では使いません）" : "扶養人数"}</label>
              <input type="number" min={0} max={7} value={extras.dependents} onChange={e => setExtras(p => ({ ...p, dependents: Number(e.target.value) }))} style={S.inputS} />
            </div>
            <div>
              <label style={S.labelS} title="従業員の設定の、年度ごとの住民税の額（この月に支給する給与の分）。退職する人の一括徴収などは、ここで直します">住民税（{props.month}月分）</label>
              <input type="number" min={0} value={extras.residentTax} onChange={e => setExtras(p => ({ ...p, residentTax: Number(e.target.value) }))} style={S.inputS} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.print()} style={{ ...S.printBtnS, flex: 1 }}>🖨 印刷・PDF保存</button>
            <button
              onClick={handleSaveResult}
              disabled={salary.prefectureUnknown || salary.insurerRateMissing || salary.averageWageMissing.length > 0 || loadingParts.length > 0 || loadErrors.length > 0}
              title={salary.prefectureUnknown
                ? "都道府県がわからないため、健康保険料を計算していません。「都道府県」を選んでから確定してください"
                : salary.insurerRateMissing ? `${salary.insurer.name}の、この月の分の料率が入っていないため、健康保険料を計算していません。会社設定の「社会保険規定」で料率を入れてから確定してください`
                : salary.averageWageMissing.length > 0 ? "平均賃金を出せないため、休業手当・休業補償を計算していません。メニューの「平均賃金」で確かめてから確定してください"
                : loadErrors.length > 0 ? `${loadErrors.join("・")}を読み込めなかったので、確定できません`
                : loadingParts.length > 0 ? `${loadingParts.join("・")}を読み込んでいます`
                : isSaved ? "確定済みです。押すと、いまの計算で確定し直します（年末調整の過不足額を載せるときなど）" : undefined}
              style={{
                ...S.printBtnS, flex: 1,
                backgroundColor: salary.prefectureUnknown || salary.insurerRateMissing || salary.averageWageMissing.length > 0 || loadingParts.length > 0 || loadErrors.length > 0 ? "#bdc3c7" : isSaved ? "#27ae60" : "#8e44ad",
                cursor: salary.prefectureUnknown || salary.insurerRateMissing || salary.averageWageMissing.length > 0 || loadingParts.length > 0 || loadErrors.length > 0 ? "not-allowed" : "pointer",
              }}
            >
              {loadingParts.length > 0 && loadErrors.length === 0 ? "読み込んでいます…" : isSaved ? "✅ 確定済み（確定し直す）" : "💾 給与確定"}
            </button>
            {isSaved && (
              <button onClick={handleCancelResult} style={{ ...S.printBtnS, flex: 1, backgroundColor: "#64748b" }}>
                確定を取り消す
              </button>
            )}
          </div>
          {isSaved && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
              確定した月の勤怠は、勤怠の画面で変えられません。勤怠を直すときは「確定を取り消す」をしてから直し、もう一度確定してください。
            </div>
          )}
          {loadErrors.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              ⚠ {loadErrors.join("・")}を読み込めませんでした。この明細の額は足りないかもしれないので、確定できません。給与明細を閉じて、開き直してください。
            </div>
          )}
          {rateWarnings.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              {rateWarnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
          {flatTaxLaterUsed.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              ⚠ この給与より後に払う給与・賞与（{flatTaxLaterUsed.map(describeFlatTaxPayment).join("・")}）で、先に定額減税を引いて確定しています。
              定額減税は払う日の順に引くので、この給与を確定したあと、後の給与・賞与を確定し直してください（減税額の合計を超えて引かないよう、この給与で引く額は減らしてあります）。
            </div>
          )}
          {salary.prefectureUnknown && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              ⚠ {PREFECTURE_UNKNOWN_EFFECT}「都道府県」で、健康保険料率に使う都道府県を選んでください。選ぶまで確定できません。
              {branchPrefectureProblem && <div style={{ fontWeight: "normal" }}>{branchPrefectureProblem}</div>}
            </div>
          )}
          {salary.insurerRateMissing && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              ⚠ {salary.insurer.name}の、{insMonthLabel}の料率が入っていないため、健康保険料と介護保険料を計算していません（0円）。
              会社設定の「社会保険規定」で、組合から知らされた本人負担の料率を「何年何月分から」と一緒に入れてください。入れるまで確定できません。
            </div>
          )}
          {salary.averageWageMissing.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              ⚠ 平均賃金を出せないので、次の額を計算していません（0円）。確定できません。
              {salary.averageWageMissing.map((m) => <div key={m} style={{ fontWeight: "normal" }}>・{m}</div>)}
              <div style={{ fontWeight: "normal" }}>メニューの「平均賃金」で理由を確かめ、必要なら平均賃金を手で入れてください（入社して間もない人・3か月がすべて休業の人など）。</div>
            </div>
          )}
          {salary.insurer.type === "kyokai" && !salary.prefectureUnknown && branchPrefectureProblem && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              ⚠ {branchPrefectureProblem}
              {extras.prefecture && `この明細は、「都道府県」で選んだ${extras.prefecture}の料率で計算しています。`}
              最低賃金は、拠点の都道府県がわからないため比べていません。
            </div>
          )}
          {workOnCalendarHolidays.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              ⚠ 会社カレンダーで休みの日に「出勤」で入れて働いた日があります（{workOnCalendarHolidays.map(md).join("・")}）。
              「出勤」の日は所定労働日として計算します（所定労働時間の分は{staff.wage_type === "daily" ? "日給" : "月給"}に入っているとみなし、週40時間を超えた時間も割増分だけを払います）。
              所定休日の出勤なら、勤怠の画面で「所定休日出勤」にして確定し直してください（振替で所定労働日にした日なら、このままで構いません）。
            </div>
          )}
          {absentOnCalendarHolidays.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              ⚠ 会社カレンダーで休みの日に「欠勤」を入れた日があります（{absentOnCalendarHolidays.map(md).join("・")}）。
              この日も欠勤控除に数えています。休みの日なら、勤怠の画面で「公休」にして確定し直してください。
            </div>
          )}
          {wageMismatchDays > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              ⚠ 勤怠を確定したときの{staff.wage_type === "daily" ? "日給" : "時給"}が、基本給の履歴のこの月の値（{Number(staff.base_wage).toLocaleString()}円）と違う日が{wageMismatchDays}日あります。
              この明細は勤怠に残した{staff.wage_type === "daily" ? "日給" : "時給"}で計算しています。履歴の値で計算するなら、勤怠の画面でその日を確定し直してください。
            </div>
          )}
          {salary.leave && (() => {
            // 休業・休職の月（utils/leaveOfAbsence.ts）
            const names = salary.leave.types.map(t => LEAVE_TYPE_NAMES[t]).join("・");
            const items = salary.customEarningLines.length > 0 ? "・固定の支給項目" : "";
            return (
              <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
                {salary.leave.full
                  ? `計算期間がまるごと休業（${names}）なので、月給${items}・固定残業代・通勤手当（月額）は払いません。`
                  : salary.proration?.reason === "leave"
                    ? `休業（${names}）の日が${salary.leave.days}日あるため、月給${items.replace("・", "と")}を${salary.proration.method === "workdays" ? "所定労働日数" : "暦日数"}で日割りしました（休業していない日 ${salary.proration.numerator}日 ÷ ${salary.proration.denominator}日、1円未満切り上げ）。固定残業代・通勤手当は日割りしていません。`
                    : !salary.prorationNote
                      ? `休業（${names}）の日が${salary.leave.days}日ありますが、給与規定グループの「休業の月の日割り」が「${LEAVE_PRORATION_METHOD_LABELS.none}」なので、月給を全額払います。`
                      : null}
                {salary.leave.workedDates.length > 0 && (
                  <div style={{ color: "#b45309", marginTop: 2 }}>
                    ⚠ 休業の期間に、働いた・休暇の記録がある日があります（{salary.leave.workedDates.map(md).join("・")}）。働いた時間の分は払っています。
                    休業の期間（従業員の画面）か、勤怠を確かめてください。
                  </div>
                )}
              </div>
            );
          })()}
          {salary.shutdown && (
            // 会社都合で休ませた日（勤怠の「休業（会社都合）」。utils/averageWage.ts）
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              <div>
                会社都合で休ませた日が{salary.shutdown.days}日あります。休業手当は、平均賃金の{salary.shutdown.rate}%（給与規定グループの設定）を払います（労働基準法26条）。
              </div>
              {salary.shutdown.deductionDetail && salary.shutdown.deduction > 0 && (
                <div>休業の日の控除（欠勤控除と同じ計算）：{salary.shutdown.deductionDetail}（1円未満切り捨て）</div>
              )}
              {salary.shutdown.lines.map((l) => <div key={l}>休業手当：{l}</div>)}
              {salary.shutdown.notes.map((n) => <div key={n}>{n}</div>)}
              {salary.shutdown.deductionNote && <div style={{ color: "#b45309" }}>⚠ {salary.shutdown.deductionNote}</div>}
            </div>
          )}
          {salary.injuryCompensation && (
            // 労災の待期の休業補償（労働基準法76条。utils/averageWage.ts）
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              <div>
                業務上の負傷・疾病による休業の最初の3日（労災保険の休業補償給付が出ない待期期間）は、会社が平均賃金の60%の休業補償を払います（労働基準法76条）。
                賃金ではないので、所得税・社会保険料・雇用保険料はかかりません。4日目からは、労災保険に休業補償給付を請求してください。
              </div>
              {salary.injuryCompensation.lines.map((l) => <div key={l}>休業補償：{l}</div>)}
              {salary.injuryCompensation.notes.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}
          {((salary.proration && salary.proration.reason !== "leave") || salary.prorationNote) && (
            <div style={{ marginTop: 10, fontSize: 12, color: salary.prorationNote ? "#b45309" : "#475569" }}>
              {salary.proration && salary.proration.reason !== "leave"
                ? `計算期間の途中で入社・退職したため、月給${salary.customEarningLines.length > 0 ? "と固定の支給項目" : ""}を${salary.proration.method === "workdays" ? "所定労働日数" : "暦日数"}で日割りしました（${salary.proration.numerator}日 ÷ ${salary.proration.denominator}日、1円未満切り上げ）。固定残業代・通勤手当は日割りしていません。`
                : `⚠ ${salary.prorationNote}`}
            </div>
          )}
          {salary.netPay < 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              ⚠ 差引支給額がマイナスです（給与がない月も、社会保険料・住民税などを引いているため。産休・育休のほかの休業には、社会保険料の免除がありません）。
              引ききれない分は本人から受け取るなどしてください。住民税は、市区町村に普通徴収への切り替えなどを相談できます。振込データには入れません。
            </div>
          )}
          {(salary.absenceDeductionDetail || salary.absenceDeductionNote) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              {salary.absenceDeductionDetail && (
                <div>
                  {salary.absenceDeduction > 0
                    ? `欠勤控除（給与規定グループの設定：${ABSENCE_DEDUCTION_METHOD_LABELS[salary.absenceDeductionMethod]}）：${salary.absenceDeductionDetail}（1円未満切り捨て）`
                    : salary.absenceDeductionDetail}
                </div>
              )}
              {salary.absenceDeductionNote && <div style={{ color: "#b45309" }}>⚠ {salary.absenceDeductionNote}</div>}
            </div>
          )}
          {(salary.unpaidLeaveDeductionDetail || salary.unpaidLeaveDeductionNote) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              {salary.unpaidLeaveDeductionDetail && (
                <div>
                  {salary.unpaidLeaveDeduction > 0
                    ? `無給の休暇の控除（欠勤控除と同じ計算。給与規定グループの設定：${ABSENCE_DEDUCTION_METHOD_LABELS[salary.absenceDeductionMethod]}）：${salary.unpaidLeaveDeductionDetail}（1円未満切り捨て）`
                    : salary.unpaidLeaveDeductionDetail}
                </div>
              )}
              {salary.unpaidLeaveDeductionNote && <div style={{ color: "#b45309" }}>⚠ {salary.unpaidLeaveDeductionNote}</div>}
            </div>
          )}
          {salary.flex && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              フレックスタイム制（清算期間はこの計算期間）：総労働時間 {flexHoursLabel(salary.flex.requiredHours)}
              {salary.flex.carryInHours > 0 && `（前の月から繰り越した ${flexHoursLabel(salary.flex.carryInHours)} を含む）`}
              ・法定の総枠 {flexHoursLabel(salary.flex.limitHours)}・実労働 {flexHoursLabel(salary.flex.actualHours)}
              {salary.flex.leaveHours > 0 && ` ＋ 有給 ${flexHoursLabel(salary.flex.leaveHours)}`}
              {salary.flex.excessHours > 0 && ` → 超えた時間 ${flexHoursLabel(salary.flex.excessHours)}（法定内 ${flexHoursLabel(salary.flex.innerHours)}・時間外 ${flexHoursLabel(salary.flex.fullOvertimeHours)}）`}
              {salary.flex.premiumOnlyHours > 0 && `。総労働時間の中で法定の総枠を超えた ${flexHoursLabel(salary.flex.premiumOnlyHours)} は割増分だけ`}
              {salary.flex.shortageHours > 0 && ` → 足りない時間 ${flexHoursLabel(salary.flex.shortageHours)}`}
              {salary.flex.carryOutHours > 0 && `（次の月に繰り越す ${flexHoursLabel(salary.flex.carryOutHours)}）`}
              {salary.flexShortageDetail && <div>フレックスの不足時間の控除：{salary.flexShortageDetail}（1円未満切り捨て）</div>}
              {salary.flex.notes.map((n, i) => <div key={i} style={{ color: "#b45309" }}>⚠ {n}</div>)}
            </div>
          )}
          {(salary.tardyDeductionDetail || salary.tardyDeductionNote) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              {salary.tardyDeductionDetail && (
                <div>
                  {salary.tardyDeduction > 0
                    ? `遅刻・早退・中抜けの控除（給与規定グループの設定：${TARDY_DEDUCTION_METHOD_LABELS[salary.tardyDeductionMethod]}）：${salary.tardyDeductionDetail}（1円未満切り捨て）`
                    : salary.tardyDeductionDetail}
                </div>
              )}
              {salary.tardyDeductionNote && <div style={{ color: "#b45309" }}>⚠ {salary.tardyDeductionNote}</div>}
            </div>
          )}
          {salary.socialInsCollection === "next" && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              社会保険料（翌月徴収）：この給与から{insMonthLabel}を引きます。
              {salary.retirementMonthCollectable && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={!!extras.collectRetirementMonth}
                    onChange={e => setExtras(p => ({ ...p, collectRetirementMonth: e.target.checked }))}
                  />
                  退職した月の分もこの給与から引く（この後に給与を払わないとき。前月と退職した月の2か月分になります）
                </label>
              )}
            </div>
          )}
          {minimumWageCheck && !minimumWageCheck.ok && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", fontWeight: "bold" }}>
              ⚠ 基本給を時間あたりにすると {Math.floor(minimumWageCheck.perHour).toLocaleString()}円で、
              {describeMinimumWage(Master.toKenpoPrefName(props.staff.prefecture) ?? "", minimumWageCheck.minimum)}を下回っています。
              <div style={{ fontWeight: "normal" }}>
                （給与の計算期間の終わりの日の最低賃金と比べています。対象になる手当を合わせると上回る場合もあります。通勤手当・家族手当・精皆勤手当・残業代などは含めません）
              </div>
            </div>
          )}
          {(!salary.isSocialInsEnrolled || !salary.isEmploymentInsEnrolled || !salary.isInsuredMonth || salary.isLeaveExemptMonth || !salary.isHealthInsAgeTarget || !salary.isPensionAgeTarget) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309" }}>
              {!salary.isSocialInsEnrolled && <div>※ 健康保険・厚生年金は未加入のため控除していません（従業員設定の標準報酬月額・社保規定）。</div>}
              {salary.isSocialInsEnrolled && !salary.isInsuredMonth && <div>※ 社会保険料は、入社した月の分から、退職日の翌日（資格喪失日）がある月の前月分までかかるため、{salary.socialInsMonths[0]?.replace(/^(\d+)-0?(\d+)$/, "$1年$2月")}分はかかりません（月末に退職した人は、退職した月の分までかかります）。</div>}
              {salary.isSocialInsEnrolled && salary.isInsuredMonth && salary.isLeaveExemptMonth && <div>※ 産休・育休中のため、{salary.socialInsMonths[0]?.replace(/^(\d+)-0?(\d+)$/, "$1年$2月")}分の健康保険料・介護保険料・子ども・子育て支援金・厚生年金保険料は免除されます（年金事務所・健康保険組合への申出が必要です）。</div>}
              {salary.isSocialInsEnrolled && salary.isInsuredMonth && !salary.isLeaveExemptMonth && !salary.isHealthInsAgeTarget && <div>※ 75歳の誕生月の分から、健康保険料・子ども・子育て支援金はかかりません（後期高齢者医療制度へ移るため）。</div>}
              {salary.isSocialInsEnrolled && salary.isInsuredMonth && !salary.isLeaveExemptMonth && !salary.isPensionAgeTarget && <div>※ 70歳に達した月（誕生日の前日がある月）の分から、厚生年金保険料はかかりません（70歳以上被用者）。</div>}
              {!salary.isEmploymentInsEnrolled && <div>※ 雇用保険は未加入のため控除していません（従業員設定の「雇用保険加入」）。</div>}
            </div>
          )}
          {salary.taxColumn === "hei" && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
              所得税は日額表の丙欄（日雇賃金）で、働いた日ごとの給与（社会保険料等を引いた額）に当てはめた税額の合計です（{salary.heiDays.length}日分）。
              月額の手当や社会保険料のように日が決まらない額は、日ごとの支給額の割合で分けています。
              {salary.heiDays.length > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer" }}>日ごとの金額と税額</summary>
                  <table style={{ borderCollapse: "collapse", marginTop: 4 }}>
                    <tbody>
                      {salary.heiDays.map((d, i) => (
                        <tr key={d.date ?? i}>
                          <td style={{ padding: "1px 8px 1px 0" }}>{d.date ?? "（1日分）"}</td>
                          <td style={{ padding: "1px 8px", textAlign: "right" }}>{d.amount.toLocaleString()}円</td>
                          <td style={{ padding: "1px 0 1px 8px", textAlign: "right" }}>税額 {d.tax.toLocaleString()}円</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              {salary.heiWarnings.map((w) => <div key={w} style={{ marginTop: 4, color: "#b45309" }}>⚠ {w}</div>)}
            </div>
          )}
        </div>

        {/* ─── 明細書本体 ─── */}
        <div id="print-area" style={{ padding: 16, backgroundColor: "white" }}>
          <h1 style={S.titleS}>給　与　明　細　書</h1>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 18, borderBottom: "1.5px solid #000", paddingBottom: 2, paddingRight: 40 }}>{props.staff.name} 様</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <div>{props.year} 年 {props.month} 月分</div>
              {props.staff.periodLabel && (
                <div style={{ fontSize: 11, color: "#888" }}>勤怠期間 {props.staff.periodLabel}</div>
              )}
              <div style={{ fontSize: 11, color: "#888" }}>{wageLabel}</div>
            </div>
          </div>

          <table style={S.tableS}>
            <thead>
              <tr style={S.theadS}>
                <th style={S.thS}>出勤日数</th>
                <th style={S.thS}>総労働時間</th>
                <th style={S.thS}>法定内残業</th>
                <th style={S.thS}>残業(割増対象)</th>
                <th style={S.thS}>深夜時間</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.tdCtrS}>{salary.workDays} 日</td>
                <td style={S.tdCtrS}>{fmtH(salary.totalWorkHours)}</td>
                
                {/* 1.0倍分 */}
                <td style={S.tdCtrS}>{fmtH(salary.totalStatutoryOvertimeHours)}</td>
                
                {/* 割増対象 (25%〜) */}
                <td style={S.tdCtrS}>
                  <div>{fmtH(salary.standardPremiumHours + salary.highPremiumHours)}</div>
                                  
                  {/* 60時間を超えた分がある場合のみ、内訳を表示 */}
                  {salary.highPremiumHours > 0 && (
                    <div style={{ 
                      fontSize: '10px', 
                      color: '#d35400', 
                      marginTop: 2,
                      borderTop: '1px dotted #ccc' 
                    }}>
                      {Master.OVERTIME_PREMIUM_LIMIT_HOURS}h超: {fmtH(salary.highPremiumHours)}
                    </div>
                  )}
                  {/* 中小企業の猶予（2023年3月まで）で、60時間超も25%で計算した分 */}
                  {salary.deferredHighPremiumHours > 0 && (
                    <div style={{ fontSize: '10px', color: '#7f8c8d', marginTop: 2, borderTop: '1px dotted #ccc' }}>
                      {Master.OVERTIME_PREMIUM_LIMIT_HOURS}h超（中小企業の猶予で25%）: {fmtH(salary.deferredHighPremiumHours)}
                    </div>
                  )}
                </td>
                              
                <td style={S.tdCtrS}>{fmtH(salary.totalNightHours)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
            {/* 支給項目 */}
            <div style={{ flex: 1 }}>
              <table style={S.tableS}>
                <thead><tr style={S.theadS}><th colSpan={2} style={S.thS}>支給項目</th></tr></thead>
                <tbody>
                  <tr><td style={S.tdS}>{staff.wage_type === "daily" ? `日給(${Number(salary.dailyWageDays.toFixed(2))}日分)` : salary.leave?.full && staff.wage_type === "monthly" ? "基本給(休業)" : salary.proration && staff.wage_type === "monthly" ? `基本給(日割り ${salary.proration.numerator}/${salary.proration.denominator}日)` : "基本給/時給分"}</td><td style={S.rtdS}>¥{salary.basePay.toLocaleString()}</td></tr>
                  
                  {/* 欠勤控除 */}
                  {salary.absenceDeduction > 0 && (
                    <tr><td style={{...S.tdS, color: "#c0392b"}}>欠勤控除({salary.absenceDays}日)</td><td style={{...S.rtdS, color: "#c0392b"}}>－¥{salary.absenceDeduction.toLocaleString()}</td></tr>
                  )}
                  {/* 無給の特別休暇の控除（月給制。欠勤控除と同じ計算） */}
                  {salary.unpaidLeaveDeduction > 0 && (
                    <tr><td style={{...S.tdS, color: "#c0392b"}}>無給休暇控除({salary.unpaidLeaveDays}日)</td><td style={{...S.rtdS, color: "#c0392b"}}>－¥{salary.unpaidLeaveDeduction.toLocaleString()}</td></tr>
                  )}
                  {/* フレックスタイム制の不足時間の控除（月給制） */}
                  {salary.flexShortageDeduction > 0 && (
                    <tr><td style={{...S.tdS, color: "#c0392b"}}>フレックス不足時間控除({flexHoursLabel(salary.flex?.deductHours ?? 0)})</td><td style={{...S.rtdS, color: "#c0392b"}}>－¥{salary.flexShortageDeduction.toLocaleString()}</td></tr>
                  )}
                  {/* 遅刻・早退・中抜けの控除 */}
                  {salary.tardyDeduction > 0 && (
                    <tr><td style={{...S.tdS, color: "#c0392b"}}>遅刻早退控除({fmtH(salary.tardyHours)})</td><td style={{...S.rtdS, color: "#c0392b"}}>－¥{salary.tardyDeduction.toLocaleString()}</td></tr>
                  )}
                  {/* 会社都合で休ませた日の控除（月給制。欠勤控除と同じ計算） */}
                  {(salary.shutdown?.deduction ?? 0) > 0 && (
                    <tr><td style={{...S.tdS, color: "#c0392b"}}>休業の日の控除({salary.shutdown!.fullDays}日)</td><td style={{...S.rtdS, color: "#c0392b"}}>－¥{salary.shutdown!.deduction.toLocaleString()}</td></tr>
                  )}

                  {/* 残業手当の内訳分け */}
                  {salary.statutoryOvertimePay > 0 && (
                    <tr><td style={S.tdS}>時間外手当(法定内)</td><td style={S.rtdS}>¥{salary.statutoryOvertimePay.toLocaleString()}</td></tr>
                  )}
                  {/* 固定残業代がある人は、時間外労働の割増賃金の代わりに固定残業代（と超過分）を払う */}
                  {salary.fixedOvertimeAllowance > 0 ? (
                    <>
                      <tr><td style={S.tdS}>固定残業代{salary.fixedOvertimeHours > 0 && `(${fmtH(salary.fixedOvertimeHours)}分)`}</td><td style={S.rtdS}>¥{salary.fixedOvertimeAllowance.toLocaleString()}</td></tr>
                      {salary.fixedOvertimeExcess > 0 && (
                        <tr><td style={S.tdS}>時間外手当(固定残業代の超過分)</td><td style={S.rtdS}>¥{salary.fixedOvertimeExcess.toLocaleString()}</td></tr>
                      )}
                    </>
                  ) : (
                    <>
                      {salary.standardOvertimePay > 0 && (
                        <tr><td style={S.tdS}>時間外手当({Math.round((Master.OVERTIME_RATE - 1) * 100)}%割増)</td><td style={S.rtdS}>¥{salary.standardOvertimePay.toLocaleString()}</td></tr>
                      )}
                      {salary.highOvertimePay > 0 && (
                        <tr><td style={S.tdS}>時間外手当({Math.round((Master.OVERTIME_PREMIUM_RATE - 1) * 100)}%割増)</td><td style={S.rtdS}>¥{salary.highOvertimePay.toLocaleString()}</td></tr>
                      )}
                    </>
                  )}
                  {salary.holidayWorkPay > 0 && (
                    <tr><td style={S.tdS}>休日出勤手当({Math.round((Master.HOLIDAY_WORK_RATE - 1) * 100)}%割増)</td><td style={S.rtdS}>¥{salary.holidayWorkPay.toLocaleString()}</td></tr>
                  )}
                  {salary.paidLeavePay > 0 && (
                    <tr><td style={S.tdS}>有給休暇手当({fmtH(salary.paidLeaveHours)})</td><td style={S.rtdS}>¥{salary.paidLeavePay.toLocaleString()}</td></tr>
                  )}
                  {/* 有給の特別休暇の賃金（時給制・日給制） */}
                  {salary.specialLeavePay > 0 && (
                    <tr><td style={S.tdS}>特別休暇手当({fmtH(salary.specialLeaveHours)})</td><td style={S.rtdS}>¥{salary.specialLeavePay.toLocaleString()}</td></tr>
                  )}

                  <tr><td style={S.tdS}>深夜手当</td><td style={S.rtdS}>¥{salary.nightPay.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>通勤手当</td><td style={S.rtdS}>¥{salary.commutePay.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>{extras.allowanceName || "任意手当"}</td><td style={S.rtdS}>¥{salary.allowanceAmount.toLocaleString()}</td></tr>
                  
                  {customEarningItems.map((item, i) => (
                    <tr key={i}><td style={S.tdS}>{item.name}</td><td style={S.rtdS}>¥{item.amount.toLocaleString()}</td></tr>
                  ))}
                  {/* 会社都合で休ませた日の休業手当・労災の待期の休業補償（平均賃金を使う。utils/averageWage.ts） */}
                  {(salary.shutdown?.allowance ?? 0) > 0 && (
                    <tr><td style={S.tdS}>休業手当({salary.shutdown!.days}日)</td><td style={S.rtdS}>¥{salary.shutdown!.allowance.toLocaleString()}</td></tr>
                  )}
                  {(salary.injuryCompensation?.amount ?? 0) > 0 && (
                    <tr><td style={S.tdS}>休業補償(労災の待期・非課税)</td><td style={S.rtdS}>¥{salary.injuryCompensation!.amount.toLocaleString()}</td></tr>
                  )}

                  {padRows(earningItemsCount, targetRows)}
                  <tr style={S.totalRowS}><td style={S.tdS}>支給合計</td><td style={S.rtdS}>¥{salary.totalEarnings.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>

            {/* 控除項目 */}
            <div style={{ flex: 1 }}>
              <table style={S.tableS}>
                <thead><tr style={S.theadS}><th colSpan={2} style={S.thS}>控除項目</th></tr></thead>
                <tbody>
                  <tr><td style={S.tdS}>健康保険料</td><td style={S.rtdS}>¥{salary.healthInsurance.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>介護保険料</td><td style={S.rtdS}>¥{salary.nursingInsurance.toLocaleString()}</td></tr>
                  {salary.childSupport > 0 && (
                    <tr><td style={S.tdS}>子ども・子育て支援金</td><td style={S.rtdS}>¥{salary.childSupport.toLocaleString()}</td></tr>
                  )}
                  {salary.kokuhoPremium > 0 && (
                    <tr><td style={S.tdS}>国保組合の保険料</td><td style={S.rtdS}>¥{salary.kokuhoPremium.toLocaleString()}</td></tr>
                  )}
                  <tr><td style={S.tdS}>厚生年金保険料</td><td style={S.rtdS}>¥{salary.welfarePension.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>雇用保険料</td><td style={S.rtdS}>¥{salary.empInsurance.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>所得税</td><td style={S.rtdS}>¥{salary.incomeTax.toLocaleString()}</td></tr>
                  <tr><td style={S.tdS}>住民税</td><td style={S.rtdS}>¥{salary.residentTax.toLocaleString()}</td></tr>
                  {customDeductionItems.map((item, i) => (
                    <tr key={i}><td style={S.tdS}>{item.name}</td><td style={S.rtdS}>¥{item.amount.toLocaleString()}</td></tr>
                  ))}
                  {padRows(deductionItemsCount, targetRows)}
                  <tr style={S.totalRowS}><td style={S.tdS}>控除合計</td><td style={S.rtdS}>¥{salary.totalDeductions.toLocaleString()}</td></tr>
                  {/* 年末調整の過不足額（控除合計には入れず、差引支給額で精算する） */}
                  {salary.yearEndSettlement !== 0 && (
                    <tr>
                      <td style={S.tdS}>年末調整（{yearEndYear}年分）{salary.yearEndSettlement > 0 ? "還付" : "徴収"}</td>
                      <td style={S.rtdS}>{salary.yearEndSettlement > 0 ? "+" : "−"}¥{Math.abs(salary.yearEndSettlement).toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 残業代の時給：月給・手当を1年間における1か月平均所定労働時間で割った額、日給を1日の所定労働時間で割った額（時給制で手当がない人は時給そのままなので出さない） */}
          {(staff.wage_type === "monthly" || staff.wage_type === "daily" || salary.overtimeBaseAllowances > 0)
            && (salary.statutoryOvertimePay + salary.standardOvertimePay + salary.highOvertimePay + salary.holidayWorkPay + salary.nightPay + salary.fixedOvertimeAllowance) > 0 && (() => {
            const wage = (Number(staff.base_wage) || 0).toLocaleString();
            const hoursLabel = `${salary.overtimeBaseHoursIsAnnual ? "1か月平均所定労働時間" : "この月の所定労働時間"} ${fmtH(salary.overtimeBaseHours)}`;
            const allowance = salary.overtimeBaseAllowances > 0 ? ` ＋ 手当 ¥${salary.overtimeBaseAllowances.toLocaleString()} ÷ ${hoursLabel}` : "";
            const detail = staff.wage_type === "monthly"
              ? `（(基本給 ¥${wage}${salary.overtimeBaseAllowances > 0 ? ` ＋ 手当 ¥${salary.overtimeBaseAllowances.toLocaleString()}` : ""}) ÷ ${hoursLabel}）`
              : staff.wage_type === "daily"
                ? `（日給 ¥${wage} ÷ 1日の所定労働時間 ${fmtH(Number(staff.scheduled_work_hours) || 8)}${allowance}）`
                : `（時給 ¥${wage}${allowance}）`;
            return (
              <div style={{ marginTop: 12, fontSize: 12, border: "1px solid #999", padding: "6px 10px" }}>
                残業代の時給：¥{salary.overtimeHourlyRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <span style={{ color: "#666", marginLeft: 8 }}>{detail}</span>
                {!salary.overtimeBaseHoursIsAnnual && (staff.wage_type === "monthly" || salary.overtimeBaseAllowances > 0) && (
                  <div style={{ color: "#b45309", marginTop: 4 }}>
                    1年間の所定労働日数がわからないため、この月の所定労働時間で割っています（従業員画面の出勤曜日・カレンダーを確かめてください）。
                  </div>
                )}
              </div>
            );
          })()}

          {/* 週40時間：前の計算期間の日も数えた・所定労働時間の中の時間外労働は割増分だけを払った */}
          {salary.isOvertimeEligible && (salary.weekCarryOver
            || (salary.overtimeWithinScheduleHours > 0 && (staff.wage_type !== "hourly" || salary.overtimeBaseAllowances > 0))) && (
            <div style={{ marginTop: 12, fontSize: 12, border: "1px solid #999", padding: "6px 10px" }}>
              {salary.weekCarryOver && (
                <div>
                  週40時間は、前の計算期間の日（{md(salary.weekCarryOver.from)}〜{md(salary.weekCarryOver.to)}）に働いた {fmtH(salary.weekCarryOver.hours)} も合わせて数えています（その日の給与は、前の計算期間の分として支給済みです）。
                </div>
              )}
              {salary.overtimeWithinScheduleHours > 0 && (staff.wage_type !== "hourly" || salary.overtimeBaseAllowances > 0) && (
                <div>
                  時間外労働のうち {fmtH(salary.overtimeWithinScheduleHours)} は所定労働時間の中の時間（週40時間を超えた所定労働日の時間など）で、
                  {staff.wage_type === "hourly"
                    ? "手当の分の通常の賃金は月額の手当で支給しているので、手当の分も割増分（25%。月60時間を超えた分は50%）だけを支給します。"
                    : `通常の賃金は${staff.wage_type === "monthly" ? "月給" : "日給"}で支給しているので、割増分（25%。月60時間を超えた分は50%）だけを支給します。`}
                </div>
              )}
            </div>
          )}

          {/* 残業代の対象外（管理監督者など） */}
          {!salary.isOvertimeEligible && (
            <div style={{ marginTop: 12, fontSize: 12, border: "1px solid #999", padding: "6px 10px" }}>
              残業代の対象外（管理監督者など）のため、時間外労働・休日労働の手当は支給しません。深夜手当は支給します。
            </div>
          )}

          {/* 固定残業代：法定の割増賃金と比べた結果 */}
          {salary.fixedOvertimeAllowance > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, border: "1px solid #999", padding: "6px 10px" }}>
              時間外労働 {fmtH(salary.standardPremiumHours + salary.highPremiumHours)}
              （法定の割増賃金 ¥{(salary.standardOvertimePay + salary.highOvertimePay).toLocaleString()}）は、固定残業代 ¥{salary.fixedOvertimeAllowance.toLocaleString()} に含みます。
              {salary.fixedOvertimeExcess > 0 && `固定残業代を超えた ¥${salary.fixedOvertimeExcess.toLocaleString()} を、超過分として支給します。`}
              <span style={{ color: "#666" }}>法定内残業・休日出勤・深夜の手当は、固定残業代とは別に支給します。</span>
            </div>
          )}

          {/* 定額減税（令和6年6月〜）：給与支払明細書には月次減税額を書く */}
          {flatTaxTotal > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, border: "1px solid #999", padding: "6px 10px" }}>
              定額減税額（所得税）：¥{salary.flatTaxReduction.toLocaleString()}
              <span style={{ color: "#666", marginLeft: 12 }}>
                （減税前の所得税 ¥{salary.incomeTaxBeforeReduction.toLocaleString()}／控除しきれなかった額 ¥{salary.flatTaxReductionRemaining.toLocaleString()}）
              </span>
            </div>
          )}

          {salary.yearEndSettlement < 0 && salary.netPay < 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#b91c1c" }}>
              ⚠ 年末調整の不足額を引くと、差引支払額がマイナスになります。引ききれない分は、その後に支払う給与から順に徴収します。
            </div>
          )}
          <div style={{ marginTop: 24, textAlign: "right" }}>
            <div style={{ display: "inline-block", border: "2px solid #000", padding: "12px 28px" }}>
              <span>差引支払額：</span>
              <span style={{ fontSize: 30, fontWeight: "bold" }}>¥{salary.netPay.toLocaleString()}</span>
            </div>
          </div>

          <div style={{ marginTop: 18, fontSize: 10, color: "#999", borderTop: "1px solid #ddd", paddingTop: 8 }}>
            ※ {salary.insurer.type === "kokuho"
              ? `${salary.insurer.name}（国民健康保険組合）の人なので、健康保険料・介護保険料・子ども・子育て支援金はかからず、国保組合の保険料（従業員の画面の月額）を引いています。`
              : salary.insurer.type === "union"
                ? (salary.unionRate
                  ? `健康保険料・介護保険料・子ども・子育て支援金は${salary.insurer.name}の料率（${describeUnionRate(salary.unionRate)}）、`
                  : `健康保険料・介護保険料は、${salary.insurer.name}の料率が入っていないため計算していません。`)
              : salary.prefectureUnknown
              ? "健康保険料・介護保険料は、都道府県がわからないため計算していません。"
              : `健康保険料は協会けんぽ${extras.prefecture}支部の${insMaster.MASTER_YEAR}年${insMaster.MASTER_MONTH}月分からの料率、`}
            厚生年金は{insMaster.PENSION_RATE[1]}%（折半）、雇用保険は{empInsMaster.LABOR_FROM.year}年{empInsMaster.LABOR_FROM.month}月からの料率で計算。
            健康保険・介護保険・子ども・子育て支援金・厚生年金は{insMonthLabel}（{salary.socialInsCollection === "next" ? "翌月徴収" : "当月徴収"}）。
            所得税は{props.year}年分の{salary.taxColumn === "otsu" ? "月額表（乙欄）" : salary.taxColumn === "hei" ? "日額表（丙欄。働いた日ごと）" : `${TAX_CALC_METHOD_LABELS[extras.taxMethod ?? "table"]}（甲欄）`}、通勤手当は非課税限度額（{COMMUTE_METHOD_LABELS[salary.commuteMethod]}・1か月 ¥{salary.commuteTaxFreeLimit.toLocaleString()}）まで課税対象外。住民税は手入力値。
          </div>
        </div>
      </div>
      <style>{S.printStyle}</style>
    </div>
  );
}