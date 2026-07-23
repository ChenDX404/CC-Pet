use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is unavailable"),
    );
    let config_source = manifest_dir.join("../pet-config.json");
    let config_target = manifest_dir.join("../dist-pet/pet-config.json");
    let bubble_style_source = manifest_dir.join("../media/pet-bubble.css");
    let bubble_style_target = manifest_dir.join("../dist-pet/pet-bubble.css");

    println!("cargo:rerun-if-changed={}", config_source.display());
    fs::copy(&config_source, &config_target)
        .expect("failed to sync pet-config.json into the Tauri frontend");
    println!("cargo:rerun-if-changed={}", bubble_style_source.display());
    fs::copy(&bubble_style_source, &bubble_style_target)
        .expect("failed to sync the shared pet bubble style into the Tauri frontend");

    tauri_build::build()
}
