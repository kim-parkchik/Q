use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::sqlite::SqliteConnectOptions;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_sql::{DbInstances, DbPool};

mod q_folder;
mod wal_check;

// --- パスワードをハッシュ化するコマンド ---
#[tauri::command]
fn hash_password(password: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();
        
    Ok(password_hash)
}

#[tauri::command]
fn verify_password(password: String, hash: String) -> bool {
    let parsed_hash = match PasswordHash::new(&hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok() // 一致すれば true
}

// --- マイナンバーを守る鍵を、パスワードから作る（Argon2id。強さは画面側の utils/myNumberCrypto.ts の KDF_DEFAULT） ---
#[tauri::command]
async fn derive_key(
    password: String,
    salt: Vec<u8>,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Vec<u8>, String> {
    let params = Params::new(memory_kib, iterations, parallelism, Some(32)).map_err(|e| e.to_string())?;
    let mut key = vec![0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

// --- いくつかの書き込みを、1つのトランザクションでまとめて行う ---
// tauri-plugin-sql の execute は、呼ぶたびに接続プール（1つの会社ファイルに最大10本の接続）の空いた接続を使う。
// そのため画面から BEGIN・INSERT・COMMIT を別々に送ると、別々の接続で動いて1つのトランザクションにならない。
// ここでは1本の接続でトランザクションを始め、すべての文をその接続で実行し、全部できたら保存する。
// 1つでも失敗したら、それまでの文も取り消す（トランザクションを保存せずに捨てると、sqlx が取り消す）。

/// 実行する文（値は ? の順に入れる）
#[derive(Deserialize)]
struct SqlStatement {
    sql: String,
    #[serde(default)]
    values: Vec<JsonValue>,
}

/// 文ごとの結果（変わった行の数・最後に足した行の rowid）
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SqlStatementResult {
    rows_affected: u64,
    last_insert_id: i64,
}

#[tauri::command]
async fn execute_batch(
    db_instances: tauri::State<'_, DbInstances>,
    db: String,
    statements: Vec<SqlStatement>,
) -> Result<Vec<SqlStatementResult>, String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(&db) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err(format!("会社ファイルが開かれていません: {db}")),
    };
    run_batch(pool, statements).await
}

/// 1本の接続でトランザクションを始め、文を順に実行し、全部できたら保存する（1つでも失敗したら全部取り消す）
async fn run_batch(
    pool: &sqlx::SqlitePool,
    statements: Vec<SqlStatement>,
) -> Result<Vec<SqlStatementResult>, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(statements.len());
    for (i, statement) in statements.into_iter().enumerate() {
        let mut query = sqlx::query(&statement.sql);
        for value in statement.values {
            query = match value {
                JsonValue::Null => query.bind(None::<String>),
                JsonValue::Bool(b) => query.bind(b as i64),
                JsonValue::String(s) => query.bind(s),
                JsonValue::Number(n) => match n.as_i64() {
                    Some(int) => query.bind(int),
                    None => query.bind(n.as_f64().unwrap_or_default()),
                },
                other => query.bind(other.to_string()),
            };
        }
        let result = query
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}番目の文で失敗しました（すべて取り消しました）: {e}", i + 1))?;
        results.push(SqlStatementResult {
            rows_affected: result.rows_affected(),
            last_insert_id: result.last_insert_rowid(),
        });
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(results)
}

// --- 会社ファイルを開く前に、となりにある作業中のファイル（-wal）を確かめる（wal_check.rs。画面の側は utils/companyFileCheck.ts） ---
// db は、画面が Database.load に渡す "sqlite:…" と同じもの。tauri-plugin-sql と同じ読み方で、SQLite に渡すファイルの名前にする
#[tauri::command]
async fn check_company_file(app: tauri::AppHandle, db: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = sqlite_file_path(config_dir, &db)?;
    wal_check::check_company_file(&path).map_err(|problem| problem.message())
}

/// tauri-plugin-sql が Database.load("sqlite:…") で開くファイルの名前。プラグイン（path_mapper）のとおりアプリの設定フォルダに
/// つなぎ（はじめから場所が書いてあればそのまま）、sqlx（SqliteConnectOptions::from_str）と同じく「?」の前を、「%」の書き方をもどして読む
fn sqlite_file_path(config_dir: PathBuf, db: &str) -> Result<PathBuf, String> {
    let rest = db
        .strip_prefix("sqlite:")
        .ok_or_else(|| format!("会社ファイルの場所の書き方が違います: {db}"))?;
    let mut path = config_dir;
    path.push(rest);
    let url = format!("sqlite:{}", path.to_str().ok_or("会社ファイルの場所を読めません")?);
    let options = SqliteConnectOptions::from_str(&url).map_err(|e| e.to_string())?;
    Ok(options.get_filename().to_path_buf())
}

// --- Q のフォルダ（バックアップ・書き出しを置くところ。q_folder.rs。画面の側は utils/qFolder.ts・components/QFolderPanel.tsx） ---
fn env_var(key: &str) -> Option<String> {
    std::env::var(key).ok()
}

/// いまの Q のフォルダと、クラウドと同期しているか
#[tauri::command]
fn q_folder(app: tauri::AppHandle) -> Result<q_folder::QFolderInfo, String> {
    let dirs = q_folder::Dirs::from_app(&app)?;
    Ok(q_folder::folder_info(&dirs, q_folder::load_setting(&dirs.config).as_deref(), &env_var))
}

/// 窓でフォルダを選んでもらう（まだ Q のフォルダにはしない。画面で決めたら apply_q_folder の "picked" で変える）。
/// 窓は Rust の側で開くので、画面からは好きな場所を指せない
#[tauri::command]
async fn pick_q_folder(
    app: tauri::AppHandle,
    pending: tauri::State<'_, q_folder::PendingFolder>,
) -> Result<Option<q_folder::PickedFolder>, String> {
    *pending.0.lock().map_err(|e| e.to_string())? = None;
    let dirs = q_folder::Dirs::from_app(&app)?;
    let current = q_folder::load_setting(&dirs.config).unwrap_or_else(|| dirs.default_folder());
    let start = if current.is_dir() { current } else { dirs.home.clone() };
    let Some(picked) = app.dialog().file().set_title("Q のフォルダを選ぶ").set_directory(start).blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    q_folder::check_chosen_folder(&path, &dirs)?;
    let cloud = q_folder::cloud_place(&path, &dirs.home, &env_var);
    *pending.0.lock().map_err(|e| e.to_string())? = Some(path.clone());
    Ok(Some(q_folder::PickedFolder { path: path.to_string_lossy().into_owned(), cloud }))
}

/// Q のフォルダを変える。choice は "picked"（窓で選んだフォルダ）・"home"（ホームフォルダの Q）・"default"（書類フォルダの Q）
#[tauri::command]
fn apply_q_folder(
    app: tauri::AppHandle,
    pending: tauri::State<'_, q_folder::PendingFolder>,
    choice: String,
) -> Result<q_folder::QFolderInfo, String> {
    let dirs = q_folder::Dirs::from_app(&app)?;
    let folder = match choice.as_str() {
        "default" => None,
        "home" => Some(dirs.home_folder()),
        "picked" => Some(pending.0.lock().map_err(|e| e.to_string())?.take().ok_or("フォルダが選ばれていません")?),
        _ => return Err(format!("知らない選び方です: {choice}")),
    };
    let folder = folder.and_then(|folder| q_folder::normalize_setting(&dirs, folder));
    if let Some(folder) = &folder {
        std::fs::create_dir_all(folder).map_err(|e| format!("フォルダを作れませんでした: {e}"))?;
        app.fs_scope().allow_directory(folder, true).map_err(|e| e.to_string())?;
    }
    q_folder::save_setting(&dirs.config, folder.as_deref())?;
    Ok(q_folder::folder_info(&dirs, folder.as_deref(), &env_var))
}

/// 会社ファイル（path）がクラウドと同期する場所にあれば、そのクラウドの名前（開く前に知らせる）
#[tauri::command]
fn cloud_place_of(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let dirs = q_folder::Dirs::from_app(&app)?;
    Ok(q_folder::cloud_place(Path::new(&path), &dirs.home, &env_var))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())   
        .plugin(tauri_plugin_dialog::init()) 
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(q_folder::PendingFolder::default())
        .setup(|app| {
            // ほかの場所にした Q のフォルダの読み書きを足す（書類フォルダの Q は capabilities/default.json でいつも許す）
            if let Ok(dirs) = q_folder::Dirs::from_app(app.handle()) {
                if let Some(folder) = q_folder::load_setting(&dirs.config) {
                    if let Err(e) = app.fs_scope().allow_directory(&folder, true) {
                        eprintln!("Q のフォルダの読み書きを足せませんでした: {e}");
                    }
                }
            }
            Ok(())
        })
        // 画面（TypeScript）から呼ぶコマンド。画面から使わないコマンドは置かない（src/utils/tauriCommands.test.ts で確かめる）
        .invoke_handler(tauri::generate_handler![
            hash_password,
            verify_password,
            derive_key,
            execute_batch,
            check_company_file,
            q_folder,
            pick_q_folder,
            apply_q_folder,
            cloud_place_of
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::Row;

    fn stmt(sql: &str, values: Vec<JsonValue>) -> SqlStatement {
        SqlStatement { sql: sql.to_string(), values }
    }

    /// 一時フォルダのファイルを、アプリと同じく接続を何本も持てるプールで開く
    async fn open_pool(name: &str) -> (sqlx::SqlitePool, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("q_batch_test_{}_{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&path);
        let options = SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let pool = SqlitePoolOptions::new().max_connections(4).connect_with(options).await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL, flag INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        (pool, path)
    }

    #[test]
    fn 確かめるファイルの名前は_プラグインとsqlxと同じ読み方にする() {
        let config = PathBuf::from("/設定");
        assert_eq!(sqlite_file_path(config.clone(), "sqlite:/書類/Q/会社.qp").unwrap(), PathBuf::from("/書類/Q/会社.qp"));
        // sqlx は「%」の書き方をもどし、「?」の後ろを設定として読む
        assert_eq!(sqlite_file_path(config.clone(), "sqlite:/書類/a%62c.qp").unwrap(), PathBuf::from("/書類/abc.qp"));
        assert_eq!(sqlite_file_path(config.clone(), "sqlite:/書類/会社.qp?mode=ro").unwrap(), PathBuf::from("/書類/会社.qp"));
        // 場所が書いてなければ、アプリの設定フォルダの中（TimeQard の "sqlite:timeqard.db" と同じ）
        assert_eq!(sqlite_file_path(config.clone(), "sqlite:timeqard.db").unwrap(), PathBuf::from("/設定/timeqard.db"));
        assert!(sqlite_file_path(config, "mysql://localhost/q").is_err());
    }

    async fn count(pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query("SELECT COUNT(*) AS n FROM t").fetch_one(pool).await.unwrap().get::<i64, _>("n")
    }

    #[test]
    fn 全部できたら保存し_足した行のidを返す() {
        tauri::async_runtime::block_on(async {
            let (pool, path) = open_pool("ok").await;
            let results = run_batch(&pool, vec![
                stmt("INSERT INTO t (name, amount, flag) VALUES (?, ?, ?)", vec![json!("賞与"), json!(1500.5), json!(true)]),
                stmt("INSERT INTO t (name, amount, flag) SELECT name || '2', (SELECT MAX(id) FROM t), ? FROM t", vec![json!(null)]),
            ]).await.unwrap();
            assert_eq!(results[0].rows_affected, 1);
            assert_eq!(results[0].last_insert_id, 1);
            assert_eq!(count(&pool).await, 2);
            let row = sqlx::query("SELECT name, amount, flag FROM t WHERE id = 2").fetch_one(&pool).await.unwrap();
            assert_eq!(row.get::<String, _>("name"), "賞与2");
            assert_eq!(row.get::<f64, _>("amount"), 1.0); // 同じトランザクションの中で、いま足した行が見える
            assert!(row.get::<Option<i64>, _>("flag").is_none());
            pool.close().await;
            let _ = std::fs::remove_file(&path);
        });
    }

    #[test]
    fn 一つでも失敗したら_前の文も取り消す() {
        tauri::async_runtime::block_on(async {
            let (pool, path) = open_pool("ng").await;
            sqlx::query("INSERT INTO t (name) VALUES ('前からある行')").execute(&pool).await.unwrap();
            let error = run_batch(&pool, vec![
                stmt("DELETE FROM t", vec![]),
                stmt("INSERT INTO t (name) VALUES (?)", vec![json!("新しい行")]),
                stmt("INSERT INTO t (name) VALUES (?)", vec![json!(null)]), // name は NOT NULL なので失敗する
            ]).await.unwrap_err();
            assert!(error.contains("3番目の文"), "{error}");
            // 消した行も、足した行も、元に戻っている
            let names: Vec<String> = sqlx::query("SELECT name FROM t").fetch_all(&pool).await.unwrap()
                .iter().map(|r| r.get::<String, _>("name")).collect();
            assert_eq!(names, vec!["前からある行".to_string()]);
            // 取り消した後も、ほかの接続から書き込める（トランザクションが残っていない）
            for _ in 0..8 {
                sqlx::query("INSERT INTO t (name) VALUES ('あと')").execute(&pool).await.unwrap();
            }
            assert_eq!(count(&pool).await, 9);
            pool.close().await;
            let _ = std::fs::remove_file(&path);
        });
    }
}