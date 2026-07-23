import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { CCStatusDetector, type CCState } from '../ccStatusDetector';

function projectHash(cwd: string): string {
  return cwd
    .replace(/^([A-Z]):\\/i, (_, drive: string) => drive.toLowerCase() + '--')
    .replace(/[^a-zA-Z0-9-]/g, '-');
}

async function writeSession(
  home: string,
  fileName: string,
  sessionId: string,
  cwd: string,
  mtime: Date,
  pid = process.pid,
): Promise<void> {
  const sessionPath = path.join(home, '.claude', 'sessions', fileName);
  await fs.writeFile(sessionPath, JSON.stringify({ pid, sessionId, cwd }), 'utf8');
  await fs.utimes(sessionPath, mtime, mtime);
}

async function writeTranscript(
  home: string,
  sessionId: string,
  cwd: string,
  mtime = new Date(),
  content = '{"role":"assistant","content":"ok"}\n',
): Promise<void> {
  const projectDir = path.join(home, '.claude', 'projects', projectHash(cwd));
  await fs.mkdir(projectDir, { recursive: true });
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
  await fs.writeFile(transcriptPath, content, 'utf8');
  await fs.utimes(transcriptPath, mtime, mtime);
}

function waitForState(detector: CCStatusDetector, expected: CCState): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 2000);
    detector.onStateChange((state) => {
      if (state === expected) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

suite('CCStatusDetector startup synchronization', () => {
  let home: string;

  setup(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-pet-status-'));
    await fs.mkdir(path.join(home, '.claude', 'sessions'), { recursive: true });
    await fs.mkdir(path.join(home, '.claude', 'projects'), { recursive: true });
  });

  teardown(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  test('selects the newest session and restores working only for an unanswered user prompt', async () => {
    const oldDate = new Date(Date.now() - 10_000);
    await writeSession(home, 'old.json', 'old-session', 'E:\\code\\old', oldDate);
    await writeTranscript(home, 'old-session', 'E:\\code\\old', oldDate);
    await writeSession(home, 'new.json', 'new-session', 'E:\\code\\new', new Date());
    const userLine = JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: '尚未回复的问题' }] },
    }) + '\n';
    await writeTranscript(home, 'new-session', 'E:\\code\\new', new Date(), userLine);

    const detector = new CCStatusDetector(home);
    const working = waitForState(detector, 'working');
    await detector.start();
    await working;
    detector.stop();
  });

  test('starts open when the latest user prompt already has a final reply', async () => {
    const cwd = 'E:\\code\\complete';
    const timestamp = new Date().toISOString();
    const lines = [
      { type: 'user', timestamp, message: { role: 'user', content: [{ type: 'text', text: '已经完成的问题' }] } },
      { type: 'assistant', timestamp, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '已经完成的回复' }] } },
    ].map((line) => JSON.stringify(line)).join('\n') + '\n';
    await writeSession(home, 'complete.json', 'complete-session', cwd, new Date());
    await writeTranscript(home, 'complete-session', cwd, new Date(), lines);

    const detector = new CCStatusDetector(home);
    const open = waitForState(detector, 'open');
    await detector.start();
    await open;
    detector.stop();
  });

  test('retries when the transcript is created after the session', async () => {
    const cwd = 'E:\\code\\later';
    await writeSession(home, 'later.json', 'later-session', cwd, new Date());
    await fs.mkdir(path.join(home, '.claude', 'projects', projectHash(cwd)), { recursive: true });

    const detector = new CCStatusDetector(home);
    const working = waitForState(detector, 'working');
    await detector.start();
    const userLine = JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: '稍后创建的问题' }] },
    }) + '\n';
    await writeTranscript(home, 'later-session', cwd, new Date(), userLine);
    await working;
    detector.stop();
  });

  test('finds a transcript when Claude normalizes underscores in the project directory', async () => {
    const cwd = 'E:\\code\\vscode_plugin\\cc-pet';
    await writeSession(home, 'underscore.json', 'underscore-session', cwd, new Date());
    const userLine = JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'underscore project' }] },
    }) + '\n';
    await writeTranscript(home, 'underscore-session', cwd, new Date(), userLine);

    const detector = new CCStatusDetector(home);
    const working = waitForState(detector, 'working');
    await detector.start();
    await working;
    detector.stop();
  });

  test('chooses the most recently updated transcript instead of the newest session metadata', async () => {
    const now = Date.now();
    const activeCwd = 'E:\\code\\active_window';
    const idleCwd = 'E:\\code\\debug_window';
    await writeSession(home, 'active.json', 'active-session', activeCwd, new Date(now - 60_000));
    await writeSession(home, 'debug.json', 'debug-session', idleCwd, new Date(now));
    const userLine = JSON.stringify({
      type: 'user',
      timestamp: new Date(now).toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'question from window A' }] },
    }) + '\n';
    await writeTranscript(home, 'active-session', activeCwd, new Date(now), userLine);

    const detector = new CCStatusDetector(home);
    const working = waitForState(detector, 'working');
    await detector.start();
    await working;
    detector.stop();
  });

  test('extracts a cleaned user prompt and only accepts a final assistant reply', async () => {
    const cwd = 'E:\\code\\messages';
    const timestamp = new Date().toISOString();
    const lines = [
      { type: 'user', timestamp, message: { role: 'user', content: [{ type: 'text', text: '  请帮我\n  检查   这个很长的问题  ' }] } },
      { type: 'user', timestamp, isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '内部元数据' }] } },
      { type: 'assistant', timestamp, message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'text', text: '中间结果' }] } },
      { type: 'assistant', timestamp, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '最终回复' }] } },
    ].map((line) => JSON.stringify(line)).join('\n') + '\n';
    await writeSession(home, 'messages.json', 'messages-session', cwd, new Date());
    await writeTranscript(home, 'messages-session', cwd, new Date(), lines);

    const detector = new CCStatusDetector(home);
    const open = waitForState(detector, 'open');
    await detector.start();
    await open;

    assert.strictEqual(await detector.getLastUserPrompt(8), '请帮我 检查 这…');
    assert.strictEqual(await detector.getLastReply(), '最终回复');
    detector.stop();
  });

  test('returns open when the user rejects a tool request', async () => {
    const cwd = 'E:\\code\\rejected';
    const timestamp = new Date().toISOString();
    const lines = [
      { type: 'user', timestamp, message: { role: 'user', content: [{ type: 'text', text: '需要执行工具的问题' }] } },
      {
        type: 'user',
        timestamp,
        toolDenialKind: 'user-rejected',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', is_error: true, content: 'The user rejected this tool use.' }],
        },
      },
      {
        type: 'user',
        timestamp,
        message: {
          role: 'user',
          content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }],
        },
      },
    ].map((line) => JSON.stringify(line)).join('\n') + '\n';
    await writeSession(home, 'rejected.json', 'rejected-session', cwd, new Date());
    await writeTranscript(home, 'rejected-session', cwd, new Date(), lines);

    const detector = new CCStatusDetector(home);
    const open = waitForState(detector, 'open');
    await detector.start();
    await open;

    assert.strictEqual(await detector.getLastUserPrompt(), '需要执行工具的问题');
    detector.stop();
  });

  test('ignores a newer working transcript when its Claude process has exited', async () => {
    const now = Date.now();
    const activeCwd = 'E:\\code\\active';
    const staleCwd = 'E:\\code\\stale';
    const completedLines = [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '已完成问题' }] } },
      { type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '已完成回复' }] } },
    ].map((line) => JSON.stringify(line)).join('\n') + '\n';
    const staleLines = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '残留未完成问题' }] },
    }) + '\n';

    await writeSession(home, 'active.json', 'active-session', activeCwd, new Date(now - 1000));
    await writeTranscript(home, 'active-session', activeCwd, new Date(now - 1000), completedLines);
    await writeSession(home, 'stale.json', 'stale-session', staleCwd, new Date(now), 2_147_483_647);
    await writeTranscript(home, 'stale-session', staleCwd, new Date(now), staleLines);

    const detector = new CCStatusDetector(home);
    const open = waitForState(detector, 'open');
    await detector.start();
    await open;
    detector.stop();
  });

  test('does not return a historical reply after switching away from a closed working session', async () => {
    const now = Date.now();
    const workingCwd = 'E:\\code\\closing';
    const historyCwd = 'E:\\code\\history';
    const oldTimestamp = new Date(now - 60_000).toISOString();
    const workingTimestamp = new Date(now).toISOString();
    const historyLines = [
      { type: 'user', timestamp: oldTimestamp, message: { role: 'user', content: [{ type: 'text', text: '其他会话的问题' }] } },
      { type: 'assistant', timestamp: oldTimestamp, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '其他会话的历史回复' }] } },
    ].map((line) => JSON.stringify(line)).join('\n') + '\n';
    const workingLines = JSON.stringify({
      type: 'user',
      timestamp: workingTimestamp,
      message: { role: 'user', content: [{ type: 'text', text: '关闭前仍在处理的问题' }] },
    }) + '\n';

    await writeSession(home, 'history.json', 'history-session', historyCwd, new Date(now - 60_000));
    await writeTranscript(home, 'history-session', historyCwd, new Date(now - 60_000), historyLines);
    await writeSession(home, 'closing.json', 'closing-session', workingCwd, new Date(now));
    await writeTranscript(home, 'closing-session', workingCwd, new Date(now), workingLines);

    const detector = new CCStatusDetector(home);
    const working = waitForState(detector, 'working');
    await detector.start();
    await working;

    const open = waitForState(detector, 'open');
    await fs.unlink(path.join(home, '.claude', 'sessions', 'closing.json'));
    await open;
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(await detector.getLastReply(), '');
    detector.stop();
  });
});
