#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Manager;

#[derive(serde::Serialize)]
struct RemoteFetchResult {
    ok: bool,
    status: u16,
    body: String,
}

#[tauri::command]
async fn fetch_lyrics_remote(url: String) -> Result<RemoteFetchResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("Remote fetch failed: {err}"))?;

    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response body: {err}"))?;

    Ok(RemoteFetchResult { ok, status, body })
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Missing URL".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut edge_candidates = vec![
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe".to_string(),
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe".to_string(),
        ];

        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            edge_candidates.push(format!(
                "{}\\Microsoft\\Edge\\Application\\msedge.exe",
                local_app_data
            ));
        }

        for edge_path in edge_candidates {
            if !std::path::Path::new(&edge_path).exists() {
                continue;
            }

            let launch_status = std::process::Command::new(&edge_path)
                .arg(trimmed)
                .status();

            if let Ok(status) = launch_status {
                if status.success() {
                    return Ok(());
                }
            }
        }

        let edge_protocol_url = if trimmed.starts_with("microsoft-edge:") {
            trimmed.to_string()
        } else {
            format!("microsoft-edge:{}", trimmed)
        };

        let status = std::process::Command::new("explorer.exe")
            .arg(edge_protocol_url)
            .status()
            .map_err(|err| format!("Failed to open browser: {err}"))?;

        if status.success() {
            return Ok(());
        }

        return Err(format!("Browser launch returned status: {status}"));
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(trimmed)
            .status()
            .map_err(|err| format!("Failed to open browser: {err}"))?;

        if status.success() {
            return Ok(());
        }

        return Err(format!("Browser launch returned status: {status}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = std::process::Command::new("xdg-open")
            .arg(trimmed)
            .status()
            .map_err(|err| format!("Failed to open browser: {err}"))?;

        if status.success() {
            return Ok(());
        }

        return Err(format!("Browser launch returned status: {status}"));
    }
}

fn toggle_fullscreen_for_window(window: &tauri::WebviewWindow) {
    if let Ok(is_fullscreen) = window.is_fullscreen() {
        let next_fullscreen = !is_fullscreen;
        let should_toggle_decorations = window.label() != "main";

        if should_toggle_decorations {
            let _ = window.set_decorations(!next_fullscreen);
        }

        let _ = window.set_fullscreen(next_fullscreen);
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_lyrics_remote, open_external_url])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }

            let open_mirror_item = MenuItemBuilder::with_id("open-mirror", "Open Mirror")
                .accelerator("CmdOrCtrl+M")
                .build(app)?;

            let toggle_fullscreen_item = MenuItemBuilder::with_id("toggle-fullscreen", "Toggle Fullscreen")
                .accelerator("F11")
                .build(app)?;

            let refresh_item = MenuItemBuilder::with_id("refresh", "Refresh")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;

            let update_item = MenuItemBuilder::with_id("update", "Update")
                .accelerator("CmdOrCtrl+U")
                .build(app)?;

            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "App")
                .item(&open_mirror_item)
                .item(&toggle_fullscreen_item)
                .item(&refresh_item)
                .item(&update_item)
                .item(&quit_item)
                .build()?;

            let menu = MenuBuilder::new(app).item(&app_submenu).build()?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "open-mirror" => {
                    if let Some(existing) = app.get_webview_window("mirror") {
                        let _ = existing.set_focus();
                    } else {
                        let _ = tauri::WebviewWindowBuilder::new(
                            app,
                            "mirror",
                            tauri::WebviewUrl::App(std::path::PathBuf::from("/")),
                        )
                        .title("Mirror Screen")
                        .decorations(true)
                        .inner_size(1280.0, 800.0)
                        .resizable(true)
                        .initialization_script(
                            "if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') { \
                                window.location.replace('#/mirror?safeMargins=1&density=medium'); \
                            }"
                        )
                        .build();
                    }
                }
                "open-lyric-machine" => {
                    let _ = open_external_url("https://www.the-human-jukebox.org/lyric-machine".to_string());
                }
                "toggle-fullscreen" => {
                    if let Some(window) = app
                        .webview_windows()
                        .values()
                        .find(|window| window.is_focused().unwrap_or(false))
                    {
                        toggle_fullscreen_for_window(window);
                    } else if let Some(window) = app.get_webview_window("main") {
                        toggle_fullscreen_for_window(&window);
                    }
                }
                "refresh" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("window.location.reload()") ;
                    }
                }
"update" => {
                    // app.restart() requires updater plugin - call safely to prevent crash
                    let _ = app.restart();
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
