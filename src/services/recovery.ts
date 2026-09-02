import { Chain } from '../core/chain';
import { Block } from '../core/block/block';
import { BlockchainError } from '../core/errors';
import { getLogger } from '../utils/logger';

export interface RecoveryResult {
  recovered: boolean;
  height: number;
  blocksValidated: number;
  stateValidated: boolean;
  error?: BlockchainError;
  message?: string;
}

export class ChainRecovery {
  private chain: Chain;

  constructor(chain: Chain) {
    this.chain = chain;
  }

  recover(): RecoveryResult {
    const height = this.chain.getHeight();

    if (height < 0) {
      return {
        recovered: true,
        height: -1,
        blocksValidated: 0,
        stateValidated: true,
        message: 'Empty chain, awaiting genesis',
      };
    }

    let blocksValidated = 0;
    let previousHash: string | null = null;
    let previousHeight = -1;

    for (let h = 0; h <= height; h++) {
      const block = this.chain.getBlockByHeight(h);
      if (!block) {
        return {
          recovered: false,
          height: h - 1,
          blocksValidated,
          stateValidated: false,
          error: BlockchainError.CORRUPTED_STORAGE,
          message: `Missing block at height ${h}`,
        };
      }

      if (h === 0) {
        if (block.header.previousHash !== '0'.repeat(64)) {
          return {
            recovered: false,
            height: h,
            blocksValidated,
            stateValidated: false,
            error: BlockchainError.CORRUPTED_STORAGE,
            message: `Genesis block has invalid previous hash`,
          };
        }
      } else {
        if (block.header.previousHash !== previousHash) {
          return {
            recovered: false,
            height: h,
            blocksValidated,
            stateValidated: false,
            error: BlockchainError.CORRUPTED_STORAGE,
            message: `Block ${h} previousHash does not link to block ${h - 1}`,
          };
        }

        const expectedHash = this.chain.computeBlockHash(block.header, block.transactions);
        if (expectedHash !== block.hash) {
          return {
            recovered: false,
            height: h,
            blocksValidated,
            stateValidated: false,
            error: BlockchainError.CORRUPTED_STORAGE,
            message: `Block ${h} hash mismatch (tampered storage)`,
          };
        }
      }

      const merkleRoot = this.chain.computeMerkleRoot(block.transactions, block.header.version);
      if (merkleRoot !== block.header.merkleRoot) {
        return {
          recovered: false,
          height: h,
          blocksValidated,
          stateValidated: false,
          error: BlockchainError.INVALID_MERKLE_ROOT,
          message: `Block ${h} Merkle root mismatch`,
        };
      }

      previousHash = block.hash;
      previousHeight = h;
      blocksValidated++;
    }

    const stateHeight = this.chain.getStorage().stateStore.getHeight();
    const stateValidated = stateHeight >= height;

    return {
      recovered: true,
      height,
      blocksValidated,
      stateValidated,
      message: `Recovered chain: ${blocksValidated} blocks validated at height ${height}`,
    };
  }
}
