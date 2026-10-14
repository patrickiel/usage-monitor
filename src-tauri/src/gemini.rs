//! The Gemini app's usage limits. gemini.google.com has no API for them, so a hidden webview
//! loads its usage page and hands back the page text. The Google session comes from a sign-in
//! window; all webviews share the app's WebView2 profile, so its cookies carry over.

use std::time::Duration;
use tauri::async_runtime::{channel, Mutex};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// English, so the frontend can parse the text.
const USAGE_URL: &str = "https://gemini.google.com/usage?hl=en";
const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fusage%3Fhl%3Den";
/// The page script "navigates" here to report back; the navigation is cancelled.
const RESULT_HOST: &str = "usage-monitor.invalid";

/// Runs at every document start in the usage webview. Waits for the limits to render, then reports
/// `ok` with the text, `signin` when Google wants a login, or `timeout`.
const SCRAPE: &str = r#"
(() => {
  const report = (kind, text) => {
    location.href = 'https://usage-monitor.invalid/' + kind + '?text=' + encodeURIComponent((text || '').slice(0, 4000));
  };
  if (location.hostname !== 'gemini.google.com') return report('signin');
  const started = Date.now();
  const poll = () => {
    const text = document.body ? document.body.innerText : '';
    if (/\d%\s*used/i.test(text) && /weekly/i.test(text)) return report('ok', text);
    if (!location.pathname.startsWith('/usage')) return report('signin');
    if (Date.now() - started > 20000) return report(/\bsign in\b/i.test(text) ? 'signin' : 'timeout', text);
    setTimeout(poll, 500);
  };
  poll();
})();
"#;

/// One scrape at a time (they share a window label).
static SCRAPING: Mutex<()> = Mutex::const_new(());

#[derive(serde::Serialize)]
pub struct Page {
    kind: String,
    text: String,
}

/// Loads the usage page in a hidden webview and returns what the page script reported.
#[tauri::command]
pub async fn gemini_usage(app: AppHandle) -> Result<Page, String> {
    let _guard = SCRAPING.lock().await;
    if let Some(w) = app.get_webview_window("gemini-usage") {
        let _ = w.destroy();
    }
    let (tx, mut rx) = channel::<Page>(1);
    // Backstop in case the page never runs the script (offline, crashed renderer).
    let backstop = tx.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        let _ = backstop.try_send(Page { kind: "timeout".into(), text: String::new() });
    });
    let window = WebviewWindowBuilder::new(&app, "gemini-usage", WebviewUrl::External(Url::parse(USAGE_URL).unwrap()))
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .initialization_script(SCRAPE)
        .on_navigation(move |url| {
            if url.host_str() != Some(RESULT_HOST) {
                return true;
            }
            let text = url.query_pairs().find(|(k, _)| k == "text").map(|(_, v)| v.into_owned()).unwrap_or_default();
            let _ = tx.try_send(Page { kind: url.path().trim_start_matches('/').to_string(), text });
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    let page = rx.recv().await;
    let _ = window.destroy();
    page.ok_or_else(|| "no response".into())
}

/// Opens a Google sign-in window that closes itself once Google sends it on to Gemini.
#[tauri::command]
pub async fn gemini_sign_in(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("gemini-login") {
        let _ = w.set_focus();
        return Ok(());
    }
    let handle = app.clone();
    WebviewWindowBuilder::new(&app, "gemini-login", WebviewUrl::External(Url::parse(LOGIN_URL).unwrap()))
        .title("Sign in to Gemini")
        .inner_size(480.0, 720.0)
        .center()
        .on_navigation(move |url| {
            if url.host_str() == Some("gemini.google.com") {
                // Not from inside the navigation handler: destroying the webview there deadlocks.
                let app = handle.clone();
                std::thread::spawn(move || {
                    if let Some(w) = app.get_webview_window("gemini-login") {
                        let _ = w.destroy();
                    }
                    let _ = app.emit("refresh", ());
                });
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
