/**
 * 勤怠の画面に出す、フレックスタイム制の清算（確定した日で数える。utils/flexTime.ts）
 * 清算期間が1か月なら、総労働時間・法定の総枠・実労働と、超えた時間（時間外労働）・足りない時間（引く・繰り越す）を出す。
 * 2・3か月なら、途中の月は、この月の実労働と週平均50時間を超えた時間（この月の時間外労働）を出し、最後の月に清算期間の合計で清算する
 * （清算期間が1か月を超えるときは、各月の実労働時間を本人に知らせるのが望ましい。基発0907第1号 第1の3）
 */
import { describeFlexSettlement, type FlexSettlement } from '../../../utils/flexTime';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function FlexSummary({ am }: Props) {
  const result = am.calcResult as { flex?: FlexSettlement | null; flexMissing?: string[] } | null;
  const flex = result?.flex;
  if (!flex) return null;
  const wageType: string | undefined = am.selectedStaff?.wage_type;
  const { title, lines } = describeFlexSettlement(flex, wageType);
  const missing = result?.flexMissing ?? [];
  return (
    <div style={{ marginBottom: 10, fontSize: 12, color: "#334155", padding: "8px 12px", borderRadius: 6, backgroundColor: "#eef2ff", lineHeight: 1.7 }}>
      <b>{title}</b>（確定した日で数えています）：
      {lines.map((line, i) => (
        <span key={i} style={line.startsWith("足りない時間") ? { color: "#b45309" } : undefined}>
          {i > 0 && "。"}{line}
        </span>
      ))}
      {missing.length > 0 && (
        <div style={{ color: "#b91c1c", fontWeight: "bold" }}>
          ⚠ 清算期間の合計で清算できません（給与明細も確定できません）：
          {missing.map((m) => <div key={m} style={{ fontWeight: "normal" }}>・{m}</div>)}
        </div>
      )}
      {flex.notes.map((n, i) => <div key={i} style={{ color: "#b45309" }}>⚠ {n}</div>)}
    </div>
  );
}
