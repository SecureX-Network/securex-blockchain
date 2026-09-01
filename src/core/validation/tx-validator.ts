import { Transaction, getSigningData } from '../transaction/transaction';
import { StateManager } from '../state/state';
import { CryptoManager } from '../../crypto/signatures/crypto';
import { ModuleRegistry } from '../../modules/registry';

export const ALLOWED_TRANSACTION_TYPES = [
  'ISSUER_REGISTER',
  'ISSUER_UPDATE',
  'CREDENTIAL_ISSUE',
  'CREDENTIAL_REVOKE',
  'CREDENTIAL_SUSPEND',
  'CREDENTIAL_REINSTATE',
  'CREDENTIAL_REISSUE',
  'KEY_REGISTER',
  'KEY_ROTATE',
  'BATCH_ANCHOR',
];

export class TransactionValidator {
  private registry: ModuleRegistry;

  constructor(registry: ModuleRegistry) {
    this.registry = registry;
  }

  validate(state: StateManager, tx: Transaction, isProposer: boolean = false): string | null {
    if (!tx || typeof tx !== 'object') return 'INVALID_TRANSACTION';

    if (tx.protocolVersion !== '1.0') return 'UNSUPPORTED_PROTOCOL_VERSION';
    if (tx.transactionVersion !== 1) return 'UNSUPPORTED_TRANSACTION_VERSION';

    if (!tx.id || typeof tx.id !== 'string') return 'INVALID_TX_ID';

    if (!ALLOWED_TRANSACTION_TYPES.includes(tx.type)) return 'UNKNOWN_TX_TYPE';

    if (!tx.sender || typeof tx.sender !== 'string') return 'INVALID_SENDER';

    if (typeof tx.nonce !== 'number' || !Number.isInteger(tx.nonce) || tx.nonce < 0) {
      return 'INVALID_NONCE';
    }

    if (!tx.signature || typeof tx.signature !== 'string') return 'MISSING_SIGNATURE';

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
    if (!senderKey) return 'UNAUTHORIZED_SENDER';

    if (!CryptoManager.verify(signingData, tx.signature, senderKey)) {
      return 'INVALID_SIGNATURE';
    }

    const nonce = state.getNonce(tx.sender);
    if (tx.nonce <= nonce) return 'REPLAYED_TRANSACTION';

    if (!this.registry.has(tx.type)) return 'UNSUPPORTED_TX_TYPE';

    const module = this.registry.get(tx.type)!;
    const result = module.validate(state, tx);
    if (!result.valid) {
      return result.error || 'TRANSACTION_VALIDATION_FAILED';
    }

    return null;
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
