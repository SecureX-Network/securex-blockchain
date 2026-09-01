import { SHA256Hasher, canonicalJSON } from '../../crypto/hashing/hash';
import { Block, GENESIS_HASH, getBlockSigningData } from '../block/block';
import { MerkleTree } from '../../merkle/merkle';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { StateManager } from '../state/state';
import { TransactionValidator } from './tx-validator';

export interface TipInfo {
  height: number;
  hash: string;
}

export class BlockValidator {
  private txValidator: TransactionValidator;

  constructor(txValidator: TransactionValidator) {
    this.txValidator = txValidator;
  }

  computeMerkleRoot(transactions: any[]): string {
    if (transactions.length === 0) return '0'.repeat(64);
    const txHashes = transactions.map(tx => (typeof tx.id === 'string' ? tx.id : sha256(tx)));
    const tree = new MerkleTree(txHashes);
    return tree.getRoot();
  }

  validate(state: StateManager, block: Block, tip: TipInfo): string | null {
    if (!block || typeof block !== 'object') return 'INVALID_BLOCK';
    if (!block.header || !Array.isArray(block.transactions)) return 'INVALID_BLOCK_STRUCTURE';

    if (block.header.version !== 1) return 'UNSUPPORTED_BLOCK_VERSION';

    if (block.header.height === 0) {
      return this.validateGenesis(block);
    }

    if (block.header.height !== tip.height + 1) return 'INVALID_BLOCK_HEIGHT';

    if (block.header.previousHash !== tip.hash) return 'INVALID_PREVIOUS_HASH';

    const merkleRoot = this.computeMerkleRoot(block.transactions);
    if (merkleRoot !== block.header.merkleRoot) return 'INVALID_MERKLE_ROOT';

    const signingData = getBlockSigningData({
      header: block.header,
      transactions: block.transactions,
    });

    const proposer = state.getValidator(block.header.proposerId);
    if (!proposer) return 'UNKNOWN_VALIDATOR';
    if (!state.isAuthorizedValidator(block.header.proposerId)) return 'UNAUTHORIZED_VALIDATOR';

    let proposerSigned = false;
    for (const sig of block.validatorSignatures) {
      if (sig.validatorId === block.header.proposerId) {
        if (CryptoManager.verify(signingData, sig.signature, proposer.publicKey)) {
          proposerSigned = true;
        }
      }
    }
    if (!proposerSigned) return 'INVALID_PROPOSER_SIGNATURE';

    for (const tx of block.transactions) {
      const error = this.txValidator.validate(state, tx);
      if (error) {
        return `INVALID_TX_IN_BLOCK:${error}`;
      }
    }

    return null;
  }

  validateGenesis(block: Block): string | null {
    if (block.header.previousHash !== GENESIS_HASH) return 'INVALID_GENESIS_PREVIOUS_HASH';
    if (block.header.height !== 0) return 'INVALID_GENESIS_HEIGHT';
    if (block.transactions.length > 0) return 'GENESIS_MUST_BE_EMPTY';
    return null;
  }
}

function sha256(obj: any): string {
  return SHA256Hasher.hash(canonicalJSON(obj));
}
