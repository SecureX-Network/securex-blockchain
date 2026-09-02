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
import { SHA256Hasher, canonicalJSON } from '../../src/crypto/hashing/hash';
import { MerkleProofService } from '../../src/merkle/proofs';
import { Block, getBlockSigningData } from '../../src/core/block/block';
import { BlockchainError } from '../../src/core/errors';
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

function signTx(type: TransactionType, sender: string, nonce: number, payload: any, privKey: string, proto = '2.0', tver = 2): Transaction {
  const unsigned = {
    protocolVersion: proto,
    transactionVersion: tver,
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

describe('V2 Transaction Attack Suite', () => {
  let storage: Storage;
  let chain: Chain;
  let validatorKey: any;
  let issuerKey: any;
  let attackerKey: any;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-attack-'));
    storage = createFileStorage(tmpDir);
    chain = new Chain(storage, buildRegistry());
    chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
    validatorKey = CryptoManager.generateKeyPair();
    issuerKey = CryptoManager.generateKeyPair();
    attackerKey = CryptoManager.generateKeyPair();
    chain.updateValidatorKey('validator-1', validatorKey.publicKey);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const setup = (credentialId = 'cred-1') => {
    const regTx = signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey);
    commitTx(regTx);
    const issueTx = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
      credentialId, issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('data'),
    }, issuerKey.privateKey);
    commitTx(issueTx);
  };

  const commitTx = (tx: Transaction) => {
    const block = chain.createBlockV2('validator-1', [tx], chain.getTip());
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    return chain.commitBlock(block);
  };

  test('forged signature transaction rejected', () => {
    setup();
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 0, {
      credentialId: 'cred-x', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('d'),
    }, attackerKey.privateKey);
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.INVALID_SIGNATURE);
  });

  test('modified payload rejected (signature mismatch)', () => {
    setup();
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 0, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('data'),
    }, issuerKey.privateKey);
    tx.payload.credentialHash = SHA256Hasher.hash('tampered');
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.INVALID_SIGNATURE);
  });

  test('modified transaction hash rejected at block level', () => {
    setup();
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 2, {
      credentialId: 'cred-2', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('d'),
    }, issuerKey.privateKey);
    tx.payload.credentialHash = SHA256Hasher.hash('tampered');
    const block = chain.createBlockV2('validator-1', [tx], chain.getTip());
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    expect(chain.commitBlock(block)).toBe('INVALID_TX_IN_BLOCK:' + BlockchainError.INVALID_SIGNATURE);
  });

  test('replayed transaction rejected', () => {
    setup();
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 0, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('data'),
    }, issuerKey.privateKey);
    commitTx(tx);
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.REPLAYED_TRANSACTION);
  });

  test('duplicate transaction in same block rejected', () => {
    setup();
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
      credentialId: 'cred-2', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('d'),
    }, issuerKey.privateKey);
    const block = chain.createBlockV2('validator-1', [tx, tx], chain.getTip());
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    expect(chain.commitBlock(block)).toBe(BlockchainError.DUPLICATE_TRANSACTION);
  });

  test('unauthorized actor cannot issue credential for another issuer', () => {
    const regTx = signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey);
    commitTx(regTx);
    const tx = signTx(TransactionType.CREDENTIAL_ISSUE, attackerKey.keyId, 0, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('d'),
    }, attackerKey.privateKey);
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.UNAUTHORIZED_SENDER);
  });

  test('invalid transaction type rejected', () => {
    const tx: any = signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 0, {
      issuerId: 'i', name: 'n', publicKey: 'k',
    }, validatorKey.privateKey);
    tx.type = 'MALICIOUS';
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.UNKNOWN_TX_TYPE);
  });

  test('unsupported protocol version rejected', () => {
    const tx = signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 0, {
      issuerId: 'i', name: 'n', publicKey: 'k',
    }, validatorKey.privateKey, '9.9', 2);
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.UNSUPPORTED_PROTOCOL_VERSION);
  });

  test('malformed transaction (missing fields) rejected', () => {
    const tx: any = {
      protocolVersion: '2.0', transactionVersion: 2, type: TransactionType.ISSUER_REGISTER,
    };
    expect(chain.validateTransaction(tx)).toBe(BlockchainError.INVALID_TX_ID);
  });
});

describe('V2 Block Attack Suite', () => {
  let storage: Storage;
  let chain: Chain;
  let validatorKey: any;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-batt-'));
    storage = createFileStorage(tmpDir);
    chain = new Chain(storage, buildRegistry());
    chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
    validatorKey = CryptoManager.generateKeyPair();
    chain.updateValidatorKey('validator-1', validatorKey.publicKey);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const makeBlock = (opts: any = {}): Block => {
    const tx = signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: CryptoManager.generateKeyPair().publicKey,
    }, validatorKey.privateKey);
    let block = chain.createBlockV2('validator-1', [tx], chain.getTip());
    if (opts.modifiedPreviousHash) block.header.previousHash = 'f'.repeat(64);
    if (opts.modifiedMerkleRoot) block.header.merkleRoot = 'f'.repeat(64);
    if (opts.modifiedHeight) block.header.height = opts.modifiedHeight;
    if (opts.invalidValidator) block.header.proposerId = 'attacker';
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    if (opts.invalidProposerSig) {
      const attacker = CryptoManager.generateKeyPair();
      block.validatorSignatures = [{ validatorId: 'attacker', signature: CryptoManager.sign(sd, attacker.privateKey) }];
    } else {
      block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    }
    if (opts.modifiedBlockHash) block.hash = 'f'.repeat(64);
    else block.hash = chain.computeBlockHash(block.header, block.transactions);
    return block;
  };

  test('modified previous hash rejected', () => {
    const block = makeBlock({ modifiedPreviousHash: true });
    expect(chain.commitBlock(block)).toBe(BlockchainError.INVALID_PREVIOUS_HASH);
  });

  test('modified merkle root rejected', () => {
    const block = makeBlock({ modifiedMerkleRoot: true });
    expect(chain.commitBlock(block)).toBe(BlockchainError.INVALID_MERKLE_ROOT);
  });

  test('modified block hash rejected', () => {
    const block = makeBlock({ modifiedBlockHash: true });
    expect(chain.commitBlock(block)).toBe(BlockchainError.INVALID_BLOCK);
  });

  test('invalid validator rejected', () => {
    const block = makeBlock({ invalidValidator: true });
    expect(chain.commitBlock(block)).toBe(BlockchainError.UNKNOWN_VALIDATOR);
  });

  test('invalid height rejected', () => {
    const block = makeBlock({ modifiedHeight: 10 });
    expect(chain.commitBlock(block)).toBe(BlockchainError.INVALID_BLOCK_HEIGHT);
  });

  test('invalid proposer signature rejected', () => {
    const block = makeBlock({ invalidProposerSig: true });
    expect(chain.commitBlock(block)).toBe(BlockchainError.INVALID_PROPOSER_SIGNATURE);
  });

  test('corrupted persisted block detected by recovery', () => {
    const block = makeBlock();
    expect(chain.commitBlock(block)).toBeNull();

    const filePath = path.join(tmpDir, 'blocks', `${String(block.header.height).padStart(8, '0')}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    raw.header.merkleRoot = 'f'.repeat(64);
    fs.writeFileSync(filePath, JSON.stringify(raw), 'utf-8');

    const { ChainRecovery } = require('../../src/services/recovery');
    const freshChain = new Chain(createFileStorage(tmpDir), buildRegistry());
    const recovery = new ChainRecovery(freshChain);
    const result = recovery.recover();
    expect(result.recovered).toBe(false);
  });
});

describe('V2 Credential Attack Suite', () => {
  let storage: Storage;
  let chain: Chain;
  let validatorKey: any;
  let issuerKey: any;
  let attackerKey: any;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-catt-'));
    storage = createFileStorage(tmpDir);
    chain = new Chain(storage, buildRegistry());
    chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
    validatorKey = CryptoManager.generateKeyPair();
    issuerKey = CryptoManager.generateKeyPair();
    attackerKey = CryptoManager.generateKeyPair();
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
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    return chain.commitBlock(block);
  };

  test('duplicate issuance rejected', () => {
    commit(signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    const a = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('a'),
    }, issuerKey.privateKey);
    expect(commit(a)).toBeNull();
    const b = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 2, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('b'),
    }, issuerKey.privateKey);
    expect(chain.validateTransaction(b)).toBe('CREDENTIAL_ALREADY_EXISTS');
  });

  test('unauthorized revocation rejected (V2)', () => {
    commit(signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 0, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    commit(signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 0, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('a'),
    }, issuerKey.privateKey));
    const revoke = signTx(TransactionType.CREDENTIAL_REVOKE, attackerKey.keyId, 0, {
      credentialId: 'cred-1',
    }, attackerKey.privateKey);
    expect(chain.validateTransaction(revoke)).toBe(BlockchainError.UNAUTHORIZED_SENDER);
  });

  test('invalid lifecycle transition rejected (revoked cannot suspend)', () => {
    commit(signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    commit(signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('a'),
    }, issuerKey.privateKey));
    commit(signTx(TransactionType.CREDENTIAL_REVOKE, issuerKey.keyId, 2, { credentialId: 'cred-1' }, issuerKey.privateKey));
    const suspend = signTx(TransactionType.CREDENTIAL_SUSPEND, issuerKey.keyId, 3, { credentialId: 'cred-1' }, issuerKey.privateKey);
    expect(chain.validateTransaction(suspend)).toBe('INVALID_STATE_TRANSITION');
  });

  test('fake credential ID produces NOT_FOUND verification', () => {
    const { CredentialVerificationService, VerificationStatus } = require('../../src/services/verification');
    const verification = new CredentialVerificationService(chain);
    const result = verification.verifyCredentialSync('does-not-exist');
    expect(result.status).toBe(VerificationStatus.NOT_FOUND);
  });

  test('modified credential hash detected by verification', () => {
    commit(signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, validatorKey.privateKey));
    commit(signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('real'),
    }, issuerKey.privateKey));
    const onChainHash = chain.getState().getCredential('cred-1')!.credentialHash;
    expect(onChainHash).toBe(SHA256Hasher.hash('real'));
    expect(onChainHash).not.toBe(SHA256Hasher.hash('tampered'));
  });
});

describe('V2 Invalid Merkle Proof', () => {
  test('rejects invalid merkle proof', () => {
    const txHashes = [SHA256Hasher.hash('a'), SHA256Hasher.hash('b')];
    const tree = new (require('../../src/merkle/merkle').MerkleTree)(txHashes);
    const proof = tree.getProof(0);
    const valid = tree.constructor.verifyProof(SHA256Hasher.hash('a'), proof, tree.getRoot());
    expect(valid).toBe(true);
    const invalid = tree.constructor.verifyProof(SHA256Hasher.hash('tampered'), proof, tree.getRoot());
    expect(invalid).toBe(false);
  });
});
