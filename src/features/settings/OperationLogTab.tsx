/**
 * システム設定の「操作の記録」（管理者だけ）：会社ファイルの中に残している操作の記録（app_logs。utils/logUtils.ts の writeLog）を、
 * 新しい順に見る。日付・種類・使った人で絞れる（決まりは utils/appLogs.ts）。
 * 記録は会社ファイルの中にだけ残し、ほかのファイルには書かない（従業員の名前などが入るので）
 */
import { useEffect, useState, type CSSProperties } from "react";
import * as S from "./SystemSettings.styles";
import {
  ALL_USERS,
  EMPTY_FILTER,
  LOG_PAGE_SIZE,
  NO_USER,
  categoryLabel,
  formatLogTime,
  levelLabel,
  loadAppLogChoices,
  loadAppLogs,
  type AppLogChoices,
  type AppLogFilter,
  type AppLogRow,
  type LogDb,
} from "../../utils/appLogs";

export default function OperationLogTab({ db }: { db: LogDb }) {
  const [filter, setFilter] = useState<AppLogFilter>(EMPTY_FILTER);
  const [limit, setLimit] = useState(LOG_PAGE_SIZE);
  const [rows, setRows] = useState<AppLogRow[]>([]);
  const [more, setMore] = useState(false);
  const [choices, setChoices] = useState<AppLogChoices>({ categories: [], users: [], hasNoUser: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAppLogChoices(db)
      .then(setChoices)
      .catch((e) => console.error("操作の記録の種類と使った人を読めませんでした:", e));
  }, [db]);

  useEffect(() => {
    let alive = true;
    loadAppLogs(db, filter, limit)
      .then((result) => {
        if (!alive) return;
        setRows(result.rows);
        setMore(result.more);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [db, filter, limit]);

  const update = (patch: Partial<AppLogFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setLimit(LOG_PAGE_SIZE);
  };
  const filtered = filter.from !== "" || filter.to !== "" || filter.category !== "" || filter.user !== ALL_USERS;

  return (
    <div data-operation-log>
      <p style={S.description}>
        会社ファイルの中に残している操作の記録です（新しい順）。記録は会社ファイルの中にだけ残し、ほかのファイルには書きません。
        「使った人」は、ログインしている人を残します（ログインする前の記録などは残っていません）。
      </p>
      <div style={filterRowStyle}>
        <label style={labelStyle}>
          日付
          <input type="date" value={filter.from} onChange={(e) => update({ from: e.target.value })} data-log-filter="from" style={inputStyle} />
          〜
          <input type="date" value={filter.to} onChange={(e) => update({ to: e.target.value })} data-log-filter="to" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          種類
          <select value={filter.category} onChange={(e) => update({ category: e.target.value })} data-log-filter="category" style={inputStyle}>
            <option value="">すべて</option>
            {choices.categories.map((category) => (
              <option key={category} value={category}>{categoryLabel(category)}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          使った人
          <select value={filter.user} onChange={(e) => update({ user: e.target.value })} data-log-filter="user" style={inputStyle}>
            <option value={ALL_USERS}>すべて</option>
            {choices.users.map((user) => (
              <option key={user} value={user}>{user}</option>
            ))}
            {choices.hasNoUser && <option value={NO_USER}>（残っていない記録）</option>}
          </select>
        </label>
        {filtered && (
          <button type="button" onClick={() => { setFilter(EMPTY_FILTER); setLimit(LOG_PAGE_SIZE); }} data-log-clear style={clearStyle}>
            絞り込みをやめる
          </button>
        )}
      </div>
      {filter.from !== "" && filter.to !== "" && filter.from > filter.to && (
        <p style={noteStyle}>日付の初め（{filter.from}）が、終わり（{filter.to}）より後になっています。</p>
      )}
      {error && <p role="alert" style={{ ...noteStyle, color: "#c0392b" }}>操作の記録を読めませんでした。{error}</p>}
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>日時</th>
            <th style={S.th}>種類</th>
            <th style={S.th}>内容</th>
            <th style={S.th}>使った人</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr style={S.tr}>
              <td style={S.td} colSpan={4}>{filtered ? "この条件の記録はありません。" : "記録はまだありません。"}</td>
            </tr>
          ) : (
            rows.map((row) => {
              const level = levelLabel(row.level);
              return (
                <tr key={row.id} style={S.tr} data-log-row={row.id}>
                  <td style={{ ...S.td, whiteSpace: "nowrap", color: "#64748b" }}>{formatLogTime(row.created_at)}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    {categoryLabel(row.category)}
                    {level && <span style={levelStyle(row.level)}>{level}</span>}
                  </td>
                  <td style={{ ...S.td, wordBreak: "break-all" }}>{row.message}</td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>{row.user_name || "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <div style={footerStyle}>
        <span data-log-count>
          {rows.length}件を出しています{more ? "（もっと古い記録があります）" : ""}
        </span>
        {more && (
          <button type="button" onClick={() => setLimit((n) => n + LOG_PAGE_SIZE)} data-log-more style={clearStyle}>
            もっと見る（{LOG_PAGE_SIZE}件）
          </button>
        )}
      </div>
    </div>
  );
}

// --- スタイル ---
const filterRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px", marginTop: "12px" };
const labelStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" };
const inputStyle: CSSProperties = { padding: "4px 6px", fontSize: "14px" };
const clearStyle: CSSProperties = { padding: "4px 12px", fontSize: "13px", cursor: "pointer" };
const noteStyle: CSSProperties = { fontSize: "13px", color: "#b45309", margin: "8px 0 0 0" };
const footerStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "12px", marginTop: "10px", fontSize: "13px", color: "#606266" };
const levelStyle = (level: string): CSSProperties => ({
  marginLeft: "6px", padding: "1px 6px", borderRadius: "4px", fontSize: "11px", color: "white",
  backgroundColor: level.toUpperCase() === "ERROR" ? "#e74c3c" : "#f59e0b",
});
