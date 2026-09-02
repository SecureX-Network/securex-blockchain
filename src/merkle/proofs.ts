import { MerkleTree, MerkleProofElement } from '../merkle/merkle';
import { Block } from '../core/block/block';
import { Transaction, computeTransactionHash } from '../core/transaction/transaction';
import { canonicalJSON } from '../crypto/hashing/hash';
import { SHA256Hasher } from '../crypto/hashing/hash';
import { BlockchainError } from '../core/errors';

export interface TransactionMerkleProof {
  transactionId: string;
  transactionHash: string;
  leafHash: string;
  leafIndex: number;
  proof: MerkleProofElement[];
  merkleRoot: string;
  blockHeight: number;
  blockHash: string;
  blockPreviousHash: string;
  blockTimestamp: string;
  blockProposer: string;
  blockVersion: number;
  protocolVersion: string;
  verified: boolean;
}

export interface InclusionProofVerificationResult {
  valid: boolean;
  error?: BlockchainError;
  evidence?: TransactionMerkleProof;
}

export function canonicalTransactionHash(tx: Transaction): string {
  return computeTransactionHash(tx);
}

export function leafForTransaction(tx: Transaction, blockVersion: number = 1): string {
  if (blockVersion >= 2) {
    return SHA256Hasher.hash(canonicalJSON(tx));
  }
  return tx.id;
}

export class MerkleProofService {
  static buildBlockMerkleTree(block: Block): MerkleTree | null {
    if (block.transactions.length === 0) return null;
    const leaves = block.transactions.map(tx => leafForTransaction(tx, block.header.version));
    return new MerkleTree(leaves);
  }

  static getBlockMerkleRoot(block: Block): string {
    if (block.transactions.length === 0) return '0'.repeat(64);
    const tree = this.buildBlockMerkleTree(block);
    return tree ? tree.getRoot() : '0'.repeat(64);
  }

  static createTransactionProof(block: Block, transactionId: string): TransactionMerkleProof | null {
    const index = block.transactions.findIndex(tx => tx.id === transactionId);
    if (index === -1) return null;

    const tree = this.buildBlockMerkleTree(block);
    if (!tree) return null;

    const tx = block.transactions[index];
    const leafHash = leafForTransaction(tx, block.header.version);
    const proof = tree.getProof(index);
    const root = tree.getRoot();

    return {
      transactionId,
      transactionHash: canonicalTransactionHash(tx),
      leafHash,
      leafIndex: index,
      proof,
      merkleRoot: root,
      blockHeight: block.header.height,
      blockHash: block.hash,
      blockPreviousHash: block.header.previousHash,
      blockTimestamp: block.header.timestamp,
      blockProposer: block.header.proposerId,
      blockVersion: block.header.version,
      protocolVersion: `${block.header.version}.0`,
      verified: MerkleTree.verifyProof(leafHash, proof, root),
    };
  }

  static verifyInclusionProof(
    transactionHash: string,
    proof: TransactionMerkleProof,
  ): InclusionProofVerificationResult {
    const evidence = { ...proof };

    if (evidence.blockVersion === undefined) {
      evidence.blockVersion = 1;
    }

    const leafHash = evidence.blockVersion >= 2 ? transactionHash : evidence.transactionId;
    const validRoot = MerkleTree.verifyProof(evidence.leafHash, evidence.proof, evidence.merkleRoot);
    const leafConsistent = evidence.leafHash === leafHash;

    if (!validRoot || !leafConsistent) {
      return {
        valid: false,
        error: BlockchainError.INVALID_MERKLE_PROOF,
        evidence,
      };
    }

    const computedRoot = MerkleTree.verifyProof(
      evidence.leafHash,
      evidence.proof,
      evidence.merkleRoot,
    );
    if (!computedRoot) {
      return {
        valid: false,
        error: BlockchainError.INVALID_MERKLE_PROOF,
        evidence,
      };
    }

    return {
      valid: true,
      evidence: { ...evidence, verified: true },
    };
  }

  static verifyCredentialInclusion(
    credentialHash: string,
    proof: TransactionMerkleProof,
  ): InclusionProofVerificationResult {
    const result = this.verifyInclusionProof(credentialHash, proof);
    return result;
  }

  static anchorHashList(hashes: string[], sorted: boolean = true): { root: string; hashes: string[] } {
    const ordered = sorted ? [...hashes].sort() : [...hashes];
    const tree = new MerkleTree(ordered);
    return { root: tree.getRoot(), hashes: ordered };
  }
}
