import { Chain } from '../../src/core/chain';
import { createFileStorage, Storage } from '../../src/storage/file-store';
import { ModuleRegistry } from '../../src/modules/registry';
import { CredentialModule } from '../../src/modules/credentials/module';
import { IssuerModule, IssuerUpdateModule } from '../../src/modules/issuers/module';
import { RevokeModule, SuspendModule, ReinstateModule, ReissueModule } from '../../src/modules/revocation/module';
import { KeyRegisterModule, KeyRotateModule } from '../../src/modules/keys/module';
import { BatchAnchorModule } from '../../src/modules/batch';
import { Transaction, TransactionType, getSigningData } from '../../src/core/transaction/transaction';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { SHA256Hasher } from '../../src/crypto/hashing/hash';
import { getBlockSigningData } from '../../src/core/block/block';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function buildRegistry(): ModuleRegistry {
  const r = new ModuleRegistry();
  r.register(new CredentialModule());
  r.register(new IssuerModule());
  r.register(new IssuerUpdateModule());
  r.register(new RevokeModule());
  r.register(new SuspendModule());
  r.register(new ReinstateModule());
  r.register(new ReissueModule());
  r.register(new KeyRegisterModule());
  r.register(new KeyRotateModule());
  r.register(new BatchAnchorModule());
  return r;
}

function fixedId(seq: number): string {
  return seq.toString(16).padStart(32, '0');
}

function signTx(type: TransactionType, sender: string, nonce: number, payload: any, privKey: string, id: string): Transaction {
  const unsigned = {
    protocolVersion: '2.0',
    transactionVersion: 2,
    id,
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    sender,
    nonce,
    payload,
  };
  const sig = CryptoManager.sign(getSigningData(unsigned), privKey);
  return { ...unsigned, signature: sig };
}

function setupChain(dir: string, validatorKey: any, issuerKey: any): { chain: Chain; validatorKey: any; issuerKey: any } {
  const storage = createFileStorage(dir);
  const chain = new Chain(storage, buildRegistry());
  chain.initGenesis('2026-01-01T00:00:00.000Z', [validatorKey.keyId]);
  chain.updateValidatorKey(validatorKey.keyId, validatorKey.publicKey);
  return { chain, validatorKey, issuerKey };
}

function commit(chain: Chain, validatorKey: any, tx: Transaction): void {
  const block = chain.createBlockV2(validatorKey.keyId, [tx], chain.getTip());
  block.header.timestamp = '2026-01-01T00:00:00.000Z';
  const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
  block.validatorSignatures = [{ validatorId: validatorKey.keyId, signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
  block.hash = chain.computeBlockHash(block.header, block.transactions);
  const err = chain.commitBlock(block);
  if (err) throw new Error('commit failed: ' + err);
}

describe('Determinism tests', () => {
  test('identical transactions across two independent nodes produce same blocks/hash/state', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-det-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-det-b-'));
    const sharedValidator = CryptoManager.generateKeyPair();
    const sharedIssuer = CryptoManager.generateKeyPair();
    const nodeA = setupChain(dirA, sharedValidator, sharedIssuer);
    const nodeB = setupChain(dirB, sharedValidator, sharedIssuer);

    const seq = [
      { type: TransactionType.ISSUER_REGISTER as TransactionType, payload: { issuerId: 'issuer-1', name: 'University', publicKey: sharedIssuer.publicKey } },
      { type: TransactionType.CREDENTIAL_ISSUE as TransactionType, payload: { credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('cred-a') } },
      { type: TransactionType.CREDENTIAL_ISSUE as TransactionType, payload: { credentialId: 'cred-2', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('cred-b') } },
      { type: TransactionType.CREDENTIAL_SUSPEND as TransactionType, payload: { credentialId: 'cred-1' } },
      { type: TransactionType.CREDENTIAL_REINSTATE as TransactionType, payload: { credentialId: 'cred-1' } },
    ];

    for (let i = 0; i < seq.length; i++) {
      const item = seq[i];
      const sender = item.type === TransactionType.ISSUER_REGISTER ? nodeA.validatorKey.keyId : 'issuer-1';
      const nonce = item.type === TransactionType.ISSUER_REGISTER ? i + 1 : i;
      const priv = item.type === TransactionType.ISSUER_REGISTER ? nodeA.validatorKey.privateKey : nodeA.issuerKey.privateKey;
      const txA = signTx(item.type, sender, nonce, item.payload, priv, fixedId(i + 1));
      const txB = signTx(item.type, sender, nonce, item.payload, priv, fixedId(i + 1));
      commit(nodeA.chain, nodeA.validatorKey, txA);
      commit(nodeB.chain, nodeB.validatorKey, txB);
    }

    expect(nodeA.chain.getHeight()).toBe(nodeB.chain.getHeight());
    expect(nodeA.chain.getTip().hash).toBe(nodeB.chain.getTip().hash);

    for (let h = 1; h <= nodeA.chain.getHeight(); h++) {
      const bA = nodeA.chain.getBlockByHeight(h)!;
      const bB = nodeB.chain.getBlockByHeight(h)!;
      expect(bA.hash).toBe(bB.hash);
      expect(bA.header.merkleRoot).toBe(bB.header.merkleRoot);
      expect(bA.header.height).toBe(bB.header.height);
      expect(bA.transactions.map(t => t.id)).toEqual(bB.transactions.map(t => t.id));
    }

    expect(nodeA.chain.getState().getAllCredentials().length).toBe(nodeB.chain.getState().getAllCredentials().length);
    expect(nodeA.chain.getState().getCredential('cred-1')!.status).toBe(nodeB.chain.getState().getCredential('cred-1')!.status);
    expect(nodeA.chain.getState().toJSON()).toEqual(nodeB.chain.getState().toJSON());

    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  test('canonical serialization produces consistent hashes regardless of key order', () => {
    const a = { x: 1, b: 2, a: 3 };
    const b = { a: 3, b: 2, x: 1 };
    const { canonicalJSON } = require('../../src/crypto/hashing/hash');
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  test('same credential transactions give same merkle root at same height', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-mk-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-mk-b-'));
    const sharedValidator = CryptoManager.generateKeyPair();
    const sharedIssuer = CryptoManager.generateKeyPair();
    const nodeA = setupChain(dirA, sharedValidator, sharedIssuer);
    const nodeB = setupChain(dirB, sharedValidator, sharedIssuer);

    const txs = [SHA256Hasher.hash('c1'), SHA256Hasher.hash('c2'), SHA256Hasher.hash('c3')];
    for (const [i, hash] of txs.entries()) {
      const tree = new (require('../../src/merkle/merkle').MerkleTree)([hash]);
      const txA = signTx(TransactionType.BATCH_ANCHOR, nodeA.validatorKey.keyId, i + 1, { batchId: 'b1', merkleRoot: tree.getRoot(), credentialCount: 1, credentialHashes: [hash] }, nodeA.validatorKey.privateKey, fixedId(10 + i));
      const txB = signTx(TransactionType.BATCH_ANCHOR, nodeB.validatorKey.keyId, i + 1, { batchId: 'b1', merkleRoot: tree.getRoot(), credentialCount: 1, credentialHashes: [hash] }, nodeB.validatorKey.privateKey, fixedId(10 + i));
      commit(nodeA.chain, nodeA.validatorKey, txA);
      commit(nodeB.chain, nodeB.validatorKey, txB);
    }

    for (let h = 1; h <= nodeA.chain.getHeight(); h++) {
      expect(nodeA.chain.getBlockByHeight(h)!.header.merkleRoot).toBe(nodeB.chain.getBlockByHeight(h)!.header.merkleRoot);
      expect(nodeA.chain.getBlockByHeight(h)!.hash).toBe(nodeB.chain.getBlockByHeight(h)!.hash);
    }

    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });
});
