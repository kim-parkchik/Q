/**
 * その日の休憩の一覧を入れる画面（1日に何回でも。私用の外出・中抜けも休憩として入れる。utils/breaks.ts）
 *
 * ・表には、1回目の休憩だけを出す（フォームの形を崩さないため）。2回目からは、この画面で入れる。
 * ・打刻（TimeQard・CSV）の休憩があれば、それを元にして直す。直すと、その日は手入力の一覧を使う（「打刻に戻す」で戻せる）。
 * ・時間単位の有給を使う会社では、休憩（中抜け）ごとに「時間有給」の印を付けられる。印を付けた中抜けは、働いた時間にも
 *   休憩にも入れず、その日の「時間有給」の時間で、有給として数える（印を付けると、時間有給の時間を1時間単位で切り上げて入れる）。
 */
import type { CSSProperties } from "react";
import { Plus, Trash2, Undo2, X } from "lucide-react";
import TimeInputPair from "./TimeInputPair";
import { durationLabel } from "../../../utils/fixedBreak";
import { isCompleteSpan, spanLabel, type BreakSpan } from "../../../utils/breaks";

interface Props {
  /** 「11月4日（火）」 */
  dateLabel: string;
  /** 打刻の休憩 */
  punched: BreakSpan[];
  /** 手入力した一覧（null なら打刻を使っている） */
  manual: BreakSpan[] | null;
  /** 時間単位の有給を使う会社か（使わなければ「時間有給」の印を出さない） */
  hourlyLeave: boolean;
  /** 確定した日・給与を確定した月（直せない） */
  disabled: boolean;
  onChange: (list: BreakSpan[] | null) => void;
  onClose: () => void;
}

const spanMinutes = (b: BreakSpan) => {
  if (!isCompleteSpan(b)) return 0;
  const [sh, sm] = b.start.split(":").map(Number);
  const [eh, em] = b.end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return e < s ? e + 1440 - s : e - s;
};

const btn = (color: string, filled = false): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 6, fontSize: 13, cursor: "pointer",
  border: `1px solid ${color}`, background: filled ? color : "#fff", color: filled ? "#fff" : color,
});

export default function BreakListDialog({ dateLabel, punched, manual, hourlyLeave, disabled, onChange, onClose }: Props) {
  const list = manual ?? punched;
  const update = (next: BreakSpan[]) => onChange(next);
  const setField = (i: number, field: "start" | "end", value: string) => {
    const v = value === ":" ? "" : value;
    if ((list[i]?.[field] ?? "") === v) return;
    update(list.map((b, j) => (j === i ? { ...b, [field]: v } : b)));
  };
  const toggleLeave = (i: number, on: boolean) =>
    update(list.map((b, j) => (j === i ? (on ? { ...b, leave: true } : { start: b.start, end: b.end }) : b)));
  const remove = (i: number) => update(list.filter((_, j) => j !== i));
  const add = () => update([...list, { start: "", end: "" }]);

  const restMinutes = list.filter((b) => !b.leave).reduce((a, b) => a + spanMinutes(b), 0);
  const leaveMinutes = list.filter((b) => b.leave).reduce((a, b) => a + spanMinutes(b), 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "18px 22px", width: "min(560px, 94vw)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 17, flex: 1 }}>休憩（{dateLabel}）</h3>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b" }} title="閉じる">
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, lineHeight: 1.7 }}>
          打刻：{punched.length > 0 ? punched.map(spanLabel).join("、") : "なし"}
          {manual !== null && <span style={{ color: "#b45309" }}>（この日は、手で直した一覧を使っています）</span>}
          <br />
          私用の外出・中抜けも、休憩として入れます。仕事での外出（客先など）は働いた時間なので、入れません。
          {hourlyLeave && " 中抜けを時間単位の有給にするときは、「時間有給」に印を付けます（働いた時間にも休憩にも入れず、有給として数えます）。"}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ fontSize: 12, color: "#64748b", textAlign: "left" }}>
              <th style={{ padding: "4px 6px", width: 28 }}></th>
              <th style={{ padding: "4px 6px" }}>始め</th>
              <th style={{ padding: "4px 6px" }}>終わり</th>
              {hourlyLeave && <th style={{ padding: "4px 6px" }}>時間有給</th>}
              <th style={{ padding: "4px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={hourlyLeave ? 5 : 4} style={{ padding: "8px 6px", fontSize: 13, color: "#94a3b8" }}>休憩は入っていません。</td></tr>
            )}
            {list.map((b, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f1f5f9", background: b.leave ? "#eff6ff" : undefined }}>
                <td style={{ padding: "6px", fontSize: 12, color: "#94a3b8" }}>{i + 1}</td>
                <td style={{ padding: "6px" }}><TimeInputPair value={b.start} onChange={(v) => setField(i, "start", v)} disabled={disabled} /></td>
                <td style={{ padding: "6px" }}><TimeInputPair value={b.end} onChange={(v) => setField(i, "end", v)} disabled={disabled} /></td>
                {hourlyLeave && (
                  <td style={{ padding: "6px", textAlign: "center" }}>
                    <input type="checkbox" checked={!!b.leave} disabled={disabled} onChange={(e) => toggleLeave(i, e.target.checked)} title="この中抜けを時間単位の有給にする" />
                  </td>
                )}
                <td style={{ padding: "6px", textAlign: "right" }}>
                  {!disabled && (
                    <button onClick={() => remove(i)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#e11d48" }} title="この休憩を消す">
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 13, color: "#334155", margin: "10px 0" }}>
          休憩の合計：<b>{restMinutes > 0 ? durationLabel(restMinutes) : "なし"}</b>
          {leaveMinutes > 0 && <>　時間有給にした中抜け：<b style={{ color: "#2563eb" }}>{durationLabel(leaveMinutes)}</b></>}
          {list.some((b) => (b.start || b.end) && !isCompleteSpan(b)) && (
            <div style={{ color: "#b45309", fontSize: 12 }}>始めか終わりの一方しか入っていない休憩があります。その日は休憩を引きません（両方を入れてください）。</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!disabled && (
            <button onClick={add} style={btn("#2563eb")}><Plus size={14} /> 休憩を足す</button>
          )}
          {!disabled && manual !== null && (
            <button onClick={() => onChange(null)} style={btn("#64748b")} title="手で直した一覧をやめて、打刻の休憩を使う">
              <Undo2 size={14} /> 打刻に戻す
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btn("#2563eb", true)}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
