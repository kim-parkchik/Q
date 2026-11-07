//! TimeQard（タイムカード）の、パソコンの側の部分
//!
//! - 管理のパスワード（Argon2。Q のログインと同じ）
//! - 閉じるボタン・Alt+F4 で閉じる前に、画面に知らせて管理のパスワードを聞く（うっかり閉じないように）
//! - パソコンを点けたら TimeQard を開く設定（Windows・Mac・Linux）
//! - 毎日の控えの古いものを消す（TimeQard が作った名前の控えだけ）
//! - Linux：画面の部品（WebKitGTK）で、カメラ（打刻カードの QR コードを読む）を使えるようにする

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// 管理のパスワードを確かめたあとだけ、閉じてよい
struct ExitGate(AtomicBool);

/// 閉じるボタンが押されたことを、画面に知らせる名前
const CLOSE_REQUESTED: &str = "timeqard://close-requested";

#[tauri::command]
fn hash_password(password: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn verify_password(password: String, hash: String) -> bool {
    match PasswordHash::new(&hash) {
        Ok(parsed) => Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

/// TimeQard を閉じる（画面で管理のパスワードを確かめてから呼ぶ）
#[tauri::command]
fn quit_app(app: tauri::AppHandle, gate: tauri::State<'_, ExitGate>) {
    gate.0.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 記録のファイル（timeqard.db）があるフォルダ（tauri-plugin-sql は、設定のフォルダに置く）
#[tauri::command]
fn data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// 控えの名前（backup.ts の backupFileName と同じ形）
fn is_backup_name(name: &str) -> bool {
    name.starts_with("TimeQard_控え_") && name.ends_with(".db")
}

/// 古い控えを消す（名前に日時が入っているので、名前の順に並べて、新しいものから keep 個を残す）
#[tauri::command]
fn prune_backups(dir: String, keep: usize) -> Result<usize, String> {
    let mut files: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            is_backup_name(&name).then(|| (name, entry.path()))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut removed = 0;
    for (_, path) in files.into_iter().skip(keep) {
        if std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    autostart::enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    autostart::set(enabled).map_err(|e| e.to_string())
}

/// パソコンを点けたら（ログインしたら）TimeQard を開く設定
mod autostart {
    use std::io;
    use std::path::PathBuf;

    /// 開くもの。Linux の AppImage は、置き場所（APPIMAGE）を使う（動いているあいだの場所は一時的なもののため）
    fn program() -> io::Result<PathBuf> {
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            return Ok(PathBuf::from(appimage));
        }
        std::env::current_exe()
    }

    #[cfg(target_os = "windows")]
    mod imp {
        use std::io;
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        const NAME: &str = "TimeQard";
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        fn reg(args: &[&str]) -> io::Result<std::process::Output> {
            Command::new("reg").args(args).creation_flags(CREATE_NO_WINDOW).output()
        }

        pub fn enabled() -> io::Result<bool> {
            Ok(reg(&["query", RUN_KEY, "/v", NAME])?.status.success())
        }

        pub fn set(on: bool) -> io::Result<()> {
            if on {
                let exe = super::program()?;
                let value = format!("\"{}\"", exe.to_string_lossy());
                let out = reg(&["add", RUN_KEY, "/v", NAME, "/t", "REG_SZ", "/d", &value, "/f"])?;
                if !out.status.success() {
                    return Err(io::Error::new(io::ErrorKind::Other, String::from_utf8_lossy(&out.stderr).into_owned()));
                }
            } else if enabled()? {
                reg(&["delete", RUN_KEY, "/v", NAME, "/f"])?;
            }
            Ok(())
        }
    }

    #[cfg(target_os = "macos")]
    mod imp {
        use std::io;
        use std::path::PathBuf;

        fn plist_path() -> io::Result<PathBuf> {
            let home = std::env::var_os("HOME").ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME がありません"))?;
            Ok(PathBuf::from(home).join("Library/LaunchAgents/jp.payroll.timeqard.plist"))
        }

        fn xml_escape(s: &str) -> String {
            s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        }

        pub fn enabled() -> io::Result<bool> {
            Ok(plist_path()?.exists())
        }

        pub fn set(on: bool) -> io::Result<()> {
            let path = plist_path()?;
            if !on {
                if path.exists() {
                    std::fs::remove_file(path)?;
                }
                return Ok(());
            }
            let exe = super::program()?;
            // 「TimeQard.app/Contents/MacOS/TimeQard」なら、アプリとして開く（open -a）
            let app = exe.ancestors().find(|p| p.extension().map(|e| e == "app").unwrap_or(false)).map(|p| p.to_path_buf());
            let args: Vec<String> = match app {
                Some(app) => vec!["/usr/bin/open".into(), "-a".into(), app.to_string_lossy().into_owned()],
                None => vec![exe.to_string_lossy().into_owned()],
            };
            let items: String = args.iter().map(|a| format!("    <string>{}</string>\n", xml_escape(a))).collect();
            let plist = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
                 <plist version=\"1.0\">\n<dict>\n  <key>Label</key>\n  <string>jp.payroll.timeqard</string>\n  \
                 <key>ProgramArguments</key>\n  <array>\n{items}  </array>\n  <key>RunAtLoad</key>\n  <true/>\n</dict>\n</plist>\n"
            );
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::fs::write(path, plist)
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    mod imp {
        use std::io;
        use std::path::PathBuf;

        fn desktop_path() -> io::Result<PathBuf> {
            let base = match std::env::var_os("XDG_CONFIG_HOME") {
                Some(dir) if !dir.is_empty() => PathBuf::from(dir),
                _ => PathBuf::from(std::env::var_os("HOME").ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME がありません"))?).join(".config"),
            };
            Ok(base.join("autostart/timeqard.desktop"))
        }

        /// .desktop の Exec の値（引用符でくくり、決まりの文字を「\」で逃がす）
        fn exec_quote(s: &str) -> String {
            let mut out = String::from("\"");
            for c in s.chars() {
                if matches!(c, '"' | '`' | '$' | '\\') {
                    out.push('\\');
                }
                out.push(c);
            }
            out.push('"');
            out
        }

        pub fn enabled() -> io::Result<bool> {
            Ok(desktop_path()?.exists())
        }

        pub fn set(on: bool) -> io::Result<()> {
            let path = desktop_path()?;
            if !on {
                if path.exists() {
                    std::fs::remove_file(path)?;
                }
                return Ok(());
            }
            let exe = super::program()?;
            let entry = format!(
                "[Desktop Entry]\nType=Application\nName=TimeQard\nComment=Q の打刻のソフト\nExec={}\nX-GNOME-Autostart-enabled=true\n",
                exec_quote(&exe.to_string_lossy())
            );
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::fs::write(path, entry)
        }
    }

    pub use imp::{enabled, set};
}

/// Mac のメニュー：「終了」（⌘Q）を置かない（うっかり閉じないように。閉じるのは管理の画面から）。
/// 文字を入れる欄で、コピー・貼り付けが使えるように、「編集」は置く
#[cfg(target_os = "macos")]
fn kiosk_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
    let app_menu = Submenu::with_items(
        app,
        "TimeQard",
        true,
        &[&PredefinedMenuItem::about(app, None, None)?, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::hide(app, None)?],
    )?;
    let edit = Submenu::with_items(
        app,
        "編集",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit])
}

/// Linux：WebKitGTK は、カメラを使う設定（enable-media-stream）が初めは切ってあり、カメラを使ってよいかの問い合わせ
/// （permission-request）にも答えない。TimeQard の窓では、カメラを使えるようにし、カメラ・マイクの問い合わせだけを許す
/// （TimeQard は、ほかのページを開かない）。Windows（WebView2）は初めて使うときに許可を聞き、Mac（wry）は許可する。
#[cfg(target_os = "linux")]
fn enable_camera(app: &tauri::App) {
    use webkit2gtk::glib::prelude::ObjectExt;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
        }
        view.connect_permission_request(|_, request| {
            if request.is::<UserMediaPermissionRequest>() {
                request.allow();
                true
            } else {
                false
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ExitGate(AtomicBool::new(false)));
    #[cfg(target_os = "macos")]
    let builder = builder.menu(kiosk_menu);
    builder
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            enable_camera(_app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<ExitGate>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit(CLOSE_REQUESTED, ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            hash_password,
            verify_password,
            quit_app,
            data_dir,
            prune_backups,
            get_autostart,
            set_autostart
        ])
        .build(tauri::generate_context!())
        .expect("TimeQard を起動できませんでした")
        .run(|app, event| {
            // 窓をすべて閉じたとき・OS から閉じるよう言われたとき（パスワードを確かめるまで閉じない）
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() && !app.state::<ExitGate>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit(CLOSE_REQUESTED, ());
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn パスワードを確かめられる() {
        let hash = hash_password("kanri1234".into()).unwrap();
        assert!(verify_password("kanri1234".into(), hash.clone()));
        assert!(!verify_password("kanri12345".into(), hash));
        assert!(!verify_password("x".into(), "壊れた値".into()));
    }

    #[test]
    fn 控えは新しいものから残し_ほかのファイルは消さない() {
        let dir = std::env::temp_dir().join(format!("timeqard-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "TimeQard_控え_2026-11-01_090000.db",
            "TimeQard_控え_2026-11-02_090000.db",
            "TimeQard_控え_2026-11-03_090000.db",
            "大事なファイル.db",
        ] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        assert_eq!(prune_backups(dir.to_string_lossy().into_owned(), 2).unwrap(), 1);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(
            left,
            vec!["TimeQard_控え_2026-11-02_090000.db", "TimeQard_控え_2026-11-03_090000.db", "大事なファイル.db"]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
