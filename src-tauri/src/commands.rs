use crate::{
    catalog::{self, PetCatalog, PetEntry},
    config::ConfigState,
    profiles,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn settings_snapshot(app: AppHandle, state: State<'_, ConfigState>) -> Result<Value, String> {
    let (config, catalog, selected) = load_context(&state)?;
    build_settings_snapshot(&app, &config, catalog, selected)
}

#[tauri::command]
pub fn pet_bootstrap(state: State<'_, ConfigState>) -> Result<Value, String> {
    let (config, catalog, selected) = load_context(&state)?;
    let runtime = selected
        .as_ref()
        .map(|pet| profiles::runtime_config(&config, &catalog, pet))
        .unwrap_or_else(|| config.clone());
    let asset = catalog::selected_asset(&config)?;
    Ok(json!({
        "config": runtime,
        "asset": asset.map(|(pet_id, data_url)| json!({ "petId": pet_id, "dataUrl": data_url })),
    }))
}

#[tauri::command]
pub fn save_actions(
    app: AppHandle,
    state: State<'_, ConfigState>,
    rows: Value,
    bindings: Value,
) -> Result<(), String> {
    let (_, _, selected) = load_context(&state)?;
    let pet = selected.ok_or_else(|| "当前没有可配置的人物".to_string())?;
    let profile = profiles::stored_profile(&rows, &bindings, &pet)?;
    state.write_profile(&pet.folder_name, &profile)?;
    let (config, catalog, selected) = load_context(&state)?;
    let selected = selected.ok_or_else(|| "当前没有可配置的人物".to_string())?;
    let runtime = profiles::runtime_config(&config, &catalog, &selected);
    send_pet_message(&app, json!({ "type": "config-update", "config": runtime }))
}

#[tauri::command]
pub fn save_display_scale(
    app: AppHandle,
    state: State<'_, ConfigState>,
    scale: f64,
) -> Result<(), String> {
    let _ = load_context(&state)?;
    state.update(|object| {
        object.insert("displayScale".to_string(), json!(normalize_scale(scale)));
    })?;
    send_runtime_config(&app, &state)
}

#[tauri::command]
pub fn preview_scale(app: AppHandle, scale: f64) -> Result<(), String> {
    send_pet_message(&app, json!({ "type": "scale-preview", "scale": normalize_scale(scale) }))
}

#[tauri::command]
pub fn save_pets_root(
    app: AppHandle,
    state: State<'_, ConfigState>,
    value: String,
) -> Result<Value, String> {
    let _ = load_context(&state)?;
    state.update(|object| {
        object.insert("petsRootDirectory".to_string(), json!(value.trim()));
    })?;
    send_selected_asset(&app, &state)?;
    settings_snapshot(app, state)
}

#[tauri::command]
pub fn browse_pets_root(
    app: AppHandle,
    state: State<'_, ConfigState>,
) -> Result<Option<Value>, String> {
    let Some(directory) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let path = directory.to_string_lossy().into_owned();
    let _ = load_context(&state)?;
    state.update(|object| {
        object.insert("petsRootDirectory".to_string(), json!(path));
    })?;
    send_selected_asset(&app, &state)?;
    settings_snapshot(app, state).map(Some)
}

#[tauri::command]
pub fn select_pet(
    app: AppHandle,
    state: State<'_, ConfigState>,
    pet_id: String,
) -> Result<Value, String> {
    let (_, catalog, _) = load_context(&state)?;
    let selected = catalog.pets.iter().find(|pet| pet.folder_name == pet_id).cloned();
    let Some(selected) = selected else {
        return Err("选择的人物不存在、图片尺寸不兼容或配置无效".to_string());
    };
    state.update(|object| {
        object.insert("selectedPetFolder".to_string(), json!(selected.folder_name));
        object.insert("selectedPetId".to_string(), json!(selected.id));
    })?;
    send_selected_asset(&app, &state)?;
    settings_snapshot(app, state)
}

#[tauri::command]
pub fn set_pet_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_string())?;
    if visible { window.show() } else { window.hide() }.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }.map_err(|error| error.to_string())
}

pub fn send_selected_asset(app: &AppHandle, state: &ConfigState) -> Result<(), String> {
    let (config, catalog, selected) = load_context(state)?;
    match (selected, catalog::selected_asset(&config)?) {
        (Some(pet), Some((pet_id, data_url))) => {
            let runtime = profiles::runtime_config(&config, &catalog, &pet);
            send_pet_message(app, json!({
                "type": "pet-asset",
                "petId": pet_id,
                "dataUrl": data_url,
                "config": runtime,
            }))
        }
        _ => send_pet_message(app, json!({ "type": "pet-asset-reset" })),
    }
}

pub fn send_pet_message(app: &AppHandle, message: Value) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_string())?;
    let payload = serde_json::to_string(&message).map_err(|error| error.to_string())?;
    window
        .eval(&format!("window.__petHandleMessage?.({payload});"))
        .map_err(|error| error.to_string())
}

fn load_context(state: &ConfigState) -> Result<(Value, PetCatalog, Option<PetEntry>), String> {
    let original = state.snapshot()?;
    let root = original.get("petsRootDirectory").and_then(Value::as_str);
    let catalog = catalog::scan(root);
    let (_, effective) = profiles::load_configuration(state, &catalog, &original)?;
    let selected_id = effective
        .get("selectedPetFolder")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let legacy_selected_id = effective
        .get("selectedPetId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let selected = catalog
        .pets
        .iter()
        .find(|pet| pet.folder_name == selected_id)
        .or_else(|| catalog.pets.iter().find(|pet| pet.id == legacy_selected_id))
        .or_else(|| catalog.pets.first())
        .cloned();
    Ok((effective, catalog, selected))
}

fn send_runtime_config(app: &AppHandle, state: &ConfigState) -> Result<(), String> {
    let (config, catalog, selected) = load_context(state)?;
    let runtime = selected
        .as_ref()
        .map(|pet| profiles::runtime_config(&config, &catalog, pet))
        .unwrap_or(config);
    send_pet_message(app, json!({ "type": "config-update", "config": runtime }))
}

fn build_settings_snapshot(
    app: &AppHandle,
    config: &Value,
    catalog: PetCatalog,
    selected: Option<PetEntry>,
) -> Result<Value, String> {
    let profile = selected
        .as_ref()
        .map(|pet| profiles::resolve_profile(config, &catalog, pet));
    let rows = profile.as_ref().map(profiles::settings_rows).unwrap_or_default();
    let bindings = profile
        .as_ref()
        .and_then(|profile| profile.get("bindings"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let pet_format = selected.as_ref().map(|pet| {
        json!({
            "version": pet.sprite_version_number,
            "rowCount": pet.row_count,
            "sheetWidth": pet.sheet_width,
            "sheetHeight": pet.sheet_height,
            "columnWidth": pet.column_width,
            "rowHeight": pet.row_height,
            "label": format!("v{} · {} 行 · {}×{}", pet.sprite_version_number, pet.row_count, pet.sheet_width, pet.sheet_height),
        })
    });
    let pet_asset = catalog::selected_asset(config)?
        .map(|(pet_id, data_url)| json!({ "petId": pet_id, "dataUrl": data_url }));
    let pet_visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(true);
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    Ok(json!({
        "type": "init",
        "hostLabel": "桌面版",
        "rows": rows,
        "bindings": bindings,
        "autoLaunch": pet_visible,
        "autostart": autostart,
        "displayScale": config.get("displayScale").and_then(Value::as_f64).unwrap_or(1.0),
        "petFormat": pet_format,
        "petAsset": pet_asset,
        "petCatalog": {
            "rootDirectory": catalog.root_directory,
            "automatic": catalog.automatic,
            "exists": catalog.exists,
            "selectedPetId": selected.as_ref().map(|pet| pet.folder_name.as_str()).unwrap_or_default(),
            "pets": catalog.pets,
            "warnings": catalog.warnings,
        },
    }))
}

fn normalize_scale(scale: f64) -> f64 {
    (scale.clamp(0.5, 1.5) * 100.0).round() / 100.0
}
