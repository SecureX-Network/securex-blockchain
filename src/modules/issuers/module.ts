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

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { issuerId, metadata, name } = tx.payload;
    const issuer = state.getIssuer(issuerId)!;

    if (name) issuer.name = name;
    if (metadata) issuer.metadata = { ...issuer.metadata, ...metadata };

    state.setIssuer(issuer);
  }
}
