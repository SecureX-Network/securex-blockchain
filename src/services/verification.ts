import { Chain } from '../core/chain';
import {
  TransactionMerkleProof,
  MerkleProofService,
  leafForTransaction,
} from '../merkle/proofs';
import { StateManager, CredentialStatus, IssuerRecord, CredentialRecord } from '../core/state/state';
import { Block } from '../core/block/block';
import { Transaction } from '../core/transaction/transaction';
import { BlockchainError } from '../core/errors';
import { CryptoManager } from '../crypto/signatures/crypto';
import { getSigningData } from '../core/transaction/transaction';

export enum VerificationStatus {
  VALID = 'VALID',
  REVOKED = 'REVOKED',
  SUSPENDED = 'SUSPENDED',
  INVALID = 'INVALID',
  NOT_FOUND = 'NOT_FOUND',
  UNVERIFIABLE = 'UNVERIFIABLE',
}

export interface VerificationEvidence {
  status: VerificationStatus;
  credentialId?: string;
  credentialHash?: string;
  holder?: string;
  issuer?: {
    issuerId: string;
    name: string;
    publicKey: string;
    status: string;
  };
  lifecycle?: {
    issuedAt: string;
    lastUpdated: string;
    version: string;
  };
  proof?: TransactionMerkleProof;
  block?: {
    height: number;
    hash: string;
    timestamp: string;
    previousHash: string;
    proposer: string;
    version: number;
  };
  transaction?: {
    id: string;
    type: string;
    sender: string;
    nonce: number;
    blockHeight: number;
    blockHash: string;
  };
  issuerSignatureValid?: boolean;
  error?: BlockchainError;
  errorMessage?: string;
}

export class CredentialVerificationService {
  private chain: Chain;

  constructor(chain: Chain) {
    this.chain = chain;
  }

  async verifyCredential(credentialId: string): Promise<VerificationEvidence> {
    return this.verifyCredentialSync(credentialId);
  }

  verifyCredentialSync(credentialId: string): VerificationEvidence {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    if (!credential) {
      return {
        status: VerificationStatus.NOT_FOUND,
        error: BlockchainError.UNKNOWN_CREDENTIAL,
      };
    }

    if (credential.status === CredentialStatus.REVOKED) {
      return this.buildEvidence(credential, VerificationStatus.REVOKED, state);
    }
    if (credential.status === CredentialStatus.SUSPENDED) {
      return this.buildEvidence(credential, VerificationStatus.SUSPENDED, state);
    }
    if (credential.status !== CredentialStatus.ACTIVE) {
      return this.buildEvidence(credential, VerificationStatus.INVALID, state);
    }

    const issuanceTx = this.findIssuanceTransaction(credential);
    if (!issuanceTx) {
      return {
        ...this.buildEvidence(credential, VerificationStatus.UNVERIFIABLE, state),
        error: BlockchainError.UNKNOWN_CREDENTIAL,
        errorMessage: 'Issuance transaction not found on chain',
      };
    }

    const block = this.chain.getBlockByHeight(issuanceTx.blockHeight);
    if (!block) {
      return {
        ...this.buildEvidence(credential, VerificationStatus.UNVERIFIABLE, state),
        error: BlockchainError.BLOCK_NOT_FOUND,
        errorMessage: 'Issuance block not found',
      };
    }

    const proof = MerkleProofService.createTransactionProof(block, issuanceTx.id);
    if (!proof) {
      return {
        ...this.buildEvidence(credential, VerificationStatus.UNVERIFIABLE, state),
        error: BlockchainError.INVALID_MERKLE_PROOF,
        errorMessage: 'Could not construct Merkle proof',
      };
    }

    const leafHash = leafForTransaction(issuanceTx.tx, block.header.version);
    const proofValid = this.verifyProof(leafHash, proof);

    if (!proofValid) {
      return {
        ...this.buildEvidence(credential, VerificationStatus.UNVERIFIABLE, state),
        error: BlockchainError.INVALID_MERKLE_PROOF,
        errorMessage: 'Merkle inclusion proof failed verification',
      };
    }

    const issuer = state.getIssuer(credential.issuerId);
    const issuerSignatureValid = issuer ? this.verifyIssuerSignature(issuer, issuanceTx.tx) : false;

    if (!issuer || issuer.status !== 'ACTIVE' || !issuerSignatureValid) {
      return {
        ...this.buildEvidence(credential, VerificationStatus.INVALID, state),
        issuerSignatureValid,
        error: BlockchainError.UNAUTHORIZED_ISSUER,
        errorMessage: 'Issuer identity could not be verified',
      };
    }

    return {
      ...this.buildEvidence(credential, VerificationStatus.VALID, state),
      proof,
      block: {
        height: block.header.height,
        hash: block.hash,
        timestamp: block.header.timestamp,
        previousHash: block.header.previousHash,
        proposer: block.header.proposerId,
        version: block.header.version,
      },
      transaction: {
        id: issuanceTx.id,
        type: issuanceTx.type,
        sender: issuanceTx.sender,
        nonce: issuanceTx.nonce,
        blockHeight: issuanceTx.blockHeight,
        blockHash: issuanceTx.blockHash,
      },
      issuerSignatureValid,
    };
  }

  private findIssuanceTransaction(credential: CredentialRecord): { id: string; blockHeight: number; blockHash: string; type: string; sender: string; nonce: number; tx: Transaction } | null {
    const firstEvent = credential.lifecycle.find(ev => ev.type === 'ISSUED');
    const txId = firstEvent?.txId;
    if (!txId) return null;

    const record = this.chain.getTransaction(txId);
    if (!record) return null;

    return {
      id: record.id,
      blockHeight: record.blockHeight,
      blockHash: record.blockHash,
      type: record.tx.type,
      sender: record.tx.sender,
      nonce: record.tx.nonce,
      tx: record.tx as Transaction,
    };
  }

  private verifyProof(leafHash: string, proof: TransactionMerkleProof): boolean {
    return MerkleTree_verifyProof(leafHash, proof);
  }

  private verifyIssuerSignature(issuer: IssuerRecord, tx: Transaction): boolean {
    try {
      const signingData = getSigningData({
        protocolVersion: tx.protocolVersion,
        transactionVersion: tx.transactionVersion,
        id: tx.id,
        type: tx.type,
        timestamp: tx.timestamp,
        sender: tx.sender,
        nonce: tx.nonce,
        payload: tx.payload,
      });
      return CryptoManager.verify(signingData, tx.signature, issuer.publicKey);
    } catch {
      return false;
    }
  }

  private buildEvidence(
    credential: CredentialRecord,
    status: VerificationStatus,
    state: StateManager,
  ): VerificationEvidence {
    const issuer = state.getIssuer(credential.issuerId);
    return {
      status,
      credentialId: credential.credentialId,
      credentialHash: credential.credentialHash,
      issuer: issuer
        ? {
            issuerId: issuer.issuerId,
            name: issuer.name,
            publicKey: issuer.publicKey,
            status: issuer.status,
          }
        : undefined,
      lifecycle: {
        issuedAt: credential.issuedAt,
        lastUpdated: credential.lastUpdated,
        version: credential.schemaVersion,
      },
    };
  }
}

function MerkleTree_verifyProof(leafHash: string, proof: TransactionMerkleProof): boolean {
  const { MerkleTree } = require('../merkle/merkle');
  return MerkleTree.verifyProof(leafHash, proof.proof, proof.merkleRoot);
}
