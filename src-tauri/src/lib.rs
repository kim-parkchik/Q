use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};

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

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())   
        .plugin(tauri_plugin_dialog::init()) 
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // 🆕 ここに hash_password を追加して登録！
        .invoke_handler(tauri::generate_handler![
            greet,
            hash_password,
            verify_password,
            derive_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}