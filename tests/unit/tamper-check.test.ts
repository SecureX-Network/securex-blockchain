import { TamperCheckService } from '../../src/services/tamper-check';
import { AuditService } from '../../src/services/audit';
import { TransactionType } from '../../src/core/transaction/transaction';
import {
  setupV2TestChain,
  cleanupV2TestChain,
  signV2Tx,
  hashOf,
  TestChain,
} from '../helpers-v2';

describe('TamperCheckService', () => {
  let tc: TestChain;

  beforeEach(() => {
    tc = setupV2TestChain();
  });

  afterEach(() => cleanupV2TestChain(tc));

  function seedIssuerAndCred(issuerId: string, credentialId: string, data = 'real-data'): string {
    const issuerKey = require('../../src/crypto/signatures/crypto').CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId, name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, issuerId, 1, {
      credentialId, issuerId, credentialHash: hashOf(data),
    }, issuerKey.privateKey));
    return issuerKey.publicKey;
  }

  it('reports EXACT when document hash matches the anchored hash', () => {
    seedIssuerAndCred('issuer-1', 'cred-1', 'original');
    const svc = new TamperCheckService(tc.chain);
    const res = svc.check('cred-1', hashOf('original'));
    expect(res.status).toBe('EXACT');
    expect(res.hashMatch).toBe(true);
    expect(res.anchoredHash).toBe(hashOf('original'));
  });

  it('reports TAMPERED when document hash differs from the anchored hash', () => {
    seedIssuerAndCred('issuer-1', 'cred-1', 'original');
    const svc = new TamperCheckService(tc.chain);
    const res = svc.check('cred-1', hashOf('tampered'));
    expect(res.status).toBe('TAMPERED');
    expect(res.hashMatch).toBe(false);
  });

  it('reports UNVERIFIABLE for unknown credential', () => {
    const svc = new TamperCheckService(tc.chain);
    const res = svc.check('missing', hashOf('x'));
    expect(res.status).toBe('UNVERIFIABLE');
    expect(res.anchoredHash).toBeNull();
  });

  it('records a merkle verification failure on tamper', () => {
    seedIssuerAndCred('issuer-1', 'cred-1', 'original');
    const audit = new AuditService();
    const svc = new TamperCheckService(tc.chain, audit);
    svc.check('cred-1', hashOf('tampered'));
    const events = audit.getEvents();
    expect(events[0].type).toBe('MERKLE_VERIFICATION_FAILURE');
    expect(events[0].referenceId).toBe('cred-1');
  });

  it('returns anchor evidence (txId, blockHeight, blockHash)', () => {
    seedIssuerAndCred('issuer-1', 'cred-1');
    const svc = new TamperCheckService(tc.chain);
    const cred = tc.chain.getState().getCredential('cred-1')!;
    const anchor = svc.getAnchorEvidence(cred);
    expect(anchor.txId).toBeTruthy();
    expect(anchor.blockHeight).toBeGreaterThanOrEqual(1);
    expect(anchor.blockHash).toBeTruthy();
  });
});
