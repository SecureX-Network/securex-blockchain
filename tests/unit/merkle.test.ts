import { MerkleTree } from '../../src/merkle/merkle';
import { SHA256Hasher } from '../../src/crypto/hashing/hash';

describe('MerkleTree', () => {
  const data = ['a', 'b', 'c', 'd', 'e'];
  let tree: MerkleTree;
  let leaves: string[];

  beforeEach(() => {
    leaves = data.map(d => SHA256Hasher.hash(d));
    tree = new MerkleTree(leaves);
  });

  test('produces deterministic root', () => {
    const t2 = new MerkleTree(leaves);
    expect(tree.getRoot()).toBe(t2.getRoot());
    expect(tree.getRoot()).toMatch(/^[a-f0-9]{64}$/);
  });

  test('different data produces different root', () => {
    const t2 = new MerkleTree(['x', 'y', 'z'].map(d => SHA256Hasher.hash(d)));
    expect(tree.getRoot()).not.toBe(t2.getRoot());
  });

  test('single element tree has that element as root', () => {
    const single = new MerkleTree([SHA256Hasher.hash('only')]);
    expect(single.getRoot()).toBe(SHA256Hasher.hash('only'));
  });

  test('empty tree has zero root', () => {
    const empty = new MerkleTree([]);
    expect(empty.getRoot()).toBe('0'.repeat(64));
  });

  test('every leaf has a valid inclusion proof', () => {
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      expect(proof.length).toBeGreaterThan(0);
      expect(MerkleTree.verifyProof(leaves[i], proof, tree.getRoot())).toBe(true);
    }
  });

  test('rejects proof for wrong leaf', () => {
    const proof = tree.getProof(0);
    const wrongLeaf = SHA256Hasher.hash('not-in-tree');
    expect(MerkleTree.verifyProof(wrongLeaf, proof, tree.getRoot())).toBe(false);
  });

  test('rejects proof with tampered sibling', () => {
    const proof = tree.getProof(1);
    const tamperedProof = proof.map((p, idx) =>
      idx === 0 ? { ...p, hash: SHA256Hasher.hash('tampered') } : p,
    );
    expect(MerkleTree.verifyProof(leaves[1], tamperedProof, tree.getRoot())).toBe(false);
  });

  test('rejects proof against wrong root', () => {
    const proof = tree.getProof(0);
    const other = new MerkleTree(['z'].map(d => SHA256Hasher.hash(d)));
    expect(MerkleTree.verifyProof(leaves[0], proof, other.getRoot())).toBe(false);
  });

  test('even and odd leaf counts both produce valid proofs', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const t = new MerkleTree(Array.from({ length: count }, (_, i) => SHA256Hasher.hash(String(i))));
      const tLeaves = t.getLeaves();
      for (let i = 0; i < count; i++) {
        const proof = t.getProof(i);
        expect(MerkleTree.verifyProof(tLeaves[i], proof, t.getRoot())).toBe(true);
      }
    }
  });
});