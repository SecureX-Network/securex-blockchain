import {
  Transaction,
  TransactionType,
} from '../../core/transaction/transaction';
import { StateManager, CredentialStatus } from '../../core/state/state';
import {
  TransactionModule,
  ValidationResult,
  ApplyContext,
} from '../registry';
import { CryptoManager } from '../../crypto/signatures/crypto';

export class CredentialModule implements TransactionModule {
  readonly type = TransactionType.CREDENTIAL_ISSUE;

  validate(state: StateManager, tx: Transaction): ValidationResult {
    const { credentialId, issuerId, credentialHash, schemaVersion } = tx.payload;

    if (!credentialId || typeof credentialId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: credentialId required' };
    }
    if (!issuerId || typeof issuerId !== 'string') {
      return { valid: false, error: 'INVALID_PAYLOAD: issuerId required' };
    }
    if (!credentialHash || typeof credentialHash !== 'string' || credentialHash.length !== 64) {
      return { valid: false, error: 'INVALID_PAYLOAD: credentialHash must be 64-char hex' };
    }

    const issuer = state.getIssuer(issuerId);
    if (!issuer) {
      return { valid: false, error: 'UNKNOWN_ISSUER' };
    }
    if (issuer.status !== 'ACTIVE') {
      return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
    }

    if (tx.protocolVersion !== '1.0' || tx.transactionVersion !== 1) {
      if (!this.isAuthorizedActor(tx, issuerId, issuer.publicKey)) {
        return { valid: false, error: 'UNAUTHORIZED_ISSUER' };
      }
    }

    if (state.getCredential(credentialId)) {
      return { valid: false, error: 'CREDENTIAL_ALREADY_EXISTS' };
    }

    return { valid: true };
  }

  protected isAuthorizedActor(tx: Transaction, expectedIssuerId: string, issuerPublicKey: string): boolean {
    if (tx.sender === expectedIssuerId) return true;
    return CryptoManager.deriveNodeId(issuerPublicKey) === tx.sender;
  }

  apply(state: StateManager, tx: Transaction, context: ApplyContext): void {
    const { credentialId, issuerId, credentialHash, schemaVersion, metadata } = tx.payload;

    state.setCredential({
      credentialId,
      issuerId,
      credentialHash,
      status: CredentialStatus.ACTIVE,
      schemaVersion: schemaVersion || '1.0',
      issuedAt: context.timestamp,
      lastUpdated: context.timestamp,
      metadata: metadata || {},
      lifecycle: [
        {
          type: 'ISSUED',
          timestamp: context.timestamp,
          blockHeight: context.blockHeight,
          txId: context.txId,
        },
      ],
    });
  }
}
