/**
 * 押し忘れの申し出（くわしくは timeqard/DESIGN.md の 4.3）
 *
 * 日（今日から1か月前まで）・種類・時刻・理由（ひとことも書ける）を入れる。
 * 申し出は打刻とは別に残し、Q に取り込むときに一覧に出す。担当者が確かめてから、Q の修正の欄に入れる。
 * 「休憩を取れなかった」（no_break）は、時刻と理由を入れずに申し出る（休憩のボタンを出さない会社でも選べる。Q では、その日の「休憩なし」に入れる）。
 */
import { useMemo, useState } from "react";
import {
  addDays, jstDate, jstDateLabel, jstMs, jstParts, NO_BREAK_LABEL, PUNCH_LABELS, REQUEST_REASONS, type PunchKind, type RequestKind,
} from "../../shared/timeqard";

export interface RequestInput {
  date: string;
  kind: RequestKind;
  /** 申し出た時刻（「休憩を取れなかった」は ""） */
  time: string;
  reason: string;
  note: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export default function RequestDialog(props: {
  name: string;
  now: number;
  kinds: PunchKind[];
  onSubmit: (r: RequestInput) => Promise<void>;
  onCancel: () => void;
}) {
  const today = jstDate(props.now);
  const dates = useMemo(() => Array.from({ length: 32 }, (_, i) => addDays(today, -i)), [today]);
  const p = jstParts(props.now);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<RequestKind | null>(null);
  const [hour, setHour] = useState(pad2(p.hour));
  const [minute, setMinute] = useState(pad2(p.minute));
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const noBreak = kind === "no_break";
  const time = `${hour}:${minute}`;
  const future = !noBreak && jstMs(date, time) > props.now;
  const needNote = !noBreak && reason === "そのほか" && note.trim() === "";
  const ready = kind !== null && (noBreak || reason !== "") && !future && !needNote && !busy;

  const submit = async () => {
    if (!ready || kind === null) return;
    setBusy(true);
    setError("");
    try {
      await props.onSubmit(
        kind === "no_break" ? { date, kind, time: "", reason: NO_BREAK_LABEL, note } : { date, kind, time, reason, note }
      );
    } catch (e) {
      setError(`申し出を残せませんでした：${e}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back">
      <div className="modal">
        <h2>押し忘れを申し出る（{props.name}さん）</h2>
        <p style={{ fontSize: 15, color: "#444", margin: "0 0 4px" }}>
          押し忘れた・押し間違えた時刻や、休憩を取れなかった日を、担当者に伝えます。押した打刻は消えません。担当者が確かめてから直します。
        </p>
        <div className="field">
          <label>日</label>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d, i) => (
              <option key={d} value={d}>
                {jstDateLabel(jstMs(d, "12:00"))}
                {i === 0 ? "（今日）" : i === 1 ? "（きのう）" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>種類</label>
          <div className="choice">
            {props.kinds.map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{PUNCH_LABELS[k]}</button>
            ))}
            <button className={noBreak ? "on" : ""} onClick={() => setKind("no_break")}>{NO_BREAK_LABEL}</button>
          </div>
        </div>
        {noBreak ? (
          <p style={{ fontSize: 14, color: "#444", margin: "0 0 4px" }}>
            その日は休憩を取れなかったことを伝えます（時刻はいりません）。担当者が確かめて、休憩を引かずに計算します。
          </p>
        ) : (<>
        <div className="field">
          <label>時刻</label>
          <select value={hour} onChange={(e) => setHour(e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => pad2(h)).map((h) => (
              <option key={h} value={h}>{Number(h)}時</option>
            ))}
          </select>{" "}
          <select value={minute} onChange={(e) => setMinute(e.target.value)}>
            {Array.from({ length: 60 }, (_, m) => pad2(m)).map((m) => (
              <option key={m} value={m}>{m}分</option>
            ))}
          </select>
          {future && <div className="error-text">これからの時刻は申し出られません。</div>}
        </div>
        <div className="field">
          <label>理由</label>
          <div className="choice">
            {REQUEST_REASONS.map((r) => (
              <button key={r} className={reason === r ? "on" : ""} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
        </div>
        </>)}
        <div className="field">
          <label>{noBreak ? "わけ（なくてもよい）" : `ひとこと${reason === "そのほか" ? "（書いてください）" : "（なくてもよい）"}`}</label>
          <input type="text" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }}
            placeholder={noBreak ? "たとえば：来客が続いて取れなかった" : "たとえば：朝、カードを家に忘れた"} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="buttons">
          <button className="plain-btn" onClick={props.onCancel}>やめる</button>
          <button className="mid-btn k-entry" disabled={!ready} onClick={submit}>申し出る</button>
        </div>
      </div>
    </div>
  );
}
