import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { broadcastIPC } from './petIPC';
import { scanPetCatalog, type PetCatalogEntry, type PetCatalogSnapshot } from './petCatalog';
import {
  buildRuntimeConfig,
  createStoredPetProfile,
  conventionalRowName,
  loadPetConfiguration,
  resolvePetProfile,
  selectPet,
} from './petProfiles';
import { UserConfigStore, type PetConfig } from './userConfig';

export class PetBindingViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configStore: UserConfigStore,
    private readonly onPetSelectionChanged: () => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.html();
    webviewView.webview.onDidReceiveMessage((message: Record<string, unknown>) => {
      if (message.type === 'ready') { this.pushConfig(); }
      else if (message.type === 'save') { this.saveConfig(message.rows, message.bindings); }
      else if (message.type === 'toggle-desktop') {
        void vscode.workspace.getConfiguration('ccPet').update('autoLaunchDesktop', !!message.value, true);
      } else if (message.type === 'preview-scale') {
        broadcastIPC({ type: 'scale-preview', scale: normalizeDisplayScale(message.value) });
      } else if (message.type === 'save-scale') {
        this.saveDisplayScale(message.value);
      } else if (message.type === 'save-pets-root') {
        void this.savePetsRoot(message.value);
      } else if (message.type === 'browse-pets-root') {
        void this.browsePetsRoot();
      } else if (message.type === 'refresh-pets') {
        this.pushConfig();
        this.onPetSelectionChanged();
      } else if (message.type === 'select-pet') {
        this.saveSelectedPet(message.value);
      }
    });
  }

  refreshPetCatalog(): void {
    this.pushConfig();
  }

  private pushConfig(): void {
    const context = this.readPetContext();
    const selectedPet = context.selectedPet;
    const profile = selectedPet
      ? resolvePetProfile(context.config, context.catalog, selectedPet)
      : undefined;
    const rows = profile?.rows.map((row) => ({
      name: row.name ?? conventionalRowName(row.row),
      row: row.row,
      frames: row.frames,
      speed: row.speed,
      _convName: conventionalRowName(row.row),
      _defaultName: conventionalRowName(row.row),
      _userName: row.name ?? '',
    })) ?? [];
    const autoLaunch = vscode.workspace.getConfiguration('ccPet').get<boolean>('autoLaunchDesktop') ?? true;
    this.view?.webview.postMessage({
      type: 'init',
      rows,
      bindings: profile?.bindings ?? {},
      autoLaunch,
      displayScale: normalizeDisplayScale(context.config.displayScale),
      petFormat: selectedPet ? petFormat(selectedPet) : null,
      petCatalog: {
        rootDirectory: context.catalog.rootDirectory,
        automatic: context.catalog.automatic,
        exists: context.catalog.exists,
        selectedPetId: selectedPet?.folderName ?? '',
        pets: context.catalog.pets.map((pet) => ({
          id: pet.id,
          folderName: pet.folderName,
          displayName: pet.displayName,
          spriteVersionNumber: pet.spriteVersionNumber,
          rowCount: pet.rowCount,
        })),
        warnings: context.catalog.warnings,
      },
    });
  }

  private readPetContext(): {
    globalConfig: PetConfig;
    config: PetConfig;
    catalog: PetCatalogSnapshot;
    selectedPet: PetCatalogEntry | undefined;
  } {
    const rawConfig = this.configStore.read();
    const legacyRoot = vscode.workspace.getConfiguration('ccPet').get<string>('petsRootDirectory');
    const configuredRoot = typeof rawConfig.petsRootDirectory === 'string'
      ? rawConfig.petsRootDirectory
      : legacyRoot;
    const catalog = scanPetCatalog(configuredRoot);
    const loaded = loadPetConfiguration(this.configStore, catalog);
    return {
      globalConfig: loaded.globalConfig,
      config: loaded.effectiveConfig,
      catalog,
      selectedPet: selectPet(loaded.effectiveConfig, catalog),
    };
  }

  private runtimeConfig(context: ReturnType<PetBindingViewProvider['readPetContext']>): PetConfig {
    return context.selectedPet
      ? buildRuntimeConfig(context.config, context.catalog, context.selectedPet)
      : context.config;
  }

  private saveDisplayScale(rawValue: unknown): void {
    try {
      const context = this.readPetContext();
      context.globalConfig.displayScale = normalizeDisplayScale(rawValue);
      context.config.displayScale = context.globalConfig.displayScale;
      this.configStore.write(context.globalConfig);
      broadcastIPC({ type: 'config-update', config: this.runtimeConfig(context) });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `CC Pet: 人物大小保存失败 — ${error instanceof Error ? error.message : String(error)}`
      );
      this.pushConfig();
    }
  }

  private async savePetsRoot(rawValue: unknown): Promise<void> {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    try {
      const config = this.configStore.read();
      config.petsRootDirectory = value;
      this.configStore.write(config);
      this.pushConfig();
      this.onPetSelectionChanged();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `CC Pet: 人物根目录保存失败 — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async browsePetsRoot(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '选择 Codex pets 根目录',
    });
    if (selected?.[0]) { await this.savePetsRoot(selected[0].fsPath); }
  }

  private saveSelectedPet(rawValue: unknown): void {
    const petFolder = typeof rawValue === 'string' ? rawValue : '';
    const context = this.readPetContext();
    const selectedPet = context.catalog.pets.find((pet) => pet.folderName === petFolder);
    if (!selectedPet) {
      void vscode.window.showErrorMessage('CC Pet: 选择的人物不存在、图片尺寸不兼容或配置无效');
      this.pushConfig();
      return;
    }
    try {
      context.globalConfig.selectedPetFolder = selectedPet.folderName;
      context.globalConfig.selectedPetId = selectedPet.id;
      context.config.selectedPetFolder = selectedPet.folderName;
      context.config.selectedPetId = selectedPet.id;
      this.configStore.write(context.globalConfig);
      const runtime = buildRuntimeConfig(context.config, context.catalog, selectedPet);
      broadcastIPC({ type: 'config-update', config: runtime });
      this.onPetSelectionChanged();
      this.pushConfig();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `CC Pet: 人物选择保存失败 — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private saveConfig(rawRows: unknown, rawBindings: unknown): void {
    try {
      const context = this.readPetContext();
      if (!context.selectedPet) { throw new Error('当前没有可配置的人物'); }
      const profile = createStoredPetProfile(context.selectedPet, rawRows, rawBindings);
      this.configStore.writeProfile(context.selectedPet.folderName, profile);
      const reloaded = loadPetConfiguration(this.configStore, context.catalog);
      const runtime = buildRuntimeConfig(reloaded.effectiveConfig, context.catalog, context.selectedPet);
      this.view?.webview.postMessage({ type: 'saved' });
      void vscode.window.showInformationMessage(`CC Pet: 已保存 ${context.selectedPet.displayName} 的独立配置`);
      broadcastIPC({ type: 'config-update', config: runtime });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `CC Pet: 保存失败 — ${error instanceof Error ? error.message : String(error)}`
      );
      this.pushConfig();
    }
  }

  private html(): string {
    const webview = this.view!.webview;
    const nonce = randomBytes(16).toString('base64');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'pet-binding.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'pet-binding.js'));
    const templatePath = vscode.Uri.joinPath(this.extensionUri, 'media', 'pet-binding-vscode.html').fsPath;
    return readFileSync(templatePath, 'utf8')
      .replace('${cspMeta}', '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' + webview.cspSource + '; script-src \'nonce-' + nonce + '\';">')
      .replace('${cssUri}', cssUri.toString())
      .replace('${hostScript}', '')
      .replace('${nonceAttribute}', 'nonce="' + nonce + '"')
      .replace('${jsUri}', jsUri.toString());
  }
}

function petFormat(pet: PetCatalogEntry): Record<string, number | string> {
  return {
    version: pet.spriteVersionNumber,
    rowCount: pet.rowCount,
    sheetWidth: pet.sheetWidth,
    sheetHeight: pet.sheetHeight,
    label: `v${pet.spriteVersionNumber} · ${pet.rowCount} 行 · ${pet.sheetWidth}×${pet.sheetHeight}`,
  };
}

function normalizeDisplayScale(value: unknown): number {
  const scale = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(scale)) { return 1; }
  return Math.round(Math.max(0.5, Math.min(1.5, scale)) * 100) / 100;
}
