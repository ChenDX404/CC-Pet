import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { defaultUserConfigPath, UserConfigStore } from '../userConfig';

suite('user configuration store', () => {
  let directory: string;

  setup(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-pet-config-'));
  });

  teardown(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('reads packaged defaults until the user saves a configuration', async () => {
    const packagedPath = path.join(directory, 'packaged.json');
    const userPath = path.join(directory, 'user', 'config.json');
    await fs.writeFile(packagedPath, JSON.stringify({ displayScale: 1 }), 'utf8');
    const store = new UserConfigStore(packagedPath, userPath);

    assert.deepStrictEqual(store.read(), { displayScale: 1 });
    store.write({ displayScale: 0.7 });
    assert.deepStrictEqual(store.read(), { displayScale: 0.7 });
    assert.deepStrictEqual(JSON.parse(await fs.readFile(packagedPath, 'utf8')), { displayScale: 1 });
  });

  test('uses the shared Windows application data directory', () => {
    assert.strictEqual(
      defaultUserConfigPath({ APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }),
      path.join('C:\\Users\\test\\AppData\\Roaming', 'CC Pet', 'config.json'),
    );
  });

  test('writes and replaces a profile by pet folder name', async () => {
    const packagedPath = path.join(directory, 'packaged.json');
    const userPath = path.join(directory, 'user', 'config.json');
    await fs.writeFile(packagedPath, '{}', 'utf8');
    const store = new UserConfigStore(packagedPath, userPath);

    store.writeProfile('xiuxiu', { rows: [1] });
    store.writeProfile('xiuxiu', { rows: [2] });

    assert.deepStrictEqual(store.readProfile('xiuxiu'), { rows: [2] });
    assert.throws(() => store.writeProfile('../escaped', {}), /Invalid pet folder name/);
  });
});
