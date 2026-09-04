import { StateManager, CredentialStatus } from '../../src/core/state/state';

describe('Credential lifecycle state transitions', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  const seedCredential = () => {
    state.setCredential({
      credentialId: 'cred-1',
      publicCredentialId: 'SX-2F9C-A41B-8D7E',
      issuerId: 'issuer-1',
      credentialHash: 'a'.repeat(64),
      status: CredentialStatus.ACTIVE,
      schemaVersion: '1.0',
      issuedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      metadata: {},
      lifecycle: [],
    });
  };

  test('can transition ACTIVE -> SUSPENDED', () => {
    seedCredential();
    const credential = state.getCredential('cred-1')!;
    credential.status = CredentialStatus.SUSPENDED;
    state.setCredential(credential);
    expect(state.getCredential('cred-1')!.status).toBe(CredentialStatus.SUSPENDED);
  });

  test('can transition SUSPENDED -> ACTIVE', () => {
    seedCredential();
    const credential = state.getCredential('cred-1')!;
    credential.status = CredentialStatus.SUSPENDED;
    state.setCredential(credential);
    credential.status = CredentialStatus.ACTIVE;
    state.setCredential(credential);
    expect(state.getCredential('cred-1')!.status).toBe(CredentialStatus.ACTIVE);
  });

  test('lifecycle history is preserved', () => {
    seedCredential();
    const credential = state.getCredential('cred-1')!;
    credential.lifecycle.push({ type: 'REVOKED', timestamp: new Date().toISOString(), blockHeight: 1, txId: 't1' });
    state.setCredential(credential);
    expect(state.getCredential('cred-1')!.lifecycle).toHaveLength(1);
  });

  test('nonce tracking increments only forward', () => {
    expect(state.getNonce('sender-x')).toBe(0);
    state.setNonce('sender-x', 3);
    expect(state.getNonce('sender-x')).toBe(3);
    state.setNonce('sender-x', 2);
    expect(state.getNonce('sender-x')).toBe(3);
    state.setNonce('sender-x', 5);
    expect(state.getNonce('sender-x')).toBe(5);
  });

  test('persist/load roundtrip', () => {
    seedCredential();
    const json = state.toJSON();
    const restored = new StateManager();
    restored.fromJSON(json);
    expect(restored.getCredential('cred-1')!.status).toBe(CredentialStatus.ACTIVE);
    expect(restored.getCredential('cred-1')!.issuerId).toBe('issuer-1');
  });
});