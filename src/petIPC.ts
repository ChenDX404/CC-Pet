import { createServer, type Server, type Socket } from 'node:net';
import { createHash } from 'node:crypto';

const PORT_START = 19420;
const PORT_MAX = 19429;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export type IPCMessage = Record<string, unknown>;
type MessageCallback = (msg: IPCMessage) => void;

/** A small local-only WebSocket server used by the extension and Tauri pet. */
class MiniWSServer {
  private server: Server | null = null;
  private clients: Socket[] = [];
  private onMessage: MessageCallback | null = null;
  private actualPort = 0;

  get port(): number { return this.actualPort; }
  get clientCount(): number { return this.clients.length; }

  onMsg(cb: MessageCallback): void { this.onMessage = cb; }

  listen(): Promise<number> {
    if (this.server?.listening && this.actualPort !== 0) {
      return Promise.resolve(this.actualPort);
    }

    return new Promise((resolve, reject) => {
      const tryPort = (port: number): void => {
        if (port > PORT_MAX) {
          reject(new Error(`CC Pet IPC ports ${PORT_START}-${PORT_MAX} are all unavailable.`));
          return;
        }

        const candidate = createServer((socket) => this.handleConnection(socket));
        const onError = (error: NodeJS.ErrnoException): void => {
          candidate.removeAllListeners();
          try { candidate.close(); } catch { /* not listening */ }
          if (error.code === 'EADDRINUSE') {
            tryPort(port + 1);
            return;
          }
          reject(error);
        };

        candidate.once('error', onError);
        candidate.listen(port, '127.0.0.1', () => {
          candidate.removeListener('error', onError);
          candidate.on('error', (error) => console.error('[CC Pet] IPC server error:', error));
          this.server = candidate;
          this.actualPort = port;
          console.log(`[CC Pet] IPC listening on ws://127.0.0.1:${port}`);
          resolve(port);
        });
      };

      tryPort(PORT_START);
    });
  }

  broadcast(msg: IPCMessage): void {
    const frame = this.encodeTextFrame(JSON.stringify(msg));
    for (const client of [...this.clients]) {
      if (client.destroyed) {
        this.clients = this.clients.filter((item) => item !== client);
        continue;
      }
      try { client.write(frame); } catch { client.destroy(); }
    }
  }

  close(): void {
    for (const client of this.clients) {
      try { client.destroy(); } catch { /* already closed */ }
    }
    this.clients = [];
    this.server?.close();
    this.server = null;
    this.actualPort = 0;
  }

  private handleConnection(socket: Socket): void {
    let handshakeDone = false;
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      if (!handshakeDone) {
        const request = chunk.toString('utf8');
        const keyMatch = request.match(/Sec-WebSocket-Key:\s*(.+)\r\n/i);
        if (!keyMatch) { socket.destroy(); return; }
        const accept = createHash('sha1').update(keyMatch[1].trim() + WS_GUID).digest('base64');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        handshakeDone = true;
        this.clients.push(socket);
        console.log(`[CC Pet] Desktop connected to IPC port ${this.actualPort}.`);
        socket.on('close', () => {
          this.clients = this.clients.filter((client) => client !== socket);
          console.log('[CC Pet] Desktop disconnected from IPC.');
        });
        return;
      }

      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let payloadLength = buffer[1] & 0x7f;
        let offset = 2;

        if (payloadLength === 126) {
          if (buffer.length < 4) { break; }
          payloadLength = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLength === 127) {
          socket.destroy();
          return;
        }

        const maskLength = masked ? 4 : 0;
        const frameLength = offset + maskLength + payloadLength;
        if (buffer.length < frameLength) { break; }

        const maskKey = masked ? buffer.subarray(offset, offset + 4) : null;
        offset += maskLength;
        const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
        if (masked && maskKey) {
          for (let index = 0; index < payload.length; index++) {
            payload[index] ^= maskKey[index % 4];
          }
        }

        if (opcode === 0x8) {
          try { socket.write(Buffer.from([0x88, 0x00])); } catch { /* socket closed */ }
          socket.destroy();
          return;
        }

        if (opcode === 0x9) {
          const pong = Buffer.alloc(payload.length + 2);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          try { socket.write(pong); } catch { /* socket closed */ }
        }

        if (opcode === 0x1 && this.onMessage) {
          try {
            this.onMessage(JSON.parse(payload.toString('utf8')) as IPCMessage);
          } catch { /* ignore malformed JSON */ }
        }

        buffer = buffer.subarray(frameLength);
      }
    });

    socket.on('error', () => { /* close handler performs cleanup */ });
  }

  private encodeTextFrame(payload: string): Buffer {
    const data = Buffer.from(payload, 'utf8');
    const frame: Buffer[] = [Buffer.from([0x81])];
    if (data.length < 126) {
      frame.push(Buffer.from([data.length]));
    } else if (data.length < 65536) {
      const extended = Buffer.alloc(3);
      extended[0] = 126;
      extended.writeUInt16BE(data.length, 1);
      frame.push(extended);
    } else {
      const extended = Buffer.alloc(9);
      extended[0] = 127;
      extended.writeBigUInt64BE(BigInt(data.length), 1);
      frame.push(extended);
    }
    frame.push(data);
    return Buffer.concat(frame);
  }
}

let instance: MiniWSServer | null = null;

export function getIPCServer(): MiniWSServer {
  instance ??= new MiniWSServer();
  return instance;
}

export function startIPC(): Promise<number> {
  return getIPCServer().listen();
}

export function stopIPC(): void {
  instance?.close();
  instance = null;
}

export function broadcastIPC(msg: IPCMessage): void {
  instance?.broadcast(msg);
}
