#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Manager;

const OPEN_MIRROR_SHORTCUT_EVENT: &str = "human-jukebox-open-mirror-shortcut";

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_fullscreen(true);
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
                    if let Some(w) = app.get_webview_window("mirror") {
                        let _ = w.set_focus();
                    } else {
                        let _ = tauri::WebviewWindowBuilder::new(app, "mirror", tauri::WebviewUrl::App("/#/mirror".into()))
                            .title("Mirror Screen")
                            .decorations(true)
                            .inner_size(1280.0, 800.0)
                            .build();
                    }
                }
                "toggle-fullscreen" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(is_fullscreen) = window.is_fullscreen() {
                            let _ = window.set_fullscreen(!is_fullscreen);
                        }
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
