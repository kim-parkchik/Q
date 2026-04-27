import { useEffect, useState } from "react";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export function useSystemSettings(db: any) {
  const [users, setUsers] = useState<any[]>([]);
  const [holidaySource, setHolidaySource] = useState<"url" | "file">("url");
  const [holidayUrl, setHolidayUrl] = useState("読み込み中...");

  const [searchMode, setSearchMode] = useState<string>("scraping");
  const [apiKey, setApiKey] = useState<string>("");

  const hashPassword = async (password: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  };

  // --- 1. ユーザー関連ロジック ---
  const fetchUsers = async () => {
    try {
      const res = await db.select("SELECT id, login_id, display_name, role, last_login FROM users ORDER BY id ASC");
      setUsers(res);
    } catch (err) { console.error(err); }
  };

  const deleteUser = async (loginId: string) => {
    if (loginId === 'admin') return;
    const ok = await ask(`${loginId} を削除しますか？`, { title: "確認", kind: "warning" });
    if (ok) {
      await db.execute("DELETE FROM users WHERE login_id = ?", [loginId]);
      await fetchUsers();
    }
  };

  const addUser = async (loginId: string, displayName: string, rawPassword: string, role: string = 'staff') => {
    try {
      const passwordHash = await hashPassword(rawPassword);
      
      await db.execute(
        "INSERT INTO users (login_id, display_name, password_hash, role) VALUES (?, ?, ?, ?)",
        [loginId, displayName, passwordHash, role]
      );
      
      await fetchUsers();
      alert(`${displayName} さんを追加しました。`);
      return true; // 🆕 成功したら true を返す
    } catch (err) {
      console.error(err);
      alert("ユーザーの追加に失敗しました。IDが重複している可能性があります。");
      return false; // 🆕 失敗したら false を返す
    }
  };

  // --- 2. 設定関連ロジック (UserManagerから移動) ---
  const fetchSettings = async () => {
    if (!db) return;
    try {
      const res = await db.select("SELECT holiday_csv_url, holiday_source, corporate_search_mode, gbiz_api_key FROM company WHERE id = 1") as any[];
      if (res?.length > 0) {
        if (res[0].holiday_csv_url) setHolidayUrl(res[0].holiday_csv_url);
        if (res[0].holiday_source) setHolidaySource(res[0].holiday_source);
        if (res[0].corporate_search_mode) setSearchMode(res[0].corporate_search_mode);
        if (res[0].gbiz_api_key) setApiKey(res[0].gbiz_api_key);
      }
    } catch (error) { console.error(error); }
  };

  const updateSearchMode = async (mode: string) => {
    setSearchMode(mode);
    try {
      await db.execute("UPDATE company SET corporate_search_mode = ? WHERE id = 1", [mode]);
    } catch (error) { console.error(error); }
  };

  const updateApiKey = async (key: string) => {
    setApiKey(key);
    try {
      await db.execute("UPDATE company SET gbiz_api_key = ? WHERE id = 1", [key]);
    } catch (error) { console.error(error); }
  };

  const updateHolidaySource = async (source: "url" | "file") => {
    setHolidaySource(source);
    try {
      await db.execute("UPDATE company SET holiday_source = ? WHERE id = 1", [source]);
    } catch (error) { console.error(error); }
  };

  // --- 3. ファイル操作ロジック (UserManagerから移動) ---
  const downloadSampleCsv = async () => {
    const csvContent = "\uFEFF日付,祝日名\n2026/01/01,元日\n2026/05/03,憲法記念日";
    try {
      const filePath = await save({
        filters: [{ name: "CSV", extensions: ["csv"] }],
        defaultPath: "holiday_sample.csv"
      });
      if (!filePath) return;

      const data = new TextEncoder().encode(csvContent);
      await writeFile(filePath, data);
      alert("サンプルファイルを保存しました。");
    } catch (e) {
      alert(`保存に失敗しました。`);
    }
  };

  useEffect(() => {
    if (db) {
      fetchUsers();
      fetchSettings();
    }
  }, [db]);

  return {
    users,
    deleteUser,
    addUser,
    holidaySource,
    holidayUrl,
    updateHolidaySource,
    downloadSampleCsv,
    searchMode,
    updateSearchMode,
    apiKey,
    updateApiKey
  };
}