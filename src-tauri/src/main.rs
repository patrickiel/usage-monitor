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
/// activating it, on every foreground change and every mouse click (clicking the taskbar while
/// it's already the foreground doesn't change the foreground).
#[cfg(windows)]
mod topmost {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetWindowRect, IsWindowVisible, SetWindowPos, MSLLHOOKSTRUCT, SetWindowsHookExW, EVENT_SYSTEM_FOREGROUND, HWND_TOPMOST, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, WH_MOUSE_LL, WINEVENT_OUTOFCONTEXT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
        WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    static OVERLAY: AtomicIsize = AtomicIsize::new(0);
    static BURST: OnceLock<Sender<()>> = OnceLock::new();
    static ON_CLICK: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    pub fn raise() {
        let hwnd = OVERLAY.load(Ordering::Relaxed);
        if hwnd != 0 {
            unsafe { SetWindowPos(hwnd as _, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
        }
    }

    fn burst() {
        if let Some(tx) = BURST.get() {
            let _ = tx.send(());
        }
    }

    unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, _: HWND, _: i32, _: i32, _: u32, _: u32) {
        burst();
    }

    /// Whether a screen point (physical pixels, like the hook's) is on the visible overlay.
    fn on_overlay(pt: POINT) -> bool {
        let hwnd = OVERLAY.load(Ordering::Relaxed) as HWND;
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        !hwnd.is_null()
            && unsafe { IsWindowVisible(hwnd) != 0 && GetWindowRect(hwnd, &mut r) != 0 }
            && (r.left..r.right).contains(&pt.x)
            && (r.top..r.bottom).contains(&pt.y)
    }

    /// Must return fast (it sits in every mouse event's path), so it only signals the raiser.
    /// The click itself still falls through the overlay to what's below.
    unsafe extern "system" fn on_mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let msg = wparam as u32;
            if matches!(
                msg,
                WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP
            ) {
                burst();
            }
            if msg == WM_LBUTTONUP && on_overlay((*(lparam as *const MSLLHOOKSTRUCT)).pt) {
                if let Some(f) = ON_CLICK.get() {
                    f();
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    /// The taskbar raises itself at some point while handling the event, and a single delayed raise
    /// leaves a visible flash until it runs. So keep re-raising every couple of milliseconds for a
    /// short window after each event: the overlay is back on top before the next frame is composed.
    fn spawn_raiser() -> Sender<()> {
        const WINDOW: Duration = Duration::from_millis(300);
        const EVERY: Duration = Duration::from_millis(2);
        let (tx, rx) = channel::<()>();
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                let mut until = Instant::now() + WINDOW;
                while Instant::now() < until {
                    raise();
                    std::thread::sleep(EVERY);
                    if rx.try_iter().count() > 0 {
                        until = Instant::now() + WINDOW;
                    }
                }
            }
        });
        tx
    }

    /// Call on the main thread: out-of-context and low-level hooks are delivered through its message loop.
    /// `on_click` runs (on that thread) when the overlay is left-clicked.
    pub fn install(hwnd: isize, on_click: impl Fn() + Send + Sync + 'static) {
        OVERLAY.store(hwnd, Ordering::Relaxed);
        let _ = BURST.set(spawn_raiser());
        let _ = ON_CLICK.set(Box::new(on_click));
        unsafe {
            SetWindowsHookExW(WH_MOUSE_LL, Some(on_mouse), std::ptr::null_mut(), 0);
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
            {
                let app = app.handle().clone();
                topmost::install(overlay.hwnd()?.0 as isize, move || {
                    let _ = app.emit("refresh", ());
                });
            }
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
