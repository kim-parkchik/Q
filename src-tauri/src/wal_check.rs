//! 会社ファイルを開く前に、となりにある作業中のファイル（会社ファイルの名前の後ろに「-wal」が付いたファイル）を確かめる
//!
//! SQLite は会社ファイル（例：会社.qp）を開くとき、となりに「会社.qp-wal」があれば、書き込んだのにまだ会社ファイルに
//! 移していないページを、そこから読む。SQLite 3.54.0 より前には、-wal のページが、SQLite が決めたページの大きさより
//! 小さいと、足りない分を読まずに、前にメモリにあった中身のまま返してしまう弱いところがある（CVE-2026-119375。
//! SQLite の src/wal.c の sqlite3WalReadFrame。3.54.0 で、残りを 0 で埋めるようになった）。細工した会社ファイルと -wal の組を
//! 開かせると、Q のメモリにある別のデータ（前に開いた別の会社のデータなど）が、その会社ファイルの中身として見えてしまう。
//!
//! Q が使う tauri-plugin-sql 2.6.0 は sqlx 0.8 を使い、sqlx 0.8 は直る前の SQLite 3.46.0（libsqlite3-sys 0.30.1）に決まっている
//! （直った SQLite を使える sqlx 0.9.1 に、tauri-plugin-sql がまだ対応していない）。そこで開く前に、SQLite がページの大きさを
//! 決めるもの（会社ファイルの先頭・-wal の先頭・-wal の中の会社ファイルの先頭のページ）がみな同じかを確かめ、違えば開かない。
//! WAL（-wal を使う書き方）のあいだはページの大きさを変えられないので、Q をふつうに使っていて違うことはない。
//!
//! SQLite のファイルの決まり（https://www.sqlite.org/fileformat2.html）
//! - 会社ファイルの先頭の100バイトのうち、16バイトめからの2バイトがページの大きさ（大きい桁から。1 は 65536）
//! - -wal の先頭の32バイト：0〜3バイトめが決まりの数（0x377f0682 か 0x377f0683）、8〜11バイトめがページの大きさ、16〜23バイトめが塩（salt）
//! - その後ろに、ページごとに、24バイトの頭（0〜3バイトめがページの番号、8〜15バイトめが塩）と、ページの中身が並ぶ
//! - ページの大きさは 512〜65536 の2のべき乗

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// -wal の先頭の決まりの数（いちばん下の1けたは、検査の数の並べ方なので見ない）
const WAL_MAGIC: u32 = 0x377f_0682;
/// -wal の先頭の大きさ
const WAL_HEADER_SIZE: u64 = 32;
/// -wal の中の、ページごとの頭の大きさ
const WAL_FRAME_HEADER_SIZE: u64 = 24;
/// 会社ファイルの先頭の大きさ（SQLite が開くときに読む）
const DB_HEADER_SIZE: u64 = 100;

/// 確かめて見つかったこと
#[derive(Debug, PartialEq, Eq)]
pub enum WalProblem {
    /// 会社ファイルの先頭のページの大きさ（読めなければ None）が、-wal のページの大きさと違う
    HeaderMismatch { wal: PathBuf, db_page_size: Option<u32>, wal_page_size: u32 },
    /// -wal の中の会社ファイルの先頭のページに書いてあるページの大きさ（おかしければ None）が、-wal のページの大きさと違う
    FirstPageMismatch { wal: PathBuf, first_page_size: Option<u32>, wal_page_size: u32 },
    /// 会社ファイルか -wal を読めなかった
    Unreadable { path: PathBuf, error: String },
}

impl WalProblem {
    /// 画面に出す知らせ
    pub fn message(&self) -> String {
        let detail = match self {
            WalProblem::HeaderMismatch { wal, db_page_size, wal_page_size } => format!(
                "となりにある作業中のファイル「{}」と会社ファイルとで、ページの大きさが合っていません（会社ファイルは {}、作業中のファイルは {}バイト）。",
                file_name(wal),
                db_page_size.map_or("読めません".to_string(), |size| format!("{size}バイト")),
                wal_page_size,
            ),
            WalProblem::FirstPageMismatch { wal, first_page_size, wal_page_size } => format!(
                "となりにある作業中のファイル「{}」の中にある会社ファイルの先頭に、作業中のファイルのページの大きさ（{}バイト）と違う大きさ（{}）が書いてあります。",
                file_name(wal),
                wal_page_size,
                first_page_size.map_or("正しくない値".to_string(), |size| format!("{size}バイト")),
            ),
            WalProblem::Unreadable { path, error } => {
                return format!(
                    "会社ファイルと、となりにある作業中のファイル（名前の後ろに「-wal」が付いたファイル）を確かめられなかったので、開きません。\n「{}」：{error}",
                    file_name(path)
                );
            }
        };
        format!(
            "この会社ファイルは開きません。\n{detail}\n\
             Q をふつうに使っていて、こうなることはありません。こわれたか、細工されたファイルのおそれがあります。\
             そのまま開くと、Q のメモリにある別のデータが、この会社ファイルの中身として出てしまうことがあるため（SQLite の弱いところ。CVE-2026-119375）、開かないようにしています。\n\
             人から受け取ったファイルなら、送った人に、Q で開いて閉じたあとの会社ファイルだけを送り直してもらってください。\
             自分の会社ファイルなら、バックアップ（.qb）から戻してください。"
        )
    }
}

/// -wal を確かめた結果（確かめたページの数。テストで使う）
#[derive(Debug, PartialEq, Eq)]
pub struct WalSummary {
    pub page_size: u32,
    pub frames: u64,
    pub first_page_frames: u64,
}

/// 会社ファイル（db。SQLite に渡すファイルの名前）を開く前に、SQLite がいっしょに読む -wal を確かめる。開いてよければ Ok
pub fn check_company_file(db: &Path) -> Result<(), WalProblem> {
    for wal in wal_paths(db) {
        inspect_wal(db, &wal)?;
    }
    Ok(())
}

/// SQLite が会社ファイル（db）といっしょに読む -wal の場所。SQLite は、macOS・Linux ではシンボリックリンクをたどった先の名前に
/// 「-wal」を付け（unixFullPathname）、Windows ではたどらない（winFullPathname）ので、両方を返す（同じなら1つ）
pub fn wal_paths(db: &Path) -> Vec<PathBuf> {
    let mut paths = vec![with_wal_suffix(db)];
    if let Ok(real) = std::fs::canonicalize(db) {
        let wal = with_wal_suffix(&real);
        if !paths.contains(&wal) {
            paths.push(wal);
        }
    }
    paths
}

/// 1つの -wal を確かめる。SQLite が中を使わない -wal（ない・32バイト以下・決まりの数やページの大きさがおかしい）と、
/// SQLite が -wal を消してしまう会社ファイル（ない・空）なら Ok(None)
pub fn inspect_wal(db: &Path, wal: &Path) -> Result<Option<WalSummary>, WalProblem> {
    let mut wal_file = match File::open(wal) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(unreadable(wal, e)),
    };
    let wal_len = wal_file.metadata().map_err(|e| unreadable(wal, e))?.len();
    // 32バイト以下の -wal は、SQLite は空として扱う（walIndexRecover）
    if wal_len <= WAL_HEADER_SIZE {
        return Ok(None);
    }
    let mut header = [0u8; WAL_HEADER_SIZE as usize];
    wal_file.read_exact(&mut header).map_err(|e| unreadable(wal, e))?;
    // 決まりの数やページの大きさがおかしい -wal も、SQLite は中を使わない（walIndexRecover）
    let Some(wal_page_size) = valid_page_size(be_u32(&header[8..12])) else {
        return Ok(None);
    };
    if be_u32(&header[0..4]) & 0xFFFF_FFFE != WAL_MAGIC {
        return Ok(None);
    }

    // 会社ファイルがない・空なら、SQLite は -wal を消して、空の会社ファイルとして開く（pagerOpenWalIfPresent）
    let db_file = match File::open(db) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(unreadable(db, e)),
    };
    if db_file.metadata().map_err(|e| unreadable(db, e))?.len() == 0 {
        return Ok(None);
    }
    // 会社ファイルの先頭。SQLite は100バイトを読み、足りない分は 0 とする（sqlite3PagerReadFileheader）。
    // SQLite は、まずこのページの大きさで読み始める（sqlite3BtreeOpen）
    let mut db_header = Vec::with_capacity(DB_HEADER_SIZE as usize);
    db_file.take(DB_HEADER_SIZE).read_to_end(&mut db_header).map_err(|e| unreadable(db, e))?;
    db_header.resize(DB_HEADER_SIZE as usize, 0);
    let db_page_size = page_size_field(db_header[16], db_header[17]);
    if db_page_size != Some(wal_page_size) {
        return Err(WalProblem::HeaderMismatch { wal: wal.to_path_buf(), db_page_size, wal_page_size });
    }

    // -wal の中の、会社ファイルの先頭のページ（ページの番号 1）。SQLite は、これに書いてあるページの大きさで決め直す（lockBtree）。
    // 塩が -wal の先頭と違うページは、SQLite は使わない（walDecodeFrame）。SQLite が使うかどうかを検査の数（checksum）までは
    // 確かめず、塩が同じものはみな見る（多めに止める）
    let salt = &header[16..24];
    let frame_size = WAL_FRAME_HEADER_SIZE + u64::from(wal_page_size);
    let frames = (wal_len - WAL_HEADER_SIZE) / frame_size;
    let mut first_page_frames = 0;
    for i in 0..frames {
        let offset = WAL_HEADER_SIZE + i * frame_size;
        let mut frame_header = [0u8; WAL_FRAME_HEADER_SIZE as usize];
        read_at(&mut wal_file, offset, &mut frame_header).map_err(|e| unreadable(wal, e))?;
        if &frame_header[8..16] != salt || be_u32(&frame_header[0..4]) != 1 {
            continue;
        }
        first_page_frames += 1;
        let mut field = [0u8; 2];
        read_at(&mut wal_file, offset + WAL_FRAME_HEADER_SIZE + 16, &mut field).map_err(|e| unreadable(wal, e))?;
        let first_page_size = page_size_field(field[0], field[1]);
        if first_page_size != Some(wal_page_size) {
            return Err(WalProblem::FirstPageMismatch { wal: wal.to_path_buf(), first_page_size, wal_page_size });
        }
    }
    Ok(Some(WalSummary { page_size: wal_page_size, frames, first_page_frames }))
}

/// ファイルの名前の後ろに「-wal」を付ける（SQLite と同じ）
fn with_wal_suffix(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push("-wal");
    PathBuf::from(name)
}

/// 会社ファイルの先頭の16バイトめからの2バイトのページの大きさ（SQLite と同じ読み方で、1 は 65536）。おかしければ None
fn page_size_field(high: u8, low: u8) -> Option<u32> {
    valid_page_size(u32::from(high) << 8 | u32::from(low) << 16)
}

/// ページの大きさとして正しい（512〜65536 の2のべき乗）なら Some
fn valid_page_size(size: u32) -> Option<u32> {
    (size.is_power_of_two() && (512..=65536).contains(&size)).then_some(size)
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn read_at(file: &mut File, offset: u64, buf: &mut [u8]) -> io::Result<()> {
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(buf)
}

fn unreadable(path: &Path, error: io::Error) -> WalProblem {
    WalProblem::Unreadable { path: path.to_path_buf(), error: error.to_string() }
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};

    /// テストごとの一時フォルダ
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("q_wal_check_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Q と同じく sqlx で WAL の会社ファイルを作って書き込む（閉じるまで、書いたページが -wal に残る）
    async fn wal_company_file(path: &Path, page_size: u32) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .page_size(page_size)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        sqlx::query("CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL)").execute(&pool).await.unwrap();
        for i in 0..50 {
            sqlx::query("INSERT INTO staff (name) VALUES (?)").bind(format!("従業員{i}")).execute(&pool).await.unwrap();
        }
        pool
    }

    /// 会社ファイルと -wal の組を、別の名前に写す（Q が開いているあいだの組と同じ）
    fn copy_pair(db: &Path, wal_of: &Path, to: &Path) {
        std::fs::copy(db, to).unwrap();
        std::fs::copy(with_wal_suffix(wal_of), with_wal_suffix(to)).unwrap();
    }

    /// -wal の中の、会社ファイルの先頭のページ（ページの番号 1）の頭の場所
    fn first_page_frames_of(wal: &Path, page_size: u64) -> Vec<u64> {
        let bytes = std::fs::read(wal).unwrap();
        let frame = WAL_FRAME_HEADER_SIZE + page_size;
        (0..(bytes.len() as u64 - WAL_HEADER_SIZE) / frame)
            .map(|i| WAL_HEADER_SIZE + i * frame)
            .filter(|&offset| be_u32(&bytes[offset as usize..offset as usize + 4]) == 1)
            .collect()
    }

    /// SQLite の -wal の検査の数（walChecksumBytes）。決まりの数のいちばん下が 1 なら大きい桁から、0 なら小さい桁から4バイトずつ読む
    fn wal_checksum(big_endian: bool, data: &[u8], (mut s0, mut s1): (u32, u32)) -> (u32, u32) {
        let word = |b: &[u8]| {
            let b = [b[0], b[1], b[2], b[3]];
            if big_endian { u32::from_be_bytes(b) } else { u32::from_le_bytes(b) }
        };
        for chunk in data.chunks_exact(8) {
            s0 = s0.wrapping_add(word(&chunk[0..4])).wrapping_add(s1);
            s1 = s1.wrapping_add(word(&chunk[4..8])).wrapping_add(s0);
        }
        (s0, s1)
    }

    /// -wal の先頭とページの検査の数を、先頭から付け直す（細工したページも、SQLite が正しいページとして使うようになる）
    fn reseal_wal(bytes: &mut [u8], page_size: usize) {
        let big_endian = bytes[3] & 1 == 1;
        let mut sum = wal_checksum(big_endian, &bytes[..24], (0, 0));
        bytes[24..28].copy_from_slice(&sum.0.to_be_bytes());
        bytes[28..32].copy_from_slice(&sum.1.to_be_bytes());
        let frame = WAL_FRAME_HEADER_SIZE as usize + page_size;
        let mut offset = WAL_HEADER_SIZE as usize;
        while offset + frame <= bytes.len() {
            sum = wal_checksum(big_endian, &bytes[offset..offset + 8], sum);
            sum = wal_checksum(big_endian, &bytes[offset + 24..offset + frame], sum);
            bytes[offset + 16..offset + 20].copy_from_slice(&sum.0.to_be_bytes());
            bytes[offset + 20..offset + 24].copy_from_slice(&sum.1.to_be_bytes());
            offset += frame;
        }
    }

    fn write_at(path: &Path, offset: u64, data: &[u8]) {
        let mut bytes = std::fs::read(path).unwrap();
        bytes[offset as usize..offset as usize + data.len()].copy_from_slice(data);
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn 作業中のファイルがなければ_確かめることはない() {
        let dir = temp_dir("none");
        let db = dir.join("会社.qp");
        // 新しく作る会社ファイル（まだない）
        assert_eq!(check_company_file(&db), Ok(()));
        std::fs::write(&db, b"SQLite format 3\0").unwrap();
        assert_eq!(check_company_file(&db), Ok(()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ふつうに作った作業中のファイルは_開ける() {
        tauri::async_runtime::block_on(async {
            let dir = temp_dir("real");
            // Q の会社ファイルは 4096バイト。SQLite が使えるいちばん小さい 512バイト・いちばん大きい 65536バイト（先頭には 1 と書く）も
            for page_size in [4096u32, 512, 65536] {
                let db = dir.join(format!("会社{page_size}.qp"));
                let pool = wal_company_file(&db, page_size).await;
                let summary = inspect_wal(&db, &with_wal_suffix(&db)).unwrap().expect("-wal がある");
                assert_eq!(summary.page_size, page_size);
                // 表を作ると、会社ファイルの先頭のページも -wal に書く（そこも確かめている）
                assert!(summary.first_page_frames >= 1, "{summary:?}");
                assert!(summary.frames > summary.first_page_frames, "{summary:?}");
                assert_eq!(check_company_file(&db), Ok(()));
                // 写した組も開ける
                let copy = dir.join(format!("写し{page_size}.qp"));
                copy_pair(&db, &db, &copy);
                assert_eq!(check_company_file(&copy), Ok(()));
                pool.close().await;
            }
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn ページの大きさが違う作業中のファイルと組にした会社ファイルは_開かない() {
        tauri::async_runtime::block_on(async {
            let dir = temp_dir("pair");
            let db = dir.join("会社.qp");
            let other = dir.join("別.qp");
            let pool = wal_company_file(&db, 4096).await;
            let other_pool = wal_company_file(&other, 1024).await;
            // 会社ファイル（4096バイト）と、別の会社ファイルの -wal（1024バイト）の組
            let target = dir.join("受け取った会社.qp");
            copy_pair(&db, &other, &target);
            let problem = check_company_file(&target).unwrap_err();
            assert_eq!(
                problem,
                WalProblem::HeaderMismatch {
                    wal: with_wal_suffix(&target),
                    db_page_size: Some(4096),
                    wal_page_size: 1024,
                }
            );
            let message = problem.message();
            assert!(message.starts_with("この会社ファイルは開きません。"), "{message}");
            assert!(message.contains("「受け取った会社.qp-wal」"), "{message}");
            assert!(message.contains("会社ファイルは 4096バイト、作業中のファイルは 1024バイト"), "{message}");
            assert!(message.contains("CVE-2026-119375"), "{message}");
            // 逆の組（会社ファイル 1024バイト・-wal 4096バイト）も
            let reverse = dir.join("逆.qp");
            copy_pair(&other, &db, &reverse);
            assert!(matches!(
                check_company_file(&reverse),
                Err(WalProblem::HeaderMismatch { db_page_size: Some(1024), wal_page_size: 4096, .. })
            ));
            pool.close().await;
            other_pool.close().await;
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn 作業中のファイルの中の会社ファイルの先頭が_違うページの大きさを書いていれば_開かない() {
        tauri::async_runtime::block_on(async {
            let dir = temp_dir("first");
            let db = dir.join("会社.qp");
            let pool = wal_company_file(&db, 4096).await;
            let target = dir.join("受け取った会社.qp");
            copy_pair(&db, &db, &target);
            let wal = with_wal_suffix(&target);
            let firsts = first_page_frames_of(&wal, 4096);
            assert!(!firsts.is_empty());
            // 細工：-wal の中の会社ファイルの先頭に 65536バイト（1）と書く。SQLite はこれでページの大きさを 65536 に決め直し、
            // 4096バイトのページを 65536バイトの入れ物に読んで、残りが前のメモリのままになる
            let last = *firsts.last().unwrap();
            write_at(&wal, last + WAL_FRAME_HEADER_SIZE + 16, &[0x00, 0x01]);
            let problem = check_company_file(&target).unwrap_err();
            assert_eq!(
                problem,
                WalProblem::FirstPageMismatch { wal: wal.clone(), first_page_size: Some(65536), wal_page_size: 4096 }
            );
            assert!(problem.message().contains("作業中のファイルのページの大きさ（4096バイト）と違う大きさ（65536バイト）"));
            // 正しくない値（2のべき乗でない）も
            write_at(&wal, last + WAL_FRAME_HEADER_SIZE + 16, &[0x10, 0x01]);
            assert!(matches!(
                check_company_file(&target),
                Err(WalProblem::FirstPageMismatch { first_page_size: None, wal_page_size: 4096, .. })
            ));
            // 塩が -wal の先頭と違うページは、SQLite は使わないので止めない
            for &offset in &firsts {
                write_at(&wal, offset + WAL_FRAME_HEADER_SIZE + 16, &[0x00, 0x01]);
                write_at(&wal, offset + 8, &[0xAB; 8]);
            }
            let summary = inspect_wal(&target, &wal).unwrap().unwrap();
            assert_eq!(summary.first_page_frames, 0);
            assert_eq!(check_company_file(&target), Ok(()));
            pool.close().await;
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn 確かめずに細工した組を開くと_sqliteは作業中のファイルのページより大きなページで読む() {
        // SQLite 3.54.0 より前の弱いところの起こり方：-wal の中の会社ファイルの先頭に、-wal より大きなページの大きさを書き、
        // 検査の数を付け直すと、SQLite はそれでページの大きさを決め直し、-wal の 4096バイトのページを 8192バイトの入れ物に読む
        // （残りの 4096バイトが前のメモリのまま）。Q の確かめは、この組を止める
        tauri::async_runtime::block_on(async {
            use sqlx::{ConnectOptions, Connection};
            let dir = temp_dir("crafted");
            let db = dir.join("会社.qp");
            let pool = wal_company_file(&db, 4096).await;
            let target = dir.join("受け取った会社.qp");
            copy_pair(&db, &db, &target);
            pool.close().await;
            let wal = with_wal_suffix(&target);
            let mut bytes = std::fs::read(&wal).unwrap();
            // 検査の数の付け方が SQLite と同じこと（付け直しても変わらない）
            let mut resealed = bytes.clone();
            reseal_wal(&mut resealed, 4096);
            assert!(resealed == bytes);
            // 最後の会社ファイルの先頭のページ（SQLite が使うもの）に 8192バイトと書き、検査の数を付け直す
            let last = *first_page_frames_of(&wal, 4096).last().unwrap() as usize;
            let field = last + WAL_FRAME_HEADER_SIZE as usize + 16;
            bytes[field..field + 2].copy_from_slice(&[0x20, 0x00]);
            reseal_wal(&mut bytes, 4096);
            std::fs::write(&wal, &bytes).unwrap();
            assert_eq!(
                check_company_file(&target),
                Err(WalProblem::FirstPageMismatch { wal: wal.clone(), first_page_size: Some(8192), wal_page_size: 4096 })
            );
            // 確かめずに開くと、SQLite は 8192バイトのページで読む（会社ファイルの先頭と -wal の先頭は 4096バイトのまま）
            let mut conn = SqliteConnectOptions::new().filename(&target).connect().await.unwrap();
            let tables: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_schema").fetch_one(&mut conn).await.unwrap();
            assert_eq!(tables, 1);
            let page_size: i64 = sqlx::query_scalar("PRAGMA page_size").fetch_one(&mut conn).await.unwrap();
            assert_eq!(page_size, 8192);
            let _ = conn.close().await;
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn 会社ファイルの先頭が読めなければ_開かない_空なら開ける() {
        tauri::async_runtime::block_on(async {
            let dir = temp_dir("short");
            let db = dir.join("会社.qp");
            let pool = wal_company_file(&db, 4096).await;
            let target = dir.join("受け取った会社.qp");
            copy_pair(&db, &db, &target);
            // 会社ファイルが短い（ページの大きさのところまでない）。SQLite は 0 として読み、4096バイトで読み始める
            let bytes = std::fs::read(&target).unwrap();
            std::fs::write(&target, &bytes[..16]).unwrap();
            assert!(matches!(
                check_company_file(&target),
                Err(WalProblem::HeaderMismatch { db_page_size: None, wal_page_size: 4096, .. })
            ));
            // ページの大きさのところが正しくない
            let mut broken = bytes.clone();
            broken[16] = 0x03;
            std::fs::write(&target, &broken).unwrap();
            assert!(matches!(
                check_company_file(&target),
                Err(WalProblem::HeaderMismatch { db_page_size: None, .. })
            ));
            // 空の会社ファイルなら、SQLite は -wal を消して開く
            std::fs::write(&target, b"").unwrap();
            assert_eq!(check_company_file(&target), Ok(()));
            pool.close().await;
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn sqliteが中を使わない作業中のファイルは_止めない() {
        tauri::async_runtime::block_on(async {
            let dir = temp_dir("ignored");
            let db = dir.join("会社.qp");
            let other = dir.join("別.qp");
            let pool = wal_company_file(&db, 4096).await;
            let other_pool = wal_company_file(&other, 1024).await;
            let target = dir.join("受け取った会社.qp");
            copy_pair(&db, &other, &target);
            let wal = with_wal_suffix(&target);
            let bytes = std::fs::read(&wal).unwrap();
            // 32バイト以下（先頭だけ）
            std::fs::write(&wal, &bytes[..32]).unwrap();
            assert_eq!(check_company_file(&target), Ok(()));
            // 決まりの数が違う
            let mut wrong_magic = bytes.clone();
            wrong_magic[0] = 0x00;
            std::fs::write(&wal, &wrong_magic).unwrap();
            assert_eq!(check_company_file(&target), Ok(()));
            // ページの大きさが正しくない（1000バイト）
            let mut wrong_size = bytes.clone();
            wrong_size[8..12].copy_from_slice(&1000u32.to_be_bytes());
            std::fs::write(&wal, &wrong_size).unwrap();
            assert_eq!(check_company_file(&target), Ok(()));
            // 元にもどすと止める
            std::fs::write(&wal, &bytes).unwrap();
            assert!(check_company_file(&target).is_err());
            pool.close().await;
            other_pool.close().await;
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[cfg(unix)]
    #[test]
    fn シンボリックリンクの先の作業中のファイルも確かめる() {
        tauri::async_runtime::block_on(async {
            let dir = temp_dir("link");
            let db = dir.join("会社.qp");
            let other = dir.join("別.qp");
            let pool = wal_company_file(&db, 4096).await;
            let other_pool = wal_company_file(&other, 1024).await;
            std::fs::create_dir_all(dir.join("中")).unwrap();
            // macOS・Linux の SQLite は、リンクの先の名前に「-wal」を付ける（リンクから開いて書くと、-wal はリンクの先にできる）
            let real_new = dir.join("中").join("新しい会社.qp");
            wal_company_file(&real_new, 4096).await.close().await;
            let link_new = dir.join("新しいリンク.qp");
            std::os::unix::fs::symlink(&real_new, &link_new).unwrap();
            let link_pool = wal_company_file(&link_new, 4096).await;
            assert!(with_wal_suffix(&real_new).exists());
            assert!(!with_wal_suffix(&link_new).exists());
            assert_eq!(check_company_file(&link_new), Ok(()));
            link_pool.close().await;
            // 「中/受け取った会社.qp」と、その -wal（ページの大きさが違う）。「リンク.qp」は「中/受け取った会社.qp」へのリンク
            let real = dir.join("中").join("受け取った会社.qp");
            copy_pair(&db, &other, &real);
            let link = dir.join("リンク.qp");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            // macOS・Linux の SQLite は、リンクの先の名前に「-wal」を付けた「中/受け取った会社.qp-wal」を読む
            assert!(!with_wal_suffix(&link).exists());
            match check_company_file(&link) {
                Err(WalProblem::HeaderMismatch { wal, db_page_size: Some(4096), wal_page_size: 1024 }) => {
                    assert_eq!(wal, with_wal_suffix(&std::fs::canonicalize(&real).unwrap()));
                }
                other => panic!("{other:?}"),
            }
            pool.close().await;
            other_pool.close().await;
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn ページの大きさの読み方() {
        assert_eq!(page_size_field(0x10, 0x00), Some(4096));
        assert_eq!(page_size_field(0x02, 0x00), Some(512));
        assert_eq!(page_size_field(0x80, 0x00), Some(32768));
        assert_eq!(page_size_field(0x00, 0x01), Some(65536));
        assert_eq!(page_size_field(0x01, 0x00), None); // 256
        assert_eq!(page_size_field(0x00, 0x00), None);
        assert_eq!(page_size_field(0x10, 0x01), None);
        assert_eq!(valid_page_size(65536), Some(65536));
        assert_eq!(valid_page_size(131072), None);
        assert_eq!(valid_page_size(1000), None);
    }
}
