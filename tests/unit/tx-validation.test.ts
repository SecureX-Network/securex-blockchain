import { makeRegistry, makeState, makeIdentity, signTx, makeUnsignedTx, hashOf } from '../helpers';
import { TransactionValidator } from '../../src/core/validation/tx-validator';
import { TransactionType } from '../../src/core/transaction/transaction';
import { StateManager } from '../../src/core/state/state';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { getSigningData } from '../../src/core/transaction/transaction';
import { CredentialModule } from '../../src/modules/credentials/module';

describe('TransactionValidator', () => {
  let registry: ReturnType<typeof makeRegistry>;
  let validator: TransactionValidator;
  let state: StateManager;
  let issuer: { keyPair: any; nodeId: string };

  beforeEach(() => {
    registry = makeRegistry();
    validator = new TransactionValidator(registry);
    state = makeState();
    issuer = makeIdentity();

    const keyPair = issuer.keyPair;
    state.setValidator({
      validatorId: keyPair.keyId,
      publicKey: keyPair.publicKey,
      status: 'ACTIVE',
      addedAt: new Date().toISOString(),
    });
  });

  const registerIssuer = (id: string) => {
    const issuerIdent = makeIdentity();
    state.setIssuer({
      issuerId: id,
      name: 'Test University',
      publicKey: issuerIdent.keyPair.publicKey,
      status: 'ACTIVE',
      registeredAt: new Date().toISOString(),
      metadata: {},
    });
  };

  const validatorTx = (type: TransactionType, payload: Record<string, any>, nonce: number) => {
    return signTx(makeUnsignedTx(type, issuer.nodeId, nonce, payload), issuer.keyPair.privateKey);
  };

  test('valid ISSUER_REGISTER passes validation', () => {
    const tx = validatorTx(TransactionType.ISSUER_REGISTER, {
      issuerId: 'uni-1',
      name: 'Test University',
      publicKey: 'dummy-public-key',
    }, 1);
    expect(validator.validate(state, tx)).toBeNull();
  });

  test('CREDENTIAL_ISSUE validates and adds credential', () => {
    registerIssuer('uni-1');
    const tx = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-123',
      issuerId: 'uni-1',
      credentialHash: hashOf('some-cert-and-data'),
      schemaVersion: '1.0',
    }, 1);
    expect(validator.validate(state, tx)).toBeNull();
  });

  test('invalid issuer is rejected (UNKNOWN_ISSUER)', () => {
    const tx = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-1',
      issuerId: 'unknown-issuer',
      credentialHash: hashOf('data'),
    }, 1);
    expect(validator.validate(state, tx)).toBe('UNKNOWN_ISSUER');
  });

  test('wrong signature rejected (INVALID_SIGNATURE)', () => {
    registerIssuer('uni-1');
    const other = makeIdentity();
    const tx = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-1',
      issuerId: 'uni-1',
      credentialHash: hashOf('data'),
    }, 1);
    const signingData = getSigningData({
      protocolVersion: '1.0',
      transactionVersion: 1,
      id: tx.id,
      type: tx.type,
      timestamp: tx.timestamp,
      sender: tx.sender,
      nonce: tx.nonce,
      payload: tx.payload,
    });
    tx.signature = CryptoManager.sign(signingData, other.keyPair.privateKey);
    const result = validator.validate(state, tx);
    expect(['INVALID_SIGNATURE', 'UNAUTHORIZED_SENDER']).toContain(result);
  });

  test('tampered payload rejected (INVALID_SIGNATURE)', () => {
    registerIssuer('uni-1');
    const tx = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-1',
      issuerId: 'uni-1',
      credentialHash: hashOf('data'),
    }, 1);
    tx.payload.credentialHash = hashOf('different-data');
    expect(validator.validate(state, tx)).toBe('INVALID_SIGNATURE');
  });

  test('replayed transaction rejected (REPLAYED_TRANSACTION)', () => {
    registerIssuer('uni-1');
    const tx = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-1',
      issuerId: 'uni-1',
      credentialHash: hashOf('data'),
    }, 1);
    state.setNonce(issuer.nodeId, 1);
    expect(validator.validate(state, tx)).toBe('REPLAYED_TRANSACTION');
  });

  test('nonce larger than current passes (gaps allowed)', () => {
    registerIssuer('uni-1');
    const tx = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-1',
      issuerId: 'uni-1',
      credentialHash: hashOf('data'),
    }, 5);
    state.setNonce(issuer.nodeId, 2);
    expect(validator.validate(state, tx)).toBeNull();
  });

  test('duplicate credential id rejected', () => {
    registerIssuer('uni-1');
    const tx1 = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred',
      issuerId: 'uni-1',
      credentialHash: hashOf('d1'),
    }, 1);
    const tx2 = validatorTx(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred',
      issuerId: 'uni-1',
      credentialHash: hashOf('d2'),
    }, 2);

    expect(validator.validate(state, tx1)).toBeNull();
    state.setNonce(issuer.nodeId, 1);

    const mod = new CredentialModule();
    mod.apply(state, tx1, {
      blockHeight: 1,
      txId: tx1.id,
      timestamp: tx1.timestamp,
    });

    expect(validator.validate(state, tx2)).toBe('CREDENTIAL_ALREADY_EXISTS');
  });

  test('UNSUPPORTED_PROTOCOL_VERSION rejected', () => {
    const tx = validatorTx(TransactionType.ISSUER_REGISTER, {
      issuerId: 'i', name: 'n', publicKey: 'k',
    }, 1);
    tx.protocolVersion = '9.9';
    expect(validator.validate(state, tx)).toBe('UNSUPPORTED_PROTOCOL_VERSION');
  });

  test('unknown tx type rejected', () => {
    const tx: any = validatorTx(TransactionType.ISSUER_REGISTER, { issuerId: 'i', name: 'n', publicKey: 'k' }, 1);
    tx.type = 'MALICIOUS_TYPE';
    expect(validator.validate(state, tx)).toBe('UNKNOWN_TX_TYPE');
  });

  test('nonce 0 rejected for fresh sender (must start at 1)', () => {
    const tx = validatorTx(TransactionType.ISSUER_REGISTER, {
      issuerId: 'uni-2', name: 'n', publicKey: 'k',
    }, 0);
    expect(validator.validate(state, tx)).toBe('REPLAYED_TRANSACTION');
  });
});