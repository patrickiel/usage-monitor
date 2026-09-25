#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod probes;
mod update;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{include_image, AppHandle, Emitter, Manager, WindowEvent};

/// Dark ink for a light taskbar, white for a dark one.
const TRAY_LIGHT: Image<'static> = include_image!("icons/tray/tray-light.png");
const TRAY_DARK: Image<'static> = include_image!("icons/tray/tray-dark.png");

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The taskbar follows the Windows *system* theme (not the apps theme).
#[cfg(windows)]
fn taskbar_is_light() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    let value = wide("SystemUsesLightTheme");
    let (mut data, mut size) = (0u32, 4u32);
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut data as *mut u32).cast(),
            &mut size,
        )
    };
    status == 0 && data == 1
}

#[cfg(not(windows))]
fn taskbar_is_light() -> bool {
    false
}

fn tray_icon(light: bool) -> Image<'static> {
    if light { TRAY_LIGHT } else { TRAY_DARK }
}

/// The taskbar is itself topmost and jumps above the overlay whenever it's clicked (the overlay
/// is click-through, so clicking it clicks the taskbar). Push the overlay back on top, without
/// activating it, the moment the foreground changes.
#[cfg(windows)]
mod topmost {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, EVENT_SYSTEM_FOREGROUND, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        WINEVENT_OUTOFCONTEXT,
    };

    static OVERLAY: AtomicIsize = AtomicIsize::new(0);

    pub fn raise() {
        let hwnd = OVERLAY.load(Ordering::Relaxed);
        if hwnd != 0 {
            unsafe { SetWindowPos(hwnd as _, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
        }
    }

    unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, _: HWND, _: i32, _: i32, _: u32, _: u32) {
        raise();
    }

    /// Call on the main thread: out-of-context hooks are delivered through its message loop.
    pub fn install(hwnd: isize) {
        OVERLAY.store(hwnd, Ordering::Relaxed);
        unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                std::ptr::null_mut(),
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
        }
    }
}

/// Background loop (every 2 s): a backstop for staying on top (for z-order changes that aren't
/// foreground switches), and swapping the tray icon when the taskbar turns light or dark.
fn watch(tray: TrayIcon, mut light: bool) {
    std::thread::spawn(move || loop {
        #[cfg(windows)]
        topmost::raise();
        let now = taskbar_is_light();
        if now != light {
            light = now;
            let _ = tray.set_icon(Some(tray_icon(light)));
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_settings(app)))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Pending::default())
        .invoke_handler(tauri::generate_handler![probes::read_vscdb, probes::gh_token, probes::antigravity_client, probes::antigravity_status, update::check_update, update::install_update])
        .setup(|app| {
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "configure", "Configure", true, None::<&str>)?,
                    &MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?,
                    &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;

            let light = taskbar_is_light();
            let tray = TrayIconBuilder::new()
                .icon(tray_icon(light))
                .tooltip("Usage Monitor")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "configure" => show_settings(app),
                    "refresh" => {
                        let _ = app.emit("refresh", ());
                    }
                    "update" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = update::install_update(app).await {
                                eprintln!("update failed: {e}");
                            }
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_settings(tray.app_handle());
                    }
                })
                .build(app)?;

            let overlay = app.get_webview_window("overlay").unwrap();
            overlay.set_ignore_cursor_events(true)?;
            #[cfg(windows)]
            topmost::install(overlay.hwnd()?.0 as isize);
            watch(tray, light);
            app.manage(update::TrayMenu(menu));
            update::watch(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Settings only hides; the app lives in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running usage monitor");
}
