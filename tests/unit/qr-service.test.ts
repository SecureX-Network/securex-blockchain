import { Chain } from '../../src/core/chain';
import { createFileStorage, Storage } from '../../src/storage/file-store';
import { ModuleRegistry } from '../../src/modules/registry';
import { CryptoManager, KeyPair } from '../../src/crypto/signatures/crypto';
import {
  QrService,
  buildOpaqueToken,
  buildSecureXQrContent,
  REFERENCE_VERSION,
  SECUREX_QR_PREFIX,
  QR_TTL_MS,
} from '../../src/services/qr';
import { CredentialStatus } from '../../src/core/state/state';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PUBLIC_ID = 'SX-2F9C-A41B-8D7E';
const INTERNAL_ID = 'sxu-btech-2026-0001';

function seedChain(): { chain: Chain; storage: Storage; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-qr-'));
  const storage = createFileStorage(tmpDir);
  const chain = new Chain(storage, new ModuleRegistry());
  chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
  chain
    .getState()
    .setCredential({
      credentialId: INTERNAL_ID,
      publicCredentialId: PUBLIC_ID,
      issuerId: 'issuer-1',
      credentialHash: 'a'.repeat(64),
      status: CredentialStatus.ACTIVE,
      schemaVersion: '1.0',
      issuedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      metadata: {},
      lifecycle: [],
    });
  return { chain, storage, tmpDir };
}

function cleanup(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe('Opaque authenticated SecureX QR reference', () => {
  let chain: Chain;
  let storage: Storage;
  let tmpDir: string;
  let keyPair: KeyPair;
  let service: QrService;

  beforeEach(() => {
    ({ chain, storage, tmpDir } = seedChain());
    keyPair = CryptoManager.generateKeyPair();
    service = new QrService(chain, keyPair, 'https://verify.example/verify');
  });

  afterEach(() => {
    cleanup(tmpDir);
    if (storage) {
      (storage as any)?.close?.();
    }
  });

  test('referenceFor(internal id) targets the public id and returns an opaque payload', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    expect(ref.credentialId).toBe(PUBLIC_ID);
    expect(ref.credentialId).not.toBe(INTERNAL_ID);
    expect(ref.exists).toBe(true);
    expect(ref.qrContent.startsWith(SECUREX_QR_PREFIX + '.')).toBe(true);
  });

  test('qrContent is opaque: contains no public id, internal id, url, or key material', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    const content = ref.qrContent;
    expect(content).not.toContain(PUBLIC_ID);
    expect(content).not.toContain(INTERNAL_ID);
    expect(content).not.toContain('SX-');
    expect(content).not.toContain('sxu-');
    expect(content).not.toContain('http');
    expect(content).not.toContain('verify.example');
    expect(content).not.toContain(PUBLIC_ID.replace(/-/g, ''));
    expect(content.split('.')).toHaveLength(5);
    expect(content.split('.')[0]).toBe(SECUREX_QR_PREFIX);
  });

  test('qrContent is authenticated and versioned (SXQR1.token.issuedAt.v1.sig)', () => {
    const ref = service.referenceFor(PUBLIC_ID);
    const parts = ref.qrContent.split('.');
    expect(parts[0]).toBe(SECUREX_QR_PREFIX);
    const [token, issuedAt, version, signature] = parts.slice(1);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, opaque
    expect(Number(issuedAt)).toBeGreaterThan(0);
    expect(version).toBe('v' + REFERENCE_VERSION);
    expect(signature).toMatch(/^[0-9a-f]{128}$/i); // Ed25519 signature
  });

  test('verifyQrPayload(valid payload) resolves the public credential id', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    const result = service.verifyQrPayload(ref.qrContent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.publicCredentialId).toBe(PUBLIC_ID);
      expect(result.publicCredentialId).not.toBe(INTERNAL_ID);
      expect(result.version).toBe(REFERENCE_VERSION);
    }
  });

  test('rejects non-SecureX input (arbitrary URL / plain text)', () => {
    expect(service.verifyQrPayload('https://evil.example/scan')).toEqual({
      ok: false,
      reason: 'not-secure-x',
    });
    expect(service.verifyQrPayload('SX-2F9C-A41B-8D7E')).toEqual({
      ok: false,
      reason: 'not-secure-x',
    });
    expect(service.verifyQrPayload('')).toEqual({ ok: false, reason: 'not-secure-x' });
  });

  test('rejects malformed payloads', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    const parts = ref.qrContent.split('.');
    expect(service.verifyQrPayload(parts.slice(0, 2).join('.'))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(service.verifyQrPayload(`${SECUREX_QR_PREFIX}.${parts[1]}.abc.${'0'.repeat(128)}`)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('rejects unsupported versions', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    const parts = ref.qrContent.split('.');
    const fake = `${SECUREX_QR_PREFIX}.${parts[1]}.${parts[2]}.v9.${parts[4]}`;
    expect(service.verifyQrPayload(fake)).toEqual({ ok: false, reason: 'unsupported-version' });
  });

  test('rejects a tampered signature (forgery)', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    const parts = ref.qrContent.split('.');
    const flipped = parts[4][0] === 'a' ? 'b' + parts[4].slice(1) : 'a' + parts[4].slice(1);
    const tampered = `${SECUREX_QR_PREFIX}.${parts[1]}.${parts[2]}.${parts[3]}.${flipped}`;
    expect(service.verifyQrPayload(tampered)).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  test('a payload signed for an unknown id is rejected as an unknown reference', () => {
    // Signature is valid, but the opaque token does not map to an on-chain public id.
    const content = buildSecureXQrContent(keyPair, 'SX-0000-0000-0000');
    expect(service.verifyQrPayload(content)).toEqual({ ok: false, reason: 'unknown-reference' });
  });

  test('a payload signed by a DIFFERENT server key is rejected as invalid-signature', () => {
    const attackerKey = CryptoManager.generateKeyPair();
    const forged = buildSecureXQrContent(attackerKey, PUBLIC_ID);
    expect(service.verifyQrPayload(forged)).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  test('a signature copied from another credential cannot be replayed', () => {
    const otherPublicId = 'SX-7A31-C0E4-19F6';
    // Build an opaque token is a function of (binding key, publicId). A token from a
    // different id won't resolve, even if the QR is otherwise well-formed.
    const ref = service.referenceFor(INTERNAL_ID);
    const parts = ref.qrContent.split('.');
    const foreign = buildSecureXQrContent(keyPair, otherPublicId);
    const foreignParts = foreign.split('.');
    // Keep original token but foreign signature won't verify; and vice versa.
    const mixed = `${SECUREX_QR_PREFIX}.${foreignParts[1]}.${foreignParts[2]}.${foreignParts[3]}.${parts[4]}`;
    expect(service.verifyQrPayload(mixed)).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  test('expired payloads are rejected', () => {
    const shortService = new QrService(chain, keyPair, undefined, 1); // 1ms TTL
    const ref = shortService.referenceFor(INTERNAL_ID);
    const issuedAt = Number(ref.qrContent.split('.')[2]);
    // Verify well after the 1ms TTL (but not in the future relative to issuance).
    const result = shortService.verifyQrPayload(ref.qrContent, issuedAt + 10);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  test('opaque token is deterministic for a public id + key, and stable across issues', () => {
    const a = buildOpaqueToken(keyPair.publicKey, PUBLIC_ID);
    const b = buildOpaqueToken(keyPair.publicKey, PUBLIC_ID);
    expect(a).toBe(b);
    const c = buildOpaqueToken(keyPair.publicKey, 'SX-7A31-C0E4-19F6');
    expect(a).not.toBe(c);
  });

  test('referenceFor(unknown id) still returns an opaque reference, not found', () => {
    const ref = service.referenceFor('SX-1111-2222-3333');
    expect(ref.exists).toBe(false);
    expect(ref.qrContent.startsWith(SECUREX_QR_PREFIX + '.')).toBe(true);
    expect(ref.qrContent).not.toContain('SX-1111-2222-3333');
  });

  test('reference payload exposes only the public id (no internals)', () => {
    const ref = service.referenceFor(INTERNAL_ID);
    expect(ref.payload.credentialId).toBe(PUBLIC_ID);
    expect(JSON.stringify(ref.payload)).not.toContain(INTERNAL_ID);
  });

  test('buildVerificationUrl encodes the public id and never leaks internals', () => {
    const withBase = new QrService(chain, keyPair, 'https://verify.securex.example/verify');
    const ref = withBase.referenceFor(INTERNAL_ID);
    expect(ref.verificationUrl).toBe(`https://verify.securex.example/verify/${PUBLIC_ID}`);
    expect(ref.verificationUrl).not.toContain(INTERNAL_ID);
  });
});
