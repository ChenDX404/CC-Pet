import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src-tauri', 'target', 'release', 'cc-pet.exe');
const destination = join(root, 'bin', 'win32-x64', 'cc-pet.exe');
const releasesDirectory = join(root, 'releases');

if (!existsSync(source)) {
  throw new Error(`Desktop executable is missing: ${source}`);
}
mkdirSync(dirname(destination), { recursive: true });
mkdirSync(releasesDirectory, { recursive: true });
copyFileSync(source, destination);
