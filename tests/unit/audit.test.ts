import { AuditService } from '../../src/services/audit';
import { BlockchainError } from '../../src/core/errors';
import { Transaction, TransactionType } from '../../src/core/transaction/transaction';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    protocolVersion: '2.0',
    transactionVersion: 2,
    id: 'tx-1',
    type: TransactionType.CREDENTIAL_ISSUE,
    timestamp: new Date().toISOString(),
    sender: 'issuer-1',
    nonce: 1,
    payload: { credentialId: 'cred-1' },
    signature: 'sig',
    ...overrides,
  };
}

describe('AuditService', () => {
  it('records ISSUER_REGISTERED lifecycle events', () => {
    const audit = new AuditService();
    audit.onLifecycle('ISSUER_REGISTERED', makeTx({
      type: TransactionType.ISSUER_REGISTER,
      payload: { issuerId: 'issuer-1' },
    }), { header: { height: 1 } } as any, { referenceId: 'issuer-1' });
    const events = audit.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('ISSUER_REGISTERED');
    expect(events[0].severity).toBe('info');
  });

  it('records INVALID_SIGNATURE_REJECTED', () => {
    const audit = new AuditService();
    audit.onTransactionRejected(BlockchainError.INVALID_SIGNATURE, makeTx());
    const events = audit.getEvents();
    expect(events[0].type).toBe('INVALID_SIGNATURE_REJECTED');
    expect(events[0].severity).toBe('warning');
  });

  it('records REPLAY_REJECTED', () => {
    const audit = new AuditService();
    audit.onTransactionRejected(BlockchainError.REPLAYED_TRANSACTION, makeTx());
    const events = audit.getEvents();
    expect(events[0].type).toBe('REPLAY_REJECTED');
  });

  it('records UNAUTHORIZED_TRANSACTION_REJECTED for unauthorized sender', () => {
    const audit = new AuditService();
    audit.onTransactionRejected(BlockchainError.UNAUTHORIZED_SENDER, makeTx());
    expect(audit.getEvents()[0].type).toBe('UNAUTHORIZED_TRANSACTION_REJECTED');
  });

  it('records INVALID_BLOCK_REJECTED as critical', () => {
    const audit = new AuditService();
    audit.onBlockRejected(BlockchainError.INVALID_MERKLE_ROOT, { header: { height: 5 }, hash: 'blockhash' } as any);
    const events = audit.getEvents();
    expect(events[0].type).toBe('INVALID_BLOCK_REJECTED');
    expect(events[0].severity).toBe('critical');
    expect(events[0].blockHeight).toBe(5);
  });

  it('records MERKLE_VERIFICATION_FAILURE', () => {
    const audit = new AuditService();
    audit.onMerkleVerificationFailure('cred-1', 7);
    expect(audit.getEvents()[0].type).toBe('MERKLE_VERIFICATION_FAILURE');
  });

  it('records STATE_VALIDATION_FAILURE', () => {
    const audit = new AuditService();
    audit.onStateValidationFailure('height mismatch', 3);
    expect(audit.getEvents()[0].type).toBe('STATE_VALIDATION_FAILURE');
  });

  it('returns newest-first by default and respects limit/offset', () => {
    const audit = new AuditService();
    for (let i = 0; i < 10; i++) {
      audit.onMerkleVerificationFailure(`cred-${i}`, i);
    }
    const events = audit.getEvents(3, 0);
    expect(events.length).toBe(3);
    // newest first
    expect(events[0].referenceId).toBe('cred-9');
    const offsetEvents = audit.getEvents(3, 3);
    expect(offsetEvents[0].referenceId).toBe('cred-6');
  });

  it('summarize reports counts by type and severity', () => {
    const audit = new AuditService();
    audit.onTransactionRejected(BlockchainError.INVALID_SIGNATURE, makeTx());
    audit.onTransactionRejected(BlockchainError.INVALID_SIGNATURE, makeTx());
    audit.onBlockRejected(BlockchainError.INVALID_BLOCK, { header: { height: 1 }, hash: 'h' } as any);
    const summary = audit.summarize();
    expect(summary.total).toBe(3);
    expect(summary.byType['INVALID_SIGNATURE_REJECTED']).toBe(2);
    expect(summary.bySeverity['critical']).toBe(1);
    expect(summary.bySeverity['warning']).toBe(2);
  });

  it('ignores null errors', () => {
    const audit = new AuditService();
    audit.onTransactionRejected(null, makeTx());
    audit.onBlockRejected(null, { header: { height: 1 } } as any);
    expect(audit.getEventCount()).toBe(0);
  });

  it('caps the event buffer', () => {
    const audit = new AuditService();
    for (let i = 0; i < 12000; i++) {
      audit.onMerkleVerificationFailure('c', i);
    }
    expect(audit.getEventCount()).toBeLessThanOrEqual(10000);
  });
});
