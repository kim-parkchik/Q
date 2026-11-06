// @ts-ignore
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";
import { DB_SCHEMAS } from "./types/dbSchema";
import * as Master from './constants';
import { APP_DIR_NAME, BACKUP_DIR_NAME, EXT_MAIN, EXT_BACKUP, APP_PROJECT_NAME, HOLIDAY_CSV_URL_DEFAULT } from "./constants/appConfig";
import * as S from "./App.styles";
import { writeLog } from "./utils/logUtils";
import { prepareCompanyFile } from "./utils/migrations";
import { backupFileName, backupsToDelete, companyBaseName, isBackupFile, restoredFileName } from "./utils/backupFiles";
import { useMessageDialog } from "./components/MessageDialog";
import { lockVault } from "./features/mynumber/myNumberVault";

export const useApp = () => {
  const dialog = useMessageDialog();
  const [db, setDb] = useState<Database | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null); // 🆕 今どのファイルを開いているか
  const [isLoading, setIsLoading] = useState(false); // 🆕 ロード中フラグ（最初はfalseでいい）
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("company");
  const [isSetupComplete, setIsSetupComplete] = useState(false);
//   const [isLoading, setIsLoading] = useState(true);
  const [hasUser, setHasUser] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState("");

  const now = new Date();
  const [targetYear, setTargetYear] = useState(now.getFullYear());
  const [targetMonth, setTargetMonth] = useState(now.getMonth() + 1);

  const isStaffReady = staffList.length > 0;

  // 🆕 【新規作成】戦い：新しい .qp ファイルを作る
  const createNewProject = async () => {
    const docsPath = await documentDir();
    const qFolder = await join(docsPath, APP_DIR_NAME);

    // 1. 保存する前に「Q」フォルダ自体が存在することを確認（なければ作る）
    // これをしないと、OSによってはダイアログが「書類」の直下に戻ってしまうことがあります。
    await mkdir(qFolder, { recursive: true });

    const defaultDest = await join(qFolder, `新しい会社データ.${EXT_MAIN}`);

    const filePath = await save({
      filters: [{ name: APP_PROJECT_NAME, extensions: [EXT_MAIN] }],
      defaultPath: defaultDest
    });
    
    if (filePath) await loadDatabase(filePath);
  };

  // 🆕 【開く】戦い：既存の .qp ファイルを選ぶ
  const openProject = async () => {
    const docsPath = await documentDir();
    const qFolder = await join(docsPath, APP_DIR_NAME);
    
    // フォルダを作っておくことで、ダイアログが最初から「Q」フォルダを見てくれるようになります。
    await mkdir(qFolder, { recursive: true });

    const filePath = await open({
      multiple: false,
      filters: [{ name: APP_PROJECT_NAME, extensions: [EXT_MAIN, EXT_BACKUP] }], // 👈 バックアップ(.qb)も開けるように追加！
      defaultPath: qFolder // 👈 「開く」時もQフォルダを初期位置にする
    });
    if (typeof filePath !== "string") return;
    if (isBackupFile(filePath)) {
      await openBackupCopy(filePath, qFolder);
      return;
    }
    await loadDatabase(filePath);
  };

  /**
   * バックアップ（.qb）は直接開かずに、写しの会社ファイル（.qp）を作って開く（utils/backupFiles.ts）
   * 直接開くと、表の更新やログの書き込みでバックアップの中身が変わり、閉じたときにバックアップのバックアップもできてしまうため
   */
  const openBackupCopy = async (backupPath: string, qFolder: string) => {
    const ok = await ask(
      "バックアップ（.qb）は、そのまま開かずに、写しの会社ファイル（.qp）を作って開きます（バックアップのファイルは変えません）。\n" +
      "次の画面で、写しの保存先と名前を選んでください。",
      { title: "バックアップを開く", kind: "info" }
    );
    if (!ok) return;
    const dest = await save({
      filters: [{ name: APP_PROJECT_NAME, extensions: [EXT_MAIN] }],
      defaultPath: await join(qFolder, restoredFileName(backupPath)),
    });
    if (!dest) return;
    try {
      // いまある会社ファイルには上書きしない（その会社ファイルの作業中のファイル（-wal）が残っていると、壊れることがあるため）
      if (await exists(dest)) {
        await dialog.warning("同じ名前のファイルがあります。上書きはしないので、別の名前を選んでください。");
        return;
      }
      await copyFile(backupPath, dest);
    } catch (e) {
      console.error("バックアップの写しを作れませんでした:", e);
      await dialog.error(`バックアップの写しを作れませんでした。\n${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await loadDatabase(dest);
  };

  // 🆕 共通のロード処理（ここが今の useEffect の中身を移植した場所）
  const loadDatabase = async (path: string) => {
    // ほかの会社ファイルで開けたマイナンバーの鍵は閉じる
    lockVault("close");
    setIsLoading(true);
    try {
      // 魔法の一行：指定されたパスを読み込む！
      const sqlite = await Database.load(`sqlite:${path}`);
      
      // 会社ファイルの形式を確かめてから表を作り、足りない列などを追加する（詳しくは utils/migrations.ts）
      const appliedMigrations = await prepareCompanyFile(sqlite, DB_SCHEMAS);

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
      const sGroups = await sqlite.select<any[]>("SELECT * FROM social_insurance_groups WHERE id = 1");
      if (sGroups.length === 0) {
        await sqlite.execute(
          `INSERT INTO social_insurance_groups (id, name, type, is_fixed, pension_rate, is_active) 
          VALUES (1, '全国健康保険協会（協会けんぽ）', 'kyokai', 0, ?, 1)`,
          [Master.INSURANCE_2026.PENSION_RATE[1]] // インデックス1（18.30）を直接渡す
        );
      }
      // 🆕 賞与項目マスターの初期投入
      const bonusItemCheck = await sqlite.select<any[]>("SELECT id FROM bonus_item_master WHERE id = 1");
      if (bonusItemCheck.length === 0) {
        await sqlite.execute(
          `INSERT OR IGNORE INTO bonus_item_master (id, name, type, is_default_active, display_order) 
          VALUES (1, '基本賞与', 'earning', 1, 1)`
        );
      }

      // 全件数ではなく、ID=1（本社分）があるかを確認する
      const headCheck = await sqlite.select<any[]>("SELECT id FROM branches WHERE id = 1");
      if (headCheck.length === 0) {
          // ID=1 を指定してインサートする
          await sqlite.execute("INSERT INTO branches (id, name, prefecture) VALUES (1, '本店', '')");
      }

      setDb(sqlite);
      setDbPath(path);
      
      // データの再取得（ログイン画面が出るかどうかの判定に必要）
      const users = await sqlite.select<any[]>("SELECT id FROM users");
      setHasUser(users.length > 0);
      
      const companyRes = await sqlite.select<any[]>("SELECT name FROM company WHERE id = 1");
      const branchRes = await sqlite.select<any[]>("SELECT prefecture FROM branches WHERE id = 1");

      if (companyRes.length > 0 && companyRes[0].name.trim() !== "") {
        setCompanyName(companyRes[0].name);
      } else {
        setCompanyName(""); // 新規ファイルの場合は空にする
      }

      const hasName = companyRes.length > 0 && companyRes[0].name.trim() !== "";
      const hasPref = branchRes.length > 0 && branchRes[0].prefecture !== "";
      setIsSetupComplete(hasName && hasPref);

      // スタッフリストも読み込む
      const resStaff = await sqlite.select<any[]>(`
        SELECT staff.*, branches.name AS branch_name 
        FROM staff 
        LEFT JOIN branches ON staff.branch_id = branches.id 
        ORDER BY staff.id ASC
      `);
      setStaffList(resStaff);

      // 🆕 ログ追加
      await writeLog(
        sqlite,
        "info",
        "system",
        `会社ファイルを開きました: ${path}`
      );
      for (const msg of appliedMigrations) {
        await writeLog(sqlite, "info", "system", `会社ファイルを更新しました: ${msg}`);
      }
      
    } catch (error) {
      console.error("Database Load Error:", error);
      dialog.error(
        `会社ファイルを開けませんでした。\n${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const closeProject = async () => {
    // マイナンバーの鍵も閉じる（開けたデータ鍵をメモリから消す）
    lockVault("close");
    if (db && dbPath) {
      try {
        console.log("バックアップ作成中...");

        // 1. 保存場所（ドキュメント/Q/Backup）を特定
        const docsPath = await documentDir();
        const backupDir = await join(docsPath, APP_DIR_NAME, BACKUP_DIR_NAME);
        
        // 2. フォルダがなければ作成
        await mkdir(backupDir, { recursive: true });

        // 3. 日付つきのファイル名を作成："会社名_20260502_075012.qb"（秒まで入れる。utils/backupFiles.ts）
        const baseName = companyBaseName(dbPath);
        const targetPath = await join(backupDir, backupFileName(baseName, new Date()));

        // 4. 【魔法の1行】SQLiteに「自分自身を別名で書き出せ」と命令する
        // これなら -wal ファイルの内容も自動で統合され、1つのファイルになります。
        // 書き出す先は ? で渡す（ファイル名やフォルダ名に ' があっても書き出せるように）
        await db.execute("VACUUM INTO ?", [targetPath]);
        console.log("バックアップ成功:", targetPath);

        // 🆕 6. 世代管理ロジックの開始
        // DBから設定された世代数を取得
        const configRes = await db.select<any[]>(
          "SELECT backup_generations FROM company WHERE id = 1"
        );

        // この会社ファイルのバックアップだけを新しい順に並べ、設定数を超えた古いものを消す
        // （名前の頭が同じ別の会社ファイルのバックアップは、数えない・消さない）
        const entries = await readDir(backupDir);
        const filesToDelete = backupsToDelete(entries.filter(e => e.isFile).map(e => e.name), baseName, configRes[0]?.backup_generations);
        for (const name of filesToDelete) {
          await remove(await join(backupDir, name));
          console.log("古いバックアップを削除しました:", name);
        }

      } catch (err) {
        console.error("バックアップに失敗しました:", err);
        // 知らせないと、バックアップが作られていないことに気づけない（閉じる前に OK を押してもらう）
        await dialog.error(
          `会社ファイルのバックアップを作れませんでした（会社ファイルはそのまま閉じます）。\n` +
          `書類フォルダの「${APP_DIR_NAME}/${BACKUP_DIR_NAME}」に書き込めるか、空き容量があるかを確かめてください。\n${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        // 5. バックアップが終わってから、あるいは失敗しても、接続は必ず閉じる
        await db.close();
      }
    }

    // 画面状態のリセット
    setDb(null);
    setDbPath(null);
    setCurrentUser(null);
    setHasUser(null);
    setActiveTab("company");
  };

  useEffect(() => {
    // listen は Promise を返すので、async/await で解除関数を取得します
    const setupCloseHandler = async () => {
      const unlisten = await getCurrentWindow().listen("tauri://close-requested", async () => {
        console.log("ウィンドウ終了リクエストを検知しました");
        
        // 1. 今ある closeProject を実行（バックアップと DB クローズ）
        // db と dbPath がある場合のみ動くよう closeProject 内でガードされています
        await closeProject();
        
        // 2. 処理が終わったらウィンドウを破棄（＝アプリ終了）
        await getCurrentWindow().destroy();
      });
      return unlisten;
    };

    const unlistenPromise = setupCloseHandler();

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [db, dbPath]); // db や dbPath が変わるたびに最新の状態で監視

  // スタイルの注入
  useEffect(() => {
    S.injectDangerousStyles();
  }, []);

  // ② 【そのまま残す】設定画面で「保存」した時に呼び出す
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
    const resStaff = await db.select<any[]>(`
      SELECT 
        staff.*, 
        branches.name AS branch_name 
      FROM staff 
      LEFT JOIN branches ON staff.branch_id = branches.id 
      ORDER BY staff.id ASC
    `);
    setStaffList(resStaff);
  };

  // App.tsx で必要なものだけを公開する
  return {
    db, dbPath, // dbPathも返すと便利
    createNewProject, // 🆕 追加
    openProject,      // 🆕 追加
    closeProject, // 🆕 これを忘れずに！
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