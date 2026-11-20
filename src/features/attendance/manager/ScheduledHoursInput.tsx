/**
 * その日の所定労働時間（勤怠の表の日付の欄。シフトで毎週同じでない日に、その日だけ直す）
 * 入れていなければ、曜日の時間（従業員の画面の「契約曜日」の時間）か1日の所定労働時間を薄く出す（utils/scheduledHours.ts）
 */
import { useEffect, useState } from "react";
import { hoursText, parseHoursText } from "../../../utils/scheduledHours";

export default function ScheduledHoursInput({
  value, usual, onChange, disabled,
}: {
  /** その日だけ直した時間（直していなければ null） */
  value: number | null;
  /** 曜日の時間・1日の所定労働時間（わからなければ null） */
  usual: number | null;
  onChange: (hours: number | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(hoursText(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(hoursText(value)); setBad(false); }, [value]);

  const changed = value !== null && (usual === null || Math.round(value * 60) !== Math.round(usual * 60));
  const commit = () => {
    const parsed = parseHoursText(text);
    if (parsed === undefined) { setBad(true); return; }
    setBad(false);
    // 曜日の時間と同じなら、直していないことにする
    const next = parsed !== null && usual !== null && Math.round(parsed * 60) === Math.round(usual * 60) ? null : parsed;
    setText(hoursText(next));
    if (next !== value) onChange(next);
  };

  return (
    <label
      title={`その日の所定労働時間（有給の日の賃金・法定内残業・遅刻早退に使います）。シフトで毎週同じでない日だけ直します。空なら${usual === null ? "1日の所定労働時間（入っていません）" : `曜日の時間 ${hoursText(usual)}`}`}
      style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 4, fontSize: 10, fontWeight: "normal", color: "#64748b" }}
    >
      所定
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={hoursText(usual) || "--:--"}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{
          width: 46, padding: "1px 3px", fontSize: 11, textAlign: "right", borderRadius: 3,
          border: `1px solid ${bad ? "#e74c3c" : changed ? "#f59e0b" : "#d1d5db"}`,
          backgroundColor: disabled ? "transparent" : changed ? "#fffbeb" : "#fff",
          color: changed ? "#b45309" : "#334155", fontWeight: changed ? "bold" : "normal",
        }}
      />
      {changed && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="曜日の時間に戻す"
          style={{ border: "none", background: "none", padding: 0, fontSize: 10, color: "#94a3b8", cursor: "pointer" }}
        >
          戻す
        </button>
      )}
    </label>
  );
}
