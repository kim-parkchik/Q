/**
 * 勤怠の画面に出す、18歳未満の人の時間外・法定休日・深夜の労働（見直しの P13。utils/minorWork.ts）
 * 給与の計算（calcSalary の minorWork）と同じ数え方で、その月の当たる日と時間を出す
 */
import { describeMinorWork, minorWorkExceptionsNote, hasMinorWorkIssue, type MinorWork } from '../../../utils/minorWork';
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function MinorWorkNotice({ am }: Props) {
  const minorWork = (am.calcResult as { minorWork?: MinorWork | null } | null)?.minorWork ?? null;
  const lines = describeMinorWork(minorWork);
  if (lines.length === 0) return null;
  const issue = hasMinorWorkIssue(minorWork);
  return (
    <div data-note="minor-work" style={{
      marginBottom: 10, fontSize: 12, lineHeight: 1.7, padding: "8px 12px", borderRadius: 6,
      color: issue ? "#9b1c1c" : "#92400e", backgroundColor: issue ? "#fde8e8" : "#fef3c7",
    }}>
      {lines.map((line, i) => (
        <div key={i} style={i === 0 && issue ? { fontSize: 13, fontWeight: "bold" } : undefined}>{i === 0 && issue && "⚠ "}{line}</div>
      ))}
      {issue && <div style={{ marginTop: 4, color: "#64748b", fontSize: 11 }}>{minorWorkExceptionsNote()}</div>}
    </div>
  );
}
