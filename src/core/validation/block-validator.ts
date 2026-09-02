import { SHA256Hasher, canonicalJSON } from '../../crypto/hashing/hash';
import { Block, GENESIS_HASH, getBlockSigningData } from '../block/block';
import { MerkleTree } from '../../merkle/merkle';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { StateManager } from '../state/state';
import { TransactionValidator } from './tx-validator';
import { isSupportedBlockVersion } from '../version';
import { BlockchainError } from '../errors';
import { computeTransactionHash } from '../transaction/transaction';

export interface TipInfo {
  height: number;
  hash: string;
}

export class BlockValidator {
  private txValidator: TransactionValidator;

  constructor(txValidator: TransactionValidator) {
    this.txValidator = txValidator;
  }

  computeMerkleRoot(transactions: any[], version: number = 1): string {
    if (transactions.length === 0) return '0'.repeat(64);
    const txHashes = transactions.map(tx =>
      version >= 2 ? sha256(canonicalJSON(tx)) : (typeof tx.id === 'string' ? tx.id : sha256(tx)),
    );
    const tree = new MerkleTree(txHashes);
    return tree.getRoot();
  }

  validate(state: StateManager, block: Block, tip: TipInfo): string | null {
    if (!block || typeof block !== 'object') return BlockchainError.INVALID_BLOCK;
    if (!block.header || !Array.isArray(block.transactions)) return BlockchainError.INVALID_BLOCK_STRUCTURE;

    if (!isSupportedBlockVersion(block.header.version)) return BlockchainError.UNSUPPORTED_BLOCK_VERSION;

    if (block.header.height === 0) {
      return this.validateGenesis(block);
    }

    if (block.header.height !== tip.height + 1) return BlockchainError.INVALID_BLOCK_HEIGHT;

    if (block.header.previousHash !== tip.hash) return BlockchainError.INVALID_PREVIOUS_HASH;

    const merkleRoot = this.computeMerkleRoot(block.transactions, block.header.version);
    if (merkleRoot !== block.header.merkleRoot) return BlockchainError.INVALID_MERKLE_ROOT;

    const expectedBlockHash = this.computeBlockHash(block.header, block.transactions);
    if (block.header.version >= 2 && expectedBlockHash !== block.hash) return BlockchainError.INVALID_BLOCK;

    const seenTxIds = new Set<string>();
    for (const tx of block.transactions) {
      if (!tx?.id) return BlockchainError.INVALID_TX_ID;
      if (seenTxIds.has(tx.id)) return BlockchainError.DUPLICATE_TRANSACTION;
      seenTxIds.add(tx.id);
    }

    const signingData = getBlockSigningData({
      header: block.header,
      transactions: block.transactions,
    });

    const proposer = state.getValidator(block.header.proposerId);
    if (!proposer) return BlockchainError.UNKNOWN_VALIDATOR;
    if (!state.isAuthorizedValidator(block.header.proposerId)) return BlockchainError.UNAUTHORIZED_VALIDATOR;

    let proposerSigned = false;
    for (const sig of block.validatorSignatures) {
      if (sig.validatorId === block.header.proposerId) {
        if (CryptoManager.verify(signingData, sig.signature, proposer.publicKey)) {
          proposerSigned = true;
        }
      }
    }
    if (!proposerSigned) return BlockchainError.INVALID_PROPOSER_SIGNATURE;

    for (const tx of block.transactions) {
      const error = this.txValidator.validate(state, tx);
      if (error) {
        return `INVALID_TX_IN_BLOCK:${error}`;
      }
    }

    return null;
  }

  computeBlockHash(header: any, transactions: any[]): string {
    const signingData = getBlockSigningData({ header, transactions });
    return SHA256Hasher.hash(signingData);
  }

  validateGenesis(block: Block): string | null {
    if (block.header.previousHash !== GENESIS_HASH) return BlockchainError.INVALID_GENESIS_PREVIOUS_HASH;
    if (block.header.height !== 0) return BlockchainError.INVALID_GENESIS_HEIGHT;
    if (block.transactions.length > 0) return BlockchainError.GENESIS_MUST_BE_EMPTY;
    return null;
  }
}

function sha256(obj: any): string {
  return SHA256Hasher.hash(canonicalJSON(obj));
}
