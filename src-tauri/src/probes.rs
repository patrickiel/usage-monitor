//! Data sources the webview can't reach on its own: other processes, SQLite state files, CLIs.

use std::process::Command;
use std::time::Duration;

/// Runs a console program without flashing a window.
fn hidden(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Apps whose `User/globalStorage/state.vscdb` may be read (VS Code forks keep auth state there).
const VSCDB_APPS: &[&str] = &["Antigravity", "Cursor"];

/// One value from an app's `state.vscdb` key/value table, or None if the app or key is missing.
#[tauri::command]
pub fn read_vscdb(app: String, key: String) -> Result<Option<String>, String> {
    if !VSCDB_APPS.contains(&app.as_str()) {
        return Err(format!("unknown app {app}"));
    }
    let base = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let path = std::path::Path::new(&base).join(&app).join("User/globalStorage/state.vscdb");
    if !path.exists() {
        return Ok(None);
    }
    let db = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let value = db.query_row("SELECT value FROM ItemTable WHERE key = ?1", [&key], |row| {
        Ok(match row.get_ref(0)? {
            rusqlite::types::ValueRef::Text(t) | rusqlite::types::ValueRef::Blob(t) => {
                Some(String::from_utf8_lossy(t).into_owned())
            }
            _ => None,
        })
    });
    match value {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// The GitHub CLI's token (it lives in the OS keyring, so only `gh` can hand it out).
#[tauri::command]
pub fn gh_token() -> Result<String, String> {
    let out = hidden("gh").args(["auth", "token"]).output().map_err(|_| "gh not installed")?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || token.is_empty() {
        return Err("not signed in".into());
    }
    Ok(token)
}

/// Antigravity's installed-app OAuth client: the ID and candidate secrets found in its files.
#[derive(serde::Serialize)]
pub struct OAuthClient {
    id: String,
    secrets: Vec<String>,
}

/// Reads Antigravity's OAuth client from the installed CLI or IDE, so it needn't live in this
/// repo. Binaries hold several secrets with no separators, so all candidates are returned.
#[tauri::command]
pub async fn antigravity_client() -> Result<OAuthClient, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let local = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
        let files = ["agy/bin/agy.exe", "Programs/Antigravity/resources/app/out/main.js"];
        let id_re = regex::bytes::Regex::new(r"1071006060591-[a-z0-9]+\.apps\.googleusercontent\.com").unwrap();
        let secret_re = regex::bytes::Regex::new(r"GOCSPX-[A-Za-z0-9_-]{28}").unwrap();
        for file in files {
            let Ok(bytes) = std::fs::read(std::path::Path::new(&local).join(file)) else { continue };
            let Some(id) = id_re.find(&bytes) else { continue };
            let mut secrets: Vec<String> = secret_re
                .find_iter(&bytes)
                .map(|m| String::from_utf8_lossy(m.as_bytes()).into_owned())
                .collect();
            secrets.dedup();
            return Ok(OAuthClient { id: String::from_utf8_lossy(id.as_bytes()).into_owned(), secrets });
        }
        Err("antigravity not installed".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A running Antigravity language server: its CSRF token and the ports it listens on.
#[derive(serde::Deserialize)]
struct Server {
    token: String,
    ports: Vec<u16>,
}

/// Finds the language server via PowerShell (command line + listening ports in one call).
fn find_server() -> Result<Server, String> {
    const SCRIPT: &str = r#"
$p = Get-CimInstance Win32_Process -Filter "Name like 'language_server%'" |
  Where-Object { $_.CommandLine -match 'antigravity|\\agy\\' -and $_.CommandLine -match '--csrf_token[ =](\S+)' } |
  Select-Object -First 1
if (-not $p) { exit 3 }
$token = [regex]::Match($p.CommandLine, '--csrf_token[ =](\S+)').Groups[1].Value
$ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty LocalPort -Unique)
@{ token = $token; ports = $ports } | ConvertTo-Json -Compress
"#;
    let out = hidden("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.code() == Some(3) {
        return Err("not running".into());
    }
    serde_json::from_slice(&out.stdout).map_err(|_| "not running".into())
}

/// `GetUserStatus` from the local Antigravity language server (plan, per-model quota), as JSON.
#[tauri::command]
pub async fn antigravity_status() -> Result<String, String> {
    let server = tauri::async_runtime::spawn_blocking(find_server).await.map_err(|e| e.to_string())??;
    // Self-signed certificate on localhost.
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    let body = r#"{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}"#;
    // Several ports listen (API, extension server, LSP); the API one answers.
    for port in &server.ports {
        for scheme in ["https", "http"] {
            let url = format!("{scheme}://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus");
            let res = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Connect-Protocol-Version", "1")
                .header("X-Codeium-Csrf-Token", &server.token)
                .body(body)
                .send()
                .await;
            if let Ok(res) = res {
                if res.status().is_success() {
                    return res.text().await.map_err(|e| e.to_string());
                }
            }
        }
    }
    Err("no response".into())
}
