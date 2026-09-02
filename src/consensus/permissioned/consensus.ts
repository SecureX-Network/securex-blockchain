import { Chain } from '../../core/chain';
import { Block, getBlockSigningData } from '../../core/block/block';
import { Transaction } from '../../core/transaction/transaction';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { getLogger } from '../../utils/logger';

export interface ConsensusConfig {
  blockInterval: number;
  minSignatures: number;
}

export interface ConsensusEvents {
  onRejected?: (error: string | null, tx?: Transaction, block?: Block) => void;
}

export class PermissionedConsensus {
  private chain: Chain;
  private config: ConsensusConfig;
  private nodeId: string;
  private privateKey: string;
  private proposers: string[] = [];
  private pendingTxs: Transaction[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private events: ConsensusEvents;

  constructor(
    chain: Chain,
    config: ConsensusConfig,
    nodeId: string,
    privateKey: string,
    events: ConsensusEvents = {},
  ) {
    this.chain = chain;
    this.config = config;
    this.nodeId = nodeId;
    this.privateKey = privateKey;
    this.events = events;
  }

  setPanel(panel: string[]): void {
    this.proposers = [...panel];
  }

  getPanel(): string[] {
    return this.proposers;
  }

  getProposerForHeight(height: number): string | null {
    if (this.proposers.length === 0) return null;
    const next = this.chain.getHeight() + 1;
    const index = next % this.proposers.length;
    return this.proposers[index];
  }

  isCurrentProposer(): boolean {
    if (this.proposers.length === 0) return false;
    const next = this.chain.getHeight() + 1;
    const index = next % this.proposers.length;
    return this.proposers[index] === this.nodeId;
  }

  addTransaction(tx: Transaction): string | null {
    const error = this.chain.validateTransaction(tx);
    if (error) {
      this.events.onRejected?.(error, tx);
      return error;
    }

    if (this.pendingTxs.some(t => t.id === tx.id)) {
      this.events.onRejected?.('DUPLICATE_TRANSACTION', tx);
      return 'DUPLICATE_TRANSACTION';
    }

    this.pendingTxs.push(tx);
    getLogger().info(`Transaction queued: ${tx.id} (${tx.type})`);
    return null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    getLogger().info(`Consensus starting (block interval: ${this.config.blockInterval}ms)`);
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), Math.min(this.config.blockInterval, 1000));
  }

  private tick(): void {
    if (!this.running) return;

    if (this.isCurrentProposer() && this.proposers.includes(this.nodeId)) {
      this.proposeBlock();
    }

    this.scheduleNext();
  }

  proposeBlock(): Block | null {
    if (!this.proposers.includes(this.nodeId)) return null;

    const pending = this.pendingTxs;
    if (pending.length === 0) return null;

    const block = this.chain.createBlock(
      this.nodeId,
      pending,
      this.chain.getTip(),
    );

    const signingData = getBlockSigningData({
      header: block.header,
      transactions: block.transactions,
    });

    const signature = CryptoManager.sign(signingData, this.privateKey);
    block.validatorSignatures = [
      { validatorId: this.nodeId, signature },
    ];

    const error = this.chain.commitBlock(block);
    if (error) {
      getLogger().warn(`Proposal rejected locally: ${error}`);
      this.events.onRejected?.(error, undefined, block);
      return null;
    }

    this.pendingTxs = this.pendingTxs.filter(tx => !pending.includes(tx));

    getLogger().info(`Proposed and committed block ${block.header.height}`);
    return block;
  }

  validateAndCommit(block: Block): string | null {
    const existing = this.chain.getBlockByHash(block.hash);
    if (existing) return 'DUPLICATE_BLOCK';

    const signingData = getBlockSigningData({
      header: block.header,
      transactions: block.transactions,
    });

    for (const sig of block.validatorSignatures) {
      const validator = this.chain.getState().getValidator(sig.validatorId);
      if (validator && validator.publicKey) {
        if (!CryptoManager.verify(signingData, sig.signature, validator.publicKey)) {
          this.events.onRejected?.('INVALID_VALIDATOR_SIGNATURE', undefined, block);
          return 'INVALID_VALIDATOR_SIGNATURE';
        }
      }
    }

    const error = this.chain.commitBlock(block);
    if (error) {
      this.events.onRejected?.(error, undefined, block);
      return error;
    }

    this.pendingTxs = this.pendingTxs.filter(tx => !block.transactions.some(bt => bt.id === tx.id));

    return null;
  }

  getPendingTransactions(): Transaction[] {
    return [...this.pendingTxs];
  }

  getMinSignatures(): number {
    return this.config.minSignatures;
  }
}
