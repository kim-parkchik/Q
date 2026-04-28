// @ts-ignore
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";
import { DB_SCHEMAS } from "./types/dbSchema";
import { HOLIDAY_CSV_URL_DEFAULT } from "./constants/salaryMaster2026";
import * as S from "./App.styles";

export const useApp = () => {
  const [db, setDb] = useState<Database | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("company");
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasUser, setHasUser] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState("");

  const now = new Date();
  const [targetYear, setTargetYear] = useState(now.getFullYear());
  const [targetMonth, setTargetMonth] = useState(now.getMonth() + 1);

  const isStaffReady = staffList.length > 0;

  // スタイルの注入
  useEffect(() => {
    S.injectDangerousStyles();
  }, []);

  // DB初期化ロジック
  useEffect(() => {
    const init = async () => {
      try {
        const sqlite = await Database.load("sqlite:Q.db");
        for (const schema of DB_SCHEMAS) {
          await sqlite.execute(schema);
        }
        await sqlite.execute("PRAGMA foreign_keys = ON;");

        // 会社・カレンダー・グループ等の初期投入
        const companyCheck = await sqlite.select<any[]>("SELECT id FROM company WHERE id = 1");
        if (companyCheck.length === 0) {
          await sqlite.execute(
            `INSERT INTO company (id, name, holiday_csv_url) VALUES (1, '', ?)`,
            [HOLIDAY_CSV_URL_DEFAULT]
          );
        }
        const patterns = await sqlite.select<any[]>("SELECT * FROM calendar_patterns WHERE id = 1");
        if (patterns.length === 0) {
          await sqlite.execute("INSERT INTO calendar_patterns (id, name) VALUES (1, '標準')");
        }
        const pGroups = await sqlite.select<any[]>("SELECT * FROM payroll_groups WHERE id = 1");
        if (pGroups.length === 0) {
          await sqlite.execute(
            `INSERT INTO payroll_groups (id, name, closing_day, is_next_month, payment_day) VALUES (1, '全社共通規定', 99, 0, 25)`
          );
        }
        const existingHead = await sqlite.select<any[]>("SELECT * FROM branches");
        if (existingHead.length === 0) {
          await sqlite.execute("INSERT INTO branches (name, prefecture) VALUES ('本店', '')");
        }

        setDb(sqlite);

        const users = await sqlite.select<any[]>("SELECT id FROM users");
        setHasUser(users.length > 0);

        const companyRes = await sqlite.select<any[]>("SELECT name FROM company WHERE id = 1");
        const branchRes = await sqlite.select<any[]>("SELECT prefecture FROM branches WHERE id = 1");

        if (companyRes.length > 0 && companyRes[0].name.trim() !== "") {
          setCompanyName(companyRes[0].name);
        }
        
        const hasName = companyRes.length > 0 && companyRes[0].name.trim() !== "";
        const hasPref = branchRes.length > 0 && branchRes[0].prefecture !== "";
        setIsSetupComplete(hasName && hasPref);

        const resStaff = await sqlite.select<any[]>("SELECT * FROM staff ORDER BY id ASC");
        setStaffList(resStaff);
      } catch (error) { 
        console.error("Database Init Error:", error); 
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const handleSetupComplete = async () => {
    setIsSetupComplete(true);
    if (db) {
      const res = await db.select<any[]>("SELECT name FROM company WHERE id = 1");
      if (res.length > 0) setCompanyName(res[0].name);
    }
    await refreshData();
  };

  const refreshData = async () => {
    if (!db) return;
    const resStaff = await db.select<any[]>("SELECT * FROM staff ORDER BY id ASC");
    setStaffList(resStaff);
  };

  // App.tsx で必要なものだけを公開する
  return {
    db,
    currentUser,
    setCurrentUser,
    staffList,
    activeTab,
    setActiveTab,
    isSetupComplete,
    isLoading,
    hasUser,
    setHasUser,
    companyName,
    targetYear,
    setTargetYear,
    targetMonth,
    setTargetMonth,
    isStaffReady,
    handleSetupComplete,
    refreshData
  };
};