import { WsTransport, PeerConnection } from '../transport/ws-transport';
import { Chain } from '../../core/chain';
import { PermissionedConsensus } from '../../consensus/permissioned/consensus';
import { Block, getBlockSigningData } from '../../core/block/block';
import { Transaction } from '../../core/transaction/transaction';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { canonicalJSON } from '../../crypto/hashing/hash';
import { getLogger } from '../../utils/logger';
import WebSocket from 'ws';

export interface NetworkConfig {
  port: number;
  peers: string[];
  nodeId: string;
  publicKey: string;
  privateKey: string;
}

export class NodeNetwork {
  private config: NetworkConfig;
  private chain: Chain;
  private consensus: PermissionedConsensus;
  private transport: WsTransport | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private lastProcessedTx: Set<string> = new Set();
  private lastProcessedBlock: Set<string> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private attemptedAddresses: Set<string> = new Set();

  constructor(config: NetworkConfig, chain: Chain, consensus: PermissionedConsensus) {
    this.config = config;
    this.chain = chain;
    this.consensus = consensus;
  }

  start(): void {
    this.transport = new WsTransport(this.config.port, {
      onConnection: (peer) => this.handleConnection(peer),
      onMessage: (message, peer) => this.handleMessage(message, peer),
      onDisconnect: (peerId, nodeId) => this.handleDisconnect(peerId, nodeId),
    });

    for (const peerAddr of this.config.peers) {
      this.connectTo(peerAddr);
    }

    this.reconnectTimer = setInterval(() => this.retryConnections(), 3000);
    this.syncTimer = setInterval(() => this.requestSync(), 4000);
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.transport) {
      this.transport.shutdown();
      this.transport = null;
    }
    this.peers.clear();
  }

  private requestSync(): void {
    const connected = Array.from(this.peers.values()).filter(p => p.isOpen());
    if (connected.length === 0) return;

    const peer = connected[Math.floor(Math.random() * connected.length)];
    const fromHeight = this.chain.getHeight() + 1;
    if (fromHeight > this.chain.getHeight()) {
      peer.send({
        type: 'SYNC_REQUEST',
        version: '1.0',
        timestamp: new Date().toISOString(),
        fromHeight,
      });
    }
  }

  private retryConnections(): void {
    for (const peerAddr of this.config.peers) {
      const connected = Array.from(this.peers.values()).some(p => p.id === peerAddr && p.isOpen());
      if (!connected) {
        this.attemptedAddresses.delete(peerAddr);
        this.connectTo(peerAddr);
      }
    }
  }

  private connectTo(address: string): void {
    if (this.attemptedAddresses.has(address)) return;
    this.attemptedAddresses.add(address);

    try {
      const ws = new WebSocket(address);

      ws.on('open', () => {
        const peer = this.wrapOutgoingPeer(address, ws);
        this.peers.set(peer.id, peer);
        this.sendHandshake(peer);
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const message = JSON.parse(raw.toString('utf-8'));
          let peer = Array.from(this.peers.values()).find(p => p.id === address);
          if (!peer) {
            peer = this.wrapOutgoingPeer(address, ws);
            this.peers.set(peer.id, peer);
          }
          this.handleMessage(message, peer);
        } catch (e: any) {
          getLogger().warn(`Malformed message from ${address}: ${e.message}`);
        }
      });

      ws.on('close', () => {
        this.peers.delete(address);
        this.attemptedAddresses.delete(address);
      });
      ws.on('error', (err: any) => {
        getLogger().debug(`Error connecting to ${address}: ${err.message}`);
        this.peers.delete(address);
        this.attemptedAddresses.delete(address);
      });
    } catch (e: any) {
      getLogger().warn(`Failed to connect to ${address}: ${e.message}`);
    }
  }

  private wrapOutgoingPeer(address: string, ws: WebSocket): PeerConnection {
    return {
      id: address,
      nodeId: null,
      isOpen: () => ws.readyState === WebSocket.OPEN,
      send: (m: any): boolean => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        try {
          ws.send(JSON.stringify(m));
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
  }

  private sendHandshake(peer: PeerConnection): void {
    const payload = {
      nodeId: this.config.nodeId,
      publicKey: this.config.publicKey,
      timestamp: new Date().toISOString(),
    };
    const signature = CryptoManager.sign(canonicalJSON(payload), this.config.privateKey);

    peer.send({
      type: 'HANDSHAKE',
      version: '1.0',
      timestamp: new Date().toISOString(),
      payload,
      signature,
    });
  }

  private handleConnection(peer: PeerConnection): void {
    // Incoming connection: send handshake first
    this.sendHandshake(peer);
  }

  private handleMessage(message: any, peer: PeerConnection): void {
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'HANDSHAKE':
        this.handleHandshake(message, peer);
        break;
      case 'TX_BROADCAST':
        this.handleTxBroadcast(message, peer);
        break;
      case 'BLOCK_BROADCAST':
        this.handleBlockBroadcast(message, peer);
        break;
      case 'BLOCK_REQUEST':
        this.handleBlockRequest(message, peer);
        break;
      case 'BLOCK_RESPONSE':
        this.handleBlockResponse(message);
        break;
      case 'SYNC_REQUEST':
        this.handleSyncRequest(message, peer);
        break;
      case 'SYNC_RESPONSE':
        this.handleSyncResponse(message);
        break;
      case 'PEER_ANNOUNCE':
        this.handlePeerAnnounce(message);
        break;
      case 'HEARTBEAT':
        break;
      default:
        break;
    }
  }

  private authPeer(payload: any, signature: string): boolean {
    try {
      if (!payload || !payload.nodeId || !payload.publicKey) return false;
      const data = canonicalJSON(payload);
      return CryptoManager.verify(data, signature, payload.publicKey);
    } catch {
      return false;
    }
  }

  private handleHandshake(message: any, peer: PeerConnection): void {
    const { payload, signature } = message;
    if (!this.authPeer(payload, signature)) {
      getLogger().warn(`Handshake verification FAILED for peer`);
      peer.close();
      return;
    }

    peer.nodeId = payload.nodeId;
    peer.publicKey = payload.publicKey;
    this.peers.set(peer.id, peer);

    const validator = this.chain.getState().getValidator(payload.nodeId);
    if (validator && !validator.publicKey && validator.status === 'ACTIVE') {
      this.chain.updateValidatorKey(payload.nodeId, payload.publicKey);
      getLogger().info(`Validator public key registered for ${payload.nodeId}`);
    }

    const known = this.chain.getStorage().peerStore.getPeer(payload.nodeId);
    if (known) {
      known.lastSeen = new Date().toISOString();
      this.chain.getStorage().peerStore.addPeer(known);
    } else {
      this.chain.getStorage().peerStore.addPeer({
        nodeId: payload.nodeId,
        address: '',
        lastSeen: new Date().toISOString(),
        isValidator: false,
      });
    }

    getLogger().info(`Peer authenticated: ${payload.nodeId}`);

    const blockCount = this.chain.getHeight() + 1;
    peer.send({
      type: 'SYNC_REQUEST',
      version: '1.0',
      timestamp: new Date().toISOString(),
      fromHeight: blockCount,
    });
  }

  private handleTxBroadcast(message: any, peer: PeerConnection): void {
    const { tx } = message;
    if (!tx || !tx.id) return;

    if (!peer.publicKey) return;

    const signature = message.signature;
    if (!signature) return;

    try {
      const payload = { tx };
      if (!CryptoManager.verify(canonicalJSON(payload), signature, peer.publicKey)) {
        getLogger().warn(`TX_BROADCAST signature verification FAILED for ${peer.nodeId}`);
        return;
      }
    } catch {
      return;
    }

    if (this.lastProcessedTx.has(tx.id)) return;

    const error = this.consensus.addTransaction(tx);
    if (error) {
      getLogger().debug(`TX ${tx.id} not accepted: ${error}`);
      return;
    }

    this.lastProcessedTx.add(tx.id);
    if (this.lastProcessedTx.size > 10000) {
      const first = this.lastProcessedTx.values().next().value as string;
      this.lastProcessedTx.delete(first);
    }

    this.broadcast({
      type: 'TX_BROADCAST',
      version: '1.0',
      timestamp: new Date().toISOString(),
      tx,
      signature: CryptoManager.sign(
        canonicalJSON({ tx }),
        this.config.privateKey,
      ),
      sender: this.config.nodeId,
    });
  }

  private handleBlockBroadcast(message: any, peer: PeerConnection): void {
    const { block } = message;
    if (!block || !block.hash) return;

    if (this.lastProcessedBlock.has(block.hash)) return;
    this.lastProcessedBlock.add(block.hash);

    const proposer = this.chain.getState().getValidator(block.header.proposerId);
    const verifyKey = (proposer && proposer.publicKey) || peer.publicKey;

    if (verifyKey) {
      const headerData = getBlockSigningData({
        header: block.header,
        transactions: block.transactions,
      });

      const proposerSig =
        (Array.isArray(block.validatorSignatures) &&
          block.validatorSignatures.find(
            (s: any) => s.validatorId === block.header.proposerId,
          )?.signature) ||
        undefined;

      const signature = message.signature || proposerSig;
      if (!signature) {
        getLogger().warn(`BLOCK_BROADCAST missing signature for ${block.hash.slice(0, 12)}`);
        return;
      }

      if (!CryptoManager.verify(headerData, signature, verifyKey)) {
        getLogger().warn(`BLOCK_BROADCAST signature verification FAILED for ${block.hash.slice(0, 12)}`);
        return;
      }
    }

    this.consensus.validateAndCommit(block);
    this.broadcast({
      ...message,
      block,
      signature: undefined,
    });
  }

  private handleBlockRequest(message: any, peer: PeerConnection): void {
    const { height, hash } = message.payload || {};
    let block: Block | null = null;

    if (hash) block = this.chain.getBlockByHash(hash);
    else if (typeof height === 'number') block = this.chain.getBlockByHeight(height);

    if (block) {
      peer.send({
        type: 'BLOCK_RESPONSE',
        version: '1.0',
        timestamp: new Date().toISOString(),
        block,
      });
    }
  }

  private handleBlockResponse(message: any): void {
    const { block } = message;
    if (block) {
      this.consensus.validateAndCommit(block);
    }
  }

  private handleSyncRequest(message: any, peer: PeerConnection): void {
    const { fromHeight } = message;
    const full = this.chain.getStorage().blockStore.iterBlocks();
    const blocks = full.filter((b: any) => b.header.height >= (fromHeight || 0));

    const tip = this.chain.getTip();
    peer.send({
      type: 'SYNC_RESPONSE',
      version: '1.0',
      timestamp: new Date().toISOString(),
      blocks,
      tipHeight: tip.height,
    });
  }

  private handleSyncResponse(message: any): void {
    const { blocks, tipHeight } = message;
    if (!Array.isArray(blocks)) return;

    for (const block of blocks) {
      this.consensus.validateAndCommit(block);
    }

    getLogger().info(`Synchronized to height ${this.chain.getHeight()}`);
  }

  private handlePeerAnnounce(message: any): void {
    const { peerNodeId, address } = message;
    if (!peerNodeId) return;

    if (this.chain.getStorage().peerStore.hasPeer(peerNodeId)) return;

    this.chain.getStorage().peerStore.addPeer({
      nodeId: peerNodeId,
      address: address || '',
      lastSeen: new Date().toISOString(),
      isValidator: false,
    });
  }

  handleDisconnect(peerId: string, nodeId: string | null): void {
    this.peers.delete(peerId);
    if (nodeId) {
      getLogger().info(`Peer disconnected: ${nodeId}`);
    }
  }

  broadcastTransaction(tx: Transaction): void {
    if (!this.transport) return;
    const message = {
      type: 'TX_BROADCAST',
      version: '1.0',
      timestamp: new Date().toISOString(),
      tx,
      signature: CryptoManager.sign(
        canonicalJSON({ tx }),
        this.config.privateKey,
      ),
      sender: this.config.nodeId,
    };
    this.transport.broadcast(message);
  }

  broadcastBlock(block: Block): void {
    if (!this.transport) return;

    const proposerSig =
      (Array.isArray(block.validatorSignatures) &&
        block.validatorSignatures.find(
          (s: any) => s.validatorId === block.header.proposerId,
        )?.signature) ||
      '';

    const message = {
      type: 'BLOCK_BROADCAST',
      version: '1.0',
      timestamp: new Date().toISOString(),
      block,
      signature: proposerSig,
    };

    this.transport.broadcast(message);
  }

  broadcast(message: any): void {
    if (this.transport) {
      this.transport.broadcast(message);
    }
  }

  getPeerCount(): number {
    return this.transport ? this.transport.getPeerCount() : 0;
  }

  getConnectedNodeIds(): string[] {
    return Array.from(this.peers.values())
      .filter(p => p.nodeId)
      .map(p => p.nodeId as string);
  }
}

function cryptoRandomId(): string {
  return require('crypto').randomBytes(16).toString('hex');
}
