/**
 * 年末調整の画面：入れている扶養控除等申告書から数えた「扶養親族等の数」（月々の所得税）と、その年に確定した給与で使った扶養人数・
 * 従業員の画面の扶養人数を並べ、違えば知らせる（見直しの P9。数え方は utils/withholdingDependents.ts）
 * 申告書は、その年の12月31日の現況なので、年の途中で家族の状況が変わった人は、違う月があってもまちがいではない
 */
import { toTaxColumn } from "../../utils/incomeTax";
import type { NenchoDeclaration } from "../../utils/nenchoDeclaration";
import { dependentsHistoryOf, entryAsOf } from "../../utils/staffHistory";
import {
  checkYearDependents, lineChangeDate, monthDayLabel, monthRanges, usedSummary, withholdingLinesOf, type UsedDependents,
} from "../../utils/withholdingDependents";

const line = { fontSize: 12, color: "#334155", margin: "4px 0 0 0", lineHeight: 1.6 };
const small = { fontSize: 11, color: "#64748b", margin: "4px 0 0 0", lineHeight: 1.6 };
const warn = { fontSize: 12, color: "#b45309", margin: "6px 0 0 0", lineHeight: 1.6 };

interface Props {
  staff: any;
  year: number;
  draft: NenchoDeclaration;
  used: UsedDependents[];
  /** 本人の合計所得金額（年末調整の計算結果。計算しない人は null） */
  selfTotalIncome: number | null;
  /** この会社で年末調整をする人か（しない人は、月々の差を精算しない） */
  adjusted: boolean;
}

export default function DependentsYearCheck({ staff, year, draft, used, selfTotalIncome, adjusted }: Props) {
  const column = toTaxColumn(staff.tax_column);
  const check = checkYearDependents(draft, year, column, used, selfTotalIncome);
  const gm = withholdingLinesOf(year);
  if (!check || !gm) return null;
  const until = gm.withoutAdjustment.earlierUntil;
  const untilLabel = `${Number(until.slice(0, 2))}月${Number(until.slice(3))}日`;
  // その年の途中で線が変わる日（令和8年分は12月1日。その日以後に支払う給与から新しい線）
  const change = lineChangeDate(gm, year);
  // 従業員の画面の扶養人数（その年の12月分の給与に使う人数）。12月より前に退職した人には出さない
  const showCurrent = !(staff.retirement_date && staff.retirement_date < `${year}-12-01`);
  const current = entryAsOf(dependentsHistoryOf(staff), year, 12).count;
  const currentDiffers = showCurrent && current !== check.latest.total;
  // 従業員の画面の扶養人数が、線が変わる前の人数と同じ（家族の状況は変わらず、線が変わったので人数が変わる）
  const lineChanged = currentDiffers && !!check.earlier && !!change && current === check.earlier.total;

  return (
    <div style={{ marginTop: 14, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, backgroundColor: "#f8fafc" }}>
      <div style={{ fontSize: 13, fontWeight: "bold", color: "#1e293b" }}>
        扶養親族等の数（月々の所得税{column === "otsu" ? "・乙欄" : ""}）
      </div>
      <p style={line}>
        この申告書から数えると <b>{check.latest.total}人</b>
        {check.earlier && `（${year}年${untilLabel}以前に支払う給与は${check.earlier.total}人）`}
      </p>
      {check.latest.details.length > 0 && (
        <ul style={{ ...small, paddingLeft: 18 }}>
          {check.latest.details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
      {check.latest.notes.map((n) => <p key={n} style={small}>※ {n}</p>)}
      {check.used.length > 0 && <p style={line}>{year}年に確定した給与で使った扶養人数：{usedSummary(check.used)}</p>}
      {check.different.length > 0 && (
        <p style={warn}>
          ⚠ {monthRanges(check.different.map((d) => d.month))}の給与は、この申告書から数えた人数と違う扶養人数で計算しています。
          年の途中で家族の状況（結婚・出生・就職・所得の見込みなど）が変わったのでなければ、扶養人数の入れ違いです。
          {adjusted
            ? "月々の所得税の差は、年末調整で精算されます（給与を計算し直す必要はありません）。"
            : "この人は年末調整をしないので、月々の所得税の差は、この会社の年末調整では精算しません。"}
        </p>
      )}
      {showCurrent && <p style={line}>従業員の画面の扶養人数（{year}年12月分の給与に使う人数）：{current}人</p>}
      {lineChanged && change && (
        <p style={warn}>
          ⚠ {year}年{monthDayLabel(change)}以後に支払う給与からは、所得の見積額の線が変わるので、この申告書から数えた人数は{check.latest.total}人です
          （従業員の画面の扶養人数は{current}人）。{Number(change.slice(5, 7))}月分の給与から変えるときは、従業員の画面の「扶養人数の変更を追加」で、
          {year}年{Number(change.slice(5, 7))}月分からの行を足し、{check.latest.total}人にしてください。
        </p>
      )}
      {currentDiffers && !lineChanged && (
        <p style={warn}>
          ⚠ この申告書から数えた人数（{check.latest.total}人）と違います。家族の状況が変わったのでなければ、従業員の画面で扶養人数を直してください
          （従業員の画面にも、申告書から数えた人数が出ます）。
        </p>
      )}
    </div>
  );
}
