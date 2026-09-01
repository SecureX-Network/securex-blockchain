import { createHash } from 'crypto';
import { Block, GENESIS_HASH, getBlockSigningData, BlockHeader, ValidatorSignature } from './block/block';
import { Transaction, TransactionType } from './transaction/transaction';
import { TransactionValidator } from './validation/tx-validator';
import { BlockValidator, TipInfo } from './validation/block-validator';
import { StateManager, ValidatorRecord } from './state/state';
import { ModuleRegistry } from '../modules/registry';
import {
  Storage,
  BlockStoreInterface,
  TransactionStoreInterface,
  StateStoreInterface,
} from '../storage/interfaces';
import { MerkleTree } from '../merkle/merkle';
import { CryptoManager } from '../crypto/signatures/crypto';
import { getLogger } from '../utils/logger';
import { canonicalJSON } from '../crypto/hashing/hash';

export interface ChainEvents {
  onBlockCommitted?: (block: Block) => void;
}

export class Chain {
  private storage: Storage;
  private state: StateManager;
  private txValidator: TransactionValidator;
  private blockValidator: BlockValidator;
  private registry: ModuleRegistry;
  private events: ChainEvents;

  constructor(storage: Storage, registry: ModuleRegistry, events: ChainEvents = {}) {
    this.storage = storage;
    this.registry = registry;
    this.events = events;
    this.state = new StateManager(storage.stateStore);
    this.txValidator = new TransactionValidator(registry);
    this.blockValidator = new BlockValidator(this.txValidator);
  }

  getState(): StateManager {
    return this.state;
  }

  getTxValidator(): TransactionValidator {
    return this.txValidator;
  }

  getBlockValidator(): BlockValidator {
    return this.blockValidator;
  }

  getStorage(): Storage {
    return this.storage;
  }

  getHeight(): number {
    return this.storage.blockStore.getBlockCount() - 1;
  }

  getTip(): TipInfo {
    const latest = this.storage.blockStore.getLatestBlock();
    if (!latest) return { height: -1, hash: GENESIS_HASH };
    return { height: latest.header.height, hash: latest.hash };
  }

  getBlockByHeight(height: number): Block | null {
    return this.storage.blockStore.getBlockByHeight(height);
  }

  getBlockByHash(hash: string): Block | null {
    return this.storage.blockStore.getBlockByHash(hash);
  }

  getTransaction(id: string) {
    return this.storage.transactionStore.getTransaction(id);
  }

  hasTransaction(id: string): boolean {
    return this.storage.transactionStore.hasTransaction(id);
  }

  initGenesis(genesisTimestamp: string, initialValidators: string[]): void {
    if (this.storage.blockStore.getBlockCount() > 0) return;

    const header: BlockHeader = {
      version: 1,
      height: 0,
      timestamp: genesisTimestamp,
      previousHash: GENESIS_HASH,
      merkleRoot: '0'.repeat(64),
      proposerId: '',
    };

    const block: Block = {
      header,
      transactions: [],
      validatorSignatures: [],
      hash: this.computeBlockHash(header, []),
    };

    this.storage.blockStore.putBlock(0, block);

    const genesis = this.storage.blockStore.getBlockByHeight(0);

    for (const validatorId of initialValidators) {
      this.state.setValidator({
        validatorId,
        publicKey: '', // unknown until validator registers
        status: 'ACTIVE',
        addedAt: genesisTimestamp,
      });
    }

    this.state.setNonce(genesis.id || 'genesis', 0);
    this.state.persist(0);

    getLogger().info(`Genesis block created at height 0 (hash: ${block.hash})`);
  }

  computeBlockHash(header: BlockHeader, transactions: Transaction[]): string {
    const signingData = getBlockSigningData({ header, transactions });
    return createHash('sha256').update(signingData).digest('hex');
  }

  computeMerkleRoot(transactions: Transaction[]): string {
    return this.blockValidator.computeMerkleRoot(transactions);
  }

  createBlock(
    proposerId: string,
    transactions: Transaction[],
    previousTip: TipInfo,
  ): Block {
    const merkleRoot = this.blockValidator.computeMerkleRoot(transactions);

    const header: BlockHeader = {
      version: 1,
      height: previousTip.height + 1,
      timestamp: new Date().toISOString(),
      previousHash: previousTip.hash,
      merkleRoot,
      proposerId,
    };

    const blockHash = this.computeBlockHash(header, transactions);

    const block: Block = {
      header,
      transactions,
      validatorSignatures: [],
      hash: blockHash,
    };

    return block;
  }

  commitBlock(block: Block): string | null {
    if (this.storage.blockStore.hasBlock(block.header.height, block.hash)) {
      return 'DUPLICATE_BLOCK';
    }

    const tip = this.getTip();
    const error = this.blockValidator.validate(this.state, block, tip);
    if (error) {
      getLogger().warn(`Block ${block.header.height} rejected: ${error}`);
      return error;
    }

    if (block.header.height === 0) {
      this.storage.blockStore.putBlock(0, block);
    } else {
      this.storage.blockStore.putBlock(block.header.height, block);
    }

    for (const tx of block.transactions) {
      this.storage.transactionStore.putTransaction(tx, block.header.height, block.hash);
      this.applyTransaction(tx, block);
    }

    this.state.persist(block.header.height);

    if (this.events.onBlockCommitted) {
      this.events.onBlockCommitted(block);
    }

    getLogger().info(
      `Block ${block.header.height} committed (hash: ${block.hash.slice(0, 12)}..., txs: ${block.transactions.length})`,
    );

    return null;
  }

  private applyTransaction(tx: Transaction, block: Block): void {
    const module = this.registry.get(tx.type);
    if (!module) return;

    module.apply(this.state, tx, {
      blockHeight: block.header.height,
      txId: tx.id,
      timestamp: block.header.timestamp,
    });

    this.state.setNonce(tx.sender, tx.nonce);
  }

  validateTransaction(tx: Transaction): string | null {
    return this.txValidator.validate(this.state, tx);
  }

  getPendingValidatorsWithoutKey(): string[] {
    return this.state
      .getValidators()
      .filter(v => v.status === 'ACTIVE' && !v.publicKey)
      .map(v => v.validatorId);
  }

  updateValidatorKey(validatorId: string, publicKey: string): boolean {
    const validator = this.state.getValidator(validatorId);
    if (!validator) return false;
    validator.publicKey = publicKey;
    this.state.setValidator(validator);
    this.state.persist(this.getHeight());
    return true;
  }
}
