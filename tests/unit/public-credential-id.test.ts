import { StateManager, CredentialStatus } from '../../src/core/state/state';
import {
  generatePublicCredentialId,
  isPublicCredentialId,
  PUBLIC_CREDENTIAL_ID_REGEX,
} from '../../src/crypto/identity/public-credential-id';

describe('generatePublicCredentialId', () => {
  test('produces well-formed SX-XXXX-XXXX-XXXX values', () => {
    for (let i = 0; i < 500; i++) {
      const id = generatePublicCredentialId();
      expect(PUBLIC_CREDENTIAL_ID_REGEX.test(id)).toBe(true);
      expect(id).toMatch(/^SX-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });

  test('uses uppercase hexadecimal characters', () => {
    const id = generatePublicCredentialId();
    expect(id).toBe(id.toUpperCase());
    expect(id).not.toContain('sx-');
    expect(/[a-z]/.test(id)).toBe(false);
  });

  test('is not sequential and has high entropy across samples', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generatePublicCredentialId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  test('is never derived from an internal ID (separation)', () => {
    const internalId = 'sxu-btech-2026-0001';
    for (let i = 0; i < 50; i++) {
      const pub = generatePublicCredentialId();
      expect(pub).not.toContain(internalId);
      expect(pub.toLowerCase()).not.toContain(internalId);
      expect(isPublicCredentialId(pub)).toBe(true);
    }
  });

  test('does not equal the internal credential ID', () => {
    const internalId = 'sxu-btech-2026-0001';
    expect(isPublicCredentialId(internalId)).toBe(false);
  });
});

describe('isPublicCredentialId', () => {
  test('accepts canonical public IDs', () => {
    expect(isPublicCredentialId('SX-2F9C-A41B-8D7E')).toBe(true);
    expect(isPublicCredentialId('SX-9D61-4AC8-0F3B')).toBe(true);
  });

  test('rejects non-public identifiers', () => {
    expect(isPublicCredentialId('sxu-btech-2026-0001')).toBe(false);
    expect(isPublicCredentialId('SX-2f9c-a41b-8d7e')).toBe(false); // lowercase
    expect(isPublicCredentialId('SX-2F9C-A41B')).toBe(false); // too short
    expect(isPublicCredentialId('SX-2F9C-A41B-8D7E-0000')).toBe(false); // too long
    expect(isPublicCredentialId('SX-2F9C-A41B-8D7G')).toBe(false); // invalid char
    expect(isPublicCredentialId('2F9C-A41B-8D7E')).toBe(false); // missing prefix
    expect(isPublicCredentialId('')).toBe(false);
    expect(isPublicCredentialId('SX-2F9CA41B8D7E')).toBe(false); // missing dashes
  });
});

describe('public credential ID mapping in StateManager', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  function seed(credentialId: string, publicCredentialId: string): void {
    state.setCredential({
      credentialId,
      publicCredentialId,
      issuerId: 'issuer-1',
      credentialHash: 'a'.repeat(64),
      status: CredentialStatus.ACTIVE,
      schemaVersion: '1.0',
      issuedAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
      metadata: {},
      lifecycle: [],
    });
  }

  test('public ID resolves to the exact internal credential', () => {
    seed('sxu-btech-2026-0001', 'SX-2F9C-A41B-8D7E');
    const credential = state.getCredentialByPublicId('SX-2F9C-A41B-8D7E');
    expect(credential).toBeDefined();
    expect(credential!.credentialId).toBe('sxu-btech-2026-0001');
    expect(credential!.publicCredentialId).toBe('SX-2F9C-A41B-8D7E');
  });

  test('public mapping is distinct from internal lookup', () => {
    seed('sxu-btech-2026-0001', 'SX-2F9C-A41B-8D7E');
    expect(state.getCredential('sxu-btech-2026-0001')?.publicCredentialId).toBe('SX-2F9C-A41B-8D7E');
    expect(state.getCredentialByPublicId('sxu-btech-2026-0001')).toBeUndefined();
  });

  test('unknown public ID fails safely', () => {
    seed('sxu-btech-2026-0001', 'SX-2F9C-A41B-8D7E');
    expect(state.getCredentialByPublicId('SX-9D61-4AC8-0F3B')).toBeUndefined();
    expect(state.publicIdExists('SX-9D61-4AC8-0F3B')).toBe(false);
  });

  test('uniqueness is enforced across the public ID index', () => {
    seed('cred-1', 'SX-2F9C-A41B-8D7E');
    expect(state.publicIdExists('SX-2F9C-A41B-8D7E')).toBe(true);
    seed('cred-2', 'SX-2F9C-A41B-8D7E');
    const creds = state.getAllCredentials();
    expect(creds.find(c => c.credentialId === 'cred-2')?.publicCredentialId).toBe('SX-2F9C-A41B-8D7E');
  });

  test('generateUniquePublicCredentialId returns the requested unique ID', () => {
    const id = state.generateUniquePublicCredentialId('SX-9D61-4AC8-0F3B');
    expect(id).toBe('SX-9D61-4AC8-0F3B');
  });

  test('generateUniquePublicCredentialId regenerates a usable ID when duplicate', () => {
    seed('cred-1', 'SX-2F9C-A41B-8D7E');
    const id = state.generateUniquePublicCredentialId('SX-2F9C-A41B-8D7E');
    expect(id).not.toBe('SX-2F9C-A41B-8D7E');
    expect(isPublicCredentialId(id)).toBe(true);
    expect(state.publicIdExists(id)).toBe(false);
  });

  test('mapping survives persist/load roundtrip', () => {
    seed('sxu-btech-2026-0001', 'SX-2F9C-A41B-8D7E');
    const serialized = state.toJSON();
    const restored = new StateManager();
    restored.fromJSON(serialized);
    expect(restored.getCredentialByPublicId('SX-2F9C-A41B-8D7E')?.credentialId).toBe('sxu-btech-2026-0001');
    expect(restored.publicIdExists('SX-2F9C-A41B-8D7E')).toBe(true);
  });

  test('backfills public index from stored credentials if map is missing', () => {
    seed('sxu-btech-2026-0001', 'SX-2F9C-A41B-8D7E');
    const serialized = state.toJSON();
    delete (serialized as any).publicCredentials;
    const restored = new StateManager();
    restored.fromJSON(serialized);
    expect(restored.getCredentialByPublicId('SX-2F9C-A41B-8D7E')?.credentialId).toBe('sxu-btech-2026-0001');
  });
});
