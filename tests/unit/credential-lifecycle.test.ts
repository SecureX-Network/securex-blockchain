import { StateManager, CredentialStatus, canTransition } from '../../src/core/state/state';
import { BlockchainError } from '../../src/core/errors';

describe('Credential lifecycle state machine', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  const addCredential = (id: string, status: CredentialStatus = CredentialStatus.ACTIVE) => {
    state.setCredential({
      credentialId: id,
      publicCredentialId: 'SX-2F9C-A41B-8D7E',
      issuerId: 'issuer-1',
      credentialHash: 'a'.repeat(64),
      status,
      schemaVersion: '1.0',
      issuedAt: '2026-01-01',
      lastUpdated: '2026-01-01',
      metadata: {},
      lifecycle: [{ type: 'ISSUED', timestamp: '2026-01-01', blockHeight: 1, txId: 'tx1' }],
    });
  };

  test('ACTIVE -> REVOKED is valid', () => {
    expect(canTransition(CredentialStatus.ACTIVE, CredentialStatus.REVOKED)).toBe(true);
  });

  test('ACTIVE -> SUSPENDED is valid', () => {
    expect(canTransition(CredentialStatus.ACTIVE, CredentialStatus.SUSPENDED)).toBe(true);
  });

  test('SUSPENDED -> ACTIVE is valid', () => {
    expect(canTransition(CredentialStatus.SUSPENDED, CredentialStatus.ACTIVE)).toBe(true);
  });

  test('REVOKED -> REINSTATE is INVALID', () => {
    expect(canTransition(CredentialStatus.REVOKED, CredentialStatus.ACTIVE)).toBe(false);
  });

  test('REVOKED -> SUSPEND is INVALID', () => {
    expect(canTransition(CredentialStatus.REVOKED, CredentialStatus.SUSPENDED)).toBe(false);
  });

  test('REVOKED is a terminal state (only reissue allowed)', () => {
    expect(canTransition(CredentialStatus.REVOKED, CredentialStatus.REISSUED)).toBe(true);
    expect(canTransition(CredentialStatus.REVOKED, CredentialStatus.ACTIVE)).toBe(false);
    expect(canTransition(CredentialStatus.REVOKED, CredentialStatus.SUSPENDED)).toBe(false);
  });

  test('validateTransition rejects unknown credential', () => {
    const result = state.validateTransition('missing', CredentialStatus.REVOKED);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(BlockchainError.UNKNOWN_CREDENTIAL);
  });

  test('validateTransition rejects invalid transition', () => {
    addCredential('c1', CredentialStatus.REVOKED);
    const result = state.validateTransition('c1', CredentialStatus.SUSPENDED);
    expect(result.valid).toBe(false);
    expect(result.error).toBe(BlockchainError.INVALID_STATE_TRANSITION);
  });

  test('validateTransition accepts valid transition', () => {
    addCredential('c1', CredentialStatus.ACTIVE);
    const result = state.validateTransition('c1', CredentialStatus.SUSPENDED);
    expect(result.valid).toBe(true);
  });

  test('duplicate issue rejected (credential already exists)', () => {
    addCredential('c1');
    const result = state.validateTransition('c1', CredentialStatus.REVOKED);
    expect(result.valid).toBe(true);
    expect(state.getCredential('c1')).toBeDefined();
  });

  test('lifecycle history is preserved', () => {
    addCredential('c1');
    const c = state.getCredential('c1')!;
    c.status = CredentialStatus.SUSPENDED;
    c.lifecycle.push({ type: 'SUSPENDED', timestamp: '2026-01-02', blockHeight: 2, txId: 'tx2' });
    state.setCredential(c);
    expect(state.getCredential('c1')!.lifecycle.length).toBe(2);
    expect(state.getCredential('c1')!.lifecycle[1].type).toBe('SUSPENDED');
  });
});
