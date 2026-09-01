import * as fs from 'fs';
import * as path from 'path';
import { JsonFileStore } from './utils';
import {
  BlockStoreInterface,
  TransactionStoreInterface,
  StateStoreInterface,
  PeerStoreInterface,
  TransactionRecord,
  PeerRecord,
  Storage,
} from './interfaces';

export { Storage } from './interfaces';

export class FileBlockStore extends JsonFileStore implements BlockStoreInterface {
  private blocksDir: string;
  private indexFile: string;
  private height = -1;
  private hashIndex: Map<string, number> = new Map();

  constructor(dataDir: string) {
    super(path.join(dataDir, 'blocks'));
    this.blocksDir = this.dataDir;
    this.indexFile = path.join(this.dataDir, 'index.json');
    this.init();
  }

  private init(): void {
    if (!fs.existsSync(this.indexFile)) {
      this.writeFile(this.indexFile, { blockCount: 0, hashIndex: {} });
    } else {
      const idx = this.readFile(this.indexFile);
      if (idx) {
        this.height = Math.max(-1, (idx.blockCount || 0) - 1);
        this.hashIndex = new Map(Object.entries(idx.hashIndex || {}));
      }
    }
  }

  putBlock(height: number, block: any): void {
    const filePath = path.join(this.blocksDir, `${String(height).padStart(8, '0')}.json`);
    this.writeFile(filePath, block);

    this.height = Math.max(this.height, height);
    this.hashIndex.set(block.hash, height);

    this.writeFile(this.indexFile, {
      blockCount: this.height + 1,
      hashIndex: Object.fromEntries(this.hashIndex),
    });
  }

  getBlockByHeight(height: number): any | null {
    const filePath = path.join(this.blocksDir, `${String(height).padStart(8, '0')}.json`);
    return this.readFile(filePath);
  }

  getBlockByHash(hash: string): any | null {
    const height = this.hashIndex.get(hash);
    if (height === undefined) return null;
    return this.getBlockByHeight(height);
  }

  getLatestBlock(): any | null {
    if (this.height < 0) return null;
    return this.getBlockByHeight(this.height);
  }

  getBlockCount(): number {
    return this.height + 1;
  }

  hasBlock(height: number, hash: string): boolean {
    const block = this.getBlockByHeight(height);
    return block !== null && block.hash === hash;
  }

  iterBlocks(): any[] {
    const blocks: any[] = [];
    for (let h = 0; h <= this.height; h++) {
      const block = this.getBlockByHeight(h);
      if (block) blocks.push(block);
    }
    return blocks;
  }
}

export class FileTransactionStore extends JsonFileStore implements TransactionStoreInterface {
  private txFile: string;
  private transactions: Map<string, TransactionRecord> = new Map();

  constructor(dataDir: string) {
    super(path.join(dataDir, 'transactions'));
    this.txFile = path.join(this.dataDir, 'transactions.json');
    this.init();
  }

  private init(): void {
    const data = this.readFile(this.txFile);
    if (data && data.transactions) {
      for (const [id, record] of Object.entries(data.transactions)) {
        this.transactions.set(id, record as TransactionRecord);
      }
    }
  }

  putTransaction(tx: any, blockHeight: number, blockHash: string): void {
    this.transactions.set(tx.id, { id: tx.id, blockHeight, blockHash, tx });
    this.persist();
  }

  getTransaction(id: string): TransactionRecord | null {
    return this.transactions.get(id) || null;
  }

  hasTransaction(id: string): boolean {
    return this.transactions.has(id);
  }

  getTransactionCount(): number {
    return this.transactions.size;
  }

  private persist(): void {
    this.writeFile(this.txFile, {
      transactions: Object.fromEntries(this.transactions),
    });
  }
}

export class FileStateStore extends JsonFileStore implements StateStoreInterface {
  private stateFile: string;
  private state: any | null = null;
  private height = -1;

  constructor(dataDir: string) {
    super(path.join(dataDir, 'state'));
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.init();
  }

  private init(): void {
    const data = this.readFile(this.stateFile);
    if (data && data.state) {
      this.state = data.state;
      this.height = data.height || -1;
    }
  }

  getState(): any | null {
    return this.state;
  }

  putState(state: any, height: number): void {
    this.state = state;
    this.height = height;
    this.writeFile(this.stateFile, { state, height, timestamp: new Date().toISOString() });
  }

  getHeight(): number {
    return this.height;
  }
}

export class FilePeerStore extends JsonFileStore implements PeerStoreInterface {
  private peerFile: string;
  private peers: Map<string, PeerRecord> = new Map();

  constructor(dataDir: string) {
    super(path.join(dataDir, 'peers'));
    this.peerFile = path.join(this.dataDir, 'peers.json');
    this.init();
  }

  private init(): void {
    const data = this.readFile(this.peerFile);
    if (data && data.peers) {
      for (const [id, peer] of Object.entries(data.peers)) {
        this.peers.set(id, peer as PeerRecord);
      }
    }
  }

  addPeer(peer: PeerRecord): void {
    this.peers.set(peer.nodeId, peer);
    this.persist();
  }

  getPeer(nodeId: string): PeerRecord | null {
    return this.peers.get(nodeId) || null;
  }

  getPeers(): PeerRecord[] {
    return Array.from(this.peers.values());
  }

  removePeer(nodeId: string): void {
    this.peers.delete(nodeId);
    this.persist();
  }

  hasPeer(nodeId: string): boolean {
    return this.peers.has(nodeId);
  }

  private persist(): void {
    this.writeFile(this.peerFile, {
      peers: Object.fromEntries(this.peers),
    });
  }
}

export function createFileStorage(dataDir: string): Storage {
  return {
    blockStore: new FileBlockStore(dataDir),
    transactionStore: new FileTransactionStore(dataDir),
    stateStore: new FileStateStore(dataDir),
    peerStore: new FilePeerStore(dataDir),
  };
}
