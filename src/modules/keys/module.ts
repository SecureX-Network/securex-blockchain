import {
  Transaction,
  TransactionType,
} from '../../core/transaction/transaction';
import { StateManager, KeyRecord } from '../../core/state/state';
import {
  TransactionModule,
  ValidationResult,
  ApplyContext,
} from '../registry';

export class KeyRegisterModule implements TransactionModule {
  readonly type = TransactionType.KEY_REGISTER;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { keyId, ownerId, publicKey, algorithm } = tx.payload;

    if (!keyId || typeof keyId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: keyId required' };
    }
    if (!ownerId || typeof ownerId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: ownerId required' };
    }
    if (!publicKey || typeof publicKey !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: publicKey required' };
    }

    if (state.getKey(keyId)) {
      return { valid: false, error: 'KEY_ALREADY_REGISTERED' };
    }

    const issuer = state.getIssuer(ownerId);
    if (issuer && issuer.status !== 'ACTIVE') {
      return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { keyId, ownerId, publicKey, algorithm, purpose, metadata } = tx.payload;

    const key: KeyRecord = {
      keyId,
      ownerId,
      publicKey,
      algorithm: algorithm || 'ed25519',
      status: 'ACTIVE',
      registeredAt: context.timestamp,
      metadata: { ...(metadata || {}), purpose: purpose || 'signing' },
    };

    state.setKey(key);
  }
}

export class KeyRotateModule implements TransactionModule {
  readonly type = TransactionType.KEY_ROTATE;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { oldKeyId, newKeyId, newPublicKey } = tx.payload;

    if (!oldKeyId || typeof oldKeyId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: oldKeyId required' };
    }
    if (!newKeyId || typeof newKeyId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: newKeyId required' };
    }
    if (!newPublicKey || typeof newPublicKey !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: newPublicKey required' };
    }

    const oldKey = state.getKey(oldKeyId);
    if (!oldKey) {
      return { valid: false, error: 'UNKNOWN_KEY' };
    }
    if (oldKey.status !== 'ACTIVE') {
      return { valid: false, error: 'KEY_NOT_ACTIVE' };
    }
    if (state.getKey(newKeyId)) {
      return { valid: false, error: 'NEW_KEY_ALREADY_REGISTERED' };
    }

    const issuer = state.getIssuer(oldKey.ownerId);
    if (issuer && issuer.status !== 'ACTIVE') {
      return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { oldKeyId, newKeyId, newPublicKey, reason, algorithm } = tx.payload;
    const oldKey = state.getKey(oldKeyId)!;

    oldKey.status = reason === 'compromised' ? 'COMPROMISED' : 'RETIRED';
    state.setKey(oldKey);

    const newKey: KeyRecord = {
      keyId: newKeyId,
      ownerId: oldKey.ownerId,
      publicKey: newPublicKey,
      algorithm: algorithm || oldKey.algorithm || 'ed25519',
      status: 'ACTIVE',
      registeredAt: context.timestamp,
      metadata: { ...oldKey.metadata, rotatedFrom: oldKeyId, reason: reason || 'scheduled' },
    };

    state.setKey(newKey);
  }
}
