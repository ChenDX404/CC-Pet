# CC Pet — 项目约定与上下文（最终锁定版）

## 〇、最终总目标

CC Pet 是一个**桌面浮窗桌宠**（形态类似 Codex 自带桌宠）：

- **独立桌面进程**（Tauri），**不依赖 VS Code 可见 / 聚焦**
- 透明背景、始终置顶、可拖到桌面任意位置
- 感知 VS Code、Codex、其他编码智能体的工作状态
- 以对应动画（idle / thinking / reading / editing / running / waiting / success / error）与方向帧反馈

## 长期架构（已锁定）

| 角色 | 技术栈 | 职责 |
|---|---|---|
| **桌面浮窗宿主** | **Tauri**（Rust + 系统 Webview） | 透明窗口、置顶、托盘、开机自启；承载 PetRenderer |
| **VS Code Extension** | 现有 TS + VS Code API | **launcher + 状态桥**：启动 / 停止 Tauri 进程、把 Codex 状态通过 IPC 推送给桌宠 |
| **PetRenderer 共享核心** | 纯 TypeScript（不绑 vscode / tauri API） | 资产加载、帧计算、状态→动画映射；可被任意 Webview 宿主复用 |

## 阶段路线（已修订）

| 阶段 | 目标 | 关键技术 | 状态 |
|---|---|---|---|
| **1** | **当前**：VS Code WebviewPanel 预览原型 | VS Code Webview API | 规划完成，待实施 |
| 2 | 抽出 PetRenderer 共享核心（不绑 vscode） | TS 重构 | 延后 |
| 3 | 扩展 manifest schema + 11 行约定 + 16 方向 | PetRenderer + pet.json v3 | 延后 |
| 4 | Codex 状态检测（事件源） | VS Code ext + 文件监听 | 延后 |
| 5 | **GUI 绑定编辑器**（webviewView）+ 完整事件触发 + 动画状态机 | VS Code WebviewView | 延后 |
| 6 | Tauri 桌面浮窗原型 | Tauri (Rust + Webview) | 延后 |
| 7 | 透明 + 始终置顶 + 系统托盘 + 开机自启 | Tauri API | 延后 |
| 8 | VS Code Ext 改 launcher + IPC 整合 | IPC 协议 | 延后 |
| 9 | 打包发布（Marketplace + GitHub Release） | vsce + cargo bundle | 延后 |

## 业务模型 4 决策（已锁定）

| 决策点 | 终态默认行为 | 生效阶段 | 阶段 1 状态 |
|---|---|---|---|
| **A 激活与生命周期** | VS Code Extension 激活时**自动拉起** Tauri 桌宠；VS Code 关闭时桌宠退出 | 阶段 8 | ❌ 阶段 1 用**手动命令** |
| **B 多 VS Code 实例** | **全局单桌宠** + 用户手动选状态源 | 阶段 8 | ❌ 不适用 |
| **C 离线行为**（Codex 未运行 / 未安装） | 显示**闲置动画**（idle 帧），不报错、不隐藏 | 阶段 4 | ❌ 阶段 1 无状态检测 |
| **D 交互模型** | 拖动（永远响应）+ **点击展示状态详情**（CC 回复文本气泡） | 阶段 5+ | ❌ 阶段 1 仅拖动 |

### 阶段 1 严禁（即使想到也忍住）
- ❌ 不要加任何 Tauri 进程启动 / 关闭 / IPC 逻辑
- ❌ 不要加 Codex 状态检测的任何探针代码
- ❌ 不要让 WebviewPanel 自动随扩展激活打开
- ❌ 不要加点击 / 悬停 / 右键响应
- ❌ 不要加 idle / thinking / 任何动画状态切换逻辑
- ❌ 不要加多 VS Code 窗口协调代码
- ❌ 不要加 GUI 绑定编辑器（阶段 5 才做）

## 核心设计原则：配置驱动，零 LLM

| 时期 | 角色 | 是否需要 AI |
|---|---|---|
| **写 pet.json**（一次性） | pet 作者 / 用户手填；AI 可选辅助草稿 | 可选 |
| **运行时**（CC Pet 启动 / 事件触发） | 读 JSON + 查表 + 算坐标 + 渲染 | **完全不需要** |

**CC Pet 是「数据驱动的渲染器」——它从不动 sprite 内容，只看 JSON**。

## 11 行约定俗成表（内置于 CC Pet，可被 pet.json 的 `name` 字段覆盖）

约定俗成：**11 行 = 11 动作**。用户必上传 11 行。事件数 ≤ 动作数（≤ 11），允许多事件绑同一动作。

| 行号 | 约定动作名 | 用途 |
|---|---|---|
| 1 | `idle` | 默认待机（睁眼正面） |
| 2 | `running-left` | 向左跑 |
| 3 | `running-right` | 向右跑 |
| 4 | `running` | 向前跑 / 默认方向 |
| 5 | `jumping` | 跳跃 |
| 6 | `waving` | 挥手 / 欢迎 / CC success |
| 7 | `waiting` | 等待用户输入 |
| 8 | `review` | 审阅 / thinking / reading / editing |
| 9 | `failed` | 任务失败 |
| 10 | `look-down` | 向下看（单击反应） |
| 11 | `ambient` | 长空闲变体 |

**冲突防护语义**（GUI 编辑器 + pet.json 手填都遵守）：
- 同事件不绑两个动作（❌ 阻止）
- 同动作可绑多事件（✅ 允许）

## pet.json schema 版本策略

| `spriteVersionNumber` | 阶段 1 行为 | 完整 schema 何时生效 |
|---|---|---|
| `2`（当前生产 pet.json） | **精简模式**：仅找 sprite + 渲染默认帧 + 不解析 rows/bindings | 阶段 1 即可用 |
| `3` | 阶段 3+ 才解析 `frameWidth`/`frameHeight`/`rows[]`/`bindings[]` | 阶段 3+ |

阶段 1 **不要求**用户升级 pet.json。

## pet.json v3 schema（最终版）

```jsonc
{
  "id": "xiuxiu",
  "displayName": "绣绣",
  "description": "...",
  "spriteVersionNumber": 3,
  "spritesheetPath": "spritesheet.webp",
  "frameWidth": 256,
  "frameHeight": 240,
  "rows": [
    { "row": 1,  "frames": 6 },
    { "row": 2,  "frames": 4 },
    ...
    { "row": 11, "frames": 8 }
    // 可选 "name": "xxx" 覆盖约定名
  ],
  "bindings": {
    "drag-left":   "running-left",
    "drag-right":  "running-right",
    "click":       "look-down",
    "appear":      "waving",
    "cc-thinking": "review",
    "cc-running":  "running",
    "cc-waiting":  "waiting",
    "cc-success":  "waving",
    "cc-error":    "failed"
  }
}
```

## 触发 → 动作 → 帧映射（阶段 3+ 生效）

| 触发 | 动作（约定名） | 帧类型 | 帧源（行） |
|---|---|---|---|
| 拖动 向左 | `running-left` | 循环 | 第 2 行 |
| 拖动 向右 | `running-right` | 循环 | 第 3 行 |
| 拖动 向上 | **无明确帧** | 不触发动画 | 仅移动位置 |
| 拖动 向下 | **无明确帧** | 不触发动画 | 仅移动位置 |
| 无拖动 / CC 空闲 | `idle` | 循环 | 第 1 行 |
| 单击 | `look-down` | 一次性 | 第 10 行 |
| 单击 + CC 回复 | 文本气泡 + look-down 动画 | 并行 | 阶段 5 UI |
| CC 出现 / 欢迎 / success | `waving` | 一次性 → 回 idle | 第 6 行 |
| 长空闲 | `ambient` | 一次性 | 第 11 行 |
| CC thinking/reading/editing | `review` | 循环 | 第 8 行 |
| CC running | `running` | 循环 | 第 4 行 |
| CC waiting | `waiting` | 循环 | 第 7 行 |
| CC error | `failed` | 一次性 → 回 idle | 第 9 行 |

## 阶段 1 关键约定

### 命名空间
- **命令 ID**：`cc-pet.*`（如 `cc-pet.openPetPreview`）。`category: "CC Pet"`、`title: "Open Pet Preview"`，命令面板显示 `CC Pet: Open Pet Preview`
- **VS Code 设置**：`ccPet.*`（如 `ccPet.petDirectory`）。两者前缀故意不一致

### Codex 桌宠目录（绝对禁止硬编码）
- 默认：`~/.codex/pets/xiuxiu`，运行时 `os.homedir()` 拼出；源码 / 测试**绝不允许** `C:\Users\Lenovo`
- 用户可在 `ccPet.petDirectory` 覆盖；空值回落默认
- **只读** —— 扩展任何时候都不允许写 / 改 / 删 / 重命名 / 复制

### 阶段 1 帧计算临时常量（写死在 `src/petAssetLoader.ts` 顶部）

```typescript
// NOTE: **实测自 spritesheet.webp（DevTools onload 验证 2026-07-17）**
// 真实尺寸 1536×2288（不是早期假设的 1536×240 单行 6 帧）
// 6 列 × 11 行网格，每格 256×208 px
// 终态 spriteVersionNumber=3 时改由 manifest.frameWidth/frameHeight + actions[] 驱动
const SHEET_W = 1536;
const SHEET_H = 2288;
const COL_WIDTH = 256;
const ROW_HEIGHT = 208;
const DEFAULT_FRAME: FrameRect = { x: 0, y: 0, width: COL_WIDTH, height: ROW_HEIGHT };
//   ↑ 帧 1（睁眼正面 idle 默认，实测最平衡的姿态）
//     帧 0（闭眼）作为次 idle 变种保留，本阶段 1 不使用
```

### 平台无关约束（阶段 2 / 阶段 6 复用前提）
- `src/petPath.ts`：纯函数，**不 import `vscode`**
- `src/petAssetLoader.ts`：`node:fs` + `node:path`，**不 import `vscode`**
- `src/petPreviewPanel.ts`：**唯一**允许 `import * as vscode from 'vscode'`
- `media/pet.{html,css,js}`：纯 DOM，仅引用 `acquireVsCodeApi()`（Tauri 阶段可 polyfill）

## 构建与质量门

- `npm run compile` / `npm run lint` / `npm run test`（`pretest` 会先 compile + lint）
- TypeScript strict；**禁用 `any`**；**不新增运行期 npm 依赖**
- 测试用 Mocha + `@vscode/test-cli` + `@vscode/test-electron`
- 既有 `src/test/extension.test.ts` 占位测试**保留不动**

## 阶段 1 范围外（明确延后）

Codex hooks / 状态检测、16 方向精灵切换、动画状态机、Tauri（阶段 6 才引入）、Electron、桌面透明窗口、置顶、系统托盘、HTTP / WebSocket / MCP / 云端服务、登录、Marketplace 发布配置、自动 git 提交、GUI 绑定编辑器（阶段 5）。

## 阶段 1 防偏执行约束（自我约束，跨会话有效）

### Definition of Done —— 12 条验收硬指标

1. `npm run compile` 通过，零 TS 错误
2. `npm run lint` 通过，零 ESLint 错误
3. `npm run test` 通过（既有 `extension.test.ts` + 新增 `petPath.test.ts` + `petAssetLoader.test.ts`）
4. 命令面板能找到 `CC Pet: Open Pet Preview`，执行后只打开一个 WebviewPanel
5. 默认桌宠路径 = `~/.codex/pets/xiuxiu`，运行时 `os.homedir()`；源码 + 测试 `grep C:\Users\Lenovo` 必须 0 命中
6. Webview 渲染 `spritesheet.webp` **第 2 格（睁眼正面 256×240）**，不是整张 sheet
7. 拖动工作（Pointer Events、保持偏移、视口夹紧、resize 重夹紧）
8. 文件监听 300ms 防抖生效，关闭面板后 watcher 释放
9. critical 错误只弹一次 toast；Webview 内错误面板**始终**显示解析后绝对路径 + Reload 按钮
10. CSP 无违规（无 `unsafe-inline`、无 CDN、所有 URI 通过 `asWebviewUri`）
11. 主题全部走 `--vscode-*` CSS 变量，无硬编码颜色
12. `git diff --stat` 仅显示预期文件改动；**Codex 桌宠目录无任何变化**

### 反蔓延清单（37 条硬红线）

**不要新增命令 / 设置：**
1. ❌ 不要新增 `cc-pet.openPetPreview` 之外的任何命令
2. ❌ 不要新增 `ccPet.petDirectory` 之外的任何 VS Code 设置
3. ❌ 不要添加 `menus` / `viewsContainers` / `views` / `customEditors` / `keybindings`（GUI 编辑器留阶段 5）
4. ❌ 不要保留 `cc-pet.helloWorld`

**不要扩展 manifest schema（v3 留给阶段 3）：**
5. ❌ 不要解析 pet.json 的 `frameWidth` / `frameHeight` / `rows[]` / `bindings[]`
6. ❌ 不要读 `images/*.png`（终态没这目录，**强约束**）

**不要加渲染 / 交互花活：**
7. ❌ 不要加动画播放（sprite 循环、fps、定时器切换帧）
8. ❌ 不要加键盘快捷键 / 右键菜单 / 鼠标悬停 tooltip
9. ❌ 不要加拖动惯性 / 吸附 / 重力 / 物理
10. ❌ 不要加右键隐藏 / 双击退出 / 滚轮缩放
11. ❌ 不要加图片预加载 / 缓存池 / 离屏 canvas

**不要过度工程：**
12. ❌ 不要引入运行期 npm 依赖（只用 `node:*` + `vscode`）
13. ❌ 不要创建额外子目录（`src/utils/` / `src/commands/` 等）
14. ❌ 不要把 `extension.ts` 写得超过 30 行
15. ❌ 不要做 manifest 版本协商（v2 直接走精简模式）
16. ❌ 不要 WebP header 解析（用 DevTools 实测量 `1536/2288/256/208`，加注释）
17. ❌ 不要做递归 watcher（顶层 `*`）
18. ❌ 不要加重试 / 退避 / 限流
19. ❌ 不要改 `tsconfig.json` / `eslint.config.mjs` / `.vscode-test.mjs` / `.vscodeignore` / `.gitignore` / `.vscode/launch.json`

**不要越界 Codex 目录 / git：**
20. ❌ 不要读 `~/.codex/pets/xiuxiu` 之外的任何用户目录
21. ❌ 不要写 / 改 / 删 / 重命名 / 复制 `~/.codex/pets/xiuxiu` 下任何文件
22. ❌ 不要自动 `git add` / `git commit` / `git push`
23. ❌ 不要改 `README.md` 之外的项目元文件

**不要把范围外功能偷渡进来：**
24. ❌ 不要做 Codex hooks / 状态检测的任何探针
25. ❌ 不要加 Tauri / Electron / 任何桌面窗口相关代码
26. ❌ 不要加 idle / thinking / 任何动画状态切换逻辑
27. ❌ 不要加多 VS Code 窗口协调代码
28. ❌ 不要加 Tauri 进程启动 / 关闭 / IPC 逻辑
29. ❌ 不要让 WebviewPanel 自动随扩展激活打开
30. ❌ 不要加点击 / 悬停 / 右键响应（仅拖动）

**阶段 1 框架限制：**
31. ❌ 不要写任何动作触发 / 帧切换 / 方向判断逻辑
32. ❌ 不要引入文本气泡 / 浮窗 / 任何 UI 元素
33. ❌ 不要重设计 spritesheet.webp
34. ❌ 不要实现 `requestAnimationFrame` 循环
35. ❌ 不要解析 11 行 / 11 事件 / GUI 绑定（阶段 5 才做）
36. ❌ 不要预先加 `pet.json` schema 字段（v3 字段一律不留）
37. ❌ 不要把 `petPreviewPanel.ts` 写成超长文件

### 实施子步骤（每步后内部自检）

1. **Scaffold**：`petPath.ts` + `petAssetLoader.ts` + 类型 → `npm run compile` → `npm run lint` → 自检 DoD 1-3
2. **Tests**：`petPath.test.ts` + `petAssetLoader.test.ts` → `npm run test` → 自检 DoD 3 + 5
3. **Webview assets**：`media/pet.css` + `media/pet.js` → `npm run compile` → 自检 DoD 6-7、10-11
4. **Panel + extension**：`petPreviewPanel.ts` + 改 `extension.ts` + 改 `package.json` → `npm run compile` + `npm run lint` + `npm run test`
5. **交付前自检**：`git diff --stat` + 全文 grep `C:\Users\Lenovo` + Codex 目录 mtime + DoD 12 条 + 反蔓延 37 条逐条审计

## 下一阶段「pet.json v3 + GUI 编辑器」所需数据

阶段 3 升级 pet.json schema：新增 `frameWidth` / `frameHeight` / `rows[]` / `bindings[]` 字段。`spriteVersionNumber` 升 3。

阶段 5 GUI 编辑器：VS Code 左栏 webviewView（非 TreeView），渲染 11 行 + 事件下拉框 + 冲突防护 + 保存到 pet.json。冲突规则：同事件不绑两个动作 / 同动作可绑多事件。

阶段 6 Tauri：复用 `pet-renderer/` 子模块，替换 `acquireVsCodeApi()` polyfill，通过 IPC 接收状态推送。

## 手工验收入口

F5 启动 Extension Development Host → 命令面板执行 `CC Pet: Open Pet Preview` → 验证渲染、拖动、watcher、错误状态、Reload、CSP。详见 plan 文件 §F5 验证步骤。