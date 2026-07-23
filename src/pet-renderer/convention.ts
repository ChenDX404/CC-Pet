// pet-renderer/convention.ts
//
// 11 行约定俗成表 + 事件绑定。
// 数据来源：项目根目录 `pet-config.json`。
// 每次创建预览面板时读取一次，面板生命周期内使用同一份配置快照。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ActionDef {
  name: string;
  row: number;
  frames: number;
  speed: number;
}

interface ConfigRow {
  row: number;
  frames: number;
  speed?: number;
  name?: string;
}

export interface ConfigFile {
  colWidth?: number;
  rowHeight?: number;
  rows?: ConfigRow[];
  bindings?: Record<string, string>;
}

export interface ConventionSnapshot {
  readonly colWidth: number;
  readonly rowHeight: number;
  readonly actionTable: ReadonlyArray<ActionDef>;
  readonly bindings: Readonly<Record<string, string>>;
}

export const DEFAULT_COL_WIDTH = 192;
export const DEFAULT_ROW_HEIGHT = 208;

const CONFIG_PATH = join(__dirname, '..', '..', 'pet-config.json');

const ROW_NAMES: Readonly<Record<number, string>> = {
  1: 'idle',
  2: 'running-left',
  3: 'running-right',
  4: 'running',
  5: 'jumping',
  6: 'waving',
  7: 'waiting',
  8: 'review',
  9: 'failed',
  10: 'look-down',
  11: 'ambient',
};

const DEFAULT_BINDINGS: Readonly<Record<string, string>> = {
  'drag-left':   'running-right',
  'drag-right':  'running-left',
  'click':       'look-down',
  'appear':      'waving',
  'cc-working':  'review',
  'cc-complete': 'waving',
};

function buildActionTable(cfg: ConfigFile | null): ReadonlyArray<ActionDef> {
  const rows = cfg?.rows;
  if (rows && rows.length === 11) {
    return rows.map((row) => ({
      name: row.name ?? ROW_NAMES[row.row] ?? `row-${row.row}`,
      row: row.row,
      frames: row.frames,
      speed: normalizeSpeed(row.speed),
    }));
  }

  return Array.from({ length: 11 }, (_, index) => ({
    name: ROW_NAMES[index + 1] ?? `row-${index + 1}`,
    row: index + 1,
    frames: 8,
    speed: 1,
  }));
}

function normalizeSpeed(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { return 1; }
  return Math.round(Math.max(0.5, Math.min(2, value)) * 10) / 10;
}

export function createConventionSnapshot(cfg: ConfigFile | null): ConventionSnapshot {
  return {
    colWidth: cfg?.colWidth ?? DEFAULT_COL_WIDTH,
    rowHeight: cfg?.rowHeight ?? DEFAULT_ROW_HEIGHT,
    actionTable: buildActionTable(cfg),
    bindings: { ...(cfg?.bindings ?? DEFAULT_BINDINGS) },
  };
}

/** 读取一份新的配置快照；文件缺失或解析失败时使用内置默认值。 */
export function loadConventionSnapshot(configPath: string = CONFIG_PATH): ConventionSnapshot {
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
    return createConventionSnapshot(cfg);
  } catch {
    return createConventionSnapshot(null);
  }
}
