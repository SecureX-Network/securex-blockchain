import { Chain } from '../core/chain';
import { TransactionMerkleProof, MerkleProofService } from '../merkle/proofs';
import { Block } from '../core/block/block';
import { Transaction } from '../core/transaction/transaction';
import { CredentialRecord, IssuerRecord } from '../core/state/state';
import { BlockchainError } from '../core/errors';
import { VerificationStatus, CredentialVerificationService, VerificationEvidence } from './verification';
import { StateManager } from '../core/state/state';

export interface BlockchainEvidenceQuery {
  credentialId: string;
}

export interface BlockchainEvidence {
  anchored: boolean;
  transaction?: {
    id: string;
    type: string;
    blockHeight: number;
    blockHash: string;
    valid: boolean;
  };
  block?: {
    height: number;
    hash: string;
    previousHash: string;
    timestamp: string;
    proposer: string;
  };
  issuerValid?: boolean;
  inclusionProof?: boolean;
  lifecycle?: Array<{
    type: string;
    timestamp: string;
    blockHeight: number;
    txId?: string;
  }>;
}

export interface EvidenceResult {
  available: boolean;
  evidence?: BlockchainEvidence;
  verification?: VerificationEvidence;
  error?: BlockchainError;
  message?: string;
}

export interface BlockchainEvidenceProvider {
  isCredentialAnchored(credentialId: string): EvidenceResult;
  getIssuanceTransaction(credentialId: string): EvidenceResult;
  getContainingBlock(credentialId: string): EvidenceResult;
  getInclusionProof(credentialId: string): EvidenceResult;
  getLifecycleHistory(credentialId: string): EvidenceResult;
  verifyInclusion(credentialId: string): EvidenceResult;
  isIssuerRecognized(issuerId: string): boolean;
}

export class ChainEvidenceProvider implements BlockchainEvidenceProvider {
  private chain: Chain;
  private verification: CredentialVerificationService;

  constructor(chain: Chain) {
    this.chain = chain;
    this.verification = new CredentialVerificationService(chain);
  }

  isCredentialAnchored(credentialId: string): EvidenceResult {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    if (!credential) {
      return { available: false, error: BlockchainError.UNKNOWN_CREDENTIAL, message: 'Credential not found on chain' };
    }
    const issuance = this.findIssuance(credential);
    return {
      available: true,
      evidence: {
        anchored: issuance !== null,
        transaction: issuance
          ? { id: issuance.id, type: issuance.type, blockHeight: issuance.blockHeight, blockHash: issuance.blockHash, valid: true }
          : undefined,
      },
    };
  }

  getIssuanceTransaction(credentialId: string): EvidenceResult {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    if (!credential) {
      return { available: false, error: BlockchainError.UNKNOWN_CREDENTIAL, message: 'Credential not found on chain' };
    }
    const issuance = this.findIssuance(credential);
    if (!issuance) {
      return { available: false, error: BlockchainError.TRANSACTION_NOT_FOUND, message: 'Issuance transaction not found' };
    }
    return {
      available: true,
      evidence: {
        anchored: true,
        transaction: { id: issuance.id, type: issuance.type, blockHeight: issuance.blockHeight, blockHash: issuance.blockHash, valid: true },
      },
    };
  }

  getContainingBlock(credentialId: string): EvidenceResult {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    if (!credential) {
      return { available: false, error: BlockchainError.UNKNOWN_CREDENTIAL, message: 'Credential not found on chain' };
    }
    const issuance = this.findIssuance(credential);
    if (!issuance) {
      return { available: false, error: BlockchainError.BLOCK_NOT_FOUND, message: 'Issuance block not found' };
    }
    const block = this.chain.getBlockByHeight(issuance.blockHeight);
    if (!block) {
      return { available: false, error: BlockchainError.BLOCK_NOT_FOUND, message: 'Issuance block not found' };
    }
    return {
      available: true,
      evidence: {
        anchored: true,
        block: {
          height: block.header.height,
          hash: block.hash,
          previousHash: block.header.previousHash,
          timestamp: block.header.timestamp,
          proposer: block.header.proposerId,
        },
      },
    };
  }

  getInclusionProof(credentialId: string): EvidenceResult {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    if (!credential) {
      return { available: false, error: BlockchainError.UNKNOWN_CREDENTIAL, message: 'Credential not found on chain' };
    }
    const issuance = this.findIssuance(credential);
    if (!issuance) {
      return { available: false, error: BlockchainError.TRANSACTION_NOT_FOUND, message: 'Issuance transaction not found' };
    }
    const block = this.chain.getBlockByHeight(issuance.blockHeight);
    if (!block) {
      return { available: false, error: BlockchainError.BLOCK_NOT_FOUND, message: 'Issuance block not found' };
    }
    const proof = MerkleProofService.createTransactionProof(block, issuance.id);
    if (!proof) {
      return { available: false, error: BlockchainError.INVALID_MERKLE_PROOF, message: 'Could not construct proof' };
    }
    const valid = proof.verified && MerkleProofService.verifyInclusionProof(proof.leafHash, proof).valid;
    return {
      available: true,
      evidence: {
        anchored: true,
        inclusionProof: valid,
        transaction: { id: issuance.id, type: issuance.type, blockHeight: issuance.blockHeight, blockHash: issuance.blockHash, valid },
      },
    };
  }

  getLifecycleHistory(credentialId: string): EvidenceResult {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    if (!credential) {
      return { available: false, error: BlockchainError.UNKNOWN_CREDENTIAL, message: 'Credential not found on chain' };
    }
    return {
      available: true,
      evidence: {
        anchored: true,
        lifecycle: credential.lifecycle,
      },
    };
  }

  verifyInclusion(credentialId: string): EvidenceResult {
    const base = this.getInclusionProof(credentialId);
    if (!base.available) return base;
    return {
      available: true,
      verification: this.verification.verifyCredentialSync(credentialId),
      evidence: base.evidence,
    };
  }

  isIssuerRecognized(issuerId: string): boolean {
    const issuer = this.chain.getState().getIssuer(issuerId);
    return issuer !== undefined && issuer.status === 'ACTIVE';
  }

  private findIssuance(credential: CredentialRecord): { id: string; type: string; blockHeight: number; blockHash: string } | null {
    const firstEvent = credential.lifecycle.find(ev => ev.type === 'ISSUED');
    const txId = firstEvent?.txId;
    if (!txId) return null;
    const record = this.chain.getTransaction(txId);
    if (!record) return null;
    return {
      id: record.id,
      type: record.tx.type,
      blockHeight: record.blockHeight,
      blockHash: record.blockHash,
    };
  }
}
