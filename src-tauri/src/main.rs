#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

/// Background loop (every 2 s):
/// - the taskbar is itself topmost and wins the z-order whenever it is clicked,
///   so push the overlay back above it (without activating it);
/// - swap the tray icon when the taskbar switches between light and dark.
fn watch(tray: TrayIcon, overlay_hwnd: isize, mut light: bool) {
    std::thread::spawn(move || loop {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            };
            SetWindowPos(overlay_hwnd as _, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
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
            let hwnd = overlay.hwnd()?.0 as isize;
            #[cfg(not(windows))]
            let hwnd = 0;
            watch(tray, hwnd, light);

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
