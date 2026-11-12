/**
 * 勤怠の「CSV 取り込み」のボタンと、取り込む前のまとめ（確かめの画面）
 * 勤怠の「一括操作 (CSV)」と、「TimeQard（打刻）」の画面の両方で使う。くわしくは timeqard/DESIGN.md の 5.5
 *
 * 1. CSV を選ぶ（UTF-8 で読めなければ Shift_JIS として読む）
 * 2. 会社の印・形式・ID・日付・時刻を確かめ、会社ファイルの勤怠（確定した日・修正の欄）と合わせて、まとめを出す
 * 3. 「取り込む」で、打刻の列と、選んだ申し出を、1つのトランザクションでまとめて書き込む（全部入るか、何も入らないか）
 * 4. 取り込んだこと（ファイル名・期間・件数）を、Q の記録（ログ）に残す
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { FileDown } from "lucide-react";
import { companyMarkLabel, PUNCH_LABELS, timeLabel } from "../../../shared/timeqard";
import {
  decodeCsvBytes,
  dayKey,
  importRequestLabel,
  importStatements,
  planAttendanceImport,
  readAttendanceImport,
  type ExistingDay,
  type ImportPlan,
} from "../../utils/attendanceImport";
import { executeBatch } from "../../utils/dbBatch";
import { writeLog } from "../../utils/logUtils";
import { useToast } from "../../components/Toast";
import { useMessageDialog } from "../../components/MessageDialog";
import { modernIconBtnStyle } from "../../styles/styles";
import { loadTimeQardSettings } from "../timeqard/timeqardStore";

interface Props {
  db: any;
  staffList: { id: string | number; name: string }[];
  /** 取り込んだあと（勤怠の画面を読み込み直すなど） */
  onImported?: () => void | Promise<void>;
  userName?: string;
  style?: CSSProperties;
}

interface Preview {
  fileName: string;
  plan: ImportPlan;
}

const MAX_LIST = 200; // 一覧に出す行の上限（多すぎると画面が重くなる）

export default function AttendanceImportButton({ db, staffList, onImported, userName, style }: Props) {
  const toast = useToast();
  const dialog = useMessageDialog();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const loadPreview = async (fileName: string, text: string) => {
    const settings = await loadTimeQardSettings(db);
    const read = readAttendanceImport(text, {
      staff: staffList.map((s) => ({ id: String(s.id), name: s.name })),
      companyMark: settings?.companyMark ?? null,
    });
    if (read.error) {
      await dialog.warning(read.error, "取り込めません");
      return;
    }
    const existing = new Map<string, ExistingDay>();
    if (read.period) {
      const rows = (await db.select(
        `SELECT staff_id, work_date, is_finalized, entry_time, exit_time, break_start, break_end, out_time, return_time, memo, break_none
         FROM attendance WHERE work_date BETWEEN ? AND ?`,
        [read.period.from, read.period.to]
      )) as any[];
      for (const r of rows ?? []) {
        existing.set(dayKey(String(r.staff_id), r.work_date), {
          finalized: Number(r.is_finalized) === 1,
          manual: {
            entry: r.entry_time ?? "",
            exit: r.exit_time ?? "",
            break_start: r.break_start ?? "",
            break_end: r.break_end ?? "",
            out: r.out_time ?? "",
            return: r.return_time ?? "",
          },
          memo: r.memo ?? "",
          breakNone: Number(r.break_none) === 1,
        });
      }
    }
    setSelected(new Set());
    setPreview({ fileName, plan: planAttendanceImport(read, existing) });
  };

  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
        await loadPreview(file.name, text);
      } catch (e) {
        console.error(e);
        await dialog.error(`CSV を読めませんでした。\n${e}`);
      }
    };
    input.click();
  };

  const runImport = async () => {
    if (!preview) return;
    const { plan, fileName } = preview;
    setBusy(true);
    try {
      const statements = importStatements(plan, selected);
      const results = await executeBatch(db, statements);
      const upserts = results.slice(0, plan.toWrite.length);
      const imported = upserts.filter((r) => r.rowsAffected > 0).length;
      const finalizedNow = upserts.length - imported; // まとめを出したあとに確定した日
      const applied = results.slice(plan.toWrite.length).filter((r) => r.rowsAffected > 0).length;
      const period = plan.period ? `${plan.period.from}〜${plan.period.to}` : "期間なし";
      const source = plan.fromTimeQard ? `TimeQard の打刻・会社の印 ${plan.companyMark ?? "なし"}` : "CSV";
      await writeLog(
        db,
        "INFO",
        "attendance",
        `勤怠の CSV を取り込みました：${fileName}（${source}）${period}・${imported}日分` +
          `（確定した日で入れなかった ${plan.finalized.length + finalizedNow}日分・Q にない ID ${plan.unknownIds.reduce((a, x) => a + x.rows, 0)}行・` +
          `読めない行 ${plan.invalid.length}行・申し出を修正の欄に入れた ${applied}件）`,
        userName
      );
      toast.success(`「${fileName}」から${imported}日分を取り込みました${applied > 0 ? `（申し出 ${applied}件を修正の欄に入れました）` : ""}`);
      if (finalizedNow > 0) toast.info(`取り込むあいだに確定した${finalizedNow}日分は、上書きしませんでした`);
      setPreview(null);
      await onImported?.();
    } catch (e) {
      console.error(e);
      await dialog.error(`取り込めませんでした（何も書き込んでいません）。\n${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={pickFile} style={{ ...modernIconBtnStyle("#2980b9"), ...style }}>
        <FileDown size={16} style={{ marginRight: 6 }} /> CSVファイルを読み込む
      </button>
      {preview && (
        <PreviewDialog
          preview={preview}
          selected={selected}
          setSelected={setSelected}
          busy={busy}
          onCancel={() => setPreview(null)}
          onImport={runImport}
        />
      )}
    </>
  );
}

const th: CSSProperties = { textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #ddd", background: "#f5f7fa", fontSize: 12, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "4px 8px", borderBottom: "1px solid #eee", fontSize: 12, verticalAlign: "top" };

function Section({ title, color = "#34495e", children }: { title: string; color?: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: "bold", fontSize: 13, color, borderLeft: `4px solid ${color}`, paddingLeft: 8, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function More({ total }: { total: number }) {
  return total > MAX_LIST ? <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>ほかに {total - MAX_LIST} 件あります</div> : null;
}

/** 取り込む前のまとめ（確かめ用の画面 timeqard/dev/import.tsx からも使う） */
export function PreviewDialog(props: {
  preview: Preview;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  busy: boolean;
  onCancel: () => void;
  onImport: () => void;
}) {
  const { plan, fileName } = props.preview;
  const { selected, setSelected } = props;
  const people = new Set(plan.toWrite.map((r) => r.staffId)).size;
  const unknownRows = plan.unknownIds.reduce((a, x) => a + x.rows, 0);
  const applicable = plan.requests.filter((r) => r.applicable);
  const cardless = plan.toWrite.filter((r) => r.cardless.length > 0);
  const web = plan.toWrite.filter((r) => r.web.length > 0);
  const notes = plan.toWrite.filter((r) => r.notes.length > 0);
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 10, width: "min(960px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 16, fontWeight: "bold" }}>CSV の取り込み：まだ書き込んでいません</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{fileName}</div>
        </div>

        <div style={{ padding: "12px 20px", overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <tr><td style={td}>種類</td><td style={td}>{plan.fromTimeQard ? `TimeQard の打刻（会社の印 ${companyMarkLabel(plan.companyMark ?? "")}）` : "CSV（TimeQard のものではありません）"}</td></tr>
              <tr><td style={td}>期間</td><td style={td}>{plan.period ? `${plan.period.from} 〜 ${plan.period.to}` : "なし"}</td></tr>
              <tr><td style={td}>入れる</td><td style={{ ...td, fontWeight: "bold" }}>{plan.toWrite.length} 日分（{people} 人）。打刻の欄だけを入れ直します（修正の欄・確定はそのまま）</td></tr>
              {plan.finalized.length > 0 && <tr><td style={td}>入れない</td><td style={td}>確定した日 {plan.finalized.length} 日分（上書きしません）</td></tr>}
              {unknownRows > 0 && <tr><td style={td}>入れない</td><td style={{ ...td, color: "#c0392b" }}>Q の従業員にない ID の行 {unknownRows} 行（下に一覧）</td></tr>}
              {plan.invalid.length > 0 && <tr><td style={td}>入れない</td><td style={{ ...td, color: "#c0392b" }}>読めない行 {plan.invalid.length} 行（下に一覧）</td></tr>}
              {plan.fixedValues > 0 && <tr><td style={td}>直した</td><td style={td}>日付・時刻の形 {plan.fixedValues} か所（「2026/11/7」→「2026-11-07」、「8:58」→「08:58」など）</td></tr>}
              {plan.fixedIds.length > 0 && <tr><td style={td}>直した</td><td style={td}>ID {plan.fixedIds.map((x) => `${x.csvId} → ${x.staffId}`).join("、")}</td></tr>}
              {plan.duplicates.length > 0 && <tr><td style={td}>同じ日</td><td style={td}>同じ人・同じ日の行が2つ以上 {plan.duplicates.length} 件（後の行を使います）</td></tr>}
            </tbody>
          </table>

          {plan.unknownIds.length > 0 && (
            <Section title="Q の従業員にない ID（入れません）" color="#c0392b">
              <div style={{ fontSize: 12 }}>
                {plan.unknownIds.slice(0, MAX_LIST).map((x) => `${x.id}（${x.rows}行）`).join("、")}
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>従業員の登録を確かめてから、もう一度取り込んでください（同じ CSV を何度取り込んでも大丈夫です）。</div>
            </Section>
          )}

          {plan.invalid.length > 0 && (
            <Section title="読めない行（入れません）" color="#c0392b">
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>行</th><th style={th}>わけ</th></tr></thead>
                <tbody>
                  {plan.invalid.slice(0, MAX_LIST).map((x) => (
                    <tr key={x.rowNumber}><td style={td}>{x.rowNumber}行目</td><td style={td}>{x.reason}</td></tr>
                  ))}
                </tbody>
              </table>
              <More total={plan.invalid.length} />
            </Section>
          )}

          {plan.requests.length > 0 && (
            <Section title={`押し忘れの申し出（${plan.requests.length}件）`} color="#8e44ad">
              <div style={{ fontSize: 12, color: "#555", marginBottom: 6, lineHeight: 1.6 }}>
                本人の申し出です。実際の時刻と合っているかを確かめてから、入れるものを選んでください。選んだものは、その日の修正の欄に入れ、備考に「TimeQard の申し出：…」と書き足します。
                「休憩を取れなかった」を選ぶと、その日を「休憩なし」にします（給与規定グループの決まった休憩を引きません）。確定は、いつもどおり勤怠の画面でします。
                <br />あとで確かめるときは、同じ CSV をもう一度取り込めば、ここに出ます。
              </div>
              {applicable.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <button style={{ ...modernIconBtnStyle("#8e44ad"), margin: 0 }} onClick={() => setSelected(new Set(applicable.map((r) => r.key)))}>入れられるものを全部選ぶ</button>
                  <button style={{ ...modernIconBtnStyle("#7f8c8d") }} onClick={() => setSelected(new Set())}>選ぶのをやめる</button>
                </div>
              )}
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>入れる</th><th style={th}>日</th><th style={th}>名前</th><th style={th}>種類</th><th style={th}>時刻</th><th style={th}>理由</th><th style={th}></th></tr></thead>
                <tbody>
                  {plan.requests.slice(0, MAX_LIST).map((r) => (
                    <tr key={r.key} style={{ color: r.applicable ? undefined : "#999" }}>
                      <td style={td}><input type="checkbox" disabled={!r.applicable} checked={selected.has(r.key)} onChange={() => toggle(r.key)} /></td>
                      <td style={td}>{r.date}</td>
                      <td style={td}>{r.name}（{r.staffId}）</td>
                      <td style={td}>{importRequestLabel(r.kind)}</td>
                      <td style={td}>{r.time ? timeLabel(r.time) : ""}</td>
                      <td style={td}>{r.reason}</td>
                      <td style={td}>{r.whyNot ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <More total={plan.requests.length} />
            </Section>
          )}

          {cardless.length > 0 && (
            <Section title={`カードなし（ID で押した）打刻（${cardless.length}日分）`} color="#d35400">
              <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>カードを使わずに、スタッフID を入れて押した打刻です。本人が押したかを確かめてください。</div>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>日</th><th style={th}>名前</th><th style={th}>ID で押した種類</th></tr></thead>
                <tbody>
                  {cardless.slice(0, MAX_LIST).map((r) => (
                    <tr key={dayKey(r.staffId, r.date)}><td style={td}>{r.date}</td><td style={td}>{r.name}（{r.staffId}）</td><td style={td}>{r.cardless.map((k) => PUNCH_LABELS[k]).join("・")}</td></tr>
                  ))}
                </tbody>
              </table>
              <More total={cardless.length} />
            </Section>
          )}

          {web.length > 0 && (
            <Section title={`ブラウザで押した打刻（${web.length}日分）`} color="#00695c">
              <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
                各自のパソコンのブラウザで、スタッフID とパスワードでログインして押した打刻です（時刻は、入口のパソコンの時計で記録しています）。
                どのパソコンから押したかは、TimeQard の管理の画面の「打刻の一覧」で見られます。
              </div>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>日</th><th style={th}>名前</th><th style={th}>ブラウザで押した種類</th></tr></thead>
                <tbody>
                  {web.slice(0, MAX_LIST).map((r) => (
                    <tr key={dayKey(r.staffId, r.date)}><td style={td}>{r.date}</td><td style={td}>{r.name}（{r.staffId}）</td><td style={td}>{r.web.map((k) => PUNCH_LABELS[k]).join("・")}</td></tr>
                  ))}
                </tbody>
              </table>
              <More total={web.length} />
            </Section>
          )}

          {notes.length > 0 && (
            <Section title={`注意（${notes.length}日分）`} color="#b7950b">
              <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Q の1日の行に入らない打刻などです。取り込んだあと、勤怠の画面で確かめて直してください。</div>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>日</th><th style={th}>名前</th><th style={th}>注意</th></tr></thead>
                <tbody>
                  {notes.slice(0, MAX_LIST).map((r) => (
                    <tr key={dayKey(r.staffId, r.date)}><td style={td}>{r.date}</td><td style={td}>{r.name}（{r.staffId}）</td><td style={td}>{r.notes.join("／")}</td></tr>
                  ))}
                </tbody>
              </table>
              <More total={notes.length} />
            </Section>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid #eee", display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
          {selected.size > 0 && <span style={{ fontSize: 12, color: "#8e44ad" }}>申し出 {selected.size}件を修正の欄に入れます</span>}
          <button onClick={props.onCancel} disabled={props.busy} style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>やめる</button>
          <button
            onClick={props.onImport}
            disabled={props.busy || (plan.toWrite.length === 0 && selected.size === 0)}
            style={{ padding: "8px 22px", borderRadius: 6, border: "none", background: plan.toWrite.length === 0 && selected.size === 0 ? "#bdc3c7" : "#2980b9", color: "#fff", fontWeight: "bold", cursor: "pointer" }}
          >
            {props.busy ? "取り込んでいます…" : "取り込む"}
          </button>
        </div>
      </div>
    </div>
  );
}
