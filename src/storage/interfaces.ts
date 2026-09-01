export enum BlockStore {
  get = 'get',
}

export interface BlockRecord {
  height: number;
  hash: string;
  block: any;
}

export interface TransactionRecord {
  id: string;
  blockHeight: number;
  blockHash: string;
  tx: any;
}

export interface StateSnapshot {
  height: number;
  state: any;
  timestamp: string;
}

export interface PeerRecord {
  nodeId: string;
  address: string;
  lastSeen: string;
  isValidator: boolean;
}

export interface BlockStoreInterface {
  putBlock(height: number, block: any): void;
  getBlockByHeight(height: number): any | null;
  getBlockByHash(hash: string): any | null;
  getLatestBlock(): any | null;
  getBlockCount(): number;
  hasBlock(height: number, hash: string): boolean;
  iterBlocks(): any[];
}

export interface TransactionStoreInterface {
  putTransaction(tx: any, blockHeight: number, blockHash: string): void;
  getTransaction(id: string): TransactionRecord | null;
  hasTransaction(id: string): boolean;
  getTransactionCount(): number;
}

export interface StateStoreInterface {
  getState(): any | null;
  putState(state: any, height: number): void;
  getHeight(): number;
}

export interface PeerStoreInterface {
  addPeer(peer: PeerRecord): void;
  getPeer(nodeId: string): PeerRecord | null;
  getPeers(): PeerRecord[];
  removePeer(nodeId: string): void;
  hasPeer(nodeId: string): boolean;
}

export interface Storage {
  blockStore: BlockStoreInterface;
  transactionStore: TransactionStoreInterface;
  stateStore: StateStoreInterface;
  peerStore: PeerStoreInterface;
}
