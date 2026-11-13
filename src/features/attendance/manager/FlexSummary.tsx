/**
 * 勤怠の画面に出す、フレックスタイム制の清算（清算期間は計算期間の1か月。確定した日で数える。utils/flexTime.ts）
 * 総労働時間・法定の総枠・実労働と、超えた時間（時間外労働）・足りない時間（引く・繰り越す）を出す
 */
import { flexHoursLabel, type FlexSettlement } from '../../../utils/flexTime';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function FlexSummary({ am }: Props) {
  const flex = (am.calcResult as { flex?: FlexSettlement | null } | null)?.flex;
  if (!flex) return null;
  const h = flexHoursLabel;
  return (
    <div style={{ marginBottom: 10, fontSize: 12, color: "#334155", padding: "8px 12px", borderRadius: 6, backgroundColor: "#eef2ff", lineHeight: 1.7 }}>
      <b>フレックスタイム制</b>（清算期間はこの計算期間。確定した日で数えています）：
      総労働時間 <b>{h(flex.requiredHours)}</b>
      {flex.carryInHours > 0 && `（前の月から繰り越した ${h(flex.carryInHours)} を含む）`}
      ・法定の総枠 {h(flex.limitHours)}・実労働 <b>{h(flex.actualHours)}</b>
      {flex.leaveHours > 0 && ` ＋ 有給 ${h(flex.leaveHours)}`}
      {" → "}
      {flex.excessHours > 0
        ? <>超えた時間 <b>{h(flex.excessHours)}</b>（法定内 {h(flex.innerHours)}・時間外 {h(flex.fullOvertimeHours)}）</>
        : flex.shortageHours > 0
          ? <span style={{ color: "#b45309" }}>
              足りない時間 <b>{h(flex.shortageHours)}</b>
              （{[flex.deductHours > 0 ? `給与から引く ${h(flex.deductHours)}` : "", flex.carryOutHours > 0 ? `次の月に繰り越す ${h(flex.carryOutHours)}` : ""].filter(Boolean).join("・") || "時給制なので引きません"}）
            </span>
          : "総労働時間どおり"}
      {flex.premiumOnlyHours > 0 && `。総労働時間の中で法定の総枠を超えた ${h(flex.premiumOnlyHours)} には、割増分を払います`}
      {flex.notes.map((n, i) => <div key={i} style={{ color: "#b45309" }}>⚠ {n}</div>)}
    </div>
  );
}
