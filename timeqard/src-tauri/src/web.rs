//! ブラウザ版（各自のパソコンのブラウザから押す。timeqard/DESIGN.md の 10）
//!
//! - 同じネットワークの中だけの https のサーバー。社内のアドレス（プライベートアドレス・リンクローカル）と、このパソコンからだけ受ける。
//! - 会社専用の証明書（認証局）を自動で作り、各自のパソコンに1回だけ入れてもらう。
//!   名前の制約（社内のアドレス・localhost・.local だけ）を付けるので、万が一この証明書の鍵が盗まれても、
//!   インターネットのほかのサイトのふりには使えない。
//! - サーバーの証明書は、このパソコンのアドレスが変わったときや期限の前に、自動で作り直す（各自のパソコンでの入れ直しはいらない）。
//! - 打刻・申し出などの中身は、画面の側（TypeScript。src/webApi.ts）で決める。サーバーは、ブラウザから来た頼み（/api/…）を
//!   画面に渡し（イベント timeqard://web-request）、画面の答え（web_respond）をブラウザに返すだけにする。
//! - ブラウザ用の画面（web.html と assets/）は、TimeQard に入っている画面のファイルから出す。

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{HeaderMap, HeaderValue, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE, HOST, ORIGIN};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use rcgen::{
    BasicConstraints, CertificateParams, CidrSubnet, DistinguishedName, DnType, ExtendedKeyUsagePurpose, GeneralSubtree, IsCa,
    KeyPair, KeyUsagePurpose, NameConstraints, SanType, SerialNumber,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;

/// ブラウザからの頼みを、画面に渡すイベントの名前
pub const WEB_REQUEST: &str = "timeqard://web-request";
/// 画面が答えるまで待つ長さ（Argon2 でパスワードを確かめるので、少し長め）
const ANSWER_TIMEOUT: Duration = Duration::from_secs(20);
/// ブラウザから受ける中身の大きさの上限
const BODY_LIMIT: usize = 64 * 1024;
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
const TLS_TIMEOUT: Duration = Duration::from_secs(10);
/// 1つのつながりを持っていてよい長さ
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(120);
const DAY: u64 = 86_400;
/// サーバーの証明書の期限（ブラウザの決まりに合わせて 398 日より短くする）
const SERVER_CERT_DAYS: u64 = 397;
/// 期限がこれより近ければ、作り直す
const RENEW_BEFORE_DAYS: u64 = 30;
/// 会社専用の証明書（認証局）の期限
const CA_DAYS: u64 = 20 * 365;
/// アドレスの変わり・期限を確かめる間隔
const CHECK_INTERVAL: Duration = Duration::from_secs(10 * 60);

/// 会社専用の証明書をダウンロードするときの名前
pub const CA_FILE_NAME: &str = "TimeQard-CA.cer";

// ---------------------------------------------------------------- 証明書

/// 会社専用の証明書（認証局）の名前。作ったときに決め、サーバーの証明書を作り直すときも同じ名前を使う
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CaInfo {
    pub cn: String,
    pub org: String,
}

/// 会社専用の証明書と、その鍵
pub struct CaMaterial {
    pub info: CaInfo,
    pub cert_der: Vec<u8>,
    pub key: KeyPair,
}

/// サーバーの証明書を作ったときの、アドレスと期限
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct ServerInfo {
    ips: Vec<String>,
    not_after: u64,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// 証明書の番号（同じ認証局が出す証明書で重ならないように、ばらばらにする。先頭は 0 にして正の数にする）
fn random_serial() -> SerialNumber {
    use rand_core::RngCore;
    let mut b = [0u8; 16];
    rand_core::OsRng.fill_bytes(&mut b);
    b[0] &= 0x7f;
    b[0] |= 0x01;
    SerialNumber::from_slice(&b)
}

/// 名前の制約：この証明書で確かめてよいのは、社内のアドレス・このパソコン・localhost・.local だけ
fn local_subtrees() -> Vec<GeneralSubtree> {
    let v4: [([u8; 4], u8); 5] = [
        ([10, 0, 0, 0], 8),
        ([172, 16, 0, 0], 12),
        ([192, 168, 0, 0], 16),
        ([169, 254, 0, 0], 16),
        ([127, 0, 0, 0], 8),
    ];
    let mut s: Vec<GeneralSubtree> = v4.iter().map(|(a, p)| GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix(*a, *p))).collect();
    for (addr, prefix) in [
        (Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7u8),
        (Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10),
        (Ipv6Addr::LOCALHOST, 128),
    ] {
        s.push(GeneralSubtree::IpAddress(CidrSubnet::from_v6_prefix(addr.octets(), prefix)));
    }
    s.push(GeneralSubtree::DnsName("localhost".into()));
    s.push(GeneralSubtree::DnsName("local".into()));
    s
}

fn ca_params(info: &CaInfo) -> CertificateParams {
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, info.cn.clone());
    if !info.org.is_empty() {
        dn.push(DnType::OrganizationName, info.org.clone());
    }
    p.distinguished_name = dn;
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    p.name_constraints = Some(NameConstraints { permitted_subtrees: local_subtrees(), excluded_subtrees: vec![] });
    p
}

/// 会社専用の証明書（認証局）を作る
pub fn create_ca(company: &str, today: &str) -> Result<CaMaterial, String> {
    let key = KeyPair::generate().map_err(err)?;
    let info = CaInfo {
        cn: format!("TimeQard 会社専用の証明書（{today}）"),
        org: company.trim().chars().take(60).collect(),
    };
    let mut p = ca_params(&info);
    let now = SystemTime::now();
    p.not_before = (now - Duration::from_secs(DAY)).into();
    p.not_after = (now + Duration::from_secs(CA_DAYS * DAY)).into();
    p.serial_number = Some(random_serial());
    let cert = p.self_signed(&key).map_err(err)?;
    Ok(CaMaterial { info, cert_der: cert.der().to_vec(), key })
}

/// サーバーの証明書を作る（会社専用の証明書の鍵で署名する。このパソコンのアドレスと localhost を入れる）
/// 返すのは、証明書（DER）と鍵（PKCS#8 の DER）
pub fn make_server_cert(ca: &CaMaterial, ips: &[Ipv4Addr]) -> Result<(Vec<u8>, Vec<u8>, u64), String> {
    // 署名する人（同じ名前・同じ鍵の認証局。配った証明書と、名前・鍵の識別子が同じになる）
    let issuer = ca_params(&ca.info).self_signed(&ca.key).map_err(err)?;
    let key = KeyPair::generate().map_err(err)?;
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "TimeQard");
    p.distinguished_name = dn;
    p.subject_alt_names = vec![
        SanType::DnsName("localhost".try_into().map_err(err)?),
        SanType::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST)),
    ];
    for ip in ips {
        p.subject_alt_names.push(SanType::IpAddress(IpAddr::V4(*ip)));
    }
    p.is_ca = IsCa::ExplicitNoCa;
    p.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    p.use_authority_key_identifier_extension = true;
    p.serial_number = Some(random_serial());
    let now = SystemTime::now();
    let not_after = now + Duration::from_secs(SERVER_CERT_DAYS * DAY);
    p.not_before = (now - Duration::from_secs(DAY)).into();
    p.not_after = not_after.into();
    let cert = p.signed_by(&key, &issuer, &ca.key).map_err(err)?;
    let not_after_secs = not_after.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    Ok((cert.der().to_vec(), key.serialize_der(), not_after_secs))
}

/// 指紋（各自のパソコンで証明書を入れるときに、同じ証明書かを見比べる）
pub fn fingerprint(der: &[u8], sha256: bool) -> String {
    let alg = if sha256 { &ring::digest::SHA256 } else { &ring::digest::SHA1_FOR_LEGACY_USE_ONLY };
    ring::digest::digest(alg, der).as_ref().iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

// ---------------------------------------------------------------- アドレス

/// 社内のネットワーク（プライベートアドレス・リンクローカル）か、このパソコンか
pub fn is_local_network(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_local_network(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

/// このパソコンの、社内のネットワークのアドレス（いくつかの行き先へのつなぎ方から調べる。実際には何も送らない）
pub fn local_ipv4s() -> Vec<Ipv4Addr> {
    let targets = ["192.168.0.1:9", "192.168.1.1:9", "10.0.0.1:9", "172.16.0.1:9", "8.8.8.8:9"];
    let mut out: Vec<Ipv4Addr> = Vec::new();
    for t in targets {
        let Ok(s) = UdpSocket::bind("0.0.0.0:0") else { continue };
        if s.connect(t).is_err() {
            continue;
        }
        if let Ok(SocketAddr::V4(a)) = s.local_addr() {
            let ip = *a.ip();
            if is_local_network(IpAddr::V4(ip)) && !ip.is_loopback() && !out.contains(&ip) {
                out.push(ip);
            }
        }
    }
    out.sort();
    out
}

// ---------------------------------------------------------------- ファイル

fn write_secret(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(err)?;
    }
    Ok(())
}

/// 会社専用の証明書を読む。なければ作って残す
pub fn load_or_create_ca(dir: &Path, company: &str, today: &str) -> Result<CaMaterial, String> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let (info_p, cert_p, key_p) = (dir.join("ca.json"), dir.join("ca.der"), dir.join("ca.key.pem"));
    if info_p.exists() && cert_p.exists() && key_p.exists() {
        let info: CaInfo = serde_json::from_slice(&std::fs::read(&info_p).map_err(err)?).map_err(err)?;
        let cert_der = std::fs::read(&cert_p).map_err(err)?;
        let key = KeyPair::from_pem(&std::fs::read_to_string(&key_p).map_err(err)?).map_err(err)?;
        return Ok(CaMaterial { info, cert_der, key });
    }
    let ca = create_ca(company, today)?;
    write_secret(&key_p, ca.key.serialize_pem().as_bytes())?;
    std::fs::write(&cert_p, &ca.cert_der).map_err(err)?;
    std::fs::write(&info_p, serde_json::to_vec_pretty(&ca.info).map_err(err)?).map_err(err)?;
    Ok(ca)
}

/// サーバーの証明書を読む。アドレスが変わった・期限が近い・なければ、作り直して残す（証明書・鍵・作り直したか）
fn load_or_renew_server_cert(dir: &Path, ca: &CaMaterial, ips: &[Ipv4Addr]) -> Result<(Vec<u8>, Vec<u8>, bool), String> {
    let (info_p, cert_p, key_p) = (dir.join("server.json"), dir.join("server.der"), dir.join("server.key.der"));
    let want: Vec<String> = ips.iter().map(|i| i.to_string()).collect();
    if let (Ok(info), Ok(cert), Ok(key)) = (std::fs::read(&info_p), std::fs::read(&cert_p), std::fs::read(&key_p)) {
        if let Ok(info) = serde_json::from_slice::<ServerInfo>(&info) {
            let covers = want.iter().all(|ip| info.ips.contains(ip));
            if covers && info.not_after > now_secs() + RENEW_BEFORE_DAYS * DAY {
                return Ok((cert, key, false));
            }
        }
    }
    let (cert, key, not_after) = make_server_cert(ca, ips)?;
    write_secret(&key_p, &key)?;
    std::fs::write(&cert_p, &cert).map_err(err)?;
    std::fs::write(&info_p, serde_json::to_vec_pretty(&ServerInfo { ips: want, not_after }).map_err(err)?).map_err(err)?;
    Ok((cert, key, true))
}

fn certified_key(cert_der: Vec<u8>, key_der: Vec<u8>) -> Result<Arc<CertifiedKey>, String> {
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der));
    let signing = rustls::crypto::ring::sign::any_supported_type(&key).map_err(err)?;
    Ok(Arc::new(CertifiedKey::new(vec![CertificateDer::from(cert_der)], signing)))
}

/// サーバーの証明書を、動かしたまま差し替えられるようにする
#[derive(Debug)]
struct CertSwap(RwLock<Arc<CertifiedKey>>);

impl ResolvesServerCert for CertSwap {
    fn resolve(&self, _hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        self.0.read().ok().map(|k| k.clone())
    }
}

// ---------------------------------------------------------------- サーバーの状態

/// ブラウザの頼みと、画面の答えのつなぎ
#[derive(Default)]
pub struct WebBridge {
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<(u16, String)>>>,
}

#[derive(Clone, Serialize)]
struct WebRequestEvent {
    id: u64,
    action: String,
    body: String,
    ip: String,
}

#[derive(Clone, Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebStatus {
    pub running: bool,
    pub port: u16,
    /// 各自のパソコンのブラウザで開くアドレス
    pub urls: Vec<String>,
    pub ca_name: String,
    pub sha256: String,
    pub sha1: String,
}

struct Running {
    /// つながりを受ける仕事と、証明書を見張る仕事
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
    status: WebStatus,
}

#[derive(Default)]
pub struct WebServer {
    running: Mutex<Option<Running>>,
}

/// サーバーの中で使う、変わらない値
struct Shared {
    ca_der: Vec<u8>,
    status: WebStatus,
}

fn web_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("web"))
}

fn urls_of(ips: &[Ipv4Addr], port: u16) -> Vec<String> {
    ips.iter().map(|ip| format!("https://{ip}:{port}/")).collect()
}

/// ブラウザ版のサーバーを始める（動いていれば止めてから）。会社名と今日の日付は、会社専用の証明書を初めて作るときの名前に使う
#[tauri::command]
pub async fn web_start<R: Runtime>(
    app: AppHandle<R>,
    server: tauri::State<'_, WebServer>,
    port: u16,
    company: String,
    today: String,
) -> Result<WebStatus, String> {
    stop(&server);
    if port < 1024 {
        return Err("ポートは 1024 から 65535 の番号にしてください。".into());
    }
    let dir = web_dir(&app)?;
    let ca = load_or_create_ca(&dir, &company, &today)?;
    let ips = local_ipv4s();
    let (cert, key, _) = load_or_renew_server_cert(&dir, &ca, &ips)?;
    let swap = Arc::new(CertSwap(RwLock::new(certified_key(cert, key)?)));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(err)?
        .with_no_client_auth()
        .with_cert_resolver(swap.clone());
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))
        .await
        .map_err(|e| format!("ポート {port} を使えませんでした（ほかのソフトが使っていないか確かめてください）。{e}"))?;
    let status = WebStatus {
        running: true,
        port,
        urls: urls_of(&ips, port),
        ca_name: ca.info.cn.clone(),
        sha256: fingerprint(&ca.cert_der, true),
        sha1: fingerprint(&ca.cert_der, false),
    };
    let shared = Arc::new(Shared { ca_der: ca.cert_der.clone(), status: status.clone() });
    let accept = tauri::async_runtime::spawn(serve(app.clone(), listener, acceptor, shared));
    let watch = tauri::async_runtime::spawn(watch_cert(swap, dir, ca));
    *server.running.lock().map_err(err)? = Some(Running { tasks: vec![accept, watch], status: status.clone() });
    Ok(status)
}

fn stop(server: &WebServer) {
    if let Ok(mut r) = server.running.lock() {
        if let Some(running) = r.take() {
            for task in running.tasks {
                task.abort();
            }
        }
    }
}

/// ブラウザ版のサーバーを止める
#[tauri::command]
pub fn web_stop(server: tauri::State<'_, WebServer>) {
    stop(&server);
}

/// ブラウザ版のサーバーの状態（止まっていれば running が false）。アドレスは、いまのこのパソコンのアドレスで出す
#[tauri::command]
pub fn web_status(server: tauri::State<'_, WebServer>) -> WebStatus {
    let mut status = server.running.lock().ok().and_then(|r| r.as_ref().map(|x| x.status.clone())).unwrap_or_default();
    if status.running {
        status.urls = urls_of(&local_ipv4s(), status.port);
    }
    status
}

/// 会社専用の証明書のファイルの中身（入口のパソコンの管理の画面から、USB メモリなどに保存して、各自のパソコンに入れる）
#[tauri::command]
pub fn web_ca_der<R: Runtime>(app: AppHandle<R>) -> Result<Vec<u8>, String> {
    std::fs::read(web_dir(&app)?.join("ca.der")).map_err(|_| "会社専用の証明書が、まだありません（ブラウザ版を一度始めると作ります）。".to_string())
}

/// 画面の答えを、待っているブラウザに返す
#[tauri::command]
pub fn web_respond(bridge: tauri::State<'_, WebBridge>, id: u64, status: u16, body: String) {
    if let Ok(mut pending) = bridge.pending.lock() {
        if let Some(tx) = pending.remove(&id) {
            let _ = tx.send((status, body));
        }
    }
}

/// つながりを受ける（同じネットワークの中だけ）
async fn serve<R: Runtime>(app: AppHandle<R>, listener: TcpListener, acceptor: TlsAcceptor, shared: Arc<Shared>) {
    loop {
        let Ok((tcp, peer)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        };
        if !is_local_network(peer.ip()) {
            continue;
        }
        let (acceptor, app, shared) = (acceptor.clone(), app.clone(), shared.clone());
        tauri::async_runtime::spawn(async move {
            let Ok(Ok(tls)) = tokio::time::timeout(TLS_TIMEOUT, acceptor.accept(tcp)).await else { return };
            let service = service_fn(move |req| handle(app.clone(), shared.clone(), peer, req));
            let conn = http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(HEADER_TIMEOUT)
                .serve_connection(TokioIo::new(tls), service);
            let _ = tokio::time::timeout(CONNECTION_TIMEOUT, conn).await;
        });
    }
}

/// このパソコンのアドレスが変わった・期限が近いときは、サーバーの証明書を作り直して差し替える
async fn watch_cert(swap: Arc<CertSwap>, dir: PathBuf, ca: CaMaterial) {
    loop {
        tokio::time::sleep(CHECK_INTERVAL).await;
        let ips = local_ipv4s();
        if let Ok((cert, key, true)) = load_or_renew_server_cert(&dir, &ca, &ips) {
            if let (Ok(ck), Ok(mut slot)) = (certified_key(cert, key), swap.0.write()) {
                *slot = ck;
            }
        }
    }
}

type Res = Response<Full<Bytes>>;

fn respond(status: StatusCode, content_type: &str, body: impl Into<Bytes>) -> Res {
    let mut r = Response::new(Full::new(body.into()));
    *r.status_mut() = status;
    if let Ok(v) = HeaderValue::from_str(content_type) {
        r.headers_mut().insert(CONTENT_TYPE, v);
    }
    r
}

fn text(status: StatusCode, message: &str) -> Res {
    respond(status, "text/plain; charset=utf-8", message.to_string())
}

/// ブラウザに、ほかのサイトから読み込ませない・覚えさせない決まりを付ける
fn with_security_headers(mut r: Res) -> Res {
    let h = r.headers_mut();
    let pairs = [
        (
            "content-security-policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ),
        ("x-frame-options", "DENY"),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
    ];
    for (k, v) in pairs {
        if let Ok(v) = HeaderValue::from_str(v) {
            h.insert(k, v);
        }
    }
    if !h.contains_key(CACHE_CONTROL) {
        h.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    r
}

/// TimeQard に入っている画面のファイル（web.html と assets/）。拡張子と中身の種類が合わなければ、見つからなかったことにする
fn asset<R: Runtime>(app: &AppHandle<R>, path: &str) -> Res {
    let Some(a) = app.asset_resolver().get(path.to_string()) else {
        return text(StatusCode::NOT_FOUND, "ブラウザ版の画面が見つかりません。");
    };
    let mime = a.mime_type().to_string();
    let expected_html = path.ends_with(".html");
    if expected_html != mime.starts_with("text/html") {
        return text(StatusCode::NOT_FOUND, "見つかりません。");
    }
    let mut r = respond(StatusCode::OK, &mime, a.bytes().to_vec());
    if path.starts_with("assets/") {
        // 名前に中身の印が入っているので、覚えておいてよい
        r.headers_mut().insert(CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    }
    r
}

async fn handle<R: Runtime>(app: AppHandle<R>, shared: Arc<Shared>, peer: SocketAddr, req: Request<Incoming>) -> Result<Res, Infallible> {
    let path = req.uri().path().to_string();
    let res = match (req.method().clone(), path.as_str()) {
        (Method::GET, "/") | (Method::GET, "/index.html") => asset(&app, "web.html"),
        (Method::GET, p) if p.starts_with("/assets/") && !p.contains("..") => asset(&app, &p[1..]),
        (Method::GET, "/cert/TimeQard-CA.cer") => {
            let mut r = respond(StatusCode::OK, "application/pkix-cert", shared.ca_der.clone());
            if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{CA_FILE_NAME}\"")) {
                r.headers_mut().insert(CONTENT_DISPOSITION, v);
            }
            r
        }
        (Method::GET, "/api/cert-info") => {
            let s = &shared.status;
            let body = serde_json::json!({ "caName": s.ca_name, "sha256": s.sha256, "sha1": s.sha1, "fileName": CA_FILE_NAME });
            respond(StatusCode::OK, "application/json; charset=utf-8", body.to_string())
        }
        (Method::POST, p) if p.starts_with("/api/") => bridge(&app, &p[5..], peer, req).await,
        _ => text(StatusCode::NOT_FOUND, "見つかりません。"),
    };
    Ok(with_security_headers(res))
}

/// ほかのサイトのページから送られた頼みではないか（なりすましの頼み（CSRF）を断る）。
/// - 中身の種類は JSON だけを受ける（ほかのサイトのページが JSON を送ろうとすると、ブラウザが先に確かめ（OPTIONS）を送り、
///   このサーバーは答えないので、本当の頼みは送られない）。
/// - ブラウザが「どのページからの頼みか」（Origin）を付けていれば、このサーバーのページ（https://＋Host）からのものだけを受ける。
fn same_site_request(headers: &HeaderMap) -> bool {
    let json = headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("application/json"))
        .unwrap_or(false);
    if !json {
        return false;
    }
    match headers.get(ORIGIN) {
        None => true,
        Some(origin) => {
            let host = headers.get(HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
            !host.is_empty() && origin.to_str().map(|o| o.eq_ignore_ascii_case(&format!("https://{host}"))).unwrap_or(false)
        }
    }
}

/// ブラウザの頼みを画面に渡し、答えを待つ
async fn bridge<R: Runtime>(app: &AppHandle<R>, action: &str, peer: SocketAddr, req: Request<Incoming>) -> Res {
    if action.is_empty() || action.len() > 40 || !action.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return text(StatusCode::NOT_FOUND, "見つかりません。");
    }
    if !same_site_request(req.headers()) {
        return text(StatusCode::FORBIDDEN, "TimeQard のページからの頼みではないので、受けません。");
    }
    let body = match Limited::new(req.into_body(), BODY_LIMIT).collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => return text(StatusCode::PAYLOAD_TOO_LARGE, "送られた中身が大きすぎます。"),
    };
    let Ok(body) = String::from_utf8(body.to_vec()) else {
        return text(StatusCode::BAD_REQUEST, "送られた中身を読めません。");
    };
    let bridge = app.state::<WebBridge>();
    let id = bridge.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = oneshot::channel();
    if let Ok(mut pending) = bridge.pending.lock() {
        pending.insert(id, tx);
    }
    let event = WebRequestEvent { id, action: action.to_string(), body, ip: peer.ip().to_string() };
    if app.emit_to("main", WEB_REQUEST, event).is_err() {
        if let Ok(mut pending) = bridge.pending.lock() {
            pending.remove(&id);
        }
        return text(StatusCode::SERVICE_UNAVAILABLE, "TimeQard の画面に届きませんでした。");
    }
    match tokio::time::timeout(ANSWER_TIMEOUT, rx).await {
        Ok(Ok((status, body))) => {
            let code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            respond(code, "application/json; charset=utf-8", body)
        }
        _ => {
            if let Ok(mut pending) = bridge.pending.lock() {
                pending.remove(&id);
            }
            text(StatusCode::SERVICE_UNAVAILABLE, "TimeQard の画面が答えませんでした。入口のパソコンの TimeQard が動いているか確かめてください。")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ほかのサイトのページからの頼みは受けない() {
        let headers = |pairs: &[(&str, &str)]| {
            let mut h = HeaderMap::new();
            for (k, v) in pairs {
                h.insert(hyper::header::HeaderName::from_bytes(k.as_bytes()).unwrap(), HeaderValue::from_str(v).unwrap());
            }
            h
        };
        let host = ("host", "192.168.0.10:8443");
        // TimeQard のページから（fetch は Origin を付ける）
        assert!(same_site_request(&headers(&[("content-type", "application/json"), host, ("origin", "https://192.168.0.10:8443")])));
        assert!(same_site_request(&headers(&[("content-type", "application/json; charset=utf-8"), host])));
        // JSON でない（ほかのサイトのページが、確かめなしで送れる形）
        assert!(!same_site_request(&headers(&[("content-type", "text/plain"), host])));
        assert!(!same_site_request(&headers(&[host])));
        // ほかのページから
        assert!(!same_site_request(&headers(&[("content-type", "application/json"), host, ("origin", "https://evil.example")])));
        assert!(!same_site_request(&headers(&[("content-type", "application/json"), host, ("origin", "http://192.168.0.10:8443")])));
        assert!(!same_site_request(&headers(&[("content-type", "application/json"), ("origin", "https://192.168.0.10:8443")])));
    }

    #[test]
    fn 社内のアドレスとこのパソコンだけを受ける() {
        for ok in ["192.168.1.20", "10.1.2.3", "172.16.0.5", "172.31.255.1", "127.0.0.1", "169.254.1.1", "::1", "fe80::1", "fd12::3", "::ffff:192.168.0.9"] {
            assert!(is_local_network(ok.parse().unwrap()), "{ok}");
        }
        for ng in ["8.8.8.8", "172.32.0.1", "203.0.113.5", "2001:db8::1", "::ffff:8.8.8.8"] {
            assert!(!is_local_network(ng.parse().unwrap()), "{ng}");
        }
    }

    /// 会社専用の証明書で、サーバーの証明書を確かめられる（rustls の確かめと同じ部品 webpki で確かめる）
    #[test]
    fn 会社専用の証明書でサーバーの証明書を確かめられ_作り直しても同じ証明書で確かめられる() {
        use rustls::client::danger::ServerCertVerifier;
        use rustls::pki_types::{ServerName, UnixTime};
        let ca = create_ca("確かめ株式会社", "2026-11-12").unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(CertificateDer::from(ca.cert_der.clone())).unwrap();
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let verifier = rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider).build().unwrap();
        let ip: Ipv4Addr = "192.168.10.23".parse().unwrap();
        for _ in 0..2 {
            // 作り直しても（新しい鍵・番号でも）、配った会社専用の証明書で確かめられる
            let (cert, _key, _) = make_server_cert(&ca, &[ip]).unwrap();
            let end = CertificateDer::from(cert);
            for name in ["192.168.10.23", "127.0.0.1", "localhost"] {
                let server = ServerName::try_from(name).unwrap();
                verifier.verify_server_cert(&end, &[], &server, &[], UnixTime::now()).unwrap();
            }
            // 証明書に入れていないアドレスでは確かめられない
            let other = ServerName::try_from("192.168.10.99").unwrap();
            assert!(verifier.verify_server_cert(&end, &[], &other, &[], UnixTime::now()).is_err());
        }
    }

    /// 名前の制約：この会社専用の証明書では、インターネットのサイトの証明書を確かめられない
    #[test]
    fn 会社専用の証明書ではインターネットのサイトの証明書は通らない() {
        use rustls::client::danger::ServerCertVerifier;
        use rustls::pki_types::{ServerName, UnixTime};
        let ca = create_ca("確かめ株式会社", "2026-11-12").unwrap();
        // 鍵が盗まれて、ほかのサイトの証明書を作られたとき
        let issuer = ca_params(&ca.info).self_signed(&ca.key).unwrap();
        let key = KeyPair::generate().unwrap();
        let mut p = CertificateParams::new(vec!["www.example.com".to_string()]).unwrap();
        p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        p.use_authority_key_identifier_extension = true;
        let now = SystemTime::now();
        p.not_before = (now - Duration::from_secs(DAY)).into();
        p.not_after = (now + Duration::from_secs(30 * DAY)).into();
        let fake = p.signed_by(&key, &issuer, &ca.key).unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(CertificateDer::from(ca.cert_der.clone())).unwrap();
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let verifier = rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider).build().unwrap();
        let server = ServerName::try_from("www.example.com").unwrap();
        assert!(verifier.verify_server_cert(&CertificateDer::from(fake.der().to_vec()), &[], &server, &[], UnixTime::now()).is_err());
    }

    #[test]
    fn 会社専用の証明書はファイルに残し_2回目は同じものを読む() {
        let dir = std::env::temp_dir().join(format!("timeqard-web-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = load_or_create_ca(&dir, "確かめ株式会社", "2026-11-12").unwrap();
        let b = load_or_create_ca(&dir, "別の名前", "2027-01-01").unwrap();
        assert_eq!(a.cert_der, b.cert_der);
        assert_eq!(b.info.org, "確かめ株式会社");
        assert_eq!(fingerprint(&a.cert_der, true).len(), 32 * 3 - 1);
        // サーバーの証明書：アドレスが同じなら作り直さない。変わったら作り直す
        let ip1: Ipv4Addr = "192.168.0.10".parse().unwrap();
        let ip2: Ipv4Addr = "192.168.0.11".parse().unwrap();
        let (c1, _, r1) = load_or_renew_server_cert(&dir, &a, &[ip1]).unwrap();
        let (c2, _, r2) = load_or_renew_server_cert(&dir, &a, &[ip1]).unwrap();
        let (c3, _, r3) = load_or_renew_server_cert(&dir, &a, &[ip2]).unwrap();
        assert_eq!(c1, c2);
        assert_ne!(c1, c3);
        assert_eq!((r1, r2, r3), (true, false, true));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
