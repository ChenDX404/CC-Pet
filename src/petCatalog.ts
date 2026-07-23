import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

export interface PetCatalogEntry {
  id: string;
  folderName: string;
  displayName: string;
  directory: string;
  spritePath: string;
  spriteVersionNumber: 1 | 2;
  sheetWidth: number;
  sheetHeight: number;
  columnWidth: 192;
  rowHeight: 208;
  rowCount: 9 | 11;
}

export interface PetCatalogSnapshot {
  rootDirectory: string;
  automatic: boolean;
  exists: boolean;
  pets: PetCatalogEntry[];
  warnings: string[];
}

interface PetManifest {
  id?: unknown;
  displayName?: unknown;
  spritesheetPath?: unknown;
  spriteVersionNumber?: unknown;
}

const SHEET_WIDTH = 1536;
const COLUMN_WIDTH = 192;
const ROW_HEIGHT = 208;
const V1_HEIGHT = 1872;
const V2_HEIGHT = 2288;

export function defaultPetsRoot(): string {
  return join(homedir(), '.codex', 'pets');
}

export function resolvePetsRoot(configuredRoot: string | undefined): { path: string; automatic: boolean } {
  const trimmed = configuredRoot?.trim() ?? '';
  if (!trimmed) { return { path: defaultPetsRoot(), automatic: true }; }
  const expanded = trimmed === '~'
    ? homedir()
    : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? join(homedir(), trimmed.slice(2))
      : trimmed;
  return { path: resolve(expanded), automatic: false };
}

export function scanPetCatalog(configuredRoot?: string): PetCatalogSnapshot {
  const root = resolvePetsRoot(configuredRoot);
  const snapshot: PetCatalogSnapshot = {
    rootDirectory: root.path,
    automatic: root.automatic,
    exists: false,
    pets: [],
    warnings: [],
  };
  if (!existsSync(root.path)) { return snapshot; }

  let directories;
  try {
    directories = readdirSync(root.path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    snapshot.exists = true;
  } catch (error) {
    snapshot.warnings.push(`无法读取目录：${error instanceof Error ? error.message : String(error)}`);
    return snapshot;
  }

  for (const directoryEntry of directories) {
    const petDirectory = join(root.path, directoryEntry.name);
    const manifestPath = join(petDirectory, 'pet.json');
    if (!existsSync(manifestPath)) {
      snapshot.warnings.push(`${directoryEntry.name}：缺少 pet.json`);
      continue;
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PetManifest;
      const spriteRelative = typeof manifest.spritesheetPath === 'string'
        ? manifest.spritesheetPath.trim()
        : '';
      if (!spriteRelative) { throw new Error('pet.json 缺少 spritesheetPath'); }
      const spritePath = resolve(petDirectory, spriteRelative);
      const relativeSprite = relative(petDirectory, spritePath);
      if (relativeSprite.startsWith('..') || isAbsolute(relativeSprite)) {
        throw new Error('spritesheetPath 不能指向人物目录之外');
      }
      if (!existsSync(spritePath) || !statSync(spritePath).isFile()) {
        throw new Error(`找不到精灵文件 ${spriteRelative}`);
      }
      const dimensions = readImageDimensions(readFileSync(spritePath));
      const layout = classifyLayout(dimensions.width, dimensions.height, manifest.spriteVersionNumber);
      snapshot.pets.push({
        id: typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : directoryEntry.name,
        folderName: directoryEntry.name,
        displayName: typeof manifest.displayName === 'string' && manifest.displayName.trim()
          ? manifest.displayName.trim()
          : directoryEntry.name,
        directory: petDirectory,
        spritePath,
        ...layout,
      });
    } catch (error) {
      snapshot.warnings.push(
        `${directoryEntry.name}：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return snapshot;
}

function classifyLayout(
  width: number,
  height: number,
  declaredVersion: unknown,
): Pick<PetCatalogEntry, 'spriteVersionNumber' | 'sheetWidth' | 'sheetHeight' | 'columnWidth' | 'rowHeight' | 'rowCount'> {
  if (width !== SHEET_WIDTH || (height !== V1_HEIGHT && height !== V2_HEIGHT)) {
    throw new Error(`精灵图尺寸 ${width}×${height} 不兼容，需要 1536×1872 或 1536×2288`);
  }
  const actualVersion: 1 | 2 = height === V2_HEIGHT ? 2 : 1;
  if (declaredVersion !== undefined && declaredVersion !== actualVersion) {
    throw new Error(`spriteVersionNumber=${String(declaredVersion)} 与图片实际 v${actualVersion} 不一致`);
  }
  return {
    spriteVersionNumber: actualVersion,
    sheetWidth: SHEET_WIDTH,
    sheetHeight: height,
    columnWidth: COLUMN_WIDTH,
    rowHeight: ROW_HEIGHT,
    rowCount: actualVersion === 2 ? 11 : 9,
  };
}

export function readImageDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  const signature = buffer.subarray(0, 6).toString('ascii');
  if (buffer.length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a')) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return readWebpDimensions(buffer);
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return readJpegDimensions(buffer);
  }
  throw new Error('无法读取精灵图片尺寸');
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (chunkType === 'VP8X' && data + 10 <= buffer.length) {
      return { width: 1 + buffer.readUIntLE(data + 4, 3), height: 1 + buffer.readUIntLE(data + 7, 3) };
    }
    if (chunkType === 'VP8 ' && data + 10 <= buffer.length && buffer.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff };
    }
    if (chunkType === 'VP8L' && data + 5 <= buffer.length && buffer[data] === 0x2f) {
      const b1 = buffer[data + 1];
      const b2 = buffer[data + 2];
      const b3 = buffer[data + 3];
      const b4 = buffer[data + 4];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }
    offset = data + chunkSize + (chunkSize % 2);
  }
  throw new Error('WebP 缺少可识别的尺寸信息');
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (startOfFrame.has(marker) && offset + 9 <= buffer.length) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    if (length < 2) { break; }
    offset += 2 + length;
  }
  throw new Error('JPEG 缺少可识别的尺寸信息');
}

export function spriteMimeType(spritePath: string): string | null {
  switch (extname(spritePath).toLowerCase()) {
    case '.webp': return 'image/webp';
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return null;
  }
}
