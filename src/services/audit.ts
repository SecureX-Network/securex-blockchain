import { Chain } from '../core/chain';
import { PermissionedConsensus } from '../consensus/permissioned/consensus';
import { Block } from '../core/block/block';
import { Transaction } from '../core/transaction/transaction';
import { getLogger } from '../utils/logger';
import { BlockchainError } from '../core/errors';

/**
 * Auditable backend events. These are derived from REAL validation and lifecycle
 * operations only. No synthetic/fabricated events are generated.
 */
export type AuditEventType =
  | 'ISSUER_REGISTERED'
  | 'ISSUER_UPDATED'
  | 'CREDENTIAL_ISSUED'
  | 'CREDENTIAL_SUSPENDED'
  | 'CREDENTIAL_REINSTATED'
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_REISSUED'
  | 'KEY_REGISTERED'
  | 'KEY_ROTATED'
  | 'KEY_COMPROMISED'
  | 'INVALID_SIGNATURE_REJECTED'
  | 'REPLAY_REJECTED'
  | 'UNAUTHORIZED_TRANSACTION_REJECTED'
  | 'INVALID_BLOCK_REJECTED'
  | 'MERKLE_VERIFICATION_FAILURE'
  | 'STATE_VALIDATION_FAILURE'
  | 'UNKNOWN_TX_TYPE_REJECTED'
  | 'UNSUPPORTED_VERSION_REJECTED';

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  referenceType?: 'transaction' | 'block' | 'credential' | 'issuer' | 'key' | 'validator';
  referenceId?: string;
  txId?: string;
  blockHeight?: number;
  actor?: string;
}

const SEVERITY: Record<AuditEventType, AuditEvent['severity']> = {
  ISSUER_REGISTERED: 'info',
  ISSUER_UPDATED: 'info',
  CREDENTIAL_ISSUED: 'info',
  CREDENTIAL_SUSPENDED: 'info',
  CREDENTIAL_REINSTATED: 'info',
  CREDENTIAL_REVOKED: 'info',
  CREDENTIAL_REISSUED: 'info',
  KEY_REGISTERED: 'info',
  KEY_ROTATED: 'info',
  KEY_COMPROMISED: 'warning',
  INVALID_SIGNATURE_REJECTED: 'warning',
  REPLAY_REJECTED: 'warning',
  UNAUTHORIZED_TRANSACTION_REJECTED: 'warning',
  INVALID_BLOCK_REJECTED: 'critical',
  MERKLE_VERIFICATION_FAILURE: 'critical',
  STATE_VALIDATION_FAILURE: 'critical',
  UNKNOWN_TX_TYPE_REJECTED: 'warning',
  UNSUPPORTED_VERSION_REJECTED: 'warning',
};

const MAX_EVENTS = 10000;

export class AuditService {
  private events: AuditEvent[] = [];
  private counter = 0;

  start(): void {
    // No-op: event capture is synchronous and driven by validation/lifecycle.
  }

  stop(): void {
    // No-op
  }

  private record(type: AuditEventType, message: string, ref?: Partial<AuditEvent>): void {
    const event: AuditEvent = {
      id: `evt-${(this.counter++).toString(16)}-${Date.now()}`,
      type,
      timestamp: new Date().toISOString(),
      severity: SEVERITY[type] || 'info',
      message,
      ...ref,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    const level = event.severity === 'critical' ? 'error' : event.severity === 'warning' ? 'warn' : 'info';
    getLogger()[level](`[AUDIT] ${event.type}: ${event.message}`);
  }

  onTransactionRejected(error: string | null, tx?: Transaction): void {
    if (!error || !tx) return;
    const ref = { txId: tx.id };
    if (error === BlockchainError.INVALID_SIGNATURE) {
      this.record('INVALID_SIGNATURE_REJECTED', `Transaction signature rejected`, { ...ref, referenceType: 'transaction' as const, referenceId: tx.id, actor: tx.sender });
    } else if (error === BlockchainError.REPLAYED_TRANSACTION || error === BlockchainError.REPLAY_DETECTED) {
      this.record('REPLAY_REJECTED', `Replayed transaction rejected (nonce ${tx.nonce})`, { ...ref, referenceType: 'transaction' as const, referenceId: tx.id, actor: tx.sender });
    } else if (error === BlockchainError.UNAUTHORIZED_ISSUER || error === BlockchainError.UNAUTHORIZED_SENDER || error === BlockchainError.UNAUTHORIZED_VALIDATOR) {
      this.record('UNAUTHORIZED_TRANSACTION_REJECTED', `Unauthorized transaction rejected (${error})`, { ...ref, referenceType: 'transaction' as const, referenceId: tx.id, actor: tx.sender });
    } else if (error === BlockchainError.UNKNOWN_TX_TYPE) {
      this.record('UNKNOWN_TX_TYPE_REJECTED', `Unknown transaction type rejected`, { ...ref, referenceType: 'transaction' as const, referenceId: tx.id, actor: tx.sender });
    } else if (error === BlockchainError.UNSUPPORTED_PROTOCOL_VERSION || error === BlockchainError.UNSUPPORTED_TRANSACTION_VERSION) {
      this.record('UNSUPPORTED_VERSION_REJECTED', `Unsupported version rejected (${error})`, { ...ref, referenceType: 'transaction' as const, referenceId: tx.id, actor: tx.sender });
    }
  }

  onBlockRejected(error: string | null, block?: Block): void {
    if (!error || !block) return;
    this.record('INVALID_BLOCK_REJECTED', `Block rejected: ${error}`, {
      referenceType: 'block' as const,
      referenceId: block.hash,
      blockHeight: block.header.height,
    });
  }

  onMerkleVerificationFailure(credentialId?: string, blockHeight?: number): void {
    this.record('MERKLE_VERIFICATION_FAILURE', 'Merkle proof verification failed', {
      referenceType: 'credential' as const,
      referenceId: credentialId,
      blockHeight,
    });
  }

  onStateValidationFailure(message: string, blockHeight?: number): void {
    this.record('STATE_VALIDATION_FAILURE', message, { blockHeight });
  }

  onLifecycle(type: AuditEventType, tx: Transaction, block: Block, ref: Partial<AuditEvent> = {}): void {
    this.record(type, `${type} via transaction`, {
      ...ref,
      txId: tx.id,
      blockHeight: block.header.height,
      referenceId: ref.referenceId || tx.id,
    });
  }

  getEvents(limit = 500, offset = 0): AuditEvent[] {
    const bounded = Math.max(1, Math.min(limit, 1000));
    return this.events.slice().reverse().slice(offset, offset + bounded);
  }

  getEventCount(): number {
    return this.events.length;
  }

  summarize(): { total: number; byType: Record<string, number>; bySeverity: Record<string, number> } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const e of this.events) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    }
    return { total: this.events.length, byType, bySeverity };
  }
}
