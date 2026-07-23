// pet-renderer/index.ts
//
// VS Code GUI 与 Tauri 桌面端共享的动作配置入口。
export {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  createConventionSnapshot,
  loadConventionSnapshot,
} from './convention';
export type { ActionDef, ConfigFile, ConventionSnapshot } from './convention';
