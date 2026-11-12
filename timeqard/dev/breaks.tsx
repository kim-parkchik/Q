/**
 * Q の勤怠の画面の「休憩の一覧」（src/features/attendance/manager/BreakListDialog.tsx）を、見本の値で画面に出す（開発用。配るものには入らない）
 * 使い方：確かめ用の画面（vite.preview.config.ts）を動かし、http://localhost:1432/dev/breaks.html を開く
 * 直した一覧と、その日の働いた時間（src/utils/fixedBreak.ts）を下に出す。
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import BreakListDialog from "../../src/features/attendance/manager/BreakListDialog";
import { calcDayHours, type FixedBreakRule } from "../../src/utils/fixedBreak";
import { effectiveBreaks, type BreakSpan } from "../../src/utils/breaks";

const punched: BreakSpan[] = [{ start: "12:01", end: "13:00" }, { start: "15:00", end: "15:10" }];
const lunch: FixedBreakRule = { mode: "time", start: "12:00", end: "13:00", combine: "record" };

function Page() {
  const [manual, setManual] = useState<BreakSpan[] | null>(null);
  const [open, setOpen] = useState(true);
  const list = effectiveBreaks(manual, punched);
  const day = calcDayHours({ entry: "09:00", exit: "18:00", breaks: list }, lunch);
  return (
    <div style={{ padding: 20 }}>
      <button onClick={() => setOpen(true)}>休憩の一覧を開く</button>
      <pre id="result" style={{ background: "#fff", padding: 12, marginTop: 12 }}>
        {JSON.stringify({ manual, workHours: day.total, breakMinutes: day.breakMinutes, leaveMinutes: day.leaveMinutes, notice: day.notice }, null, 2)}
      </pre>
      {open && (
        <BreakListDialog
          dateLabel="11月4日（水）"
          punched={punched}
          manual={manual}
          hourlyLeave
          disabled={false}
          onChange={setManual}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Page />);
