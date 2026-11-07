/**
 * 打刻の記録から、1人1日1行（Q の勤怠の1行）を作る（くわしくは timeqard/DESIGN.md の 4.5・付録 E）
 *
 * ・出勤を押すと、新しい勤務が始まる。勤務の日は、出勤を押した日（日本時間）。日をまたぐ夜勤も、出勤した日の行にする
 *   （Q も「退勤が出勤より前なら次の日」として、出勤した日の行で数える）。
 * ・退勤・休憩・外出は、24時間のうちに始まった、まだ退勤していない勤務の分。そういう勤務がなければ、押した日の行にして
 *   「出勤がありません」と注意を出す。
 * ・Q の1日の行には、出勤・退勤・休憩1組・外出1組しか入らない。入らない打刻（2回目の休憩、1日に2回の出勤など）は、
 *   注意に書いて、担当者が Q で直せるようにする（TimeQard の記録には、すべて残っている）。
 * ・取り消した打刻・申し出は、呼ぶ側で外してから渡す。
 */
import { PUNCH_KINDS, PUNCH_LABELS, type PunchKind, type PunchMethod } from "./kinds";
import { DAY_MS, HOUR_MS, MINUTE_MS, jstDate, jstTime, timeLabel } from "./time";
import { compareStaffId } from "./staffFile";

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
  kind: PunchKind;
  /** 申し出た時刻（「09:00」） */
  time: string;
  reason: string;
  note: string;
  /** 申し出た日時（ミリ秒）。同じ日・同じ種類の申し出が2つあれば、後のものを使う */
  requestedAt: number;
}

export interface DayRow {
  staffId: string;
  date: string;
  /** 打刻の時刻（「08:58」。なければ ""） */
  times: Record<PunchKind, string>;
  /** 申し出た時刻（申し出がない種類は入れない） */
  requests: Partial<Record<PunchKind, string>>;
  /** 申し出の理由（「退勤：押し間違えた（会議が長引いた）」。2つ以上は「／」で区切る） */
  requestReason: string;
  /** ID で押した（カードなしの）打刻の種類（行に入れた打刻のうち） */
  cardless: PunchKind[];
  notes: string[];
}

/** 1つの勤務の長さの上限（Q は24時間を超える勤務を数えられない） */
export const MAX_SHIFT_MS = DAY_MS;
/** 退勤のあと、この長さのうちにもう一度退勤を押したら、同じ勤務の退勤にする（押し直し・呼び戻されて少し働いたとき） */
export const EXIT_REPRESS_MS = 3 * HOUR_MS;
/** 休憩・外出のボタンを、この長さのうちに2回押したら、押し直しとして1回にする */
export const DOUBLE_PRESS_MS = 10 * MINUTE_MS;

interface Shift {
  date: string;
  entry: Punch;
  duplicateEntries: Punch[];
  /** 退勤のほかの打刻（休憩・外出） */
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

/** 休憩（または外出）の打刻を、始めと終わりの組にする */
const pairsOf = (members: Punch[], startKind: PunchKind, endKind: PunchKind, notes: string[]): Pair[] => {
  const pairs: Pair[] = [];
  for (const p of members) {
    const last = pairs[pairs.length - 1];
    if (p.kind === startKind) {
      if (last?.start && !last.end && p.at - last.start.at <= DOUBLE_PRESS_MS) {
        notes.push(`${PUNCH_LABELS[startKind]}を2回押しています（${t(last.start)}・${t(p)}）。初めのほうを入れました`);
        continue;
      }
      pairs.push({ start: p });
    } else if (p.kind === endKind) {
      if (last?.start && !last.end) {
        last.end = p;
        continue;
      }
      if (last?.end && p.at - last.end.at <= DOUBLE_PRESS_MS) {
        notes.push(`${PUNCH_LABELS[endKind]}を2回押しています（${t(last.end)}・${t(p)}）。初めのほうを入れました`);
        continue;
      }
      pairs.push({ end: p });
    }
  }
  return pairs;
};

interface RowDraft {
  row: DayRow;
  sources: Partial<Record<PunchKind, Punch>>;
  /** 出勤から始まる勤務の行か（出勤のない打刻だけの行は false） */
  fromShift: boolean;
}

const emptyTimes = (): Record<PunchKind, string> => ({
  entry: "",
  exit: "",
  break_start: "",
  break_end: "",
  out: "",
  return: "",
});

const emptyDraft = (staffId: string, date: string, fromShift: boolean): RowDraft => ({
  row: { staffId, date, times: emptyTimes(), requests: {}, requestReason: "", cardless: [], notes: [] },
  sources: {},
  fromShift,
});

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

  const pairKinds: [PunchKind, PunchKind, string][] = [
    ["break_start", "break_end", "休憩"],
    ["out", "return", "外出"],
  ];
  for (const [startKind, endKind, name] of pairKinds) {
    const pairs = pairsOf(shift.members, startKind, endKind, notes);
    const first = pairs[0];
    if (first?.start) sources[startKind] = first.start;
    if (first?.end) sources[endKind] = first.end;
    if (first && !first.start && first.end) {
      notes.push(`${PUNCH_LABELS[startKind]}がありません（${PUNCH_LABELS[endKind]} ${t(first.end)}）`);
    }
    if (first?.start && !first.end && finished) {
      notes.push(`${PUNCH_LABELS[endKind]}がありません（${PUNCH_LABELS[startKind]} ${t(first.start)}）`);
    }
    pairs.slice(1).forEach((pair, i) => {
      const range = `${pair.start ? t(pair.start) : "?"}〜${pair.end ? t(pair.end) : "?"}`;
      notes.push(`${i + 2}回目の${name}（${range}）は Q に入りません`);
    });
  }
  return draft;
};

/** 申し出の理由の文（「退勤：押し間違えた（会議が長引いた）」） */
export const requestReasonText = (r: Pick<PunchRequest, "kind" | "reason" | "note">) => {
  const note = r.note.trim();
  return `${PUNCH_LABELS[r.kind]}：${r.reason}${note ? `（${note}）` : ""}`;
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
      const prev = draft.sources[p.kind];
      if (!draft.fromShift && !prev) {
        draft.sources[p.kind] = p;
      } else if (!draft.fromShift && p.kind === "exit" && prev) {
        draft.row.notes.push(`退勤を2回押しています（${t(prev)}・${t(p)}）。後の退勤を入れました`);
        draft.sources.exit = p;
      } else {
        draft.row.notes.push(`ほかに ${PUNCH_LABELS[p.kind]} ${t(p)} を押しています（その日の勤務と合わないので、Q には入りません）`);
      }
    }
  }

  // 申し出：同じ人・同じ日・同じ種類なら、後の申し出を使う
  const latest = new Map<string, PunchRequest>();
  for (const r of args.requests ?? []) {
    const key = `${r.staffId}\u0000${r.date}\u0000${r.kind}`;
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
  for (const list of requestsByDay.values()) {
    const { staffId, date } = list[0];
    const byDate = draftsOf(staffId);
    let draft = byDate.get(date);
    if (!draft) {
      draft = emptyDraft(staffId, date, false);
      byDate.set(date, draft);
    }
    const ordered = PUNCH_KINDS.flatMap((k) => list.filter((r) => r.kind === k));
    for (const r of ordered) draft.row.requests[r.kind] = r.time;
    draft.row.requestReason = ordered.map(requestReasonText).join("／");
  }

  const rows: DayRow[] = [];
  for (const byDate of drafts.values()) {
    for (const draft of byDate.values()) {
      const { row, sources } = draft;
      if ((args.from && row.date < args.from) || (args.to && row.date > args.to)) continue;
      for (const k of PUNCH_KINDS) {
        const p = sources[k];
        row.times[k] = p ? jstTime(p.at) : "";
      }
      row.cardless = PUNCH_KINDS.filter((k) => sources[k]?.method === "id");
      rows.push(row);
    }
  }
  return rows.sort((a, b) => compareStaffId(a.staffId, b.staffId) || a.date.localeCompare(b.date));
};

/** いまの状態（出勤前・出勤中・休憩中・外出中・退勤済み） */
export type WorkState = "before" | "working" | "on_break" | "out" | "done";

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  before: "出勤前",
  working: "出勤中",
  on_break: "休憩中",
  out: "外出中",
  done: "退勤済み",
};

/** いまの状態で押すはずのボタン（打刻の画面で大きく出す） */
export const SUGGESTED_KIND: Record<WorkState, PunchKind> = {
  before: "entry",
  working: "exit",
  on_break: "break_end",
  out: "return",
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
  let out = false;
  for (const p of last.members) {
    if (p.kind === "break_start") onBreak = true;
    if (p.kind === "break_end") onBreak = false;
    if (p.kind === "out") out = true;
    if (p.kind === "return") out = false;
  }
  if (onBreak) return "on_break";
  if (out) return "out";
  return "working";
};
