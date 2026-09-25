use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// The last release found newer than this one, so installing needs no second request.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// The tray menu, to add an "Install update" entry once one is found.
pub struct TrayMenu(pub Menu<Wry>);

async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let version = update.as_ref().map(|u| u.version.clone());
    *app.state::<Pending>().0.lock().unwrap() = update;
    if let Some(v) = &version {
        announce(app, v);
    }
    Ok(version)
}

fn announce(app: &AppHandle, version: &str) {
    let _ = app.emit("update-available", version);
    let menu = &app.state::<TrayMenu>().0;
    let text = format!("Install update v{version}");
    match menu.get("update") {
        Some(item) => {
            if let Some(item) = item.as_menuitem() {
                let _ = item.set_text(text);
            }
        }
        None => {
            if let Ok(item) = MenuItem::with_id(app, "update", text, true, None::<&str>) {
                let _ = menu.insert(&item, 0);
            }
        }
    }
}

/// Newer version, if any.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    check(&app).await
}

/// Downloads and runs the installer. On Windows the installer closes the app and starts it again.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app.state::<Pending>().0.lock().unwrap().clone().ok_or("No update available")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// Checks at startup, then every few hours.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Err(e) = tauri::async_runtime::block_on(check(&app)) {
            eprintln!("update check failed: {e}");
        }
        std::thread::sleep(INTERVAL);
    });
}
