<p align="center">
  <img src="docs/images/cc-pet-logo.png" alt="CC Pet Logo" width="190">
</p>

<h1 align="center">CC Pet</h1>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Give Claude Code a desktop pet that reacts to its work in real time</strong>
</p>

<p align="center">
  Animated companions have become a delightful part of the Codex experience, but Claude Code has not had the same kind of visual desktop companion.<br>
  CC Pet fills that gap by turning Claude Code's thinking, running, waiting, and completion states into character animations and speech bubbles.
</p>

<p align="center">
  Available as both a <strong>standalone Windows desktop app</strong> and a <strong>VS Code extension</strong>, CC Pet can directly reuse Codex and Petdex pet assets.<br>
  It supports both legacy 9-row and current 11-row spritesheets, with fully customizable action names, frame counts, playback speeds, and event bindings.<br>
  Everything can be configured through a visual desktop GUI—no manual JSON editing required.
</p>

<p align="center">
  <a href="https://github.com/ChenDX404/CC-Pet/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="https://github.com/crafter-station/petdex">Discover more Codex / Petdex pets</a>
</p>

<p align="center">
  Transparent always-on-top window · Free dragging · Claude Code status detection · Codex pet compatibility · Visual action binding
</p>

---

## 🎬 Demo

### Live interaction with Claude Code

The character changes animations as Claude Code works and displays dedicated bubbles while a task is running and when the final response arrives.

<p align="center">
  <img src="docs/images/claude-interaction-demo.gif" alt="CC Pet interacting with Claude Code" width="850">
</p>

### Desktop control center

Use the visual GUI to switch pets, resize the character, and configure each action's name, frame count, playback speed, and trigger events.

<p align="center">
  <img src="docs/images/desktop-control-demo.gif" alt="CC Pet desktop control center demo" width="900">
</p>

## 🖼️ Interface preview

![CC Pet desktop control center](docs/images/desktop-pet-settings.png)

<table>
  <tr>
    <td><img src="docs/images/desktop-action-mapping.png" alt="Desktop action mapping page"></td>
    <td><img src="docs/images/vscode-extension-settings.png" alt="VS Code extension settings page"></td>
  </tr>
  <tr>
    <td align="center">Desktop action mapping</td>
    <td align="center">VS Code extension settings</td>
  </tr>
</table>

---

## ⚠️ Before you start

CC Pet supports both Codex v1 (9-row) and v2 (11-row) spritesheets and automatically detects the format from the image dimensions.

When using a custom pet for the first time, open the GUI settings and confirm the action name and actual frame count for each row. Pet creators decide what each row contains; CC Pet's built-in names are only initial defaults and can be changed freely.

**Default v2 (11-row) action guide:**

| Row | Conventional purpose | Name |
|-----|----------------------|------|
| Row 1 | Default idle pose | 🔧 Customizable |
| Row 2 | Move right | 🔧 Customizable |
| Row 3 | Move left | 🔧 Customizable |
| Row 4 | Welcome / wave | 🔧 Customizable |
| Row 5 | Jump / greet | 🔧 Customizable |
| Row 6 | Failure / eyes closed | 🔧 Customizable |
| Row 7 | Waiting / shrug | 🔧 Customizable |
| Row 8 | Review / thinking | 🔧 Customizable |
| Row 9 | Head tilt / variant | 🔧 Customizable |
| Row 10 | Look up / click reaction | 🔧 Customizable |
| Row 11 | Turn around / long-idle variant | 🔧 Customizable |

> 💡 The row numbers and purposes follow the conventional Codex pet format, but **you can freely rename every row in the GUI**.

For each action row, you only need to:

1. ✏️ **Give it a name** — so it is easy to recognize when binding events.
2. 📐 **Enter the frame count** — the number of actual frames in that spritesheet row.

**How do I determine the frame count?** Think of the spritesheet as a flipbook. Each pose from left to right is one frame. Count the non-empty cells in the row. The GUI includes a frame-by-frame preview to make this easy.

### 🔧 What can the GUI configure?

| Feature | Description |
|---------|-------------|
| ✏️ **Action names** | Give every row a custom display name in any language |
| 📐 **Frame counts** | Set the actual frame count for each row (1–8) |
| ⚡ **Playback speed** | Adjust every animation independently (0.5x–2.0x) |
| 🔗 **Event bindings** | Map events to actions, including drag, click, hover, and Claude Code states |
| 🐱 **Pet selection** | Scan a local pet directory and select the active pet |
| 🔍 **Live size preview** | Drag a slider to preview the character scale in real time |

> 💡 All of these settings are available through the GUI. Character size previews immediately; action names, frame counts, speeds, and event bindings take effect after clicking **Save Changes**.

---

## 📦 Installation

### Option 1: VS Code extension

Download `cc-pet-win32-x64.vsix` from [GitHub Releases](https://github.com/ChenDX404/CC-Pet/releases/latest):

```text
Ctrl+Shift+P → Extensions: Install from VSIX... → select the .vsix file
```

After installation, the 🐾 **CC Pet: Action Binding** icon appears in the VS Code activity bar. Select it to open the settings page.

### Option 2: Standalone Windows app

Download one of the following files from [GitHub Releases](https://github.com/ChenDX404/CC-Pet/releases/latest):

| File | Description |
|------|-------------|
| `CC-Pet_x.x.x_windows-x64-setup.exe` | 📦 NSIS installer; recommended for most users |
| `CC-Pet_x.x.x_windows-x64-portable.exe` | 🚀 Portable version; no installation required |

After launching the desktop app, right-click the **system tray** icon and open the control center to configure CC Pet.

> The first public release supports Windows x64 only. The installer downloads and installs WebView2 when it is missing. The portable version requires Microsoft Edge WebView2 Runtime to be installed already.

---

## ✨ Features

| Category | Features |
|----------|----------|
| 🪟 **Desktop overlay** | Transparent, borderless, always-on-top, and freely draggable |
| 🤖 **Claude Code awareness** | Detects idle, thinking, waiting for input, running commands, completion, and errors |
| 💬 **Smart bubbles** | Shows a summarized user request while working and the final Claude Code response when complete |
| 🎞️ **Sprite animation** | Supports 9-row and 11-row pets with independent frame counts and playback speeds |
| 🎛️ **Visual configuration** | Configure event bindings and action names from VS Code or the standalone desktop GUI |
| 📂 **Automatic discovery** | Scans `~/.codex/pets` and recognizes v1 and v2 Codex pet formats |
| 👥 **Multiple pets** | Stores an independent profile for every pet and switches between them instantly |
| 🖥️ **Dual-mode operation** | Use the VS Code extension or the standalone desktop app with shared settings |

---

## 🏗️ Two ways to use CC Pet

| Mode | Best for | Claude Code status detection |
|------|----------|------------------------------|
| **VS Code extension** | Developers who primarily use Claude Code in VS Code | Sends status updates to the desktop pet over WebSocket |
| **Standalone Windows app** | Users who want the pet to run independently | Uses a built-in Rust status detector and does not depend on VS Code |

> 📁 Both modes share the configuration stored under `%APPDATA%\CC Pet\`, so you can switch between them without reconfiguring your pets.

---

## 🎨 Pet format

CC Pet is compatible with the Codex desktop pet format. You can install compatible pets directly from the [Petdex GitHub repository](https://github.com/crafter-station/petdex):

```bash
npx petdex install boba    # Installs to ~/.codex/pets/boba/
# CC Pet discovers it automatically; select it from the GUI.
```

```text
my-pet/
├── pet.json            # Metadata: name and spritesheet path
└── spritesheet.webp    # Spritesheet (WebP and PNG supported)
```

**Spritesheet specifications:**

| Property | v1 (9 rows) | v2 (11 rows) |
|----------|-------------|--------------|
| Size | 1536 × 1872 | 1536 × 2288 |
| Cell size | 192 × 208 | 192 × 208 |
| Grid | 8 columns × 9 rows | 8 columns × 11 rows |

CC Pet automatically detects and adapts to either version.

---

## 📁 Configuration

### User configuration location

```text
%APPDATA%\CC Pet\
├── config.json              # Global settings: selected pet, scale, desktop options, etc.
└── profiles\
    ├── xiuxiu.json          # Per-pet frame counts, speeds, names, and bindings
    └── boba.json
```

### VS Code extension settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccPet.petsRootDirectory` | Empty (uses `~/.codex/pets`) | Root directory containing pet folders |
| `ccPet.autoLaunchDesktop` | `true` | Automatically launches the desktop pet with VS Code |

---

## 🔒 Privacy

CC Pet reads Claude Code's `~/.claude/sessions` session index and `~/.claude/projects` transcript JSONL locally to determine work status and extract the current request summary and final response. It does not make additional model calls at runtime and does not actively upload conversation content.

---

## 📂 Project structure

```text
cc-pet/
│
├── src/                        # 📦 VS Code extension source (TypeScript)
│   ├── extension.ts            #   Extension entry: IPC, desktop launch, sidebar registration
│   ├── ccStatusDetector.ts     #   Claude Code status detection (session JSONL watcher)
│   ├── petIPC.ts               #   WebSocket server (ports 19420–19429)
│   ├── petCatalog.ts           #   Pet directory scanning and v1/v2 detection
│   ├── petProfiles.ts          #   Per-pet row and binding profile management
│   ├── userConfig.ts           #   User configuration persistence
│   ├── petBindingView.ts       #   Sidebar binding editor (WebviewView)
│   ├── pet-renderer/           #   Shared renderer core and 11-row conventions
│   └── test/                   #   Mocha tests
│
├── src-tauri/                  # 🦀 Tauri desktop application (Rust)
│   ├── src/main.rs             #   Windows, tray, and application lifecycle
│   ├── src/commands.rs         #   Tauri commands: bootstrap, save, scale, and select
│   ├── src/config.rs           #   Thread-safe configuration with atomic writes
│   ├── src/catalog.rs          #   Rust mirror of the pet catalog
│   ├── src/profiles.rs         #   Rust mirror of profile management
│   ├── src/status.rs           #   Standalone Claude Code status detector
│   ├── Cargo.toml              #   Rust dependencies
│   └── tauri.conf.json         #   Window configuration and NSIS packaging
│
├── dist-pet/                   # 🌐 Desktop WebView frontend (vanilla JavaScript)
│   ├── index.html              #   Pet window entry page
│   ├── pet.js                  #   Sprite rendering, animation loop, and dragging
│   ├── pet-ipc.js              #   IPC client for the VS Code WebSocket server
│   ├── pet-binding.js          #   Shared binding editor UI
│   ├── settings-host.js        #   Tauri polyfill for acquireVsCodeApi
│   └── settings.html           #   Desktop settings window
│
├── media/                      # 🎨 Shared UI source assets
│   ├── pet-binding-vscode.html #   VS Code sidebar template
│   ├── pet-binding-desktop.html#   Desktop settings template
│   ├── pet-binding.js/css      #   Binding editor JavaScript and CSS
│   └── pet-bubble.css          #   Shared bubble styles
│
├── scripts/                    # 🔧 Build scripts
│   ├── sync-desktop-assets.mjs #   Synchronizes media/ → dist-pet/
│   └── stage-vscode-binary.mjs #   Stages the desktop executable for VSIX packaging
│
├── bin/                        # Local build output (not tracked by Git)
├── releases/                   # Local release output (not tracked by Git)
└── pet-config.json             # Default first-run configuration
```

### Mirrored implementations (TypeScript ↔ Rust)

| Feature | TypeScript | Rust | Relationship |
|---------|------------|------|--------------|
| 📂 Pet directory scanning | `src/petCatalog.ts` | `src-tauri/src/catalog.rs` | Mirrored |
| ⚙️ Pet profile management | `src/petProfiles.ts` | `src-tauri/src/profiles.rs` | Mirrored |
| 🤖 Claude Code status detection | `src/ccStatusDetector.ts` | `src-tauri/src/status.rs` | Complementary |
| 💾 Configuration persistence | `src/userConfig.ts` | `src-tauri/src/config.rs` | Mirrored |

### Data flow

```text
Install a pet                    Claude Code status detection
    │                                      │
npx petdex install boba          Watch ~/.claude/sessions/
    ↓                                      ↓
~/.codex/pets/boba/              src/ccStatusDetector.ts
    ↓                                      │
src/petCatalog.ts scan                      │ WebSocket (127.0.0.1:19420–19429)
    │                                      ↓
    │                              dist-pet/pet-ipc.js → pet.js
    │                                      │
    └──────────────────────────────────────┘
                      🖥️ Desktop pet rendering
```

---

## 🛠️ Local development

### Requirements

- Node.js ≥ 18
- Rust with the MSVC toolchain
- VS Code

```bash
git clone https://github.com/ChenDX404/CC-Pet.git
cd CC-Pet
npm install
npm test                    # Compile, lint, and test
npm run desktop:prepare     # Prepare desktop frontend assets
```

### Debugging the VS Code extension

Press `F5` to launch the Extension Development Host.

### Checking the desktop app

Install [Rust](https://rustup.rs) first and select the MSVC toolchain on Windows.

```bash
cd src-tauri
cargo check
```

---

## 🔨 Build

```bash
# Windows NSIS installer
npm run desktop:build       # → src-tauri/target/release/bundle/nsis/

# VS Code extension package (run desktop:build first)
npm run extension:package   # → releases/cc-pet-win32-x64.vsix
```

---

## 🧰 Tech stack

| Layer | Technology |
|-------|------------|
| VS Code extension | TypeScript · VS Code Extension API |
| Desktop shell | Tauri 2 (Rust) · WebView2 |
| Desktop renderer | Vanilla JavaScript · CSS sprites |
| Communication | Custom RFC 6455 WebSocket · zero runtime dependencies |
| Packaging | NSIS for desktop · vsce for the extension |

---

## 📝 License

MIT
