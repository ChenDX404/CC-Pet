use serde_json::Value;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const PACKAGED_CONFIG: &str = include_str!("../../pet-config.json");

pub struct ConfigState {
    value: Mutex<Value>,
    path: PathBuf,
}

impl ConfigState {
    pub fn load() -> Result<Self, String> {
        let path = user_config_path()?;
        let value = if path.exists() {
            read_json(&path)?
        } else {
            serde_json::from_str(PACKAGED_CONFIG).map_err(|error| error.to_string())?
        };
        Ok(Self {
            value: Mutex::new(value),
            path,
        })
    }

    pub fn snapshot(&self) -> Result<Value, String> {
        self.value
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "配置锁已损坏".to_string())
    }

    pub fn update<F>(&self, update: F) -> Result<Value, String>
    where
        F: FnOnce(&mut serde_json::Map<String, Value>),
    {
        let mut value = self
            .value
            .lock()
            .map_err(|_| "配置锁已损坏".to_string())?;
        let object = value
            .as_object_mut()
            .ok_or_else(|| "配置文件根节点必须是对象".to_string())?;
        update(object);
        write_json(&self.path, &value)?;
        Ok(value.clone())
    }

    pub fn replace(&self, replacement: Value) -> Result<Value, String> {
        let mut value = self
            .value
            .lock()
            .map_err(|_| "配置锁已损坏".to_string())?;
        write_json(&self.path, &replacement)?;
        *value = replacement;
        Ok(value.clone())
    }

    pub fn read_profile(&self, folder_name: &str) -> Result<Option<Value>, String> {
        let path = self.profile_path(folder_name)?;
        if !path.exists() { return Ok(None); }
        read_json(&path).map(Some)
    }

    pub fn write_profile(&self, folder_name: &str, profile: &Value) -> Result<(), String> {
        write_json(&self.profile_path(folder_name)?, profile)
    }

    pub fn backup_before_profile_migration(&self) -> Result<(), String> {
        if !self.path.exists() { return Ok(()); }
        let backup = self.path.with_file_name("config.v2.backup.json");
        if !backup.exists() {
            fs::copy(&self.path, &backup)
                .map_err(|error| format!("无法备份旧配置：{error}"))?;
        }
        Ok(())
    }

    fn profile_path(&self, folder_name: &str) -> Result<PathBuf, String> {
        let name = Path::new(folder_name);
        if folder_name.is_empty() || name.file_name().and_then(|value| value.to_str()) != Some(folder_name) {
            return Err("人物文件夹名称无效".to_string());
        }
        let parent = self.path.parent().ok_or_else(|| "配置目录无效".to_string())?;
        Ok(parent.join("profiles").join(format!("{folder_name}.json")))
    }

    #[cfg(test)]
    pub(crate) fn for_test(value: Value, path: PathBuf) -> Self {
        Self { value: Mutex::new(value), path }
    }
}

fn user_config_path() -> Result<PathBuf, String> {
    if let Some(app_data) = env::var_os("APPDATA").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(app_data).join("CC Pet").join("config.json"));
    }
    if let Some(config_home) = env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(config_home).join("cc-pet").join("config.json"));
    }
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .ok_or_else(|| "无法确定当前用户目录".to_string())?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join("cc-pet")
        .join("config.json"))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("无法读取配置 {}：{error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("配置格式错误 {}：{error}", path.display()))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "配置目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())? + "\n";
    fs::write(&temporary_path, content).map_err(|error| format!("无法写入临时配置：{error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("无法替换旧配置：{error}"))?;
    }
    fs::rename(&temporary_path, path).map_err(|error| format!("无法保存配置：{error}"))
}
