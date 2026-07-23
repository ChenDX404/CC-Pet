use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const SHEET_WIDTH: u32 = 1536;
const COLUMN_WIDTH: u32 = 192;
const ROW_HEIGHT: u32 = 208;
const V1_HEIGHT: u32 = 1872;
const V2_HEIGHT: u32 = 2288;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetEntry {
    pub id: String,
    pub folder_name: String,
    pub display_name: String,
    pub sprite_version_number: u8,
    pub sheet_width: u32,
    pub sheet_height: u32,
    pub column_width: u32,
    pub row_height: u32,
    pub row_count: u8,
    #[serde(skip)]
    pub sprite_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCatalog {
    pub root_directory: String,
    pub automatic: bool,
    pub exists: bool,
    pub pets: Vec<PetEntry>,
    pub warnings: Vec<String>,
}

pub fn scan(configured_root: Option<&str>) -> PetCatalog {
    let (root, automatic) = resolve_root(configured_root);
    let mut catalog = PetCatalog {
        root_directory: root.to_string_lossy().into_owned(),
        automatic,
        exists: root.is_dir(),
        pets: Vec::new(),
        warnings: Vec::new(),
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return catalog;
    };
    let mut directories = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .collect::<Vec<_>>();
    directories.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    for entry in directories {
        let directory = entry.path();
        let folder_name = entry.file_name().to_string_lossy().into_owned();
        match read_pet(&directory, &folder_name) {
            Ok(pet) => catalog.pets.push(pet),
            Err(error) => catalog.warnings.push(format!("{folder_name}：{error}")),
        }
    }
    catalog
}

pub fn selected_pet(config: &Value) -> (PetCatalog, Option<PetEntry>) {
    let root = config.get("petsRootDirectory").and_then(Value::as_str);
    let catalog = scan(root);
    let selected_folder = config
        .get("selectedPetFolder")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let selected_id = config
        .get("selectedPetId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let selected = catalog
        .pets
        .iter()
        .find(|pet| pet.folder_name == selected_folder)
        .or_else(|| catalog.pets.iter().find(|pet| pet.id == selected_id))
        .or_else(|| catalog.pets.first())
        .cloned();
    (catalog, selected)
}

pub fn selected_asset(config: &Value) -> Result<Option<(String, String)>, String> {
    let (_, selected) = selected_pet(config);
    let Some(pet) = selected else { return Ok(None) };
    let bytes = fs::read(&pet.sprite_path)
        .map_err(|error| format!("无法读取人物图片：{error}"))?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("人物图片超过 25MB 限制".to_string());
    }
    let mime = match pet
        .sprite_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "webp" => "image/webp",
        "png" => "image/png",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        _ => return Err("不支持的人物图片格式".to_string()),
    };
    Ok(Some((
        pet.id,
        format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
    )))
}

fn resolve_root(configured_root: Option<&str>) -> (PathBuf, bool) {
    let trimmed = configured_root.unwrap_or_default().trim();
    if trimmed.is_empty() {
        return (home_dir().join(".codex").join("pets"), true);
    }
    if trimmed == "~" {
        return (home_dir(), false);
    }
    if let Some(remainder) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return (home_dir().join(remainder), false);
    }
    (PathBuf::from(trimmed), false)
}

fn home_dir() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn read_pet(directory: &Path, folder_name: &str) -> Result<PetEntry, String> {
    let manifest_path = directory.join("pet.json");
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(&manifest_path).map_err(|_| "缺少 pet.json".to_string())?,
    )
    .map_err(|error| format!("pet.json 格式错误：{error}"))?;
    let sprite_relative = manifest
        .get("spritesheetPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "pet.json 缺少 spritesheetPath".to_string())?;
    let sprite_path = directory.join(sprite_relative);
    let canonical_directory = directory.canonicalize().map_err(|error| error.to_string())?;
    let canonical_sprite = sprite_path
        .canonicalize()
        .map_err(|_| format!("找不到精灵文件 {sprite_relative}"))?;
    if !canonical_sprite.starts_with(&canonical_directory) || !canonical_sprite.is_file() {
        return Err("spritesheetPath 不能指向人物目录之外".to_string());
    }
    let bytes = fs::read(&canonical_sprite).map_err(|error| error.to_string())?;
    let (width, height) = image_dimensions(&bytes)?;
    if width != SHEET_WIDTH || (height != V1_HEIGHT && height != V2_HEIGHT) {
        return Err(format!(
            "精灵图尺寸 {width}×{height} 不兼容，需要 1536×1872 或 1536×2288"
        ));
    }
    let actual_version = if height == V2_HEIGHT { 2 } else { 1 };
    if let Some(declared_version) = manifest.get("spriteVersionNumber") {
        if declared_version.as_u64() != Some(actual_version.into()) {
            return Err(format!(
                "spriteVersionNumber={} 与图片实际 v{actual_version} 不一致",
                declared_version
            ));
        }
    }
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(folder_name);
    let display_name = manifest
        .get("displayName")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(folder_name);
    Ok(PetEntry {
        id: id.to_string(),
        folder_name: folder_name.to_string(),
        display_name: display_name.to_string(),
        sprite_version_number: actual_version,
        sheet_width: SHEET_WIDTH,
        sheet_height: height,
        column_width: COLUMN_WIDTH,
        row_height: ROW_HEIGHT,
        row_count: if actual_version == 2 { 11 } else { 9 },
        sprite_path: canonical_sprite,
    })
}

fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() >= 24 && bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Ok((
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
        ));
    }
    if bytes.len() >= 10 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        return Ok((
            u16::from_le_bytes([bytes[6], bytes[7]]) as u32,
            u16::from_le_bytes([bytes[8], bytes[9]]) as u32,
        ));
    }
    if bytes.len() >= 30 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return webp_dimensions(bytes);
    }
    if bytes.len() >= 4 && bytes[..2] == [0xff, 0xd8] {
        return jpeg_dimensions(bytes);
    }
    Err("无法读取精灵图片尺寸".to_string())
}

fn webp_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let chunk_type = &bytes[offset..offset + 4];
        let chunk_size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let data = offset + 8;
        if chunk_type == b"VP8X" && data + 10 <= bytes.len() {
            return Ok((
                1 + le_u24(&bytes[data + 4..data + 7]),
                1 + le_u24(&bytes[data + 7..data + 10]),
            ));
        }
        if chunk_type == b"VP8 " && data + 10 <= bytes.len() && bytes[data + 3..data + 6] == [0x9d, 0x01, 0x2a] {
            return Ok((
                (u16::from_le_bytes([bytes[data + 6], bytes[data + 7]]) & 0x3fff) as u32,
                (u16::from_le_bytes([bytes[data + 8], bytes[data + 9]]) & 0x3fff) as u32,
            ));
        }
        if chunk_type == b"VP8L" && data + 5 <= bytes.len() && bytes[data] == 0x2f {
            let b1 = bytes[data + 1] as u32;
            let b2 = bytes[data + 2] as u32;
            let b3 = bytes[data + 3] as u32;
            let b4 = bytes[data + 4] as u32;
            return Ok((
                1 + b1 + ((b2 & 0x3f) << 8),
                1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
            ));
        }
        offset = data.saturating_add(chunk_size).saturating_add(chunk_size % 2);
    }
    Err("WebP 缺少可识别的尺寸信息".to_string())
}

fn jpeg_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let mut offset = 2usize;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        let is_sof = matches!(
            marker,
            0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
        );
        if is_sof && offset + 9 <= bytes.len() {
            return Ok((
                u16::from_be_bytes([bytes[offset + 7], bytes[offset + 8]]) as u32,
                u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32,
            ));
        }
        if marker == 0xd8 || marker == 0xd9 {
            offset += 2;
            continue;
        }
        let length = u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]) as usize;
        if length < 2 {
            break;
        }
        offset += 2 + length;
    }
    Err("JPEG 缺少可识别的尺寸信息".to_string())
}

fn le_u24(bytes: &[u8]) -> u32 {
    bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_vp8x_dimensions() {
        let mut bytes = vec![0u8; 30];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[8..12].copy_from_slice(b"WEBP");
        bytes[12..16].copy_from_slice(b"VP8X");
        bytes[16..20].copy_from_slice(&10u32.to_le_bytes());
        let width = 1535u32.to_le_bytes();
        let height = 2287u32.to_le_bytes();
        bytes[24..27].copy_from_slice(&width[..3]);
        bytes[27..30].copy_from_slice(&height[..3]);
        assert_eq!(image_dimensions(&bytes).unwrap(), (1536, 2288));
    }
}
