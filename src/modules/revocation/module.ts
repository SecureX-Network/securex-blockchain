import {
  Transaction,
  TransactionType,
} from '../../core/transaction/transaction';
import { StateManager, CredentialStatus, canTransition } from '../../core/state/state';
import {
  TransactionModule,
  ValidationResult,
  ApplyContext,
} from '../registry';
import { CryptoManager } from '../../crypto/signatures/crypto';

function canTransition2(from: string, to: CredentialStatus): boolean {
  return canTransition(from as CredentialStatus, to);
}

function getCredential(state: StateManager, credentialId: string): { error: string; credential?: never } | { error?: never; credential: NonNullable<ReturnType<StateManager['getCredential']>> } {
  const credential = state.getCredential(credentialId);
  if (!credential) {
    return { error: 'UNKNOWN_CREDENTIAL' };
  }
  return { credential };
}

function isAuthorizedActor(tx: Transaction, issuerId: string, issuerPublicKey: string): boolean {
  if (tx.sender === issuerId) return true;
  return CryptoManager.deriveNodeId(issuerPublicKey) === tx.sender;
}

function assertIssuerAuthorization(state: StateManager, tx: Transaction, credentialId: string): string | null {
  if (tx.protocolVersion === '1.0' && tx.transactionVersion === 1) return null;
  const credential = state.getCredential(credentialId);
  if (!credential) return 'UNKNOWN_CREDENTIAL';

  const issuer = state.getIssuer(credential.issuerId);
  if (!issuer) return 'UNKNOWN_ISSUER';
  if (issuer.status !== 'ACTIVE') return 'UNAUTHORIZED_ISSUER';
  if (!isAuthorizedActor(tx, credential.issuerId, issuer.publicKey)) return 'UNAUTHORIZED_ISSUER';

  return null;
}

export class RevokeModule implements TransactionModule {
  readonly type = TransactionType.CREDENTIAL_REVOKE;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { credentialId } = tx.payload;
    if (!credentialId || typeof credentialId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: credentialId required' };
    }

    const { credential, error } = getCredential(state, credentialId);
    if (error) return { valid: false, error };

    const authErr = assertIssuerAuthorization(state, tx, credentialId);
    if (authErr) return { valid: false, error: authErr };

    if (credential!.status === CredentialStatus.REVOKED) {
      return { valid: false, error: 'CREDENTIAL_ALREADY_REVOKED' };
    }

    if (!canTransition2(credential!.status, CredentialStatus.REVOKED)) {
      return { valid: false, error: 'INVALID_STATE_TRANSITION' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { credentialId, reason } = tx.payload;
    const credential = state.getCredential(credentialId)!;

    credential.status = CredentialStatus.REVOKED;
    credential.revokedAt = context.timestamp;
    credential.lastUpdated = context.timestamp;
    credential.lifecycle.push({
      type: 'REVOKED',
      timestamp: context.timestamp,
      reason,
      blockHeight: context.blockHeight,
      txId: context.txId,
    });

    state.setCredential(credential);
  }
}

export class SuspendModule implements TransactionModule {
  readonly type = TransactionType.CREDENTIAL_SUSPEND;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { credentialId } = tx.payload;
    if (!credentialId || typeof credentialId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: credentialId required' };
    }

    const { credential, error } = getCredential(state, credentialId);
    if (error) return { valid: false, error };

    const authErr = assertIssuerAuthorization(state, tx, credentialId);
    if (authErr) return { valid: false, error: authErr };

    if (credential!.status === CredentialStatus.SUSPENDED) {
      return { valid: false, error: 'CREDENTIAL_ALREADY_SUSPENDED' };
    }

    if (!canTransition2(credential!.status, CredentialStatus.SUSPENDED)) {
      return { valid: false, error: 'INVALID_STATE_TRANSITION' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { credentialId, reason } = tx.payload;
    const credential = state.getCredential(credentialId)!;

    credential.status = CredentialStatus.SUSPENDED;
    credential.suspendedAt = context.timestamp;
    credential.lastUpdated = context.timestamp;
    credential.lifecycle.push({
      type: 'SUSPENDED',
      timestamp: context.timestamp,
      reason,
      blockHeight: context.blockHeight,
      txId: context.txId,
    });

    state.setCredential(credential);
  }
}

export class ReinstateModule implements TransactionModule {
  readonly type = TransactionType.CREDENTIAL_REINSTATE;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { credentialId } = tx.payload;
    if (!credentialId || typeof credentialId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: credentialId required' };
    }

    const { credential, error } = getCredential(state, credentialId);
    if (error) return { valid: false, error };

    const authErr = assertIssuerAuthorization(state, tx, credentialId);
    if (authErr) return { valid: false, error: authErr };

    if (credential!.status !== CredentialStatus.SUSPENDED) {
      return { valid: false, error: 'INVALID_STATE_TRANSITION: only suspended can be reinstated' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { credentialId, reason } = tx.payload;
    const credential = state.getCredential(credentialId)!;

    credential.status = CredentialStatus.ACTIVE;
    credential.suspendedAt = undefined;
    credential.lastUpdated = context.timestamp;
    credential.lifecycle.push({
      type: 'REINSTATED',
      timestamp: context.timestamp,
      reason,
      blockHeight: context.blockHeight,
      txId: context.txId,
    });

    state.setCredential(credential);
  }
}

export class ReissueModule implements TransactionModule {
  readonly type = TransactionType.CREDENTIAL_REISSUE;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { credentialId, newCredentialId, newCredentialHash } = tx.payload;
    if (!credentialId) return { valid: false, error: 'INVALID_PAYLOAD: credentialId required' };
    if (!newCredentialId) return { valid: false, error: 'INVALID_PAYLOAD: newCredentialId required' };
    if (!newCredentialHash || newCredentialHash.length !== 64) {
      return { valid: false, error: 'INVALID_PAYLOAD: newCredentialHash must be 64-char hex' };
    }

    const { credential, error } = getCredential(state, credentialId);
    if (error) return { valid: false, error };

    const authErr = assertIssuerAuthorization(state, tx, credentialId);
    if (authErr) return { valid: false, error: authErr };

    if (state.getCredential(newCredentialId)) {
      return { valid: false, error: 'NEW_CREDENTIAL_ALREADY_EXISTS' };
    }

    return { valid: true };
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { credentialId, newCredentialId, newCredentialHash, reason, schemaVersion, metadata } = tx.payload;
    const oldCredential = state.getCredential(credentialId)!;

    oldCredential.status = CredentialStatus.REISSUED;
    oldCredential.reissuedTo = newCredentialId;
    oldCredential.currentReissue = newCredentialId;
    oldCredential.lastUpdated = context.timestamp;
    oldCredential.lifecycle.push({
      type: 'REISSUED',
      timestamp: context.timestamp,
      reason,
      blockHeight: context.blockHeight,
      txId: context.txId,
    });
    state.setCredential(oldCredential);

    state.setCredential({
      credentialId: newCredentialId,
      issuerId: oldCredential.issuerId,
      credentialHash: newCredentialHash,
      status: CredentialStatus.ACTIVE,
      schemaVersion: schemaVersion || oldCredential.schemaVersion || '1.0',
      issuedAt: context.timestamp,
      lastUpdated: context.timestamp,
      reissuedFrom: credentialId,
      metadata: metadata || oldCredential.metadata || {},
      lifecycle: [
        {
          type: 'REISSUED',
          timestamp: context.timestamp,
          reason,
          blockHeight: context.blockHeight,
          txId: context.txId,
        },
      ],
    });
  }
}
