/**
 * 勤怠の画面に出す、有給の残り（「有給休暇管理」の画面と同じ数え方。確定した勤怠で数える）
 * この期間に残りが足りない有給の日があれば知らせる
 */
import dayjs from "dayjs";
import type { AttendanceViewModel } from './types';

interface Props {
  am: AttendanceViewModel;
}

export default function PaidLeaveNotice({ am }: Props) {
  const { paidLeave } = am;
  if (!paidLeave) return null;
  // 有給をほかで管理している会社（付与を登録していない人）は、この期間に有給がなければ何も出さない
  if (!paidLeave.hasGrants && !paidLeave.leaveInPeriod) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "#475569", padding: "6px 12px", borderRadius: 6, backgroundColor: "#f1f5f9" }}>
        {paidLeave.hasGrants ? (
          <>
            有給の残り：<b style={{ fontSize: 14, color: "#1e293b" }}>{paidLeave.remainingText}</b>
            （{dayjs(paidLeave.asOf).format("M月D日")}時点。確定した勤怠で数えています。くわしくは「有給休暇管理」の画面で見られます）
          </>
        ) : (
          <>この人の有給の付与は登録されていないので、残りは数えていません（「有給休暇管理」の画面で付与を登録すると、ここに残りが出ます）。</>
        )}
      </div>
      {paidLeave.shortages.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13, color: "#9b1c1c", padding: "8px 12px", borderRadius: 6, backgroundColor: "#fde8e8" }}>
          ⚠ この期間に、残りが足りない有給があります：
          {paidLeave.shortages.map(s => `${s.date}（${s.amount}のうち${s.shortage}）`).join("、")}。
          付与を登録するか、勤怠を直してください。
        </div>
      )}
      {paidLeave.hourlyOver.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13, color: "#9b1c1c", padding: "8px 12px", borderRadius: 6, backgroundColor: "#fde8e8" }}>
          ⚠ 時間単位の有給が、1年に5日分を超えています：
          {paidLeave.hourlyOver.map(y => `${y.from}〜${y.to} の年に ${y.hours}時間（上限 ${y.limitHours}時間）`).join("、")}。
          時間単位で取れるのは、1年に5日分までです（労働基準法39条4項。前の年から繰り越した分も含めて数えます）。
          超えた分は、半日・1日の有給にするか、勤怠を直してください。
        </div>
      )}
      {!am.hourlyLeaveEnabled && paidLeave.hourlyLeaveInPeriod && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#92400e", padding: "6px 12px", borderRadius: 6, backgroundColor: "#fef3c7" }}>
          この期間に時間有給の日がありますが、会社の設定では時間単位の有給を使わないことになっています（会社設定の「会社情報」で変えられます）。
          時間単位の有給は、労使協定を結んだときだけ使えます。
        </div>
      )}
      {paidLeave.hoursAssumed && paidLeave.hourlyLeaveInPeriod && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#92400e", padding: "6px 12px", borderRadius: 6, backgroundColor: "#fef3c7" }}>
          この人の1日の所定労働時間が入っていないので、時間単位の有給は8時間を1日として数えています。従業員の画面で、1日の所定労働時間を入れてください。
        </div>
      )}
    </div>
  );
}
