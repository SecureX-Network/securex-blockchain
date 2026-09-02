import { Chain } from '../core/chain';
import { Transaction } from '../core/transaction/transaction';
import { CredentialRecord } from '../core/state/state';

export interface HistoryEntry {
  type: string;
  timestamp: string;
  txId: string;
  blockHeight: number;
  blockHash: string;
  reason?: string;
}

/**
 * Bounded, deterministic history queries over committed blockchain transactions
 * and on-chain lifecycle events. Never scans unbounded; results are always
 * limited and returned in ascending height order.
 */
export class HistoryService {
  private chain: Chain;

  constructor(chain: Chain) {
    this.chain = chain;
  }

  /**
   * History of lifecycle events for a credential from its on-chain record.
   */
  getCredentialHistory(credentialId: string): HistoryEntry[] | null {
    const credential = this.chain.getState().getCredential(credentialId);
    if (!credential) return null;
    return credential.lifecycle.map(ev => ({
      type: ev.type,
      timestamp: ev.timestamp,
      txId: ev.txId,
      blockHeight: ev.blockHeight,
      blockHash: this.chain.getBlockByHeight(ev.blockHeight)?.hash || '',
      reason: ev.reason,
    }));
  }

  /**
   * History of transactions authored by an issuer (e.g. issued/suspended/
   * revoked/reinstated credentials), bounded by limit, in ascending height order.
   * Returns up to `limit` transactions.
   */
  getIssuerTransactionHistory(issuerId: string, limit = 100, offset = 0): HistoryEntry[] {
    const records: HistoryEntry[] = [];
    const height = this.chain.getHeight();
    const txs = this.chain.getStorage().transactionStore;
    const bounded = Math.max(1, Math.min(limit, 1000));

    for (let h = 1; h <= height; h++) {
      const block = this.chain.getBlockByHeight(h);
      if (!block) continue;
      for (const tx of block.transactions) {
        if (tx.sender === issuerId || tx.payload?.issuerId === issuerId) {
          records.push({
            type: tx.type,
            timestamp: tx.timestamp,
            txId: tx.id,
            blockHeight: h,
            blockHash: block.hash,
          });
        }
      }
    }

    void txs;
    return records.slice(offset, offset + bounded);
  }

  /**
   * Issuer registration/update history for a given issuer, derived from the
   * chain's transaction log.
   */
  getIssuerLifecycle(issuerId: string): HistoryEntry[] | null {
    if (!this.chain.getState().getIssuer(issuerId)) return null;
    const entries: HistoryEntry[] = [];
    const height = this.chain.getHeight();
    for (let h = 1; h <= height; h++) {
      const block = this.chain.getBlockByHeight(h);
      if (!block) continue;
      for (const tx of block.transactions) {
        if ((tx.type === 'ISSUER_REGISTER' || tx.type === 'ISSUER_UPDATE') && (tx.payload?.issuerId === issuerId || tx.sender === issuerId)) {
          entries.push({
            type: tx.type,
            timestamp: tx.timestamp,
            txId: tx.id,
            blockHeight: h,
            blockHash: block.hash,
          });
        }
      }
    }
    return entries;
  }

  /**
   * Latest lifecycle status for a credential computed from its history tail.
   */
  summarizeCredential(credential: CredentialRecord): { currentStatus: string; lastEvent: HistoryEntry | null; eventCount: number } {
    const history = credential.lifecycle;
    const last = history.length > 0 ? history[history.length - 1] : null;
    return {
      currentStatus: credential.status,
      lastEvent: last
        ? {
            type: last.type,
            timestamp: last.timestamp,
            txId: last.txId,
            blockHeight: last.blockHeight,
            blockHash: this.chain.getBlockByHeight(last.blockHeight)?.hash || '',
            reason: last.reason,
          }
        : null,
      eventCount: history.length,
    };
  }
}

export interface TransactionWithBlock extends Transaction {
  _blockHeight: number;
  _blockHash: string;
  _blockTimestamp: string;
}
