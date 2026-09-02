import { HistoryService } from '../../src/services/history';
import { TransactionType } from '../../src/core/transaction/transaction';
import {
  setupV2TestChain,
  cleanupV2TestChain,
  signV2Tx,
  hashOf,
  TestChain,
} from '../helpers-v2';

describe('HistoryService', () => {
  let tc: TestChain;

  beforeEach(() => {
    tc = setupV2TestChain();
  });

  afterEach(() => cleanupV2TestChain(tc));

  function seedCredential(issuerId: string, credentialId: string): void {
    const issuerKey = require('../../src/crypto/signatures/crypto').CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId, name: 'Inst', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, issuerId, 1, {
      credentialId, issuerId, credentialHash: hashOf('data'),
    }, issuerKey.privateKey));
  }

  it('returns null for unknown credential history', () => {
    const svc = new HistoryService(tc.chain);
    expect(svc.getCredentialHistory('missing')).toBeNull();
  });

  it('returns credential lifecycle history in order', () => {
    const issuerKey = require('../../src/crypto/signatures/crypto').CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: hashOf('d'),
    }, issuerKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_SUSPEND, 'issuer-1', 2, { credentialId: 'cred-1' }, issuerKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_REINSTATE, 'issuer-1', 3, { credentialId: 'cred-1' }, issuerKey.privateKey));

    const svc = new HistoryService(tc.chain);
    const history = svc.getCredentialHistory('cred-1')!;
    expect(history.map(h => h.type)).toEqual(['ISSUED', 'SUSPENDED', 'REINSTATED']);
    expect(history.every(h => h.blockHeight >= 1 && h.blockHash)).toBe(true);
  });

  it('returns issuer transaction history bounded by limit', () => {
    const issuerKey = require('../../src/crypto/signatures/crypto').CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    for (let i = 0; i < 5; i++) {
      tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', i + 1, {
        credentialId: `cred-${i}`, issuerId: 'issuer-1', credentialHash: hashOf(`d${i}`),
      }, issuerKey.privateKey));
    }

    const svc = new HistoryService(tc.chain);
    const all = svc.getIssuerTransactionHistory('issuer-1', 100, 0);
    expect(all.length).toBeGreaterThanOrEqual(5);
    const limited = svc.getIssuerTransactionHistory('issuer-1', 2, 0);
    expect(limited.length).toBe(2);
  });

  it('returns issuer lifecycle (register + update)', () => {
    const issuerKey = require('../../src/crypto/signatures/crypto').CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.ISSUER_UPDATE, 'issuer-1', 1, {
      issuerId: 'issuer-1', name: 'Updated',
    }, issuerKey.privateKey));

    const svc = new HistoryService(tc.chain);
    const lifecycle = svc.getIssuerLifecycle('issuer-1')!;
    expect(lifecycle.map(h => h.type)).toEqual(['ISSUER_REGISTER', 'ISSUER_UPDATE']);
  });

  it('summarizeCredential reports current status and event count', () => {
    seedCredential('issuer-1', 'cred-1');
    const svc = new HistoryService(tc.chain);
    const cred = tc.chain.getState().getCredential('cred-1')!;
    const summary = svc.summarizeCredential(cred);
    expect(summary.eventCount).toBe(1);
    expect(summary.currentStatus).toBe('ACTIVE');
    expect(summary.lastEvent?.type).toBe('ISSUED');
  });
});
