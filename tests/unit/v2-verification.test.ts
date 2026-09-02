import { Chain } from '../../src/core/chain';
import { createFileStorage, Storage } from '../../src/storage/file-store';
import { ModuleRegistry } from '../../src/modules/registry';
import { CredentialModule } from '../../src/modules/credentials/module';
import { IssuerModule, IssuerUpdateModule } from '../../src/modules/issuers/module';
import { RevokeModule, SuspendModule, ReinstateModule, ReissueModule } from '../../src/modules/revocation/module';
import { KeyRegisterModule, KeyRotateModule } from '../../src/modules/keys/module';
import { BatchAnchorModule } from '../../src/modules/batch';
import { Transaction, TransactionType, getSigningData, buildV2Transaction } from '../../src/core/transaction/transaction';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { SHA256Hasher, canonicalJSON } from '../../src/crypto/hashing/hash';
import { CredentialVerificationService, VerificationStatus } from '../../src/services/verification';
import { ChainEvidenceProvider } from '../../src/services/evidence';
import { ChainRecovery } from '../../src/services/recovery';
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

function signV2Tx(type: TransactionType, sender: string, nonce: number, payload: any, privKey: string): Transaction {
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
  const sig = CryptoManager.sign(getSigningData(unsigned), privKey);
  return { ...unsigned, signature: sig };
}

describe('Verification and Evidence boundary', () => {
  let tmpDir: string;
  let storage: Storage;
  let chain: Chain;
  let validatorKey: CryptoManager & { publicKey: string; privateKey: string; keyId: string };
  let issuerKey: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-v2-'));
    storage = createFileStorage(tmpDir);
    chain = new Chain(storage, buildRegistry());
    chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
    validatorKey = CryptoManager.generateKeyPair() as any;
    issuerKey = CryptoManager.generateKeyPair();
    chain.updateValidatorKey('validator-1', validatorKey.publicKey);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const commit = (tx: Transaction) => {
    const block = chain.createBlockV2('validator-1', [tx], chain.getTip());
    const sd = require('../../src/core/block/block').getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    const err = chain.commitBlock(block);
    expect(err).toBeNull();
  };

  test('verifies a valid credential to VALID', () => {
    commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    const payload = {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('data'), schemaVersion: '2.0',
    };
    commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, payload, issuerKey.privateKey));

    const verification = new CredentialVerificationService(chain);
    const result = verification.verifyCredentialSync('cred-1');
    expect(result.status).toBe(VerificationStatus.VALID);
    expect(result.proof).toBeDefined();
    expect(result.block).toBeDefined();
  });

  test('returns REVOKED for a revoked credential without fabricating proof', () => {
    commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    const payload = {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('data'),
    };
    commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, payload, issuerKey.privateKey));
    commit(signV2Tx(TransactionType.CREDENTIAL_REVOKE, 'issuer-1', 2, { credentialId: 'cred-1' }, issuerKey.privateKey));

    const verification = new CredentialVerificationService(chain);
    const result = verification.verifyCredentialSync('cred-1');
    expect(result.status).toBe(VerificationStatus.REVOKED);
  });

  test('returns NOT_FOUND for unknown credential', () => {
    const verification = new CredentialVerificationService(chain);
    const result = verification.verifyCredentialSync('missing');
    expect(result.status).toBe(VerificationStatus.NOT_FOUND);
  });

  test('evidence provider reports anchored and issuer recognized', () => {
    commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('data'),
    }, issuerKey.privateKey));

    const provider = new ChainEvidenceProvider(chain);
    expect(provider.isCredentialAnchored('cred-1').available).toBe(true);
    expect(provider.isIssuerRecognized('issuer-1')).toBe(true);
    const block = provider.getContainingBlock('cred-1');
    expect(block.available).toBe(true);
    expect(block.evidence?.block).toBeDefined();
  });

  test('evidence provider returns unavailable for unknown credential', () => {
    const provider = new ChainEvidenceProvider(chain);
    const result = provider.isCredentialAnchored('missing');
    expect(result.available).toBe(false);
  });
});

describe('ChainRecovery', () => {
  test('recovers an empty chain', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-rec-'));
    const storage = createFileStorage(tmpDir);
    const chain = new Chain(storage, buildRegistry());
    const recovery = new ChainRecovery(chain);
    const result = recovery.recover();
    expect(result.recovered).toBe(true);
    expect(result.height).toBe(-1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('recovers a chain with blocks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-rec2-'));
    const storage = createFileStorage(tmpDir);
    const chain = new Chain(storage, buildRegistry());
    const key = CryptoManager.generateKeyPair();
    chain.initGenesis('2026-01-01T00:00:00.000Z', [key.keyId]);
    chain.updateValidatorKey(key.keyId, key.publicKey);
    const tx = signV2Tx(TransactionType.ISSUER_REGISTER, key.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: CryptoManager.generateKeyPair().publicKey,
    }, key.privateKey);
    const block = chain.createBlockV2(key.keyId, [tx], chain.getTip());
    const sd = require('../../src/core/block/block').getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: key.keyId, signature: CryptoManager.sign(sd, key.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    chain.commitBlock(block);

    const recovery = new ChainRecovery(chain);
    const result = recovery.recover();
    expect(result.recovered).toBe(true);
    expect(result.height).toBe(1);
    expect(result.blocksValidated).toBe(2);
    expect(result.stateValidated).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
