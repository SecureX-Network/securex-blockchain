import { Transaction, getSigningData, ALL_TRANSACTION_TYPES } from '../transaction/transaction';
import { StateManager } from '../state/state';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { ModuleRegistry } from '../../modules/registry';
import { BlockchainError } from '../errors';
import { isSupportedProtocolVersion, isSupportedTransactionVersion } from '../version';
import { timingSafeEqual } from 'crypto';
import { canonicalJSON } from '../../crypto/hashing/hash';

export const ALLOWED_TRANSACTION_TYPES = ALL_TRANSACTION_TYPES;

export class TransactionValidator {
  private registry: ModuleRegistry;

  constructor(registry: ModuleRegistry) {
    this.registry = registry;
  }

  validate(state: StateManager, tx: Transaction, isProposer: boolean = false): string | null {
    if (!tx || typeof tx !== 'object') return BlockchainError.INVALID_TRANSACTION;

    if (!isSupportedProtocolVersion(tx.protocolVersion)) return BlockchainError.UNSUPPORTED_PROTOCOL_VERSION;
    if (!isSupportedTransactionVersion(tx.transactionVersion)) return BlockchainError.UNSUPPORTED_TRANSACTION_VERSION;

    if (!tx.id || typeof tx.id !== 'string') return BlockchainError.INVALID_TX_ID;

    if (!ALLOWED_TRANSACTION_TYPES.includes(tx.type)) return BlockchainError.UNKNOWN_TX_TYPE;

    if (!tx.sender || typeof tx.sender !== 'string') return BlockchainError.INVALID_SENDER;

    if (typeof tx.nonce !== 'number' || !Number.isInteger(tx.nonce) || tx.nonce < 0) {
      return BlockchainError.INVALID_NONCE;
    }

    if (!tx.signature || typeof tx.signature !== 'string') return BlockchainError.MISSING_SIGNATURE;

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

    const senderKey = this.resolveSenderKey(state, tx.sender);
    if (!senderKey) return BlockchainError.UNAUTHORIZED_SENDER;

    if (!CryptoManager.verify(signingData, tx.signature, senderKey)) {
      return BlockchainError.INVALID_SIGNATURE;
    }

    const nonce = state.getNonce(tx.sender);
    if (tx.nonce <= nonce) return BlockchainError.REPLAYED_TRANSACTION;

    if (!this.registry.has(tx.type)) return BlockchainError.UNSUPPORTED_TX_TYPE;

    const module = this.registry.get(tx.type)!;
    const result = module.validate(state, tx);
    if (!result.valid) {
      for (const err of Object.values(BlockchainError)) {
        if (result.error === err) return result.error;
      }
      return result.error || BlockchainError.INVALID_TRANSACTION;
    }

    return null;
  }

  verifyTransactionSignature(state: StateManager, tx: Transaction): boolean {
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
    const senderKey = this.resolveSenderKey(state, tx.sender);
    if (!senderKey) return false;
    return CryptoManager.verify(signingData, tx.signature, senderKey);
  }

  resolveSenderKey(state: StateManager, sender: string): string | null {
    const validators = state.getValidators();
    for (const v of validators) {
      const vKey = v.publicKey;
      if (v.validatorId === sender) return vKey;
      if (vKey && CryptoManager.deriveNodeId(vKey) === sender) return vKey;
    }

    const issuers = state.getAllIssuers();
    for (const issuer of issuers) {
      if (issuer.issuerId === sender) return issuer.publicKey;
      if (CryptoManager.deriveNodeId(issuer.publicKey) === sender) return issuer.publicKey;
    }

    return null;
  }
}
