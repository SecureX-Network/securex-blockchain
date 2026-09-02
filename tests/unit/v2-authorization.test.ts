import { TransactionType, getSigningData } from '../../src/core/transaction/transaction';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import {
  setupV2TestChain,
  cleanupV2TestChain,
  signV2Tx,
  hashOf,
  TestChain,
} from '../helpers-v2';

function signAs(sender: string, nonce: number, type: TransactionType, payload: any, privKey: string) {
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

describe('V2 lifecycle authorization boundary', () => {
  let tc: TestChain;

  beforeEach(() => {
    tc = setupV2TestChain();
  });

  afterEach(() => cleanupV2TestChain(tc));

  function seed(issuerId = 'issuer-1', credentialId = 'cred-1') {
    const issuerKey = CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId, name: 'Institution', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    const sender = CryptoManager.deriveNodeId(issuerKey.publicKey);
    tc.commit(signAs(sender, 1, TransactionType.CREDENTIAL_ISSUE, {
      credentialId, issuerId, credentialHash: hashOf('data'),
    }, issuerKey.privateKey));
    return { issuerKey, sender };
  }

  it('authorizes the issuer-derived sender to suspend their own credential', () => {
    const { issuerKey, sender } = seed();
    tc.commit(signAs(sender, 2, TransactionType.CREDENTIAL_SUSPEND, { credentialId: 'cred-1' }, issuerKey.privateKey));
    expect(tc.chain.getState().getCredential('cred-1')!.status).toBe('SUSPENDED');
  });

  it('rejects an unauthorized actor revoking another issuers credential (V2)', () => {
    seed('issuer-1', 'cred-1');
    const attacker = CryptoManager.generateKeyPair();
    const attackerSender = CryptoManager.deriveNodeId(attacker.publicKey);

    const block = tc.chain.createBlockV2('validator-1', [
      signAs(attackerSender, 1, TransactionType.CREDENTIAL_REVOKE, { credentialId: 'cred-1' }, attacker.privateKey),
    ], tc.chain.getTip());
    const sd = require('../../src/core/block/block').getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, tc.validatorKey.privateKey) }];
    block.hash = tc.chain.computeBlockHash(block.header, block.transactions);
    const err = tc.chain.commitBlock(block);
    expect(err).not.toBeNull();
    expect(tc.chain.getState().getCredential('cred-1')!.status).toBe('ACTIVE');
  });

  it('rejects unauthorized suspend leaving state unchanged', () => {
    seed('issuer-1', 'cred-1');
    const attacker = CryptoManager.generateKeyPair();
    const attackerSender = CryptoManager.deriveNodeId(attacker.publicKey);
    const block = tc.chain.createBlockV2('validator-1', [
      signAs(attackerSender, 1, TransactionType.CREDENTIAL_SUSPEND, { credentialId: 'cred-1' }, attacker.privateKey),
    ], tc.chain.getTip());
    const sd = require('../../src/core/block/block').getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: 'validator-1', signature: CryptoManager.sign(sd, tc.validatorKey.privateKey) }];
    block.hash = tc.chain.computeBlockHash(block.header, block.transactions);
    const err = tc.chain.commitBlock(block);
    expect(err).not.toBeNull();
    expect(tc.chain.getState().getCredential('cred-1')!.status).toBe('ACTIVE');
  });

  it('authorizes V1-style sender==issuerId binding (back-compat)', () => {
    const issuerKey = CryptoManager.generateKeyPair();
    tc.commit(signV2Tx(TransactionType.ISSUER_REGISTER, 'validator-1', 1, {
      issuerId: 'issuer-1', name: 'U', publicKey: issuerKey.publicKey,
    }, tc.validatorKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_ISSUE, 'issuer-1', 1, {
      credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: hashOf('d'),
    }, issuerKey.privateKey));
    tc.commit(signV2Tx(TransactionType.CREDENTIAL_REVOKE, 'issuer-1', 2, { credentialId: 'cred-1' }, issuerKey.privateKey));
    expect(tc.chain.getState().getCredential('cred-1')!.status).toBe('REVOKED');
  });
});
