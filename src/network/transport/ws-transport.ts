import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import { getLogger } from '../../utils/logger';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { canonicalJSON } from '../../crypto/hashing/hash';

export interface MessageHandler {
  (message: any, from: PeerConnection): void;
}

export interface PeerConnection {
  id: string;
  nodeId: string | null;
  publicKey?: string;
  send(message: any): boolean;
  close(): void;
  isOpen(): boolean;
}

export interface TransportEvents {
  onConnection: (peer: PeerConnection) => void;
  onMessage: (message: any, peer: PeerConnection) => void;
  onDisconnect: (peerId: string, nodeId: string | null) => void;
}

export class WsTransport {
  private wss: WebSocketServer;
  private httpServer: Server;
  private events: TransportEvents;
  private connections: Map<string, PeerConnection> = new Map();

  constructor(port: number, events: TransportEvents) {
    this.events = events;
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.httpServer.listen(port, () => {
      getLogger().info(`P2P listening on port ${port}`);
    });
    this.setup();
  }

  private setup(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const peer = this.wrapPeer(ws);
      this.connections.set(peer.id, peer);

      ws.on('message', (raw: Buffer) => {
        try {
          const message = JSON.parse(raw.toString('utf-8'));
          this.events.onMessage(message, peer);
        } catch (e: any) {
          getLogger().warn(`Malformed message from ${peer.id}: ${e.message}`);
        }
      });

      ws.on('close', () => {
        this.connections.delete(peer.id);
        this.events.onDisconnect(peer.id, peer.nodeId);
      });

      ws.on('error', () => {
        /* handled by close */
      });

      this.events.onConnection(peer);
    });
  }

  private wrapPeer(ws: WebSocket): PeerConnection {
    const peer: PeerConnection = {
      id: cryptoRandomId(),
      nodeId: null,
      isOpen: () => ws.readyState === WebSocket.OPEN,
      send: (message: any): boolean => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        try {
          ws.send(JSON.stringify(message));
          return true;
        } catch {
          return false;
        }
      },
      close: () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
    };
    return peer;
  }

  getPeerCount(): number {
    let count = 0;
    for (const peer of this.connections.values()) {
      if (peer.isOpen()) count++;
    }
    return count;
  }

  broadcast(message: any): number {
    let sent = 0;
    for (const peer of this.connections.values()) {
      if (peer.isOpen() && peer.nodeId) {
        if (peer.send(message)) sent++;
      }
    }
    return sent;
  }

  shutdown(): void {
    for (const peer of this.connections.values()) {
      peer.close();
    }
    this.connections.clear();
    this.wss.close();
    this.httpServer.close();
  }
}

function cryptoRandomId(): string {
  return require('crypto').randomBytes(16).toString('hex');
}
