// ccStatusDetector.ts
//
// Claude Code 状态检测器（阶段 4b）。
//
// 原理：
// 1. 扫描 ~/.claude/sessions/*.json → 取第一个有效 session，得 sessionId + cwd
// 2. 将 cwd 编码为 project hash → ~/.claude/projects/<hash>/<sessionId>.jsonl
// 3. 对比最新真实用户消息与最终 end_turn 回复 → 有未完成问题 = "working"
// 4. 已存在最终回复或没有用户问题 → "open"（CC 开着但没在干活）
// 5. sessions 目录空了 → "idle"（CC 没开）
//
// 零配置侵入，不修改 CC 设置，不依赖 hooks。

import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, open as fsOpen, stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export type CCState = 'idle' | 'open' | 'working';

type StateCallback = (state: CCState, prevState: CCState) => void;

interface SessionMeta {
  sessionId: string;
}

interface TranscriptSelection {
  hasSessions: boolean;
  transcriptPath: string | null;
  mtimeMs: number;
}

export class CCStatusDetector {
  private sessionsWatcher: FSWatcher | null = null;
  private transcriptWatcher: FSWatcher | null = null;
  private transcriptChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private activityPollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private readonly sessionsDir: string;
  private readonly projectsDir: string;
  private readonly listeners: StateCallback[] = [];
  private lastState: CCState = 'idle';
  private currentTranscriptPath: string | null = null;
  private currentTranscriptMtimeMs = 0;
  private transcriptSyncVersion = 0;
  private stopped = false;
  /** 进入 working 的时间戳，getLastReply 过滤此时间之前的旧消息。 */
  private workingStartedAt = 0;
  /** 触发当前 working 的 transcript；最终回复只能来自同一文件。 */
  private workingTranscriptPath: string | null = null;
  /** 最近一次 working → open 是否在同一 transcript 内完成。 */
  private replyTranscriptPath: string | null = null;

  constructor(home: string = os.homedir()) {
    this.sessionsDir = path.join(home, '.claude', 'sessions');
    this.projectsDir = path.join(home, '.claude', 'projects');
  }

  onStateChange(cb: StateCallback): void {
    this.listeners.push(cb);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.poll(0);
    if (this.stopped) { return; }
    try {
      this.sessionsWatcher = watch(this.sessionsDir, () => { void this.poll(500); });
    } catch { /* sessions 目录不存在 */ }
    this.activityPollTimer = setInterval(() => { void this.poll(0); }, 350);
  }

  stop(): void {
    this.stopped = true;
    this.sessionsWatcher?.close();
    this.sessionsWatcher = null;
    this.transcriptWatcher?.close();
    this.transcriptWatcher = null;
    if (this.transcriptChangeTimer) {
      clearTimeout(this.transcriptChangeTimer);
      this.transcriptChangeTimer = null;
    }
    if (this.activityPollTimer) {
      clearInterval(this.activityPollTimer);
      this.activityPollTimer = null;
    }
  }

  // ===== 内部 =====

  private async poll(delayMs: number): Promise<void> {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (this.stopped) { return; }

    if (this.pollInFlight) { return; }
    this.pollInFlight = true;
    try {
      const selection = await this.selectActiveTranscript();
      if (this.stopped) { return; }
      if (!selection.hasSessions) {
        this.releaseTranscript();
        this.transition('idle');
        return;
      }
      if (!selection.transcriptPath) {
        this.releaseTranscript();
        this.transition('open');
        return;
      }

      const transcriptChanged = selection.transcriptPath !== this.currentTranscriptPath;
      const contentChanged = selection.mtimeMs !== this.currentTranscriptMtimeMs;
      if (transcriptChanged || !this.transcriptWatcher) {
        if (transcriptChanged && this.currentTranscriptPath && this.lastState === 'working') {
          this.transition('open');
        }
        this.releaseTranscript();
        try {
          this.transcriptWatcher = watch(
            selection.transcriptPath,
            () => { this.scheduleTranscriptSync(); },
          );
          this.currentTranscriptPath = selection.transcriptPath;
        } catch {
          this.transition('open');
          return;
        }
      }
      this.currentTranscriptMtimeMs = selection.mtimeMs;
      if (transcriptChanged || contentChanged) {
        await this.syncTranscriptState();
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private scheduleTranscriptSync(): void {
    if (this.transcriptChangeTimer) { clearTimeout(this.transcriptChangeTimer); }
    this.transcriptChangeTimer = setTimeout(() => {
      this.transcriptChangeTimer = null;
      void this.syncTranscriptState();
    }, 50);
  }

  private async syncTranscriptState(): Promise<void> {
    const syncVersion = ++this.transcriptSyncVersion;
    const lines = await this.readTranscriptTail();
    if (this.stopped || syncVersion !== this.transcriptSyncVersion) { return; }

    let latestUserIndex = -1;
    let latestUserTimestamp = 0;
    let latestFinalReplyIndex = -1;
    let latestTerminalIndex = -1;
    for (let index = 0; index < lines.length; index++) {
      try {
        const obj = JSON.parse(lines[index]) as Record<string, unknown>;
        const msg = obj.message as Record<string, unknown> | undefined;
        if (this.isTerminalUserEvent(obj, msg)) {
          latestTerminalIndex = index;
          continue;
        }
        const text = this.messageText(msg);
        if (!text) { continue; }
        if (obj.isMeta !== true && msg?.role === 'user') {
          latestUserIndex = index;
          latestUserTimestamp = this.messageTimestamp(obj);
        } else if (msg?.role === 'assistant' && msg.stop_reason === 'end_turn') {
          latestFinalReplyIndex = index;
        }
      } catch { /* 跳过无法解析的行 */ }
    }

    if (latestUserIndex > Math.max(latestFinalReplyIndex, latestTerminalIndex)) {
      this.transition('working', latestUserTimestamp || Date.now());
    } else {
      this.transition('open');
    }
  }

  private transition(state: CCState, workingStartedAt?: number): void {
    if (state === this.lastState) { return; }
    const prev = this.lastState;
    if (state === 'working') {
      this.workingStartedAt = workingStartedAt ?? Date.now();
      this.workingTranscriptPath = this.currentTranscriptPath;
      this.replyTranscriptPath = null;
    } else if (state === 'open') {
      this.replyTranscriptPath = prev === 'working'
        && this.currentTranscriptPath === this.workingTranscriptPath
        ? this.currentTranscriptPath
        : null;
    } else {
      this.workingTranscriptPath = null;
      this.replyTranscriptPath = null;
    }
    this.lastState = state;
    for (const cb of this.listeners) {
      try { cb(state, prev); } catch { /* ignore */ }
    }
  }

  private releaseTranscript(): void {
    this.transcriptWatcher?.close();
    this.transcriptWatcher = null;
    if (this.transcriptChangeTimer) {
      clearTimeout(this.transcriptChangeTimer);
      this.transcriptChangeTimer = null;
    }
    this.currentTranscriptPath = null;
    this.currentTranscriptMtimeMs = 0;
    this.transcriptSyncVersion += 1;
  }

  private async selectActiveTranscript(): Promise<TranscriptSelection> {
    try {
      const files = await readdir(this.sessionsDir);
      const sessions = (await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file): Promise<SessionMeta | null> => {
            try {
              const sessionPath = path.join(this.sessionsDir, file);
              const raw = await readFile(sessionPath, 'utf8');
              const obj = JSON.parse(raw) as Record<string, unknown>;
              const pid = typeof obj.pid === 'number' && Number.isInteger(obj.pid) ? obj.pid : null;
              if (pid !== null && !this.isProcessAlive(pid)) { return null; }
              return typeof obj.sessionId === 'string' ? { sessionId: obj.sessionId } : null;
            } catch {
              return null;
            }
          }),
      )).filter((session): session is SessionMeta => session !== null);
      if (sessions.length === 0) {
        return { hasSessions: false, transcriptPath: null, mtimeMs: 0 };
      }

      const projectDirectories = (await readdir(this.projectsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.projectsDir, entry.name));
      const transcriptCandidates = (
        await Promise.all(sessions.flatMap((session) =>
          projectDirectories.map(async (directory) => {
            const transcriptPath = path.join(directory, `${session.sessionId}.jsonl`);
            try {
              const transcriptStat = await stat(transcriptPath);
              return transcriptStat.isFile()
                ? { transcriptPath, mtimeMs: transcriptStat.mtimeMs }
                : null;
            } catch {
              return null;
            }
          })
        ))
      ).filter((candidate): candidate is { transcriptPath: string; mtimeMs: number } => candidate !== null);
      const active = transcriptCandidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
      return {
        hasSessions: true,
        transcriptPath: active?.transcriptPath ?? null,
        mtimeMs: active?.mtimeMs ?? 0,
      };
    } catch {
      return { hasSessions: false, transcriptPath: null, mtimeMs: 0 };
    }
  }

  /** 读取当前一轮对话中最后一条用户文本，并清理空白、截断到 maxLen 字符。 */
  async getLastUserPrompt(maxLen = 60): Promise<string> {
    const lines = await this.readTranscriptTail();
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]) as Record<string, unknown>;
        if (obj.isMeta === true || this.isBeforeCurrentTurn(obj)) { continue; }
        const msg = obj.message as Record<string, unknown> | undefined;
        if (this.isTerminalUserEvent(obj, msg)) { continue; }
        if (msg?.role !== 'user') { continue; }

        const text = this.messageText(msg).replace(/\s+/g, ' ').trim();
        if (text) { return text.length > maxLen ? text.slice(0, maxLen) + '…' : text; }
      } catch { /* 跳过无法解析的行 */ }
    }
    return '';
  }

  /** 读取 transcript JSONL 最后一条 assistant 消息，截断到 maxLen 字符。 */
  async getLastReply(maxLen = 80): Promise<string> {
    if (this.replyTranscriptPath !== null && this.replyTranscriptPath !== this.currentTranscriptPath) {
      return '';
    }
    const lines = await this.readTranscriptTail();
    let latestUserIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]) as Record<string, unknown>;
        if (obj.isMeta === true || this.isBeforeCurrentTurn(obj)) { continue; }
        const msg = obj.message as Record<string, unknown> | undefined;
        if (this.isTerminalUserEvent(obj, msg)) { continue; }
        if (msg?.role === 'user' && this.messageText(msg)) { latestUserIndex = i; }
      } catch { /* 跳过无法解析的行 */ }
    }
    if (latestUserIndex < 0) { return ''; }

    for (let i = lines.length - 1; i > latestUserIndex; i--) {
      try {
        const obj = JSON.parse(lines[i]) as Record<string, unknown>;
        if (this.isBeforeCurrentTurn(obj)) { continue; }
        const msg = obj.message as Record<string, unknown> | undefined;
        if (msg?.role === 'assistant' && msg.stop_reason === 'end_turn' && Array.isArray(msg.content)) {
          const parts: string[] = [];
          for (const block of msg.content as Array<Record<string, unknown>>) {
            if (block.type === 'text' && typeof block.text === 'string') {
              parts.push(block.text);
            }
          }
          const text = parts.join('').trim();
          if (text) {
            return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
          }
        }
      } catch { /* 跳过无法解析的行 */ }
    }
    return '';
  }

  private isBeforeCurrentTurn(obj: Record<string, unknown>): boolean {
    if (typeof obj.timestamp !== 'string') { return false; }
    const timestamp = new Date(obj.timestamp).getTime();
    return this.workingStartedAt > 0 && timestamp < this.workingStartedAt - 5000;
  }

  private messageTimestamp(obj: Record<string, unknown>): number {
    if (typeof obj.timestamp !== 'string') { return 0; }
    const timestamp = new Date(obj.timestamp).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private messageText(msg: Record<string, unknown> | undefined): string {
    if (!msg) { return ''; }
    if (typeof msg.content === 'string') { return msg.content.trim(); }
    if (!Array.isArray(msg.content)) { return ''; }
    const parts: string[] = [];
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    return parts.join(' ').trim();
  }

  private isTerminalUserEvent(
    obj: Record<string, unknown>,
    msg: Record<string, unknown> | undefined,
  ): boolean {
    if (obj.toolDenialKind === 'user-rejected') { return true; }
    if (msg?.role !== 'user' || !Array.isArray(msg.content)) { return false; }
    return (msg.content as Array<Record<string, unknown>>).some((block) => (
      block.type === 'text'
      && typeof block.text === 'string'
      && /^\[Request interrupted by user(?: for tool use)?\]$/i.test(block.text.trim())
    ));
  }

  private isProcessAlive(pid: number): boolean {
    if (pid <= 0) { return false; }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async readTranscriptTail(): Promise<string[]> {
    if (!this.currentTranscriptPath) { return []; }
    let fd: Awaited<ReturnType<typeof fsOpen>> | null = null;
    try {
      fd = await fsOpen(this.currentTranscriptPath, 'r');
      const fileStat = await fd.stat();
      // 只读文件末尾 512KB，覆盖一次包含多轮工具调用的长任务。
      const tailSize = Math.min(fileStat.size, 512 * 1024);
      const buf = Buffer.alloc(tailSize);
      await fd.read(buf, 0, tailSize, fileStat.size - tailSize);
      return buf.toString('utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    } finally {
      await fd?.close().catch(() => undefined);
    }
  }
}
