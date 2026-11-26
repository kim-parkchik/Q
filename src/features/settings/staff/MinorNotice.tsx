/**
 * 従業員の画面に出す、18歳未満の人の知らせ（見直しの P13。utils/minorWork.ts）
 * 入力中の生年月日で、きょうか入社日の遅いほうの日に18歳未満なら出す（できない労働・戸籍証明書の備え付け・
 * 使えない決まり（フレックスタイム制・週44時間の特例）と、最低年齢に満たないこと）
 */
import dayjs from 'dayjs';
import { describeMinorStaff } from '../../../utils/minorWork';
import { weekly44BusinessOf } from '../../../utils/weekly44';
import type { StaffManagerState } from '../useStaffManager';

interface Props {
    cm: StaffManagerState;
}

export default function MinorNotice({ cm }: Props) {
    const today = dayjs().format('YYYY-MM-DD');
    const on = cm.targetJoinDate && cm.targetJoinDate > today ? cm.targetJoinDate : today;
    const notice = describeMinorStaff({
        birthday: cm.targetBirthday,
        on,
        isFlex: !!cm.targetIsFlex,
        weekly44: weekly44BusinessOf(cm.branches ?? [], cm.targetBranchId) !== null,
    });
    if (!notice) return null;
    return (
        <div data-note="minor-staff" style={{
            marginTop: "6px", fontSize: "12px", lineHeight: 1.7, padding: "8px 10px", borderRadius: "6px",
            color: notice.belowMinimumAge ? "#9b1c1c" : "#92400e", backgroundColor: notice.belowMinimumAge ? "#fde8e8" : "#fef3c7",
        }}>
            {notice.lines.map((line, i) => <div key={i}>{i === 0 && "⚠ "}{line}</div>)}
        </div>
    );
}
