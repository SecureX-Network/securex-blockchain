import { MerkleProofService } from '../../src/merkle/proofs';
import { MerkleTree } from '../../src/merkle/merkle';
import { Block, BlockHeader, GENESIS_HASH } from '../../src/core/block/block';
import { Transaction, TransactionType, getSigningData, buildV2Transaction } from '../../src/core/transaction/transaction';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { SHA256Hasher, canonicalJSON } from '../../src/crypto/hashing/hash';

function buildBlock(transactions: Transaction[], version: number = 2): Block {
  const txHashes = transactions.map(tx => (version >= 2 ? SHA256Hasher.hash(canonicalJSON(tx)) : tx.id));
  const tree = new MerkleTree(txHashes);
  const header: BlockHeader = {
    version,
    height: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    previousHash: GENESIS_HASH,
    merkleRoot: tree.getRoot(),
    proposerId: 'validator-1',
  };
  return {
    header,
    transactions,
    validatorSignatures: [],
    hash: 'a'.repeat(64),
  };
}

function signTx(type: TransactionType, sender: string, nonce: number, payload: any, privKey: string): Transaction {
  const unsigned = {
    protocolVersion: '2.0',
    transactionVersion: 2,
    id: require('crypto').randomBytes(16).toString('hex'),
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    sender,
    nonce,
    payload,
  };
  const signingData = getSigningData(unsigned);
  const sig = CryptoManager.sign(signingData, privKey);
  return { ...unsigned, signature: sig };
}

describe('MerkleProofService', () => {
  const keyPair = CryptoManager.generateKeyPair();
  const hash = (s: string) => SHA256Hasher.hash(s);

  test('builds a deterministic merkle root for V2 transactions', () => {
    const tx1 = signTx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, { credentialHash: hash('a') }, keyPair.privateKey);
    const tx2 = signTx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, { credentialHash: hash('b') }, keyPair.privateKey);
    const block = buildBlock([tx1, tx2], 2);
    const root1 = MerkleProofService.getBlockMerkleRoot(block);
    const root2 = MerkleProofService.getBlockMerkleRoot(block);
    expect(root1).toBe(root2);
  });

  test('creates a valid inclusion proof for a transaction', () => {
    const txs = Array.from({ length: 4 }, (_, i) =>
      signTx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, { credentialHash: hash(`x${i}`) }, keyPair.privateKey),
    );
    const block = buildBlock(txs, 2);
    const proof = MerkleProofService.createTransactionProof(block, txs[2].id)!;
    expect(proof).not.toBeNull();
    expect(proof.verified).toBe(true);
    const verification = MerkleProofService.verifyInclusionProof(proof.leafHash, proof);
    expect(verification.valid).toBe(true);
  });

  test('rejects a tampered merkle proof', () => {
    const txs = Array.from({ length: 4 }, (_, i) =>
      signTx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, { credentialHash: hash(`y${i}`) }, keyPair.privateKey),
    );
    const block = buildBlock(txs, 2);
    const proof = MerkleProofService.createTransactionProof(block, txs[1].id)!;
    proof.merkleRoot = 'f'.repeat(64);
    const verification = MerkleProofService.verifyInclusionProof(proof.leafHash, proof);
    expect(verification.valid).toBe(false);
  });

  test('handles empty transaction list (zero merkle root)', () => {
    const block = buildBlock([], 2);
    expect(MerkleProofService.getBlockMerkleRoot(block)).toBe('0'.repeat(64));
  });

  test('anchorHashList produces deterministic canonical root', () => {
    const hashes = [hash('a'), hash('b'), hash('c')];
    const { root } = MerkleProofService.anchorHashList(hashes, true);
    const shuffled = MerkleProofService.anchorHashList([hash('c'), hash('a'), hash('b')], true);
    expect(root).toBe(shuffled.root);
  });

  test('odd transaction count handled correctly', () => {
    const txs = [0, 1, 2].map(i =>
      signTx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, { credentialHash: hash(`z${i}`) }, keyPair.privateKey),
    );
    const block = buildBlock(txs, 2);
    const proof = MerkleProofService.createTransactionProof(block, txs[2].id)!;
    expect(proof.verified).toBe(true);
  });

  test('V1 blocks use transaction id as leaf', () => {
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, { credentialHash: hash('w') }, keyPair.privateKey);
    const block = buildBlock([tx], 1);
    const proof = MerkleProofService.createTransactionProof(block, tx.id)!;
    expect(proof.leafHash).toBe(tx.id);
  });
});
