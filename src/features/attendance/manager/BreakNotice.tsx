/**
 * 勤怠の画面に出す、休憩のこと（utils/fixedBreak.ts）
 * ・この人の決まった休憩（給与規定グループで決める。休憩の時刻が入っていない日に、確定するときに引く）
 * ・労働基準法34条の休憩より短い日と、決まった休憩を引かなかった日（途中で出勤・退勤した日など）
 */
import dayjs from "dayjs";
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

const md = (date: string) => dayjs(date).format("M/D");

export default function BreakNotice({ am }: Props) {
  const { fixedBreakText, breakInfo } = am;
  const entries = Object.entries(breakInfo);
  const short = entries.filter(([, b]) => b.shortage > 0).map(([d]) => md(d));
  const notices = entries.filter(([, b]) => b.notice).map(([d]) => md(d));
  if (!fixedBreakText && short.length === 0 && notices.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      {fixedBreakText && (
        <div style={{ fontSize: 12, color: "#475569", padding: "6px 12px", borderRadius: 6, backgroundColor: "#f1f5f9" }}>
          決まった休憩：<b style={{ color: "#1e293b" }}>{fixedBreakText}</b>
          （給与規定グループの決まり）。休憩の時刻が入っていない日は、確定するときにこの休憩を引きます。
          休憩の時刻が違った日はその日の休憩を入れ、休憩を取らなかった日は「休憩なし」に印を付けてから確定してください。
        </div>
      )}
      {short.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13, color: "#9b1c1c", padding: "8px 12px", borderRadius: 6, backgroundColor: "#fde8e8" }}>
          ⚠ 休憩が労働基準法34条の長さより短い日があります：{short.join("、")}
          （労働時間が6時間を超えたら45分、8時間を超えたら1時間。外出も休憩に含めて見ています）。休憩を入れ忘れていないか確かめてください。
        </div>
      )}
      {notices.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#92400e", padding: "6px 12px", borderRadius: 6, backgroundColor: "#fef3c7" }}>
          休憩を引いていない日があります：{notices.join("、")}（理由はその日の欄に出しています）。
        </div>
      )}
    </div>
  );
}
