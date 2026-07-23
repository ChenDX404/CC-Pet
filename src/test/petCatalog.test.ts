import * as assert from 'node:assert';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImageDimensions, scanPetCatalog } from '../petCatalog';

suite('pet catalog discovery', () => {
  let root: string;

  setup(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'cc-pet-catalog-'));
  });

  teardown(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function webpHeader(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(30);
    buffer.write('RIFF', 0, 'ascii');
    buffer.write('WEBP', 8, 'ascii');
    buffer.write('VP8X', 12, 'ascii');
    buffer.writeUInt32LE(10, 16);
    buffer.writeUIntLE(width - 1, 24, 3);
    buffer.writeUIntLE(height - 1, 27, 3);
    return buffer;
  }

  async function createPet(
    folder: string,
    id: string,
    displayName: string,
    height = 1872,
    declaredVersion?: number,
  ): Promise<void> {
    const directory = join(root, folder);
    await fs.mkdir(directory);
    await fs.writeFile(join(directory, 'spritesheet.webp'), webpHeader(1536, height));
    await fs.writeFile(
      join(directory, 'pet.json'),
      JSON.stringify({ id, displayName, spritesheetPath: 'spritesheet.webp', ...(declaredVersion ? { spriteVersionNumber: declaredVersion } : {}) }),
      'utf8',
    );
  }

  test('finds every valid first-level pet folder in name order', async () => {
    await createPet('zeta', 'zeta-id', 'Zeta');
    await createPet('alpha', 'alpha-id', 'Alpha');

    const catalog = scanPetCatalog(root);

    assert.strictEqual(catalog.exists, true);
    assert.strictEqual(catalog.automatic, false);
    assert.deepStrictEqual(catalog.pets.map((pet) => pet.folderName), ['alpha', 'zeta']);
    assert.deepStrictEqual(catalog.pets.map((pet) => pet.id), ['alpha-id', 'zeta-id']);
    assert.deepStrictEqual(catalog.pets.map((pet) => pet.rowCount), [9, 9]);
  });

  test('detects v1 and v2 from real image dimensions', async () => {
    await createPet('legacy', 'legacy', 'Legacy', 1872);
    await createPet('modern', 'modern', 'Modern', 2288, 2);

    const catalog = scanPetCatalog(root);

    assert.deepStrictEqual(
      catalog.pets.map((pet) => [pet.id, pet.spriteVersionNumber, pet.sheetHeight, pet.rowCount]),
      [['legacy', 1, 1872, 9], ['modern', 2, 2288, 11]],
    );
    assert.deepStrictEqual(readImageDimensions(webpHeader(1536, 2288)), { width: 1536, height: 2288 });
  });

  test('rejects a manifest version that contradicts the image', async () => {
    await createPet('mismatch', 'mismatch', 'Mismatch', 1872, 2);

    const catalog = scanPetCatalog(root);

    assert.strictEqual(catalog.pets.length, 0);
    assert.match(catalog.warnings[0], /spriteVersionNumber=2/);
  });

  test('ignores invalid manifests and sprites outside the pet folder', async () => {
    const missing = join(root, 'missing');
    const escaped = join(root, 'escaped');
    await fs.mkdir(missing);
    await fs.mkdir(escaped);
    await fs.writeFile(join(missing, 'pet.json'), JSON.stringify({ id: 'missing' }), 'utf8');
    await fs.writeFile(
      join(escaped, 'pet.json'),
      JSON.stringify({ id: 'escaped', spritesheetPath: '../outside.webp' }),
      'utf8',
    );
    await fs.writeFile(join(root, 'outside.webp'), Buffer.from([1]));

    const catalog = scanPetCatalog(root);

    assert.strictEqual(catalog.pets.length, 0);
    assert.strictEqual(catalog.warnings.length, 2);
  });
});
