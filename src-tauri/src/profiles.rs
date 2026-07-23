use crate::{catalog::{PetCatalog, PetEntry}, config::ConfigState};
use serde_json::{json, Map, Value};

const ROW_NAMES: [&str; 11] = [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review",
    "look-directions-a",
    "look-directions-b",
];

const FRAME_COUNTS: [u64; 11] = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];

pub fn load_configuration(
    state: &ConfigState,
    catalog: &PetCatalog,
    original: &Value,
) -> Result<(Value, Value), String> {
    let needs_migration = original.get("configVersion").and_then(Value::as_u64) != Some(3);
    if needs_migration {
        state.backup_before_profile_migration()?;
    }

    for pet in &catalog.pets {
        if state.read_profile(&pet.folder_name)?.is_none() {
            let profile = resolve_profile(original, catalog, pet);
            state.write_profile(&pet.folder_name, &profile_document(pet, &profile))?;
        }
    }

    let mut global = if needs_migration {
        let mut object = original.as_object().cloned().unwrap_or_default();
        object.insert("configVersion".to_string(), json!(3));
        for key in ["rows", "bindings", "petProfiles", "spriteVersionNumber", "sheetWidth", "sheetHeight", "colWidth", "rowHeight"] {
            object.remove(key);
        }
        state.replace(Value::Object(object))?
    } else {
        original.clone()
    };

    let selected_folder = global.get("selectedPetFolder").and_then(Value::as_str).unwrap_or_default();
    let selected_id = global.get("selectedPetId").and_then(Value::as_str).unwrap_or_default();
    let selected = catalog
        .pets
        .iter()
        .find(|pet| pet.folder_name == selected_folder)
        .or_else(|| catalog.pets.iter().find(|pet| pet.id == selected_id))
        .or_else(|| catalog.pets.first());
    if let Some(selected) = selected.filter(|pet| selected_folder != pet.folder_name) {
        let mut object = global.as_object().cloned().unwrap_or_default();
        object.insert("selectedPetFolder".to_string(), json!(selected.folder_name));
        object.insert("selectedPetId".to_string(), json!(selected.id));
        global = state.replace(Value::Object(object))?;
    }

    let mut external_profiles = Map::new();
    for pet in &catalog.pets {
        let stored = state.read_profile(&pet.folder_name)?;
        let profile = stored
            .as_ref()
            .map(|value| normalize_profile(value.get("rows"), value.get("bindings"), pet))
            .unwrap_or_else(|| default_profile(pet));
        let stored_rows = stored
            .as_ref()
            .and_then(|value| value.get("rows"))
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or_default();
        let stored_version = stored
            .as_ref()
            .and_then(|value| value.get("spriteVersionNumber"))
            .and_then(Value::as_u64);
        if stored.is_none() || stored_rows != pet.row_count as usize || stored_version != Some(pet.sprite_version_number.into()) {
            state.write_profile(&pet.folder_name, &profile_document(pet, &profile))?;
        }
        external_profiles.insert(pet.folder_name.clone(), profile);
    }
    let mut effective = global.as_object().cloned().unwrap_or_default();
    effective.insert("petProfiles".to_string(), Value::Object(external_profiles));
    Ok((global, Value::Object(effective)))
}

pub fn resolve_profile(config: &Value, catalog: &PetCatalog, pet: &PetEntry) -> Value {
    if let Some(profile) = config
        .get("petProfiles")
        .and_then(Value::as_object)
        .and_then(|profiles| profiles.get(&pet.folder_name).or_else(|| profiles.get(&pet.id)))
    {
        return normalize_profile(profile.get("rows"), profile.get("bindings"), pet);
    }

    let legacy_rows = config.get("rows").and_then(Value::as_array);
    if let Some(rows) = legacy_rows {
        if legacy_owner(config, catalog, rows.len()).is_some_and(|owner| owner.id == pet.id) {
            let legacy_rows_value = Value::Array(rows.clone());
            return normalize_profile(Some(&legacy_rows_value), config.get("bindings"), pet);
        }
    }
    default_profile(pet)
}

pub fn normalized_profile(rows: &Value, bindings: &Value, pet: &PetEntry) -> Result<Value, String> {
    let row_values = rows
        .as_array()
        .ok_or_else(|| "动作行格式无效".to_string())?;
    if row_values.len() != pet.row_count as usize {
        return Err(format!("{} 人物必须包含 {} 行动作", pet.display_name, pet.row_count));
    }
    Ok(normalize_profile(Some(rows), Some(bindings), pet))
}

pub fn stored_profile(rows: &Value, bindings: &Value, pet: &PetEntry) -> Result<Value, String> {
    normalized_profile(rows, bindings, pet).map(|profile| profile_document(pet, &profile))
}

pub fn runtime_config(config: &Value, catalog: &PetCatalog, pet: &PetEntry) -> Value {
    let mut runtime = config.as_object().cloned().unwrap_or_default();
    let profile = resolve_profile(config, catalog, pet);
    runtime.insert("selectedPetId".to_string(), json!(pet.id));
    runtime.insert("selectedPetFolder".to_string(), json!(pet.folder_name));
    runtime.insert("spriteVersionNumber".to_string(), json!(pet.sprite_version_number));
    runtime.insert("sheetWidth".to_string(), json!(pet.sheet_width));
    runtime.insert("sheetHeight".to_string(), json!(pet.sheet_height));
    runtime.insert("colWidth".to_string(), json!(pet.column_width));
    runtime.insert("rowHeight".to_string(), json!(pet.row_height));
    runtime.insert("rows".to_string(), profile.get("rows").cloned().unwrap_or_else(|| json!([])));
    runtime.insert(
        "bindings".to_string(),
        profile.get("bindings").cloned().unwrap_or_else(|| json!({})),
    );
    Value::Object(runtime)
}

pub fn settings_rows(profile: &Value) -> Vec<Value> {
    profile
        .get("rows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, row)| {
            let row_number = (index + 1) as u64;
            let default_name = row_name(row_number as usize);
            let user_name = row.get("name").and_then(Value::as_str).unwrap_or_default();
            json!({
                "name": if user_name.is_empty() { default_name } else { user_name },
                "row": row_number,
                "frames": row.get("frames").and_then(Value::as_u64).unwrap_or(FRAME_COUNTS[index]),
                "speed": row.get("speed").and_then(Value::as_f64).unwrap_or(1.0),
                "_convName": default_name,
                "_defaultName": default_name,
                "_userName": user_name,
            })
        })
        .collect()
}

fn default_profile(pet: &PetEntry) -> Value {
    let rows = (0..pet.row_count as usize)
        .map(|index| json!({ "row": index + 1, "frames": FRAME_COUNTS[index], "speed": 1.0 }))
        .collect::<Vec<_>>();
    json!({
        "spriteVersionNumber": pet.sprite_version_number,
        "rows": rows,
        "bindings": {
            "drag-left": "row-3",
            "drag-right": "row-2",
            "click": "row-4",
            "hover": "row-9",
            "appear": "row-4",
            "idle-loop": "row-1",
            "cc-working": "row-8",
            "cc-complete": "row-4"
        }
    })
}

fn normalize_profile(rows: Option<&Value>, bindings: Option<&Value>, pet: &PetEntry) -> Value {
    let defaults = default_profile(pet);
    let default_rows = defaults.get("rows").and_then(Value::as_array).unwrap();
    let source_rows = rows.and_then(Value::as_array);
    let normalized_rows = default_rows
        .iter()
        .enumerate()
        .map(|(index, default_row)| {
            let row = source_rows.and_then(|rows| rows.get(index)).unwrap_or(default_row);
            let frames = row
                .get("frames")
                .and_then(Value::as_u64)
                .unwrap_or(FRAME_COUNTS[index])
                .clamp(1, 8);
            let speed = row
                .get("speed")
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
                .clamp(0.5, 2.0);
            let mut normalized = Map::new();
            normalized.insert("row".to_string(), json!(index + 1));
            normalized.insert("frames".to_string(), json!(frames));
            normalized.insert("speed".to_string(), json!((speed * 10.0).round() / 10.0));
            // The settings UI edits `_userName`. `name` is the previously
            // resolved display value, so it must not override a newer edit.
            let edited_name = row.get("_userName").and_then(Value::as_str).map(str::trim);
            let name = edited_name.or_else(|| row.get("name").and_then(Value::as_str).map(str::trim));
            if let Some(name) = name.filter(|name| !name.is_empty()) {
                normalized.insert("name".to_string(), json!(name));
            }
            Value::Object(normalized)
        })
        .collect::<Vec<_>>();
    let normalized_bindings = normalize_bindings(bindings, &normalized_rows, pet.row_count);
    json!({
        "spriteVersionNumber": pet.sprite_version_number,
        "rows": normalized_rows,
        "bindings": normalized_bindings,
    })
}

fn normalize_bindings(bindings: Option<&Value>, rows: &[Value], row_count: u8) -> Value {
    let Some(bindings) = bindings.and_then(Value::as_object) else {
        return default_profile_bindings();
    };
    let mut normalized = Map::new();
    for (event_name, target) in bindings {
        let Some(target) = target.as_str() else { continue };
        if let Some(row_number) = target.strip_prefix("row-").and_then(|value| value.parse::<u8>().ok()) {
            if (1..=row_count).contains(&row_number) {
                normalized.insert(event_name.clone(), json!(format!("row-{row_number}")));
            }
            continue;
        }
        if let Some((index, _)) = rows.iter().enumerate().find(|(index, row)| {
            row.get("name").and_then(Value::as_str) == Some(target) || row_name(index + 1) == target
        }) {
            normalized.insert(event_name.clone(), json!(format!("row-{}", index + 1)));
        }
    }
    Value::Object(normalized)
}

fn default_profile_bindings() -> Value {
    json!({
        "drag-left": "row-3",
        "drag-right": "row-2",
        "click": "row-4",
        "hover": "row-9",
        "appear": "row-4",
        "idle-loop": "row-1",
        "cc-working": "row-8",
        "cc-complete": "row-4"
    })
}

fn legacy_owner<'a>(config: &Value, catalog: &'a PetCatalog, row_count: usize) -> Option<&'a PetEntry> {
    if row_count != 9 && row_count != 11 {
        return None;
    }
    let selected_folder = config.get("selectedPetFolder").and_then(Value::as_str).unwrap_or_default();
    if let Some(selected) = catalog
        .pets
        .iter()
        .find(|pet| pet.folder_name == selected_folder && pet.row_count as usize == row_count)
    {
        return Some(selected);
    }
    let selected_id = config.get("selectedPetId").and_then(Value::as_str).unwrap_or_default();
    if let Some(selected) = catalog
        .pets
        .iter()
        .find(|pet| pet.id == selected_id && pet.row_count as usize == row_count)
    {
        return Some(selected);
    }
    catalog
        .pets
        .iter()
        .find(|pet| pet.id == "xiuxiu" && pet.row_count as usize == row_count)
        .or_else(|| catalog.pets.iter().find(|pet| pet.row_count as usize == row_count))
}

fn row_name(row: usize) -> &'static str {
    ROW_NAMES.get(row.saturating_sub(1)).copied().unwrap_or("row")
}

fn profile_document(pet: &PetEntry, profile: &Value) -> Value {
    json!({
        "schemaVersion": 1,
        "petId": pet.id,
        "folderName": pet.folder_name,
        "spriteVersionNumber": pet.sprite_version_number,
        "rows": profile.get("rows").cloned().unwrap_or_else(|| json!([])),
        "bindings": profile.get("bindings").cloned().unwrap_or_else(|| json!({})),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

    fn pet(id: &str, version: u8) -> PetEntry {
        PetEntry {
            id: id.to_string(),
            folder_name: id.to_string(),
            display_name: id.to_string(),
            sprite_version_number: version,
            sheet_width: 1536,
            sheet_height: if version == 2 { 2288 } else { 1872 },
            column_width: 192,
            row_height: 208,
            row_count: if version == 2 { 11 } else { 9 },
            sprite_path: PathBuf::new(),
        }
    }

    #[test]
    fn migrates_legacy_rows_to_physical_profile_files() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir().join(format!("cc-pet-rust-profile-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        let config_path = directory.join("config.json");
        let rows = (0..11)
            .map(|index| json!({ "row": index + 1, "frames": if index == 0 { 7 } else { 8 }, "speed": 1, "name": format!("custom-{}", index + 1) }))
            .collect::<Vec<_>>();
        let original = json!({
            "selectedPetId": "doraemon",
            "rows": rows,
            "bindings": { "click": "custom-5" }
        });
        fs::write(&config_path, serde_json::to_string_pretty(&original).unwrap()).unwrap();
        let state = ConfigState::for_test(original.clone(), config_path.clone());
        let catalog = PetCatalog {
            root_directory: String::new(),
            automatic: true,
            exists: true,
            pets: vec![pet("doraemon", 1), pet("xiuxiu", 2)],
            warnings: Vec::new(),
        };

        let (global, _) = load_configuration(&state, &catalog, &original).unwrap();

        assert_eq!(global.get("configVersion").and_then(Value::as_u64), Some(3));
        assert!(global.get("rows").is_none());
        assert_eq!(state.read_profile("doraemon").unwrap().unwrap()["rows"].as_array().unwrap().len(), 9);
        let xiuxiu = state.read_profile("xiuxiu").unwrap().unwrap();
        assert_eq!(xiuxiu["rows"][0]["frames"], 7);
        assert_eq!(xiuxiu["bindings"]["click"], "row-5");
        assert!(directory.join("config.v2.backup.json").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn edited_gui_name_overrides_the_stale_resolved_name() {
        let current_pet = pet("xiuxiu", 2);
        let rows = (0..11)
            .map(|index| json!({
                "row": index + 1,
                "frames": FRAME_COUNTS[index],
                "speed": 1.0,
                "name": row_name(index + 1),
                "_userName": if index == 0 { "my-idle" } else { "" },
            }))
            .collect::<Vec<_>>();
        let profile = normalized_profile(&Value::Array(rows), &json!({ "idle-loop": "row-1" }), &current_pet).unwrap();

        assert_eq!(profile["rows"][0]["name"], "my-idle");
        assert!(profile["rows"][1].get("name").is_none());
    }
}
