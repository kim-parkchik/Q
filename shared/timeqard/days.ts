/**
 * 打刻の記録から、1人1日1行（Q の勤怠の1行）を作る（くわしくは timeqard/DESIGN.md の 4.5・付録 E）
 *
 * ・出勤を押すと、新しい勤務が始まる。勤務の日は、出勤を押した日（日本時間）。日をまたぐ夜勤も、出勤した日の行にする
 *   （Q も「退勤が出勤より前なら次の日」として、出勤した日の行で数える）。
 * ・退勤・休憩は、24時間のうちに始まった、まだ退勤していない勤務の分。そういう勤務がなければ、押した日の行にして
 *   「出勤がありません」と注意を出す。
 * ・休憩は1日に何回でも入れる（休憩始と休憩終を、押した順に組にする。中抜けも休憩として押す）。
 * ・Q の1日の行には、出勤・退勤が1つずつしか入らない。入らない打刻（1日に2回の出勤など）は、
 *   注意に書いて、担当者が Q で直せるようにする（TimeQard の記録には、すべて残っている）。
 * ・取り消した打刻・申し出は、呼ぶ側で外してから渡す。
 */
import { NO_BREAK_SHORT, BREAK_LABEL, PUNCH_KINDS, PUNCH_LABELS, TIME_REQUEST_KINDS, type PunchKind, type PunchMethod, type RequestKind, type TimeRequestKind } from "./kinds";
import { DAY_MS, HOUR_MS, MINUTE_MS, jstDate, jstTime, timeLabel } from "./time";
import { compareStaffId } from "./staffFile";
import type { TimeSpan } from "./spans";

export interface Punch {
  id: number;
  staffId: string;
  kind: PunchKind;
  /** 押した日時（1970年からのミリ秒） */
  at: number;
  method: PunchMethod;
}

export interface PunchRequest {
  id: number;
  staffId: string;
  /** 申し出た日（「2026-11-07」） */
  date: string;
  kind: RequestKind;
  /** 申し出た時刻（「09:00」）。休憩は始めの時刻。「休憩を取れなかった」（no_break）は "" */
  time: string;
  /** 休憩の終わりの時刻（休憩の申し出だけ。ほかは ""） */
  endTime: string;
  reason: string;
  note: string;
  /** 申し出た日時（ミリ秒）。同じ日・同じ種類の申し出が2つあれば、後のものを使う（休憩は、ちがう時刻ならどちらも使う） */
  requestedAt: number;
}

export interface DayRow {
  staffId: string;
  date: string;
  /** 出勤・退勤の時刻（「08:58」。なければ ""） */
  times: Record<TimeRequestKind, string>;
  /** 休憩（押した順。始めか終わりの一方しかない休憩も入れる） */
  breaks: TimeSpan[];
  /** 申し出た出勤・退勤の時刻（申し出がない種類は入れない） */
  requests: Partial<Record<TimeRequestKind, string>>;
  /** 申し出た休憩 */
  requestBreaks: TimeSpan[];
  /** 「休憩を取れなかった」の申し出がある */
  noBreakRequest: boolean;
  /** 申し出の理由（「退勤：押し間違えた（会議が長引いた）」。2つ以上は「／」で区切る） */
  requestReason: string;
  /** ID で押した（カードなしの）打刻の種類（行に入れた打刻のうち） */
  cardless: PunchKind[];
  /** ブラウザで押した打刻の種類（行に入れた打刻のうち） */
  web: PunchKind[];
  notes: string[];
}

/** 1つの勤務の長さの上限（Q は24時間を超える勤務を数えられない） */
export const MAX_SHIFT_MS = DAY_MS;
/** 退勤のあと、この長さのうちにもう一度退勤を押したら、同じ勤務の退勤にする（押し直し・呼び戻されて少し働いたとき） */
export const EXIT_REPRESS_MS = 3 * HOUR_MS;
/** 休憩のボタンを、この長さのうちに2回押したら、押し直しとして1回にする */
export const DOUBLE_PRESS_MS = 10 * MINUTE_MS;

interface Shift {
  date: string;
  entry: Punch;
  duplicateEntries: Punch[];
  /** 退勤のほかの打刻（休憩） */
  members: Punch[];
  exits: Punch[];
  /** 退勤しないうちに、次の日の出勤があった */
  superseded: boolean;
}

const t = (p: Punch) => timeLabel(jstTime(p.at));

const sortPunches = (ps: Punch[]) => [...ps].sort((a, b) => a.at - b.at || a.id - b.id);

/** 1人の打刻を、勤務（出勤から退勤まで）に分ける。どの勤務にも入らない打刻は orphans に入れる */
const splitShifts = (punches: Punch[]): { shifts: Shift[]; orphans: Punch[] } => {
  const shifts: Shift[] = [];
  const orphans: Punch[] = [];
  let current: Shift | null = null;
  for (const p of sortPunches(punches)) {
    if (current && p.at - current.entry.at >= MAX_SHIFT_MS) current = null;
    if (p.kind === "entry") {
      // 退勤していない同じ日の勤務がある：出勤の押し直しとして、初めの出勤を使う
      if (current && current.exits.length === 0 && jstDate(p.at) === current.date) {
        current.duplicateEntries.push(p);
        continue;
      }
      if (current && current.exits.length === 0) current.superseded = true;
      current = { date: jstDate(p.at), entry: p, duplicateEntries: [], members: [], exits: [], superseded: false };
      shifts.push(current);
      continue;
    }
    if (current && current.exits.length === 0) {
      if (p.kind === "exit") current.exits.push(p);
      else current.members.push(p);
      continue;
    }
    if (current && p.kind === "exit" && p.at - current.exits[current.exits.length - 1].at <= EXIT_REPRESS_MS) {
      current.exits.push(p);
      continue;
    }
    orphans.push(p);
  }
  return { shifts, orphans };
};

interface Pair {
  start?: Punch;
  end?: Punch;
}

/** 休憩の打刻を、始めと終わりの組にする（押した順。10分のうちの押し直しは1回にする） */
const pairsOf = (members: Punch[], notes: string[]): Pair[] => {
  const pairs: Pair[] = [];
  for (const p of members) {
    const last = pairs[pairs.length - 1];
    if (p.kind === "break_start") {
      if (last?.start && !last.end && p.at - last.start.at <= DOUBLE_PRESS_MS) {
        notes.push(`${PUNCH_LABELS.break_start}を2回押しています（${t(last.start)}・${t(p)}）。初めのほうを入れました`);
        continue;
      }
      pairs.push({ start: p });
    } else if (p.kind === "break_end") {
      if (last?.start && !last.end) {
        last.end = p;
        continue;
      }
      if (last?.end && p.at - last.end.at <= DOUBLE_PRESS_MS) {
        notes.push(`${PUNCH_LABELS.break_end}を2回押しています（${t(last.end)}・${t(p)}）。初めのほうを入れました`);
        continue;
      }
      pairs.push({ end: p });
    }
  }
  return pairs;
};

interface RowDraft {
  row: DayRow;
  /** 行に入れた出勤・退勤の打刻 */
  sources: Partial<Record<TimeRequestKind, Punch>>;
  /** 行に入れた休憩の打刻 */
  breakPunches: Punch[];
  /** 出勤から始まる勤務の行か（出勤のない打刻だけの行は false） */
  fromShift: boolean;
  /** 出勤のない行の、休憩の打刻（あとで組にする） */
  orphanBreaks: Punch[];
}

const emptyDraft = (staffId: string, date: string, fromShift: boolean): RowDraft => ({
  row: {
    staffId, date, times: { entry: "", exit: "" }, breaks: [], requests: {}, requestBreaks: [], noBreakRequest: false,
    requestReason: "", cardless: [], web: [], notes: [],
  },
  sources: {},
  breakPunches: [],
  fromShift,
  orphanBreaks: [],
});

/** 休憩の組を、行に入れる（始めか終わりの一方しかない休憩も入れて知らせる） */
const putBreaks = (draft: RowDraft, pairs: Pair[], finished: boolean) => {
  for (const pair of pairs) {
    draft.row.breaks.push({ start: pair.start ? jstTime(pair.start.at) : "", end: pair.end ? jstTime(pair.end.at) : "" });
    if (pair.start) draft.breakPunches.push(pair.start);
    if (pair.end) draft.breakPunches.push(pair.end);
    if (!pair.start && pair.end) draft.row.notes.push(`${PUNCH_LABELS.break_start}がありません（${PUNCH_LABELS.break_end} ${t(pair.end)}）`);
    if (pair.start && !pair.end && finished) draft.row.notes.push(`${PUNCH_LABELS.break_end}がありません（${PUNCH_LABELS.break_start} ${t(pair.start)}）`);
  }
};

const draftFromShift = (staffId: string, shift: Shift, now: number): RowDraft => {
  const draft = emptyDraft(staffId, shift.date, true);
  const { sources } = draft;
  const notes = draft.row.notes;
  sources.entry = shift.entry;
  if (shift.duplicateEntries.length > 0) {
    const all = [shift.entry, ...shift.duplicateEntries];
    notes.push(`出勤を${all.length}回押しています（${all.map(t).join("・")}）。初めの出勤を入れました`);
  }
  const exit = shift.exits[shift.exits.length - 1];
  if (exit) sources.exit = exit;
  if (shift.exits.length > 1) {
    notes.push(`退勤を${shift.exits.length}回押しています（${shift.exits.map(t).join("・")}）。最後の退勤を入れました`);
  }
  const finished = shift.exits.length > 0 || shift.superseded || now - shift.entry.at >= MAX_SHIFT_MS;
  if (!exit && finished) notes.push("退勤がありません");
  putBreaks(draft, pairsOf(shift.members, notes), finished);
  return draft;
};

/** 申し出の理由の文（「退勤：押し間違えた（会議が長引いた）」「休憩（15:00〜17:00）：押し忘れた」「休憩なし：休憩を取れなかった（来客が続いた）」） */
export const requestReasonText = (r: Pick<PunchRequest, "kind" | "reason" | "note" | "time" | "endTime">) => {
  const note = r.note.trim();
  const label =
    r.kind === "no_break" ? NO_BREAK_SHORT
      : r.kind === "break" ? `${BREAK_LABEL}（${timeLabel(r.time)}〜${timeLabel(r.endTime)}）`
      : PUNCH_LABELS[r.kind];
  return `${label}：${r.reason}${note ? `（${note}）` : ""}`;
};

/**
 * 1人1日1行を作る。
 * @param punches 取り消していない打刻（何人分でもよい）
 * @param requests 取り消していない申し出
 * @param now いまの日時（まだ終わっていない勤務に「退勤がありません」を出さないため）
 * @param from・to この期間（その日を含む）の行だけを返す
 */
export const buildDayRows = (args: {
  punches: Punch[];
  requests?: PunchRequest[];
  now: number;
  from?: string;
  to?: string;
}): DayRow[] => {
  const { now } = args;
  const drafts = new Map<string, Map<string, RowDraft>>(); // スタッフID → 日 → 行
  const draftsOf = (staffId: string) => {
    let m = drafts.get(staffId);
    if (!m) drafts.set(staffId, (m = new Map()));
    return m;
  };

  const punchesByStaff = new Map<string, Punch[]>();
  for (const p of args.punches) {
    const list = punchesByStaff.get(p.staffId) ?? [];
    list.push(p);
    punchesByStaff.set(p.staffId, list);
  }

  for (const [staffId, punches] of punchesByStaff) {
    const byDate = draftsOf(staffId);
    const { shifts, orphans } = splitShifts(punches);
    for (const shift of shifts) {
      const existing = byDate.get(shift.date);
      if (!existing) {
        byDate.set(shift.date, draftFromShift(staffId, shift, now));
        continue;
      }
      const exit = shift.exits[shift.exits.length - 1];
      existing.row.notes.push(
        `1日に2回出勤しています（2回目 ${t(shift.entry)}〜${exit ? t(exit) : ""}）。2回目は Q に入りません`
      );
    }
    for (const p of orphans) {
      const date = jstDate(p.at);
      let draft = byDate.get(date);
      if (!draft) {
        draft = emptyDraft(staffId, date, false);
        draft.row.notes.push("出勤がありません");
        byDate.set(date, draft);
      }
      if (!draft.fromShift && (p.kind === "break_start" || p.kind === "break_end")) {
        draft.orphanBreaks.push(p);
        continue;
      }
      const kind = p.kind as TimeRequestKind;
      const prev = draft.sources[kind];
      if (!draft.fromShift && kind === "exit" && !prev) {
        draft.sources.exit = p;
      } else if (!draft.fromShift && kind === "exit" && prev) {
        draft.row.notes.push(`退勤を2回押しています（${t(prev)}・${t(p)}）。後の退勤を入れました`);
        draft.sources.exit = p;
      } else {
        draft.row.notes.push(`ほかに ${PUNCH_LABELS[p.kind]} ${t(p)} を押しています（その日の勤務と合わないので、Q には入りません）`);
      }
    }
    // 出勤のない行の休憩：押した順に組にする
    for (const draft of byDate.values()) {
      if (draft.fromShift || draft.orphanBreaks.length === 0) continue;
      putBreaks(draft, pairsOf(sortPunches(draft.orphanBreaks), draft.row.notes), true);
    }
  }

  // 申し出：同じ人・同じ日・同じ種類なら、後の申し出を使う（休憩は、ちがう時刻ならどれも使う）
  const latest = new Map<string, PunchRequest>();
  for (const r of args.requests ?? []) {
    const key = `${r.staffId}\u0000${r.date}\u0000${r.kind}${r.kind === "break" ? `\u0000${r.time}\u0000${r.endTime}` : ""}`;
    const prev = latest.get(key);
    if (!prev || r.requestedAt > prev.requestedAt || (r.requestedAt === prev.requestedAt && r.id > prev.id)) {
      latest.set(key, r);
    }
  }
  const requestsByDay = new Map<string, PunchRequest[]>();
  for (const r of latest.values()) {
    const key = `${r.staffId}\u0000${r.date}`;
    const list = requestsByDay.get(key) ?? [];
    list.push(r);
    requestsByDay.set(key, list);
  }
  const kindOrder: RequestKind[] = ["entry", "exit", "break", "no_break"];
  for (const list of requestsByDay.values()) {
    const { staffId, date } = list[0];
    const byDate = draftsOf(staffId);
    let draft = byDate.get(date);
    if (!draft) {
      draft = emptyDraft(staffId, date, false);
      byDate.set(date, draft);
    }
    const ordered = kindOrder.flatMap((k) =>
      list.filter((r) => r.kind === k).sort((a, b) => a.time.localeCompare(b.time) || a.requestedAt - b.requestedAt)
    );
    for (const r of ordered) {
      if (r.kind === "no_break") draft.row.noBreakRequest = true;
      else if (r.kind === "break") draft.row.requestBreaks.push({ start: r.time, end: r.endTime });
      else draft.row.requests[r.kind] = r.time;
    }
    draft.row.requestReason = ordered.map(requestReasonText).join("／");
  }

  const rows: DayRow[] = [];
  for (const byDate of drafts.values()) {
    for (const draft of byDate.values()) {
      const { row, sources, breakPunches } = draft;
      if ((args.from && row.date < args.from) || (args.to && row.date > args.to)) continue;
      for (const k of TIME_REQUEST_KINDS) {
        const p = sources[k];
        row.times[k] = p ? jstTime(p.at) : "";
      }
      const used = [...Object.values(sources), ...breakPunches].filter((p): p is Punch => !!p);
      row.cardless = PUNCH_KINDS.filter((k) => used.some((p) => p.kind === k && p.method === "id"));
      row.web = PUNCH_KINDS.filter((k) => used.some((p) => p.kind === k && p.method === "web"));
      rows.push(row);
    }
  }
  return rows.sort((a, b) => compareStaffId(a.staffId, b.staffId) || a.date.localeCompare(b.date));
};

/** いまの状態（出勤前・出勤中・休憩中・退勤済み） */
export type WorkState = "before" | "working" | "on_break" | "done";

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  before: "出勤前",
  working: "出勤中",
  on_break: "休憩中",
  done: "退勤済み",
};

/** いまの状態で押すはずのボタン（打刻の画面で大きく出す） */
export const SUGGESTED_KIND: Record<WorkState, PunchKind> = {
  before: "entry",
  working: "exit",
  on_break: "break_end",
  done: "entry",
};

/**
 * 1人のいまの状態。
 * @param punches その人の、取り消していない打刻
 */
export const workStateOf = (punches: Punch[], now: number): WorkState => {
  const { shifts } = splitShifts(punches.filter((p) => p.at <= now));
  const last = shifts[shifts.length - 1];
  if (!last || now - last.entry.at >= MAX_SHIFT_MS) return "before";
  if (last.exits.length > 0) {
    const exit = last.exits[last.exits.length - 1];
    return jstDate(exit.at) === jstDate(now) ? "done" : "before";
  }
  let onBreak = false;
  for (const p of last.members) {
    if (p.kind === "break_start") onBreak = true;
    if (p.kind === "break_end") onBreak = false;
  }
  return onBreak ? "on_break" : "working";
};
