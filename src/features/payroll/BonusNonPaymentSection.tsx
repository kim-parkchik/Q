/**
 * 賞与不支給報告書（健康保険・厚生年金保険）の欄（賞与支払届の画面の下）
 * 年金機構に登録している賞与支払予定月を会社に残し、その年の予定月ごとに賞与を払ったかを出す。払っていない月を選ぶと、
 * 報告書に書く内容（事業所・賞与支払予定年月・賞与支払年月・支給の状況・予定月の変更）を出し、印刷できる。
 * e-Gov では画面で項目を入れて出す届書なので、電子申請用のファイルは作らない。決まりは utils/bonusNonPayment.ts
 */
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { BONUS_PLAN_MONTH_LIMIT, planChangeMonths } from "../../utils/bonusNonPayment";
import { formatWareki } from "../../utils/wareki";
import { warekiMonth } from "../../utils/remunerationReport";
import type { useBonusReportManager } from "./useBonusReportManager";
import { ShahoOfficeTable, button, card, fieldStyle, input, labelStyle, note, small, table, td, th, title } from "./ShahoFilePanel";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
/** 予定月ごとの状態の文（払っていない月は、過ぎた月と今月で分ける） */
const statusText = (p: { status: "paid" | "unpaid" | "upcoming"; ym: string; bonuses: string[] }, thisMonth: string): string =>
  p.status === "paid" ? `${p.bonuses.join("・")}を払った（賞与支払届を出す）`
  : p.status === "upcoming" ? "まだその月になっていない"
  : p.ym < thisMonth ? "払っていない（賞与不支給報告書を出す）"
  : "まだ払っていない（今月払わなければ、賞与不支給報告書を出す）";

export function BonusNonPaymentSection({ z, printId, onPrint }: {
  z: ReturnType<typeof useBonusReportManager>;
  printId: string;
  onPrint: () => void;
}) {
  const [draft, setDraft] = useState<number[]>(z.planMonths);
  const saved = z.planMonths.join(",");
  useEffect(() => { setDraft(z.planMonths); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ym, setYm] = useState("");
  const [submitDate, setSubmitDate] = useState(dayjs().format("YYYY-MM-DD"));
  /** 予定月を変える：none 変えない／change 変更後の月を選ぶ／gone 予定がなくなった */
  const [change, setChange] = useState<"none" | "change" | "gone">("none");
  const [after, setAfter] = useState<number[]>([]);

  const unpaid = z.planStatuses.filter((p) => p.status === "unpaid");
  // 報告する月は、払っていない予定月から選ぶ（年や予定月を変えたら、初めの月に戻す）
  useEffect(() => {
    if (!unpaid.some((p) => p.ym === ym)) setYm(unpaid[0]?.ym ?? "");
  }, [unpaid.map((p) => p.ym).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list: number[], m: number) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m].sort((a, b) => a - b));
  // 予定月の変更（変更後の月をまだ選んでいなければ null）
  const changed = change === "change" && after.length === 0 ? null : planChangeMonths(z.planMonths, change === "none" ? null : change === "gone" ? [] : after);
  const thisMonth = dayjs().format("YYYY-MM");
  const thisYear = dayjs().year();
  const years = [thisYear - 1, thisYear, thisYear + 1];

  return (
    <>
      <div style={card} className="no-print">
        <h3 style={title}>賞与不支給報告書（健康保険・厚生年金保険）</h3>
        <p style={note}>
          日本年金機構に登録している賞与支払予定月に、どの被保険者（70歳以上被用者を含む）にも賞与を払わなかったときに出します
          （払った月は賞与支払届を出し、この報告書は出しません。出さないと、あとで年金機構から提出を勧めるお知らせが届きます）。
          電子申請（e-Gov）では、「健康保険・厚生年金保険賞与不支給報告書」の画面に下の内容を入れて出します（ファイルを添付する届書ではありません）。
          紙で出すときは、年金機構から届く用紙か、年金機構のホームページの様式に書き写します。
          これからの賞与支払予定月が登録と違うときは、「予定月を変える」で変更後の月を書きます。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <span style={labelStyle}>賞与支払予定月（年金機構に登録している月。{BONUS_PLAN_MONTH_LIMIT}つまで）</span>
          {MONTHS.map((m) => (
            <label key={m} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 2 }}>
              <input
                type="checkbox" checked={draft.includes(m)}
                disabled={!draft.includes(m) && draft.length >= BONUS_PLAN_MONTH_LIMIT}
                onChange={() => setDraft(toggle(draft, m))}
              />
              {m}月
            </label>
          ))}
          <button onClick={() => z.savePlanMonths(draft)} disabled={draft.join(",") === saved} style={button(draft.join(",") === saved ? "#94a3b8" : "#2563eb")}>
            保存
          </button>
        </div>
        {z.planMonths.length === 0 ? (
          <div style={small}>賞与支払予定月が入っていません。年金機構に登録している月（新規適用届・事業所関係変更（訂正）届に書いた月）を入れてください。</div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 8 }}>
              <label style={fieldStyle}>
                <span style={labelStyle}>年</span>
                <select value={z.planYear} onChange={(e) => z.setPlanYear(Number(e.target.value))} style={input}>
                  {years.map((y) => <option key={y} value={y}>{y}年</option>)}
                </select>
              </label>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                {z.planStatuses.map((p) => (
                  <div key={p.ym} style={{ color: p.status === "unpaid" ? "#b45309" : "#334155" }}>
                    {p.month}月：{statusText(p, thisMonth)}
                  </div>
                ))}
              </div>
            </div>
            {unpaid.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>報告する月（賞与を払わなかった予定月）</span>
                  <select value={ym} onChange={(e) => setYm(e.target.value)} style={input}>
                    {unpaid.map((p) => <option key={p.ym} value={p.ym}>{warekiMonth(p.ym)}</option>)}
                  </select>
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>提出日</span>
                  <input type="date" value={submitDate} onChange={(e) => setSubmitDate(e.target.value)} style={input} />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>賞与支払予定月の変更</span>
                  <select value={change} onChange={(e) => setChange(e.target.value as typeof change)} style={input}>
                    <option value="none">変えない</option>
                    <option value="change">予定月を変える</option>
                    <option value="gone">賞与を払う予定がなくなった</option>
                  </select>
                </label>
                {change === "change" && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <span style={labelStyle}>変更後</span>
                    {MONTHS.map((m) => (
                      <label key={m} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 2 }}>
                        <input type="checkbox" checked={after.includes(m)} disabled={!after.includes(m) && after.length >= BONUS_PLAN_MONTH_LIMIT} onChange={() => setAfter(toggle(after, m))} />
                        {m}月
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={onPrint} disabled={!ym || (change === "change" && after.length === 0)} style={button(ym ? "#2563eb" : "#94a3b8")}>印刷する</button>
              </div>
            )}
            {change !== "none" && (
              <div style={{ ...small, marginTop: 6 }}>
                予定月を変えたら、年金機構に出したあとで、上の「賞与支払予定月」も変更後の月にして保存してください。
              </div>
            )}
          </>
        )}
      </div>

      {ym && (
        <div id={printId} style={card}>
          <h3 style={title}>健康保険・厚生年金保険 賞与不支給報告書に書く内容</h3>
          <ShahoOfficeTable office={z.file.office.values} />
          <table style={table}>
            <tbody>
              <tr><th style={th}>提出日</th><td style={td}>{formatWareki(submitDate)}</td></tr>
              <tr><th style={th}>賞与支払予定年月</th><td style={td}>{warekiMonth(ym)}</td></tr>
              <tr><th style={th}>①賞与支払年月</th><td style={td}>{warekiMonth(ym)}（予定していた賞与を払わなかった年月）</td></tr>
              <tr><th style={th}>②支給の状況</th><td style={td}>1. 不支給</td></tr>
              <tr>
                <th style={th}>③賞与支払予定月の変更</th>
                <td style={td}>
                  {changed === null ? "（変更後の月を選んでください）" : changed.after.length === 0 ? "変えない（書かない）" : (
                    <>
                      変更後の賞与支払予定月：{changed.after.join("・")}
                      {change === "gone" && "（賞与を払う予定がなくなった）"}
                      <br />
                      変更前の賞与支払予定月：{changed.before.join("・")}
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
