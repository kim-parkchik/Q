//! Q のフォルダ（会社ファイルの初めの置き場所と、バックアップ（Backup）・書き出し（Export）を置くところ）
//!
//! 初めは書類フォルダの「Q」。書類フォルダが iCloud（Mac の「デスクトップと書類」）や OneDrive（Windows の書類フォルダを
//! OneDrive に移す設定）と同期していると、バックアップ・書き出したファイルが自動でクラウドに上がり、同期のせいで
//! 会社ファイルが開けなくなることもある。そこで、クラウドと同期する場所かを見分けて画面で知らせ（画面の側は utils/qFolder.ts）、
//! このパソコンの設定として、同期しない場所に変えられるようにする（アプリの設定フォルダの q-folder.json）。
//!
//! 場所を選ぶ窓は Rust の側で開き、画面からは好きな場所を指せないようにする（S1 で狭めた読み書きの範囲を、画面から広げられない
//! ようにするため）。画面が選べるのは「窓で選んだフォルダ」「ホームフォルダの Q」「書類フォルダの Q（初め）」の3つだけ。
//! 書類フォルダの Q は capabilities/default.json でいつも読み書きを許し、ほかの場所にしたときは、Q が動いているあいだ、
//! その場所の読み書きを足す（Q を起動したときも足す）。

use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Q のフォルダの名前（src/constants/appConfig.ts の APP_DIR_NAME と、capabilities/default.json の "$DOCUMENT/Q" と同じ）
pub const FOLDER_NAME: &str = "Q";
/// Q のフォルダの中のフォルダ（appConfig.ts の BACKUP_DIR_NAME・EXPORT_DIR_NAME と同じ）
const SUBFOLDERS: [&str; 2] = ["Backup", "Export"];
/// このパソコンの設定（アプリの設定フォルダに置く）
const SETTINGS_FILE: &str = "q-folder.json";
/// 空のフォルダかを見るときに数えないもの（OS が作るもの）
const IGNORED: [&str; 5] = [".DS_Store", ".localized", "desktop.ini", "Thumbs.db", "Icon\r"];

/// iCloud Drive の場所（Mac。「デスクトップと書類」を入れると、書類フォルダはここの Documents へのリンクになる）
const ICLOUD_DIR: &str = "Library/Mobile Documents";
/// ほかのクラウドのアプリが、同期するファイルを置く場所（Mac）
const CLOUD_STORAGE_DIR: &str = "Library/CloudStorage";
/// OneDrive のフォルダの場所を入れている環境変数（Windows）
const ONEDRIVE_ENV: [&str; 3] = ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"];

/// Q のフォルダを決めるのに使うフォルダ
#[derive(Debug, Clone)]
pub struct Dirs {
    pub home: PathBuf,
    pub documents: PathBuf,
    /// アプリの設定フォルダ（q-folder.json を置く）
    pub config: PathBuf,
    /// 中のファイルが全部読み書きできるようになるので、そのままでは Q のフォルダにできないフォルダ（デスクトップ・ダウンロード）
    pub too_broad: Vec<PathBuf>,
}

impl Dirs {
    pub fn from_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self, String> {
        use tauri::Manager;
        let path = app.path();
        Ok(Dirs {
            home: path.home_dir().map_err(|e| e.to_string())?,
            documents: path.document_dir().map_err(|e| e.to_string())?,
            config: path.app_config_dir().map_err(|e| e.to_string())?,
            too_broad: [path.desktop_dir(), path.download_dir()].into_iter().filter_map(Result::ok).collect(),
        })
    }

    /// 書類フォルダの Q（初めの場所）
    pub fn default_folder(&self) -> PathBuf {
        self.documents.join(FOLDER_NAME)
    }

    /// ホームフォルダの Q（同期しない場所の候補。iCloud の「デスクトップと書類」も、OneDrive の書類フォルダの移動も、ホームフォルダそのものは同期しない）
    pub fn home_folder(&self) -> PathBuf {
        self.home.join(FOLDER_NAME)
    }
}

/// 画面に渡す、いまの Q のフォルダ
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QFolderInfo {
    pub path: String,
    /// 書類フォルダの Q（初め）のままか
    pub is_default: bool,
    pub exists: bool,
    /// 同期しているクラウドの名前（"iCloud Drive"・"OneDrive"・"クラウドのフォルダ"）。同期していなければ None
    pub cloud: Option<String>,
    pub default_path: String,
    pub home_path: String,
    /// ホームフォルダの Q も同期していれば、その名前（ふつうはない）
    pub home_cloud: Option<String>,
}

/// 窓で選んだフォルダ（まだ Q のフォルダにはしていない）
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    pub path: String,
    pub cloud: Option<String>,
}

/// 窓で選んで、画面で「このフォルダにする」を待っているフォルダ
#[derive(Default)]
pub struct PendingFolder(pub Mutex<Option<PathBuf>>);

#[derive(Serialize, Deserialize)]
struct Settings {
    folder: String,
}

/// いまの Q のフォルダの設定（ほかの場所にしていれば、その場所。書類フォルダの Q のままなら None）
pub fn load_setting(config: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(config.join(SETTINGS_FILE)).ok()?;
    let settings: Settings = serde_json::from_str(&text).ok()?;
    let folder = PathBuf::from(settings.folder);
    folder.is_absolute().then_some(folder)
}

/// Q のフォルダの設定を残す（None なら書類フォルダの Q に戻す）
pub fn save_setting(config: &Path, folder: Option<&Path>) -> Result<(), String> {
    let file = config.join(SETTINGS_FILE);
    match folder {
        None => match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
        Some(folder) => {
            std::fs::create_dir_all(config).map_err(|e| e.to_string())?;
            let settings = Settings { folder: folder.to_string_lossy().into_owned() };
            let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
            std::fs::write(&file, text).map_err(|e| e.to_string())
        }
    }
}

/// いまの Q のフォルダ（setting は load_setting の値）
pub fn folder_info(dirs: &Dirs, setting: Option<&Path>, env: &dyn Fn(&str) -> Option<String>) -> QFolderInfo {
    let default = dirs.default_folder();
    let path = setting.map_or_else(|| default.clone(), Path::to_path_buf);
    let home = dirs.home_folder();
    QFolderInfo {
        path: path.to_string_lossy().into_owned(),
        is_default: setting.is_none(),
        exists: path.is_dir(),
        cloud: cloud_place(&path, &dirs.home, env),
        default_path: default.to_string_lossy().into_owned(),
        home_path: home.to_string_lossy().into_owned(),
        home_cloud: cloud_place(&home, &dirs.home, env),
    }
}

/// path（まだなくてもよい）がクラウドと同期する場所の中にあれば、そのクラウドの名前
/// ・Mac：iCloud Drive（~/Library/Mobile Documents）と、ほかのクラウドのアプリの場所（~/Library/CloudStorage）。
///   「デスクトップと書類」を入れると書類フォルダはリンクになるので、リンクをたどった先で見る
/// ・Windows：OneDrive のフォルダ（環境変数 OneDrive など）の中
pub fn cloud_place(path: &Path, home: &Path, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let real = real_path(path);
    let home = real_path(home);
    if starts_with_ignore_case(&real, &home.join(ICLOUD_DIR)) {
        return Some("iCloud Drive".to_string());
    }
    let storage = home.join(CLOUD_STORAGE_DIR);
    if starts_with_ignore_case(&real, &storage) && real.components().count() > storage.components().count() {
        // ~/Library/CloudStorage の下のフォルダの名前（"OneDrive-Personal" など）で見分ける。ほかのものは名前を出さない
        let provider = real.components().nth(storage.components().count()).map(|c| c.as_os_str().to_string_lossy().into_owned());
        let onedrive = provider.is_some_and(|name| name.to_lowercase().starts_with("onedrive"));
        return Some(if onedrive { "OneDrive" } else { "クラウドのフォルダ" }.to_string());
    }
    for key in ONEDRIVE_ENV {
        if let Some(root) = env(key).filter(|value| !value.trim().is_empty()) {
            if starts_with_ignore_case(&real, &real_path(Path::new(&root))) {
                return Some("OneDrive".to_string());
            }
        }
    }
    None
}

/// 窓で選んだフォルダを、Q のフォルダにできるか
/// ・ホームフォルダとその上、書類・デスクトップ・ダウンロードのフォルダそのものはできない（中のファイルが全部、Q から読み書きできるようになる）
/// ・空のフォルダか、前に Q のフォルダとして使っていたフォルダ（Backup・Export のフォルダか、会社ファイル（.qp）・バックアップ（.qb）がある）
pub fn check_chosen_folder(path: &Path, dirs: &Dirs) -> Result<(), String> {
    let real = real_path(path);
    if !real.is_dir() {
        return Err("フォルダを選んでください。".to_string());
    }
    let broad = std::iter::once(&dirs.documents).chain(dirs.too_broad.iter());
    if real_path(&dirs.home).starts_with(&real) || real.parent().is_none() || broad.map(|d| real_path(d)).any(|d| d == real) {
        return Err(
            "ホームフォルダやその上のフォルダと、書類・デスクトップ・ダウンロードのフォルダそのものは、Q のフォルダにできません\
             （中のファイルがみな、Q から読み書きできるようになるため）。中に新しいフォルダを作って（窓の「新規フォルダ」）、それを選んでください。"
                .to_string(),
        );
    }
    let mut empty = true;
    for entry in std::fs::read_dir(&real).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if IGNORED.contains(&name.as_str()) {
            continue;
        }
        empty = false;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let lower = name.to_lowercase();
        if (is_dir && SUBFOLDERS.contains(&name.as_str())) || (!is_dir && (lower.ends_with(".qp") || lower.ends_with(".qb"))) {
            return Ok(());
        }
    }
    if empty {
        Ok(())
    } else {
        Err(
            "Q のフォルダには、空のフォルダか、前に Q のフォルダとして使っていたフォルダ（Backup・Export のフォルダや、会社ファイル（.qp）が\
             入っているもの）を選んでください。窓の「新規フォルダ」で作ってから選べます。"
                .to_string(),
        )
    }
}

/// 書類フォルダの Q と同じ場所なら None（初めの場所に戻す）
pub fn normalize_setting(dirs: &Dirs, folder: PathBuf) -> Option<PathBuf> {
    (real_path(&folder) != real_path(&dirs.default_folder())).then_some(folder)
}

/// リンクをたどった本当の場所。まだないところは、ある親までたどって、残りをつなぐ
pub fn real_path(path: &Path) -> PathBuf {
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        if let Ok(real) = std::fs::canonicalize(&current) {
            return rest.iter().rev().fold(real, |acc, name| acc.join(name));
        }
        match (current.file_name().map(|name| name.to_os_string()), current.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                current = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// 大文字・小文字を区別せずに、path が base の中（base そのものも）か（Windows の OneDrive の場所は、大文字・小文字が違うことがある）
fn starts_with_ignore_case(path: &Path, base: &Path) -> bool {
    let parts = |p: &Path| -> Vec<String> {
        p.components()
            .filter(|c| !matches!(c, Component::CurDir))
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .collect()
    };
    let (path, base) = (parts(path), parts(base));
    path.len() >= base.len() && path[..base.len()] == base[..]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// テストごとの一時フォルダ（ホーム・書類・設定のフォルダを入れる）
    fn temp_dirs(name: &str) -> (PathBuf, Dirs) {
        let root = std::env::temp_dir().join(format!("q_folder_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        let documents = home.join("Documents");
        std::fs::create_dir_all(&documents).unwrap();
        std::fs::create_dir_all(home.join("Desktop")).unwrap();
        let dirs = Dirs {
            home: home.clone(),
            documents,
            config: root.join("config"),
            too_broad: vec![home.join("Desktop"), home.join("Downloads")],
        };
        (root, dirs)
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[cfg(unix)]
    #[test]
    fn 書類フォルダがicloudへのリンクなら_同期していると見分ける() {
        let (root, mut dirs) = temp_dirs("icloud");
        // 「デスクトップと書類」を入れた Mac：書類フォルダは iCloud Drive の Documents へのリンク
        let icloud_documents = dirs.home.join("Library/Mobile Documents/com~apple~CloudDocs/Documents");
        std::fs::create_dir_all(&icloud_documents).unwrap();
        std::fs::remove_dir(&dirs.documents).unwrap();
        std::os::unix::fs::symlink(&icloud_documents, &dirs.documents).unwrap();
        // まだ Q のフォルダがなくても、あっても
        assert_eq!(cloud_place(&dirs.default_folder(), &dirs.home, &no_env), Some("iCloud Drive".to_string()));
        std::fs::create_dir_all(dirs.default_folder()).unwrap();
        let info = folder_info(&dirs, None, &no_env);
        assert_eq!(info.cloud, Some("iCloud Drive".to_string()));
        assert!(info.is_default && info.exists);
        // ホームフォルダの Q は同期しない
        assert_eq!(info.home_cloud, None);
        assert_eq!(cloud_place(&dirs.home_folder(), &dirs.home, &no_env), None);
        // iCloud Drive の中に置いた会社ファイルも
        assert_eq!(
            cloud_place(&dirs.home.join("Library/Mobile Documents/com~apple~CloudDocs/給与/会社.qp"), &dirs.home, &no_env),
            Some("iCloud Drive".to_string())
        );
        // ホームフォルダを、リンクをたどった本当の場所で渡しても（macOS の /var → /private/var のように）見分ける
        let link_home = dirs.home.clone();
        dirs.home = std::fs::canonicalize(&link_home).unwrap();
        assert_eq!(cloud_place(&link_home.join("Documents/Q"), &dirs.home, &no_env), Some("iCloud Drive".to_string()));
        assert_eq!(cloud_place(&dirs.home.join("Documents/Q"), &link_home, &no_env), Some("iCloud Drive".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ほかのクラウドのアプリの場所と_windowsのonedriveも見分ける() {
        let (root, dirs) = temp_dirs("storage");
        let storage = dirs.home.join("Library/CloudStorage");
        std::fs::create_dir_all(storage.join("OneDrive-Personal/Documents")).unwrap();
        std::fs::create_dir_all(storage.join("Example-Drive")).unwrap();
        assert_eq!(cloud_place(&storage.join("OneDrive-Personal/Documents/Q"), &dirs.home, &no_env), Some("OneDrive".to_string()));
        assert_eq!(cloud_place(&storage.join("Example-Drive/Q"), &dirs.home, &no_env), Some("クラウドのフォルダ".to_string()));
        // CloudStorage そのものは、どれかのクラウドの中ではない
        assert_eq!(cloud_place(&storage, &dirs.home, &no_env), None);
        // Windows：書類フォルダを OneDrive に移すと、書類フォルダは OneDrive のフォルダ（環境変数 OneDrive）の中になる
        let onedrive = root.join("OneDrive");
        std::fs::create_dir_all(onedrive.join("Documents")).unwrap();
        let env = |key: &str| (key == "OneDrive").then(|| onedrive.to_string_lossy().into_owned());
        assert_eq!(cloud_place(&onedrive.join("Documents/Q"), &dirs.home, &env), Some("OneDrive".to_string()));
        assert_eq!(cloud_place(&dirs.default_folder(), &dirs.home, &env), None);
        // 空の環境変数は見ない
        let empty = |_: &str| Some(String::new());
        assert_eq!(cloud_place(&dirs.default_folder(), &dirs.home, &empty), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 大文字と小文字を区別せずに比べる() {
        assert!(starts_with_ignore_case(Path::new("/Users/a/onedrive/Documents/Q"), Path::new("/Users/a/OneDrive")));
        assert!(starts_with_ignore_case(Path::new("/Users/a/OneDrive"), Path::new("/Users/a/OneDrive")));
        assert!(!starts_with_ignore_case(Path::new("/Users/a/OneDriveX/Q"), Path::new("/Users/a/OneDrive")));
        assert!(!starts_with_ignore_case(Path::new("/Users/a"), Path::new("/Users/a/OneDrive")));
    }

    #[test]
    fn 同期していない書類フォルダは_知らせない() {
        let (root, dirs) = temp_dirs("local");
        let info = folder_info(&dirs, None, &no_env);
        assert_eq!(info.cloud, None);
        assert!(info.is_default);
        assert!(!info.exists); // Q のフォルダは、まだ作っていない
        assert_eq!(info.path, dirs.default_folder().to_string_lossy());
        assert_eq!(info.home_path, dirs.home_folder().to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 設定を残して読み直す() {
        let (root, dirs) = temp_dirs("settings");
        assert_eq!(load_setting(&dirs.config), None);
        let folder = dirs.home.join("給与のQ");
        save_setting(&dirs.config, Some(&folder)).unwrap();
        assert_eq!(load_setting(&dirs.config), Some(folder.clone()));
        let info = folder_info(&dirs, load_setting(&dirs.config).as_deref(), &no_env);
        assert_eq!(info.path, folder.to_string_lossy());
        assert!(!info.is_default);
        // 書類フォルダの Q に戻す
        save_setting(&dirs.config, None).unwrap();
        assert_eq!(load_setting(&dirs.config), None);
        save_setting(&dirs.config, None).unwrap(); // もう戻っていても
        // こわれた設定・場所が書いていない設定は使わない
        std::fs::write(dirs.config.join(SETTINGS_FILE), "{").unwrap();
        assert_eq!(load_setting(&dirs.config), None);
        std::fs::write(dirs.config.join(SETTINGS_FILE), r#"{"folder":"Q"}"#).unwrap();
        assert_eq!(load_setting(&dirs.config), None);
        // 書類フォルダの Q を選んだら、初めの場所に戻す
        assert_eq!(normalize_setting(&dirs, dirs.default_folder()), None);
        assert_eq!(normalize_setting(&dirs, folder.clone()), Some(folder));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn q_のフォルダにできるフォルダ() {
        let (root, dirs) = temp_dirs("choose");
        // 空のフォルダ（OS が作るファイルだけのものも）
        let empty = dirs.home.join("新しいフォルダ");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(check_chosen_folder(&empty, &dirs), Ok(()));
        std::fs::write(empty.join(".DS_Store"), b"").unwrap();
        assert_eq!(check_chosen_folder(&empty, &dirs), Ok(()));
        // 前に Q のフォルダとして使っていたフォルダ（Backup などがある・会社ファイルがある）
        let used = dirs.home.join("前のQ");
        std::fs::create_dir_all(used.join("Backup")).unwrap();
        std::fs::write(used.join("メモ.txt"), b"").unwrap();
        assert_eq!(check_chosen_folder(&used, &dirs), Ok(()));
        let with_file = dirs.home.join("給与");
        std::fs::create_dir_all(&with_file).unwrap();
        std::fs::write(with_file.join("メモ.txt"), b"").unwrap();
        assert!(check_chosen_folder(&with_file, &dirs).unwrap_err().contains("空のフォルダか"));
        std::fs::write(with_file.join("山田商店.QP"), b"").unwrap();
        assert_eq!(check_chosen_folder(&with_file, &dirs), Ok(()));
        // ホームフォルダとその上、書類・デスクトップのフォルダそのものはできない（中に会社ファイルがあっても）
        std::fs::write(dirs.documents.join("会社.qp"), b"").unwrap();
        for broad in [dirs.home.clone(), dirs.home.parent().unwrap().to_path_buf(), dirs.documents.clone(), dirs.home.join("Desktop"), PathBuf::from("/")] {
            let error = check_chosen_folder(&broad, &dirs).unwrap_err();
            assert!(error.contains("ホームフォルダやその上のフォルダ"), "{broad:?}: {error}");
        }
        // フォルダでないもの
        assert_eq!(check_chosen_folder(&with_file.join("メモ.txt"), &dirs), Err("フォルダを選んでください。".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }
}
