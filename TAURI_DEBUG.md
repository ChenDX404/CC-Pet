# CC Pet — 桌面端剩余问题

## 项目背景

CC Pet 是一个 VS Code 扩展 + Tauri 桌面浮窗桌宠。

```
VS Code Extension                    Tauri 桌面 exe
────────────────                    ──────────────
• CC 状态检测（sessions/JSONL）       • 渲染桌宠 + 拖动窗口
• 回复气泡                            • CSS 精灵动画
• GUI 绑定编辑器                      • 配置文件读取
• WebSocket IPC 服务端（端口扫描）     • WebSocket IPC 客户端（端口扫描）
```

IPC 通道：VS Code 端 `src/petIPC.ts` WebSocket server → Tauri 端 `dist-pet/pet-ipc.js` WebSocket client。

## 已解决

- ✅ Tauri 窗口透明无边框置顶
- ✅ 手动窗口拖动（setPosition + requestAnimationFrame）
- ✅ 方向帧切换 + 单击反应
- ✅ 配置读取（build.rs 编译期复制 + pet.js 启动时 fetch）
- ✅ IPC 基础通道（WebSocket 双向通信，端口自动扫描 19420-19429）

## 当前问题

### 问题 1：cc-complete 后人物不回正

**现象**：CC 工作完成后 VS Code webview 端标签显示"工作完成"，动画停了，但人物停留在 cc-complete 绑定的最后一帧，不回到 idle。

**已尝试的修复**：`syncCcStateToWebview()` 中 cc-complete 分支后加了 3 秒 timeout 发 `anim-stop` + `asset-update` idle 帧。但可能因为你又改了代码，需要重新验证。

**相关文件**：
- `src/petPreviewPanel.ts`：`syncCcStateToWebview()` 第 294-306 行
- `src/petPreviewPanel.ts`：`handleDirection('none')` 第 329-341 行

### 问题 2：桌面端不响应 CC 状态变化

**现象**：VS Code 检测到 CC working/open 后广播 `{type:'cc-state', state}`，但 Tauri 桌面窗口不切动画。

**代码链路**：
```
petPreviewPanel.ts detector 回调
  → broadcastIPC({type:'cc-state', state})           ✅ 已写
petIPC.ts MiniWSServer.broadcast()                   ✅ 已写
dist-pet/pet-ipc.js WebSocket.onmessage              ✅ 已写
  → window.__petOnCCState(state)                     ✅ 已写
dist-pet/pet.js __petOnCCState                       ✅ 已写
  → startLoop() / playOnce() / showIdle()            ✅ 已写
```

**可能原因**：
- WebSocket 没连上（端口扫描失败或超时）
- `broadcast()` 时 clients 数组为空（Tauri 还没连上来）
- `window.__petOnCCState` 未定义（pet.js 加载失败或顺序问题）

**排查方法**：Tauri 窗口打开后，在 webview DevTools Console 跑：
```javascript
console.log('WS connected:', !!window.__petOnCCState)
```

### 问题 3：桌面端无 CC 回复气泡

**现象**：CC 回答完后 VS Code webview 端弹出气泡，Tauri 桌面端没有。

**代码链路**：
```
petPreviewPanel.ts detector 回调
  → getLastReply() 返回文本                               ✅ 已写
  → broadcastIPC({type:'cc-reply', text})                 ✅ 已写
dist-pet/pet-ipc.js showReply(text)                       ✅ 已写
dist-pet/index.html <div id="cc-reply">                   ✅ 已写
dist-pet/pet.css .cc-reply 样式                            ✅ 已写
```

**可能原因**：同问题 2（WebSocket 可能未连接）。

**排查方法**：Tauri webview Console 跑：
```javascript
document.getElementById('cc-reply').textContent = 'test';
document.getElementById('cc-reply').hidden = false;
```
如果显示了 → CSS 没问题，IPC 消息没收到。如果不显示 → DOM/CSS 问题。

### 问题 4：GUI 保存配置 → 桌面端不同步

**现象**：😊 GUI 面板改绑定 → 保存 → VS Code webview 立即生效，Tauri 桌面窗口不变。

**代码链路**：
```
petBindingView.ts saveConfig()
  → writeFileSync(pet-config.json)                       ✅ 已写
  → broadcastIPC({type:'config-update', config})         ✅ 已写
dist-pet/pet-ipc.js
  → window.__petReloadConfig(config)                     ✅ 已写
dist-pet/pet.js __petReloadConfig
  → stopAnimation() → normalizeConfig() → showIdle()    ✅ 已写
```

**可能原因**：同问题 2（WebSocket 可能未连接）。

## 核心怀疑

**WebSocket 连接可能根本没建立**。Tauri 端 `pet-ipc.js` 从 19420 开始扫描端口，VS Code 端 `petIPC.ts` 也从 19420 开始。两端可能对不上——如果 VS Code 端和 Tauri 端在同一台机器上但有多个 VS Code 窗口，端口会递增。

**排查建议**：
1. 在 VS Code Extension Host Console 看 `IPC server listening on port XXXX`（petIPC.ts 没有这行日志，需要加一句 `console.log`）
2. 在 Tauri webview Console 看 WebSocket 是否成功连接
3. 检查 `netstat -ano | findstr 1942` 确认服务端在哪个端口

## 开发环境

- Windows 10 Home China 10.0.19045
- Tauri CLI 2.11.4 / Rust 1.97.1 / Cargo 1.97.1
- Rust/Cargo: E:\rust\.cargo\bin\
- 项目: E:\code\vscode_plugin\cc-pet\

## 项目结构

```
cc-pet/
├─ src-tauri/                # Tauri Rust 后端
│  ├─ Cargo.toml, tauri.conf.json
│  ├─ capabilities/default.json
│  ├─ build.rs (编译期复制 pet-config.json)
│  └─ src/main.rs
├─ dist-pet/                 # Tauri webview 前端
│  ├─ index.html
│  ├─ pet.css (.cc-reply 气泡样式)
│  ├─ pet.js (拖动 + 动画 + 配置读取 + __petOnCCState + __petReloadConfig)
│  ├─ pet-ipc.js (WebSocket 客户端: config-update + cc-state + cc-reply)
│  └─ spritesheet.webp (1536×2288, 8列×11行, 每格 192×208)
├─ src/                      # VS Code 扩展
│  ├─ petIPC.ts (WebSocket 服务端, 端口 19420-19429 自动扫描)
│  ├─ petPreviewPanel.ts (CC 检测 + 帧切换 + broadcastIPC)
│  ├─ petBindingView.ts (GUI 编辑器 + saveConfig → broadcastIPC)
│  ├─ ccStatusDetector.ts (sessions/JSONL 监听 + getLastReply)
│  └─ extension.ts (启动 IPC + 自动拉起 Tauri + 配置开关监听)
├─ pet-config.json           # 用户配置文件（项目根目录）
└─ media/                    # VS Code webview 资源
```

## 当前配置 (pet-config.json bindings)

```json
"bindings": {
  "drag-left": "向左跑",
  "drag-right": "向右跑",
  "click": "抬头"
}
```

cc-working/cc-complete 未在 JSON 中绑定，依赖 convention.ts 默认值 fallback。

## tauri.conf.json

```json
{
  "app": {
    "withGlobalTauri": true,
    "windows": [{
      "title": "CC Pet", "width": 210, "height": 228,
      "resizable": false, "decorations": false,
      "alwaysOnTop": true, "shadow": false,
      "transparent": true, "center": true
    }]
  }
}
```

## capabilities

```json
{
  "permissions": ["core:default", "core:window:allow-set-position"]
}
```