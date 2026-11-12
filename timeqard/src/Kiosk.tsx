/**
 * 打刻の画面（いつも出している画面。くわしくは timeqard/DESIGN.md の 4.1）
 *
 * ・カード（QR コード）を読み取り機にかざすか、「ID で押す」で人を見つける。ほかの人の名前や打刻は出さない。
 * ・人が見つかったら、いまの状態（出勤前・出勤中など）と、押すはずのボタンを大きく出す。ほかのボタンは「そのほか」から。
 * ・押したら「○○さん　出勤 8:58 を記録しました」と出し、音で知らせる。1分のあいだは「取り消す」を押せる。
 * ・パソコンの時計がおかしいときは、押させない。
 */
import { useEffect, useRef, useState } from "react";
import {
  DAY_MS,
  jstDate,
  jstDateLabel,
  jstParts,
  jstTime,
  looksLikeCardPayload,
  NO_BREAK_LABEL,
  parseIso,
  PUNCH_LABELS,
  shortDateLabel,
  timeLabel,
  workStateOf,
  WORK_STATE_LABELS,
  type Punch,
  type PunchKind,
  type PunchMethod,
} from "../../shared/timeqard";
import { addPunch, addRequest, cancelRecord, CANCEL_WINDOW_MS, clockProblem, loadPunches, type KioskDb, type KioskSettings, type KioskStaff } from "./store";
import { availableKinds, findByCard, findById, punchBlockReason, suggestedKind } from "./kioskRules";
import { useScanner } from "./useScanner";
import { useNow } from "./useNow";
import IdDialog from "./IdDialog";
import CameraScanner from "./CameraScanner";
import { makeScanGate } from "./scanGate";
import RequestDialog, { type RequestInput } from "./RequestDialog";
import { playError, playOk } from "./sound";

interface Props {
  db: KioskDb;
  settings: KioskSettings;
  staff: KioskStaff[];
  lastPunch: number | null;
  /** ブラウザ版を始められなかったわけ（空なら、なし） */
  webProblem: string;
  onChanged: () => Promise<void> | void;
  onAdmin: () => void;
}

interface Current {
  person: KioskStaff;
  method: PunchMethod;
  punches: Punch[];
}

interface Banner {
  tone: "ok" | "ng" | "warn";
  text: string;
  at: number;
  cancel?: { target: "punch" | "request"; id: number; until: number };
}

/** 人の画面を、何もしなければ閉じるまでの長さ */
const PERSON_TIMEOUT_MS = 30_000;
/** 知らせを出しておく長さ（取り消しのボタンがあるときは、1分） */
const BANNER_MS = 8_000;

export default function Kiosk(props: Props) {
  const { db, settings, staff } = props;
  const now = useNow();
  const [current, setCurrent] = useState<Current | null>(null);
  const [confirmPerson, setConfirmPerson] = useState<KioskStaff | null>(null);
  const [idOpen, setIdOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const lastAction = useRef(Date.now());
  const busy = useRef(false);
  const cameraGate = useRef(makeScanGate());

  const mark = settings.companyMark ?? "";
  const kinds = availableKinds(settings);
  const problem = clockProblem(now, props.lastPunch, settings.staffFileExportedAt);
  const tzWrong = new Date(now).getTimezoneOffset() !== -540;
  const exportedMs = settings.staffFileExportedAt ? parseIso(settings.staffFileExportedAt) : null;

  const say = (tone: Banner["tone"], text: string, cancel?: Banner["cancel"]) => {
    setBanner({ tone, text, at: Date.now(), cancel });
    if (settings.sound) (tone === "ok" ? playOk : playError)();
  };

  const openPerson = async (person: KioskStaff, method: PunchMethod) => {
    const at = Date.now();
    const block = punchBlockReason(person, jstDate(at));
    if (block) {
      say("ng", `${person.name}さん：${block}`);
      return;
    }
    const punches = await loadPunches(db, { companyMark: mark, staffId: person.id, fromMs: at - 2 * DAY_MS, toMs: at + 60_000 });
    lastAction.current = Date.now();
    setShowOthers(false);
    setCurrent({ person, method, punches });
  };

  const onInput = async (text: string) => {
    if (busy.current) return;
    lastAction.current = Date.now();
    // 新しくカードを読んだ（ID を入れた）ら、前の人の画面を閉じる（次の人が、前の人のボタンを押さないように）
    setCurrent(null);
    if (looksLikeCardPayload(text)) {
      const found = await findByCard(staff, mark, text);
      setIdOpen(false);
      setConfirmPerson(null);
      if (!found.ok) {
        say("ng", found.error);
        return;
      }
      await openPerson(found.person, "card");
      return;
    }
    const person = findById(staff, text);
    setIdOpen(false);
    if (!person) {
      say("ng", `ID「${text}」の人が見つかりません。ID を確かめて、もう一度入れてください。`);
      return;
    }
    setConfirmPerson(person);
  };

  // 読み取り機・キーボード（ID を打って Enter）。ほかの画面を出しているあいだは、そちらが受け取る
  useScanner(!idOpen && !requestOpen && !confirmPerson, onInput);

  // カメラで読んだ QR コード（かざしたままのカードは、いったん離すまで受け取らない。ID を入れる画面などを出しているあいだは受け取らない）
  const onCamera = (text: string) => {
    if (!cameraGate.current(text, Date.now())) return;
    if (idOpen || requestOpen || confirmPerson) return;
    if (!looksLikeCardPayload(text)) {
      say("ng", "TimeQard の打刻カードではありません。");
      return;
    }
    void onInput(text);
  };

  useEffect(() => {
    if (current && !requestOpen && now - lastAction.current > PERSON_TIMEOUT_MS) setCurrent(null);
    if (banner) {
      const keep = banner.cancel ? Math.max(BANNER_MS, banner.cancel.until - banner.at) : BANNER_MS;
      if (now - banner.at > keep) setBanner(null);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const punch = async (kind: PunchKind) => {
    if (!current || busy.current) return;
    const at = Date.now();
    const p = clockProblem(at, props.lastPunch, settings.staffFileExportedAt);
    if (p) {
      say("ng", `${p} 時計を直すまで押せません。担当者に伝えてください。`);
      return;
    }
    busy.current = true;
    try {
      const id = await addPunch(db, { staffId: current.person.id, kind, at, method: current.method, companyMark: mark });
      say("ok", `${current.person.name}さん　${PUNCH_LABELS[kind]} ${timeLabel(jstTime(at))} を記録しました`, {
        target: "punch",
        id,
        until: at + CANCEL_WINDOW_MS,
      });
      setCurrent(null);
      await props.onChanged();
    } catch (e) {
      say("ng", `記録できませんでした。担当者に伝えてください。（${e}）`);
    } finally {
      busy.current = false;
    }
  };

  const cancel = async () => {
    const c = banner?.cancel;
    if (!c) return;
    try {
      await cancelRecord(db, c.target, c.id, Date.now());
      say("warn", c.target === "punch" ? "いまの打刻を取り消しました。押し直してください。" : "いまの申し出を取り消しました。");
      await props.onChanged();
    } catch (e) {
      say("ng", e instanceof Error ? e.message : String(e));
    }
  };

  const submitRequest = async (r: RequestInput) => {
    if (!current) return;
    const at = Date.now();
    const id = await addRequest(db, { staffId: current.person.id, ...r, at, method: current.method, companyMark: mark });
    setRequestOpen(false);
    const what = r.kind === "no_break" ? `「${NO_BREAK_LABEL}」` : `${PUNCH_LABELS[r.kind]} ${timeLabel(r.time)} `;
    say("ok", `${current.person.name}さん　${shortDateLabel(r.date)}の${what}の申し出を受け付けました（担当者が確かめます）`, {
      target: "request",
      id,
      until: at + CANCEL_WINDOW_MS,
    });
    setCurrent(null);
  };

  const p = jstParts(now);
  const state = current ? workStateOf(current.punches, now) : null;
  const suggested = state ? suggestedKind(state, kinds) : null;
  const todays = current ? current.punches.filter((x) => jstDate(x.at) === jstDate(now)) : [];
  const cancelLeft = banner?.cancel ? Math.min(60, Math.max(0, Math.ceil((banner.cancel.until - now) / 1000))) : 0;

  return (
    <div className="screen">
      <div className="header">
        <div className="company">
          {settings.companyName}
          {exportedMs !== null && <span className="sub">　・{shortDateLabel(jstDate(exportedMs))}の一覧</span>}
        </div>
        <button onClick={props.onAdmin}>管理</button>
      </div>

      <div className="clock">
        <div className="date">{jstDateLabel(now)}</div>
        <div className="time">
          {p.hour}:{String(p.minute).padStart(2, "0")}
          <small>{String(p.second).padStart(2, "0")}</small>
        </div>
      </div>

      <div className="main">
        {problem && (
          <div className="notice ng">
            <b>パソコンの時計がおかしいので、押せません。</b> {problem} 担当者は、パソコンの時計（日付と時刻）を直してください。
          </div>
        )}
        {tzWrong && !problem && (
          <div className="notice warn">パソコンのタイムゾーンが日本（東京）になっていません。上の時刻が合っているか確かめてください。</div>
        )}
        {props.webProblem && (
          <div className="notice warn" style={{ fontSize: 15 }}>
            ブラウザ版を始められなかったので、各自のパソコンからは押せません。担当者は、管理の画面の「ブラウザ版」を確かめてください。
          </div>
        )}
        {banner && (
          <div className={`notice ${banner.tone}`}>
            <div className="row">
              <div className="text" style={{ fontSize: banner.tone === "ok" ? 26 : 20, fontWeight: "bold" }}>{banner.text}</div>
              {banner.cancel && cancelLeft > 0 && (
                <button className="plain-btn" onClick={cancel}>取り消す（あと{cancelLeft}秒）</button>
              )}
            </div>
          </div>
        )}

        {!current && (
          <div className="idle">
            <div className="prompt">カードをかざしてください</div>
            <div className="hint">
              QR コードの読み取り機{settings.camera ? "か、下のカメラ" : ""}にカードをかざします。カードを忘れた日は「ID で押す」を押してください。
            </div>
          </div>
        )}

        {/* カメラは、人の画面を出しているあいだも見えなくして動かしておく（次の人のカードを読むため。いつも同じ場所に置いて、作り直さない） */}
        {settings.camera && (
          <CameraScanner deviceId={settings.cameraDevice} mode={current ? "hidden" : "inline"} onDetect={onCamera} />
        )}

        {!current && (
          <div className="idle" style={{ marginTop: 0 }}>
            <button className="big-btn k-entry" style={{ background: "#37474f" }} onClick={() => setIdOpen(true)}>ID で押す</button>
            <div className="hint" style={{ marginTop: 24 }}>押し忘れ・押し間違えたときは、カードをかざすか ID を入れてから「押し忘れを申し出る」を押してください。</div>
          </div>
        )}

        {current && state && suggested && (
          <div className="person">
            <div>
              <span className="name">{current.person.name}さん</span>
              <span className="state">{WORK_STATE_LABELS[state]}</span>
            </div>
            <div className="meta">
              ID {current.person.id}
              {current.method === "id" && "　（ID で押します。カードなしの印が付きます）"}
            </div>
            <div className="today">
              今日の打刻：{todays.length === 0 ? "まだありません" : todays.map((x) => `${PUNCH_LABELS[x.kind]} ${timeLabel(jstTime(x.at))}`).join("・")}
            </div>
            <div className="actions">
              <button className={`big-btn k-${suggested}`} disabled={!!problem} onClick={() => punch(suggested)}>
                {PUNCH_LABELS[suggested]}
              </button>
              {!showOthers && kinds.length > 1 && (
                <button className="plain-btn" onClick={() => { lastAction.current = Date.now(); setShowOthers(true); }}>そのほか</button>
              )}
            </div>
            {showOthers && (
              <div className="actions">
                {kinds.filter((k) => k !== suggested).map((k) => (
                  <button key={k} className={`mid-btn k-${k}`} disabled={!!problem} onClick={() => punch(k)}>{PUNCH_LABELS[k]}</button>
                ))}
              </div>
            )}
            <div className="actions" style={{ marginTop: 18 }}>
              <button className="plain-btn" onClick={() => { lastAction.current = Date.now(); setRequestOpen(true); }}>押し忘れを申し出る</button>
              <button className="plain-btn" onClick={() => setCurrent(null)}>やめる</button>
            </div>
          </div>
        )}
      </div>

      {idOpen && <IdDialog onSubmit={onInput} onCancel={() => setIdOpen(false)} />}

      {confirmPerson && (
        <div className="modal-back">
          <div className="modal" style={{ width: "min(560px, 94vw)", textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: "bold", margin: "10px 0" }}>{confirmPerson.name}さん</div>
            <div style={{ fontSize: 20, color: "#555" }}>（ID {confirmPerson.id}）ですか？</div>
            <div className="buttons" style={{ justifyContent: "center" }}>
              <button className="mid-btn k-exit" onClick={() => setConfirmPerson(null)}>いいえ</button>
              <button
                className="mid-btn k-entry"
                onClick={async () => {
                  const person = confirmPerson;
                  setConfirmPerson(null);
                  await openPerson(person, "id");
                }}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}

      {requestOpen && current && (
        <RequestDialog
          name={current.person.name}
          now={now}
          kinds={kinds}
          onSubmit={submitRequest}
          onCancel={() => { lastAction.current = Date.now(); setRequestOpen(false); }}
        />
      )}
    </div>
  );
}
