import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PetCatalogEntry, PetCatalogSnapshot } from '../petCatalog';
import {
  buildRuntimeConfig,
  createStoredPetProfile,
  loadPetConfiguration,
  resolvePetProfile,
  savePetProfile,
  selectPet,
} from '../petProfiles';
import { UserConfigStore } from '../userConfig';

function pet(id: string, version: 1 | 2): PetCatalogEntry {
  return {
    id,
    folderName: id,
    displayName: id,
    directory: id,
    spritePath: `${id}.webp`,
    spriteVersionNumber: version,
    sheetWidth: 1536,
    sheetHeight: version === 2 ? 2288 : 1872,
    columnWidth: 192,
    rowHeight: 208,
    rowCount: version === 2 ? 11 : 9,
  };
}

suite('per-pet profiles', () => {
  const legacy = pet('doraemon', 1);
  const modern = pet('xiuxiu', 2);
  const catalog: PetCatalogSnapshot = {
    rootDirectory: 'pets',
    automatic: true,
    exists: true,
    pets: [legacy, modern],
    warnings: [],
  };

  test('keeps an old 11-row global configuration with the compatible xiuxiu pet', () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      row: index + 1,
      frames: index === 0 ? 7 : 8,
      speed: 1,
      name: `custom-${index + 1}`,
    }));
    const config = {
      selectedPetId: 'doraemon',
      rows,
      bindings: { click: 'custom-5' },
    };

    const oldProfile = resolvePetProfile(config, catalog, legacy);
    const modernProfile = resolvePetProfile(config, catalog, modern);

    assert.strictEqual(oldProfile.rows.length, 9);
    assert.strictEqual(oldProfile.rows[0].frames, 6);
    assert.strictEqual(modernProfile.rows.length, 11);
    assert.strictEqual(modernProfile.rows[0].frames, 7);
    assert.strictEqual(modernProfile.bindings.click, 'row-5');
  });

  test('saves and resolves independent profiles by pet id', () => {
    const base = { selectedPetId: 'doraemon', displayScale: 0.7 };
    const doraemonRows = resolvePetProfile(base, catalog, legacy).rows;
    doraemonRows[0] = { ...doraemonRows[0], frames: 5, name: 'sleepy' };
    const updated = savePetProfile(base, legacy, doraemonRows, { click: 'row-1' });

    const doraemonRuntime = buildRuntimeConfig(updated, catalog, legacy);
    const xiuxiuRuntime = buildRuntimeConfig(updated, catalog, modern);

    assert.strictEqual((doraemonRuntime.rows as unknown[]).length, 9);
    assert.strictEqual(doraemonRuntime.sheetHeight, 1872);
    assert.strictEqual((xiuxiuRuntime.rows as unknown[]).length, 11);
    assert.strictEqual(xiuxiuRuntime.sheetHeight, 2288);
    assert.notDeepStrictEqual(doraemonRuntime.rows, xiuxiuRuntime.rows);
  });

  test('uses the folder name as the stable selection key', () => {
    const aqua = { ...pet('aqua', 1), folderName: 'aqua-2' };
    const folderCatalog = { ...catalog, pets: [aqua] };

    assert.strictEqual(selectPet({ selectedPetFolder: 'aqua-2', selectedPetId: 'wrong' }, folderCatalog)?.id, 'aqua');
  });

  test('persists the edited GUI action name when a pet is selected again', () => {
    const guiRows = resolvePetProfile({}, catalog, modern).rows.map((row) => ({
      ...row,
      name: `resolved-${row.row}`,
      _userName: row.row === 1 ? 'my-idle' : '',
    }));

    const stored = createStoredPetProfile(modern, guiRows, { 'idle-loop': 'row-1' });
    const reloaded = resolvePetProfile(
      { petProfiles: { [modern.folderName]: stored } },
      catalog,
      modern,
    );

    assert.strictEqual(reloaded.rows[0].name, 'my-idle');
    assert.strictEqual(reloaded.rows[1].name, undefined);
  });

  test('migrates legacy settings into one physical file per pet folder', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-pet-profile-migration-'));
    try {
      const packaged = path.join(directory, 'packaged.json');
      const user = path.join(directory, 'user', 'config.json');
      const legacyRows = Array.from({ length: 11 }, (_, index) => ({
        row: index + 1,
        frames: index === 0 ? 7 : 8,
        speed: 1,
        name: `xiuxiu-${index + 1}`,
      }));
      await fs.mkdir(path.dirname(user), { recursive: true });
      await fs.writeFile(packaged, '{}', 'utf8');
      await fs.writeFile(user, JSON.stringify({
        selectedPetId: 'doraemon',
        displayScale: 0.7,
        rows: legacyRows,
        bindings: { click: 'xiuxiu-5' },
      }), 'utf8');
      const store = new UserConfigStore(packaged, user);

      const loaded = loadPetConfiguration(store, catalog);

      assert.strictEqual(loaded.globalConfig.configVersion, 3);
      assert.strictEqual(loaded.globalConfig.rows, undefined);
      assert.strictEqual(loaded.globalConfig.bindings, undefined);
      assert.strictEqual((store.readProfile('doraemon')?.rows as unknown[]).length, 9);
      assert.strictEqual((store.readProfile('xiuxiu')?.rows as Array<{ frames: number }>)[0].frames, 7);
      assert.strictEqual((store.readProfile('xiuxiu')?.bindings as Record<string, string>).click, 'row-5');
      await fs.access(path.join(directory, 'user', 'config.v2.backup.json'));
      await fs.access(path.join(directory, 'user', 'profiles', 'doraemon.json'));
      await fs.access(path.join(directory, 'user', 'profiles', 'xiuxiu.json'));
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
