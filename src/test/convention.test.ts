import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadConventionSnapshot } from '../pet-renderer/convention';

suite('pet-renderer convention snapshot', () => {
  let dir: string;
  let configPath: string;

  setup(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-pet-convention-'));
    configPath = path.join(dir, 'pet-config.json');
  });

  teardown(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('each load reads a fresh snapshot from disk', async () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      row: index + 1,
      frames: 4,
      speed: 1.5,
    }));
    await fs.writeFile(configPath, JSON.stringify({ colWidth: 100, rows }), 'utf8');

    const first = loadConventionSnapshot(configPath);
    assert.strictEqual(first.colWidth, 100);
    assert.strictEqual(first.actionTable[0]?.frames, 4);
    assert.strictEqual(first.actionTable[0]?.speed, 1.5);

    await fs.writeFile(
      configPath,
      JSON.stringify({ colWidth: 120, rows: rows.map((row) => ({ ...row, frames: 6, speed: 0.7 })) }),
      'utf8',
    );

    const second = loadConventionSnapshot(configPath);
    assert.strictEqual(second.colWidth, 120);
    assert.strictEqual(second.actionTable[0]?.frames, 6);
    assert.strictEqual(second.actionTable[0]?.speed, 0.7);
    assert.strictEqual(first.colWidth, 100);
    assert.strictEqual(first.actionTable[0]?.frames, 4);
  });

  test('missing config falls back to built-in defaults', () => {
    const snapshot = loadConventionSnapshot(configPath);
    assert.strictEqual(snapshot.colWidth, 192);
    assert.strictEqual(snapshot.rowHeight, 208);
    assert.strictEqual(snapshot.actionTable.length, 11);
    assert.strictEqual(snapshot.actionTable[0]?.speed, 1);
    assert.strictEqual(snapshot.bindings['click'], 'look-down');
  });
});
