// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod commands;
mod config;
mod profiles;
mod status;

use config::ConfigState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, PhysicalPosition, WindowEvent,
};

const WINDOW_EDGE_MARGIN: i32 = 16;

fn main() {
    let ipc_port = std::env::var("CC_PET_IPC_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok());
    let launched_from_autostart = std::env::args().any(|argument| argument == "--autostart");
    let config_state = ConfigState::load().expect("failed to load CC Pet configuration");

    let mut builder = tauri::Builder::default()
        .manage(config_state)
        .plugin(tauri_plugin_autostart::Builder::new().arg("--autostart").build())
        .invoke_handler(tauri::generate_handler![
            commands::settings_snapshot,
            commands::pet_bootstrap,
            commands::save_actions,
            commands::save_display_scale,
            commands::preview_scale,
            commands::save_pets_root,
            commands::browse_pets_root,
            commands::select_pet,
            commands::set_pet_visible,
            commands::set_autostart,
        ]);

    if let Some(port) = ipc_port {
        builder = builder.append_invoke_initialization_script(format!(
            "window.__CC_PET_IPC_PORT = {port};"
        ));
    }

    builder
        .setup(move |app| {
            position_pet_window(app)?;
            configure_settings_window(app, ipc_port.is_none() && !launched_from_autostart)?;
            build_tray(app)?;
            if ipc_port.is_none() {
                status::start(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CC Pet");
}

fn position_pet_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else { return Ok(()) };
    let Some(monitor) = window.primary_monitor()? else { return Ok(()) };
    let work_area = monitor.work_area();
    let window_size = window.outer_size()?;
    let x = work_area.position.x + work_area.size.width as i32
        - window_size.width as i32
        - WINDOW_EDGE_MARGIN;
    let y = work_area.position.y + work_area.size.height as i32
        - window_size.height as i32
        - WINDOW_EDGE_MARGIN;
    window.set_position(PhysicalPosition::new(x, y))
}

fn configure_settings_window(app: &tauri::App, show_on_launch: bool) -> tauri::Result<()> {
    let Some(settings) = app.get_webview_window("settings") else { return Ok(()) };
    settings.on_window_event({
        let settings = settings.clone();
        move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = settings.hide();
            }
        }
    });
    if show_on_launch {
        settings.show()?;
        settings.set_focus()?;
    }
    Ok(())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
    let pet_item = MenuItem::with_id(app, "toggle-pet", "显示/隐藏桌宠", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 CC Pet", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &pet_item, &quit_item])?;
    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::new()
        .tooltip("CC Pet")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "toggle-pet" => {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(true);
                    let _ = if visible { window.hide() } else { window.show() };
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = icon { tray = tray.icon(icon) }
    tray.build(app)?;
    Ok(())
}
