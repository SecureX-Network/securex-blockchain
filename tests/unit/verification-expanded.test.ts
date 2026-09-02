import { CredentialVerificationService, VerificationStatus } from '../../src/services/verification';
import { TransactionType } from '../../src/core/transaction/transaction';
import {
  setupV2TestChain,
  cleanupV2TestChain,
  signV2Tx,
  hashOf,
  TestChain,
} from '../helpers-v2';

describe('Expanded verification engine', () => {
  let tc: TestChain;

  beforeEach(() => {
    tc = setupV2TestChain();
  });

  afterEach(() => cleanupV2TestChain(tc));

  function makeIssuer(issuerId = 'issuer-1'): string {
    const key = require('../../src/crypto/signatures/crypto').CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.KEY_REGISTER, 'validator-1', 1, {
      keyId: `key-${issuerId}`, ownerId: issuerId, publicKey: key.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 2, {
      issuerId, name: 'Inst', publicKey: key.publicKey,
    }, tc.validatorKey.privateKey));
    return key.privateKey;
  }

  it('reports EXPIRED for a credential past its expiry date', () => {
    const issuerKey = makeIssuer('issuer-1');
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-exp', issuerId: 'issuer-1', credentialHash: hashOf('d'),
      metadata: { expiry: '2020-01-01T00:00:00.000Z' },
    }, issuerKey));

    const svc = new CredentialVerificationService(tc.chain);
    const result = svc.verifyCredentialSync('cred-exp');
    expect(result.status).toBe(VerificationStatus.EXPIRED);
  });

  it('reports VALID for a credential with a future expiry', () => {
    const issuerKey = makeIssuer('issuer-1');
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-future', issuerId: 'issuer-1', credentialHash: hashOf('d'),
      metadata: { expiry: '2099-01-01T00:00:00.000Z' },
    }, issuerKey));

    const svc = new CredentialVerificationService(tc.chain);
    const result = svc.verifyCredentialSync('cred-future');
    expect(result.status).toBe(VerificationStatus.VALID);
  });

  it('includes verifiedAt, protocolCompatible and keyStatus on a valid verification', () => {
    const issuerKey = makeIssuer('issuer-1');
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: hashOf('d'),
    }, issuerKey));

    const svc = new CredentialVerificationService(tc.chain);
    const result = svc.verifyCredentialSync('cred-1');
    expect(result.status).toBe(VerificationStatus.VALID);
    expect(result.protocolCompatible).toBe(true);
    expect(result.verifiedAt).toBeTruthy();
    expect(result.issuerSignatureValid).toBe(true);
    expect(result.keyStatus).toBeTruthy();
  });

  it('reports INVALID for an inactive issuer', () => {
    const issuerKey = makeIssuer('issuer-1');
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: hashOf('d'),
    }, issuerKey));
    const issuer = tc.chain.getState().getIssuer('issuer-1')!;
    issuer.status = 'SUSPENDED';
    tc.chain.getState().setIssuer(issuer);

    const svc = new CredentialVerificationService(tc.chain);
    const result = svc.verifyCredentialSync('cred-1');
    expect(result.status).toBe(VerificationStatus.INVALID);
  });

});
