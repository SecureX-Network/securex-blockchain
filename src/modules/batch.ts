import {
  Transaction,
  TransactionType,
} from '../core/transaction/transaction';
import { StateManager } from '../core/state/state';
import {
  TransactionModule,
  ValidationResult,
  ApplyContext,
} from './registry';
import { MerkleTree } from '../merkle/merkle';
import { getLogger } from '../utils/logger';

export class BatchAnchorModule implements TransactionModule {
  readonly type = TransactionType.BATCH_ANCHOR;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { batchId, merkleRoot, credentialCount, credentialHashes } = tx.payload;

    if (!batchId || typeof batchId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: batchId required' };
    }
    if (!merkleRoot || typeof merkleRoot !== 'string' || merkleRoot.length !== 64) {
      return { valid: false, error: 'INVALID_PAYLOAD: merkleRoot must be 64-char hex' };
    }
    if (typeof credentialCount !== 'number' || credentialCount <= 0) {
      return { valid: false, error: 'INVALID_PAYLOAD: credentialCount must be positive' };
    }

    if (Array.isArray(credentialHashes)) {
      if (credentialHashes.length !== credentialCount) {
        return { valid: false, error: 'INVALID_PAYLOAD: credentialHashes count mismatch' };
      }
      for (const hash of credentialHashes) {
        if (typeof hash !== 'string' || hash.length !== 64) {
          return { valid: false, error: 'INVALID_PAYLOAD: invalid credential hash' };
        }
      }

      const tree = new MerkleTree(credentialHashes);
      if (tree.getRoot() !== merkleRoot) {
        return { valid: false, error: 'INVALID_MERKLE_PROOF' };
      }
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { batchId, merkleRoot, credentialCount } = tx.payload;
    getLogger().info(
      `Batch ${batchId} anchored with ${credentialCount} credentials (root: ${String(merkleRoot).slice(0, 12)}...)`,
    );
  }
}

export { MerkleTree };
