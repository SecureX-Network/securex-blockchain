import { Chain } from '../../src/core/chain';
import { PermissionedConsensus, ConsensusEvents } from '../../src/consensus/permissioned/consensus';
import { createFileStorage } from '../../src/storage/file-store';
import { buildV2Registry, signV2Tx, hashOf, TestChain, setupV2TestChain, cleanupV2TestChain } from '../helpers-v2';
import { TransactionType } from '../../src/core/transaction/transaction';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Security: malformed input & unauthorized actors', () => {
  let tc: TestChain;

  beforeEach(() => { tc = setupV2TestChain(); });
  afterEach(() => cleanupV2TestChain(tc));

  it('rejects malformed credential issuance (bad credentialHash)', () => {
    const issuerKey = CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));

    const tx = signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: 'not-a-64-char-hex-hash',
    }, issuerKey.privateKey);
    expect(tc.chain.validateTransaction(tx)).not.toBeNull();
  });

  it('rejects issuance missing credentialId', () => {
    const issuerKey = CryptoManager.generateKeyPair();
    const tx = signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      issuerId: 'issuer-1', credentialHash: hashOf('x'),
    }, issuerKey.privateKey);
    expect(tc.chain.validateTransaction(tx)).not.toBeNull();
  });

  it('consensus.addTransaction rejects malformed input and notifies onRejected', () => {
    const rejected: string[] = [];
    const events: ConsensusEvents = { onRejected: (err) => { if (err) rejected.push(err); } };
    const consensus = new PermissionedConsensus(tc.chain, { blockInterval: 300, minSignatures: 1 }, 'validator-1', tc.validatorKey.privateKey, events);
    consensus.setPanel(['validator-1']);

    const bad = signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'c', issuerId: 'issuer-1', credentialHash: 'short',
    }, tc.validatorKey.privateKey);
    const err = consensus.addTransaction(bad);
    expect(err).not.toBeNull();
    expect(rejected).toContain(err);
  });

  it('consensus rejects unauthorized V2 actor transactions', () => {
    const issuerKey = CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: hashOf('d'),
    }, issuerKey.privateKey));

    const attacker = CryptoManager.generateKeyPair();
    const attackerSender = CryptoManager.deriveNodeId(attacker.publicKey);
    const rejected: string[] = [];
    const events: ConsensusEvents = { onRejected: (err) => { if (err) rejected.push(err); } };
    const consensus = new PermissionedConsensus(tc.chain, { blockInterval: 300, minSignatures: 1 }, 'validator-1', tc.validatorKey.privateKey, events);
    consensus.setPanel(['validator-1']);

    const err = consensus.addTransaction(signV2Tx(TransactionType.CREDENTIAL_REVOKE, attackerSender, 1, {
      credentialId: 'cred-1',
    }, attacker.privateKey));
    expect(err).not.toBeNull();
    expect(['UNAUTHORIZED_ISSUER', 'UNAUTHORIZED_SENDER']).toContain(err);
    expect(rejected).toContain(err!);
  });
});

describe('Security: unknown-proposer block rejection (no fabrication)', () => {
  it('rejects a block proposed by an unknown validator', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-sec-'));
    const storage = createFileStorage(tmpDir);
    const chain = new Chain(storage, buildV2Registry());
    chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
    const validatorKey = CryptoManager.generateKeyPair();
    chain.updateValidatorKey('validator-1', validatorKey.publicKey);

    const unknown = CryptoManager.generateKeyPair();
    const tx = signV2Tx(TransactionType.ISSUER_REGISTER, 'unknown-validator', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: CryptoManager.generateKeyPair().publicKey,
    }, unknown.privateKey);
    const block = chain.createBlockV2('unknown-validator', [tx], chain.getTip());
    const sd = require('../../src/core/block/block').getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'unknown-validator', signature: CryptoManager.sign(sd, unknown.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    const err = chain.commitBlock(block);
    expect(err).not.toBeNull();
    expect(chain.getHeight()).toBe(0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
