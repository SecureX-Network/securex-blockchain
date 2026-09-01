import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { canonicalJSON } from '../../src/crypto/hashing/hash';

describe('CryptoManager', () => {
  test('generates Ed25519 key pair', () => {
    const keyPair = CryptoManager.generateKeyPair();
    expect(keyPair.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(keyPair.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(keyPair.keyId).toMatch(/^[a-f0-9]{64}$/);
  });

  test('keyId is derived from public key', () => {
    const keyPair = CryptoManager.generateKeyPair();
    expect(CryptoManager.deriveNodeId(keyPair.publicKey)).toBe(keyPair.keyId);
  });

  test('signs and verifies data', () => {
    const keyPair = CryptoManager.generateKeyPair();
    const signature = CryptoManager.sign('message', keyPair.privateKey);
    expect(CryptoManager.verify('message', signature, keyPair.publicKey)).toBe(true);
  });

  test('rejects tampered data', () => {
    const keyPair = CryptoManager.generateKeyPair();
    const signature = CryptoManager.sign('original', keyPair.privateKey);
    expect(CryptoManager.verify('tampered', signature, keyPair.publicKey)).toBe(false);
  });

  test('rejects signature from wrong key', () => {
    const keyA = CryptoManager.generateKeyPair();
    const keyB = CryptoManager.generateKeyPair();
    const signature = CryptoManager.sign('message', keyA.privateKey);
    expect(CryptoManager.verify('message', signature, keyB.publicKey)).toBe(false);
  });

  test('signObject and verifyObject', () => {
    const keyPair = CryptoManager.generateKeyPair();
    const obj = { a: 1, b: [1, 2], c: { nested: true } };
    const { signature } = CryptoManager.signObject(obj, keyPair.privateKey);
    expect(CryptoManager.verifyObject(obj, signature, keyPair.publicKey)).toBe(true);

    const tampered = { ...obj, a: 2 };
    expect(CryptoManager.verifyObject(tampered, signature, keyPair.publicKey)).toBe(false);
  });

  test('key roundtrip through PEM', () => {
    const keyPair = CryptoManager.generateKeyPair();
    const sig = CryptoManager.sign('data', keyPair.privateKey);
    expect(CryptoManager.verify('data', sig, keyPair.publicKey)).toBe(true);
  });
});