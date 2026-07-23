import type { PetCatalogEntry, PetCatalogSnapshot } from './petCatalog';
import { UserConfigStore, type PetConfig } from './userConfig';

export interface PetActionRow {
  row: number;
  frames: number;
  speed: number;
  name?: string;
}

export interface PetProfile {
  spriteVersionNumber: 1 | 2;
  rows: PetActionRow[];
  bindings: Record<string, string>;
}

export interface LoadedPetConfiguration {
  globalConfig: PetConfig;
  effectiveConfig: PetConfig;
}

interface StoredProfile {
  spriteVersionNumber?: unknown;
  rows?: unknown;
  bindings?: unknown;
}

const ROW_NAMES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
  'look-directions-a',
  'look-directions-b',
] as const;

const FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8] as const;

const DEFAULT_BINDINGS: Readonly<Record<string, string>> = {
  'drag-left': 'row-3',
  'drag-right': 'row-2',
  click: 'row-4',
  hover: 'row-9',
  appear: 'row-4',
  'idle-loop': 'row-1',
  'cc-working': 'row-8',
  'cc-complete': 'row-4',
};

export function conventionalRowName(row: number): string {
  return ROW_NAMES[row - 1] ?? `row-${row}`;
}

export function selectPet(config: PetConfig, catalog: PetCatalogSnapshot): PetCatalogEntry | undefined {
  const selectedFolder = typeof config.selectedPetFolder === 'string' ? config.selectedPetFolder : '';
  const byFolder = catalog.pets.find((pet) => pet.folderName === selectedFolder);
  if (byFolder) { return byFolder; }
  const selectedId = typeof config.selectedPetId === 'string' ? config.selectedPetId : '';
  return catalog.pets.find((pet) => pet.id === selectedId) ?? catalog.pets[0];
}

export function resolvePetProfile(
  config: PetConfig,
  catalog: PetCatalogSnapshot,
  pet: PetCatalogEntry,
): PetProfile {
  const profiles = isRecord(config.petProfiles) ? config.petProfiles : {};
  const storedValue = profiles[pet.folderName] ?? profiles[pet.id];
  const stored = isRecord(storedValue) ? storedValue as StoredProfile : undefined;
  if (stored) { return normalizeProfile(stored, pet); }

  const legacyRows = Array.isArray(config.rows) ? config.rows : undefined;
  const legacyOwner = legacyProfileOwner(config, catalog, legacyRows?.length ?? 0);
  if (legacyRows && legacyOwner?.id === pet.id) {
    return normalizeProfile({ rows: legacyRows, bindings: config.bindings }, pet);
  }
  return defaultPetProfile(pet);
}

export function loadPetConfiguration(
  store: UserConfigStore,
  catalog: PetCatalogSnapshot,
): LoadedPetConfiguration {
  const original = store.read();
  const needsMigration = original.configVersion !== 3;
  if (needsMigration) { store.backupBeforeProfileMigration(); }

  for (const pet of catalog.pets) {
    if (store.readProfile(pet.folderName)) { continue; }
    const profile = resolvePetProfile(original, catalog, pet);
    store.writeProfile(pet.folderName, profileDocument(pet, profile));
  }

  let globalConfig = original;
  if (needsMigration) {
    globalConfig = { ...original, configVersion: 3 };
    for (const key of ['rows', 'bindings', 'petProfiles', 'spriteVersionNumber', 'sheetWidth', 'sheetHeight', 'colWidth', 'rowHeight']) {
      delete globalConfig[key];
    }
    store.write(globalConfig);
  }

  const selected = selectPet(globalConfig, catalog);
  if (selected && globalConfig.selectedPetFolder !== selected.folderName) {
    globalConfig = {
      ...globalConfig,
      selectedPetFolder: selected.folderName,
      selectedPetId: selected.id,
    };
    store.write(globalConfig);
  }

  const profiles: Record<string, unknown> = {};
  for (const pet of catalog.pets) {
    const stored = store.readProfile(pet.folderName);
    const profile = stored
      ? normalizeProfile({ rows: stored.rows, bindings: stored.bindings }, pet)
      : defaultPetProfile(pet);
    profiles[pet.folderName] = profile;
    const storedRows = Array.isArray(stored?.rows) ? stored.rows.length : 0;
    if (stored && (stored.spriteVersionNumber !== pet.spriteVersionNumber || storedRows !== pet.rowCount)) {
      store.writeProfile(pet.folderName, profileDocument(pet, profile));
    }
  }
  return {
    globalConfig,
    effectiveConfig: { ...globalConfig, petProfiles: profiles },
  };
}

export function defaultPetProfile(pet: PetCatalogEntry): PetProfile {
  return {
    spriteVersionNumber: pet.spriteVersionNumber,
    rows: Array.from({ length: pet.rowCount }, (_, index) => ({
      row: index + 1,
      frames: FRAME_COUNTS[index] ?? 1,
      speed: 1,
    })),
    bindings: { ...DEFAULT_BINDINGS },
  };
}

export function savePetProfile(
  config: PetConfig,
  pet: PetCatalogEntry,
  rawRows: unknown,
  rawBindings: unknown,
): PetConfig {
  const profile = normalizeProfile({ rows: rawRows, bindings: rawBindings }, pet);
  const existingProfiles = isRecord(config.petProfiles) ? config.petProfiles : {};
  return {
    ...config,
    configVersion: 2,
    petProfiles: {
      ...existingProfiles,
      [pet.id]: profile,
    },
  };
}

export function createStoredPetProfile(
  pet: PetCatalogEntry,
  rawRows: unknown,
  rawBindings: unknown,
): PetConfig {
  return profileDocument(pet, normalizeProfile({ rows: rawRows, bindings: rawBindings }, pet));
}

export function buildRuntimeConfig(
  config: PetConfig,
  catalog: PetCatalogSnapshot,
  pet: PetCatalogEntry,
): PetConfig {
  const profile = resolvePetProfile(config, catalog, pet);
  return {
    ...config,
    selectedPetId: pet.id,
    selectedPetFolder: pet.folderName,
    spriteVersionNumber: pet.spriteVersionNumber,
    sheetWidth: pet.sheetWidth,
    sheetHeight: pet.sheetHeight,
    colWidth: pet.columnWidth,
    rowHeight: pet.rowHeight,
    rows: profile.rows,
    bindings: profile.bindings,
  };
}

function normalizeProfile(profile: StoredProfile, pet: PetCatalogEntry): PetProfile {
  const defaults = defaultPetProfile(pet);
  const sourceRows = Array.isArray(profile.rows) ? profile.rows : [];
  const rows = defaults.rows.map((fallback, index) => {
    const raw = sourceRows[index];
    const value = isRecord(raw) ? raw : {};
    const row = index + 1;
    // GUI rows carry the editable value in `_userName`; `name` is the
    // previously resolved display name and can therefore be stale.
    const editedName = typeof value._userName === 'string' ? value._userName.trim() : undefined;
    const name = editedName ?? (typeof value.name === 'string' ? value.name.trim() : '');
    return {
      row,
      frames: normalizeInteger(value.frames, fallback.frames, 1, 8),
      speed: normalizeSpeed(value.speed),
      ...(name ? { name } : {}),
    };
  });
  return {
    spriteVersionNumber: pet.spriteVersionNumber,
    rows,
    bindings: normalizeBindings(profile.bindings, rows, defaults.bindings),
  };
}

function profileDocument(pet: PetCatalogEntry, profile: PetProfile): PetConfig {
  return {
    schemaVersion: 1,
    petId: pet.id,
    folderName: pet.folderName,
    spriteVersionNumber: pet.spriteVersionNumber,
    rows: profile.rows,
    bindings: profile.bindings,
  };
}

function normalizeBindings(
  rawBindings: unknown,
  rows: PetActionRow[],
  fallback: Record<string, string>,
): Record<string, string> {
  if (!isRecord(rawBindings)) { return { ...fallback }; }
  const result: Record<string, string> = {};
  for (const [eventName, rawTarget] of Object.entries(rawBindings)) {
    if (typeof rawTarget !== 'string') { continue; }
    const directMatch = /^row-(\d+)$/.exec(rawTarget);
    if (directMatch) {
      const rowNumber = Number(directMatch[1]);
      if (rowNumber >= 1 && rowNumber <= rows.length) { result[eventName] = `row-${rowNumber}`; }
      continue;
    }
    const matched = rows.find((row) => row.name === rawTarget || conventionalRowName(row.row) === rawTarget);
    if (matched) { result[eventName] = `row-${matched.row}`; }
  }
  return result;
}

function legacyProfileOwner(
  config: PetConfig,
  catalog: PetCatalogSnapshot,
  legacyRowCount: number,
): PetCatalogEntry | undefined {
  if (legacyRowCount !== 9 && legacyRowCount !== 11) { return undefined; }
  const selected = selectPet(config, catalog);
  if (selected?.rowCount === legacyRowCount) { return selected; }
  const xiuxiu = catalog.pets.find((pet) => pet.id === 'xiuxiu' && pet.rowCount === legacyRowCount);
  return xiuxiu ?? catalog.pets.find((pet) => pet.rowCount === legacyRowCount);
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) { return fallback; }
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function normalizeSpeed(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) { return 1; }
  return Math.round(Math.max(0.5, Math.min(2, numeric)) * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
