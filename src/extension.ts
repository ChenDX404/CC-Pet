import * as vscode from 'vscode';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { PetBindingViewProvider } from './petBindingView';
import { CCStatusDetector, type CCState } from './ccStatusDetector';
import { broadcastIPC, getIPCServer, startIPC, stopIPC } from './petIPC';
import { scanPetCatalog, spriteMimeType } from './petCatalog';
import { buildRuntimeConfig, loadPetConfiguration, selectPet } from './petProfiles';
import { UserConfigStore, type PetConfig } from './userConfig';

let tauriProcess: ChildProcess | null = null;
let ccDetector: CCStatusDetector | null = null;
let currentCcState: CCState = 'idle';
let lastReplyText = '';
let currentWorkingPrompt = '';
let workingTurnToken = 0;
let ipcPort = 0;
let assetCache: { path: string; mtimeMs: number; dataUrl: string } | null = null;

function shouldAutoLaunch(): boolean {
  return vscode.workspace.getConfiguration('ccPet').get<boolean>('autoLaunchDesktop') ?? true;
}

function readPetConfig(configStore: UserConfigStore): PetConfig | null {
  try {
    return configStore.read();
  } catch (error) {
    console.error('[CC Pet] Failed to read pet-config.json:', error);
    return null;
  }
}

function resolveRuntimeConfig(configStore: UserConfigStore): {
  config: PetConfig | null;
  runtimeConfig: PetConfig | null;
  selected: ReturnType<typeof selectPet>;
} {
  const config = readPetConfig(configStore);
  if (!config) { return { config: null, runtimeConfig: null, selected: undefined }; }
  const legacyRoot = vscode.workspace.getConfiguration('ccPet').get<string>('petsRootDirectory');
  const configuredRoot = typeof config.petsRootDirectory === 'string'
    ? config.petsRootDirectory
    : legacyRoot;
  const catalog = scanPetCatalog(configuredRoot);
  const loaded = loadPetConfiguration(configStore, catalog);
  const selected = selectPet(loaded.effectiveConfig, catalog);
  return {
    config: loaded.globalConfig,
    runtimeConfig: selected ? buildRuntimeConfig(loaded.effectiveConfig, catalog, selected) : loaded.globalConfig,
    selected,
  };
}

function sendSnapshot(configStore: UserConfigStore): void {
  const snapshotState: CCState = currentWorkingPrompt ? 'working' : currentCcState;
  const resolved = resolveRuntimeConfig(configStore);
  broadcastIPC({
    type: 'snapshot',
    state: snapshotState,
    prevState: snapshotState,
    workingPrompt: currentWorkingPrompt,
    config: resolved.runtimeConfig,
  });
}

function sendSelectedPetAsset(configStore: UserConfigStore): void {
  try {
    const resolved = resolveRuntimeConfig(configStore);
    const selected = resolved.selected;
    if (!selected) {
      broadcastIPC({ type: 'pet-asset-reset' });
      return;
    }
    const mimeType = spriteMimeType(selected.spritePath);
    if (!mimeType) {
      console.error(`[CC Pet] Unsupported sprite format: ${selected.spritePath}`);
      broadcastIPC({ type: 'pet-asset-reset' });
      return;
    }
    const stats = statSync(selected.spritePath);
    if (stats.size > 25 * 1024 * 1024) { throw new Error('精灵图片超过 25MB 限制'); }
    if (!assetCache || assetCache.path !== selected.spritePath || assetCache.mtimeMs !== stats.mtimeMs) {
      assetCache = {
        path: selected.spritePath,
        mtimeMs: stats.mtimeMs,
        dataUrl: `data:${mimeType};base64,${readFileSync(selected.spritePath).toString('base64')}`,
      };
    }
    broadcastIPC({
      type: 'pet-asset',
      petId: selected.id,
      displayName: selected.displayName,
      dataUrl: assetCache.dataUrl,
      config: resolved.runtimeConfig,
    });
  } catch (error) {
    console.error('[CC Pet] Failed to load selected pet asset:', error);
    broadcastIPC({ type: 'pet-asset-reset' });
  }
}

function launchTauri(extensionPath: string, port: number): void {
  if (!shouldAutoLaunch() || port === 0 || tauriProcess) { return; }
  const packagedExe = join(extensionPath, 'bin', 'win32-x64', 'cc-pet.exe');
  const developmentExe = join(extensionPath, 'src-tauri', 'target', 'release', 'cc-pet.exe');
  const exePath = existsSync(packagedExe) ? packagedExe : developmentExe;
  try {
    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CC_PET_IPC_PORT: String(port) },
    });
    tauriProcess = child;
    child.once('error', (error) => {
      if (tauriProcess === child) { tauriProcess = null; }
      console.error('[CC Pet] Desktop process error:', error);
    });
    child.once('exit', () => {
      if (tauriProcess === child) { tauriProcess = null; }
    });
    child.unref();
    console.log(`[CC Pet] Desktop launched with IPC port ${port}.`);
  } catch (error) {
    tauriProcess = null;
    console.error('[CC Pet] Failed to launch desktop:', error);
  }
}

function killTauri(): void {
  if (!tauriProcess) { return; }
  try { tauriProcess.kill(); } catch { /* already closed */ }
  tauriProcess = null;
}

function publishCcState(state: CCState, extensionPath: string): void {
  const prevState = currentCcState;
  currentCcState = state;

  const awaitingFinalReply = prevState === 'working' && state === 'open';
  if (!awaitingFinalReply) {
    if (state === 'idle' && currentWorkingPrompt) {
      currentWorkingPrompt = '';
      workingTurnToken += 1;
    }
    broadcastIPC({ type: 'cc-state', state, prevState });
  }

  if (state === 'working' && !currentWorkingPrompt) {
    const detector = ccDetector;
    const turnToken = ++workingTurnToken;
    currentWorkingPrompt = 'CC正在处理中…';
    broadcastIPC({ type: 'cc-working-prompt', text: currentWorkingPrompt });
    if (detector) {
      void detector.getLastUserPrompt().then((prompt) => {
        if (!prompt || turnToken !== workingTurnToken || !currentWorkingPrompt) { return; }
        currentWorkingPrompt = prompt;
        broadcastIPC({ type: 'cc-working-prompt', text: prompt });
      });
    }
  }

  if (awaitingFinalReply) {
    const detector = ccDetector;
    if (detector) {
      void detector.getLastReply().then((reply) => {
        if (currentCcState !== 'open') { return; }
        currentWorkingPrompt = '';
        workingTurnToken += 1;
        if (reply && reply !== lastReplyText) {
          lastReplyText = reply;
          broadcastIPC({ type: 'cc-reply', text: reply });
        }
        broadcastIPC({ type: 'cc-state', state: 'open', prevState: 'working' });
      });
    } else {
      currentWorkingPrompt = '';
      workingTurnToken += 1;
      broadcastIPC({ type: 'cc-state', state: 'open', prevState: 'working' });
    }
  }

  if (getIPCServer().clientCount === 0 && shouldAutoLaunch()) {
    launchTauri(extensionPath, ipcPort);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const configStore = new UserConfigStore(join(context.extensionPath, 'pet-config.json'));
  const bindingProvider = new PetBindingViewProvider(
    context.extensionUri,
    configStore,
    () => sendSelectedPetAsset(configStore),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('cc-pet.bindingView', bindingProvider)
  );

  try {
    ipcPort = await startIPC();
    getIPCServer().onMsg((message) => {
      if (message.type === 'ready') {
        console.log('[CC Pet] Desktop requested a state snapshot.');
        sendSnapshot(configStore);
        sendSelectedPetAsset(configStore);
      }
    });
    launchTauri(context.extensionPath, ipcPort);
  } catch (error) {
    console.error('[CC Pet] IPC startup failed:', error);
    void vscode.window.showErrorMessage(`CC Pet IPC 启动失败：${error instanceof Error ? error.message : String(error)}`);
  }

  ccDetector = new CCStatusDetector();
  ccDetector.onStateChange((state) => publishCcState(state, context.extensionPath));
  void ccDetector.start();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ccPet.autoLaunchDesktop')) {
        if (shouldAutoLaunch()) { launchTauri(context.extensionPath, ipcPort); }
        else { killTauri(); }
      }
      if (event.affectsConfiguration('ccPet.petsRootDirectory')) {
        bindingProvider.refreshPetCatalog();
        sendSelectedPetAsset(configStore);
      }
    })
  );
}

export function deactivate(): void {
  ccDetector?.stop();
  ccDetector = null;
  killTauri();
  stopIPC();
}
