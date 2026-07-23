import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export type PetConfig = Record<string, unknown>;

export function defaultUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const baseDirectory = env.APPDATA?.trim()
    || env.XDG_CONFIG_HOME?.trim()
    || join(homedir(), '.config');
  return join(baseDirectory, 'CC Pet', 'config.json');
}

/**
 * User-owned configuration store.
 *
 * The packaged pet-config.json is a read-only default. User changes are written
 * atomically outside the extension installation directory so upgrades cannot
 * erase them and the standalone desktop app can share the same settings.
 */
export class UserConfigStore {
  readonly userConfigPath: string;
  readonly profilesDirectory: string;

  constructor(
    private readonly packagedConfigPath: string,
    userConfigPath = defaultUserConfigPath(),
  ) {
    this.userConfigPath = userConfigPath;
    this.profilesDirectory = join(dirname(userConfigPath), 'profiles');
  }

  read(): PetConfig {
    const sourcePath = existsSync(this.userConfigPath)
      ? this.userConfigPath
      : this.packagedConfigPath;
    return JSON.parse(readFileSync(sourcePath, 'utf8')) as PetConfig;
  }

  write(config: PetConfig): void {
    mkdirSync(dirname(this.userConfigPath), { recursive: true });
    const temporaryPath = `${this.userConfigPath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    renameSync(temporaryPath, this.userConfigPath);
  }

  readProfile(folderName: string): PetConfig | null {
    const path = this.profilePath(folderName);
    if (!existsSync(path)) { return null; }
    return JSON.parse(readFileSync(path, 'utf8')) as PetConfig;
  }

  writeProfile(folderName: string, profile: PetConfig): void {
    const path = this.profilePath(folderName);
    mkdirSync(this.profilesDirectory, { recursive: true });
    const temporaryPath = `${path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
    renameSync(temporaryPath, path);
  }

  backupBeforeProfileMigration(): void {
    if (!existsSync(this.userConfigPath)) { return; }
    const backupPath = join(dirname(this.userConfigPath), 'config.v2.backup.json');
    if (!existsSync(backupPath)) { copyFileSync(this.userConfigPath, backupPath); }
  }

  private profilePath(folderName: string): string {
    if (!folderName || basename(folderName) !== folderName || folderName === '.' || folderName === '..') {
      throw new Error(`Invalid pet folder name: ${folderName}`);
    }
    return join(this.profilesDirectory, `${folderName}.json`);
  }
}
