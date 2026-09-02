import {
  Transaction,
  TransactionType,
} from '../../core/transaction/transaction';
import { StateManager, IssuerRecord } from '../../core/state/state';
import {
  TransactionModule,
  ValidationResult,
  ApplyContext,
} from '../registry';
import { CryptoManager } from '../../crypto/signatures/crypto';

function isAuthorizedValidatorOrIssuer(state: StateManager, tx: Transaction): boolean {
  if (state.isAuthorizedValidator(tx.sender)) return true;
  const issuer = state.getIssuer(tx.sender);
  if (issuer && issuer.status === 'ACTIVE') return true;
  for (const v of state.getValidators()) {
    if (v.publicKey && CryptoManager.deriveNodeId(v.publicKey) === tx.sender) return true;
  }
  return false;
}

export class IssuerModule implements TransactionModule {
  readonly type = TransactionType.ISSUER_REGISTER;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { issuerId, name, publicKey } = tx.payload;

    if (!issuerId || typeof issuerId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: issuerId required' };
    }
    if (!name || typeof name !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: name required' };
    }
    if (!publicKey || typeof publicKey !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: publicKey required' };
    }

    if (tx.protocolVersion === '1.0' && tx.transactionVersion === 1) {
      if (!state.isAuthorizedValidator(tx.sender)) {
        const issuer = state.getIssuer(tx.sender);
        if (!issuer || issuer.status !== 'ACTIVE') {
          if (!isAuthorizedValidatorOrIssuer(state, tx)) {
            return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
          }
        }
      }
    } else if (!isAuthorizedValidatorOrIssuer(state, tx)) {
      return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
    }

    if (state.getIssuer(issuerId)) {
      return { valid: false, error: 'ISSUER_ALREADY_REGISTERED' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { issuerId, name, publicKey, metadata } = tx.payload;

    const issuer: IssuerRecord = {
      issuerId,
      name,
      publicKey,
      status: 'ACTIVE',
      registeredAt: context.timestamp,
      metadata: metadata || {},
    };

    state.setIssuer(issuer);
  }
}

export class IssuerUpdateModule implements TransactionModule {
  readonly type = TransactionType.ISSUER_UPDATE;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { issuerId } = tx.payload;

    if (!issuerId || typeof issuerId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: issuerId required' };
    }

    const issuer = state.getIssuer(issuerId);
    if (!issuer) {
      return { valid: false, error: 'UNKNOWN_ISSUER' };
    }

    if (issuer.status === 'REVOKED') {
      return { valid: false, error: 'ISSUER_REVOKED' };
    }

    if (tx.sender !== issuer.issuerId && CryptoManager.deriveNodeId(issuer.publicKey) !== tx.sender) {
      return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { issuerId, metadata, name } = tx.payload;
    const issuer = state.getIssuer(issuerId)!;

    if (name) issuer.name = name;
    if (metadata) issuer.metadata = { ...issuer.metadata, ...metadata };
    issuer.updatedAt = context.timestamp;

    state.setIssuer(issuer);
  }
}
