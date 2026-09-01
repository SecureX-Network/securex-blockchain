import { SHA256Hasher, canonicalJSON } from '../../src/crypto/hashing/hash';

describe('SHA256Hasher', () => {
  test('produces 64-char hex hash', () => {
    const hash = SHA256Hasher.hash('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('is deterministic', () => {
    const a = SHA256Hasher.hash('test data');
    const b = SHA256Hasher.hash('test data');
    expect(a).toBe(b);
  });

  test('different inputs produce different hashes', () => {
    const a = SHA256Hasher.hash('input one');
    const b = SHA256Hasher.hash('input two');
    expect(a).not.toBe(b);
  });

  test('verify works', () => {
    const data = 'some data';
    const hash = SHA256Hasher.hash(data);
    expect(SHA256Hasher.verify(data, hash)).toBe(true);
    expect(SHA256Hasher.verify('tampered', hash)).toBe(false);
  });
});

describe('canonicalJSON', () => {
  test('sorts object keys deterministically', () => {
    const a = canonicalJSON({ b: 1, a: 2, c: 3 });
    const b = canonicalJSON({ c: 3, b: 1, a: 2 });
    expect(a).toBe(b);
  });

  test('stringifies equal objects identically regardless of insertion order', () => {
    const obj1 = { name: 'x', value: 1 };
    const obj2 = { value: 1, name: 'x' };
    expect(canonicalJSON(obj1)).toBe(canonicalJSON(obj2));
  });

  test('handles nested objects', () => {
    const obj1 = { outer: { z: 1, a: 2 }, n: 5 };
    const obj2 = { n: 5, outer: { a: 2, z: 1 } };
    expect(canonicalJSON(obj1)).toBe(canonicalJSON(obj2));
  });

  test('handles arrays', () => {
    expect(canonicalJSON([3, 1, 2])).toBe(canonicalJSON([3, 1, 2]));
  });
});