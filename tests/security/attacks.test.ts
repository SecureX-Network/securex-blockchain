import { makeNodeConfig, startNode, waitForHeight, waitFor, CRED } from '../integration/helpers';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { TransactionType, getSigningData } from '../../src/core/transaction/transaction';

jest.setTimeout(120000);

function pickFreePort(base: number): number {
  return base + Math.floor(Math.random() * 1000);
}

async function setupNode() {
  const keyPair = CryptoManager.generateKeyPair();
  const config = makeNodeConfig(keyPair.keyId, pickFreePort(5000), pickFreePort(6000), [keyPair.keyId]);
  const { node, client } = await startNode(config, keyPair);
  await waitForHeight(client, 0);

  const reg = await client.submitTransaction(TransactionType.ISSUER_REGISTER, {
    issuerId: 'uni-1',
    name: 'Test University',
    publicKey: CryptoManager.generateKeyPair().publicKey,
  });
  expect(reg.success).toBe(true);
  await waitFor(1500);
  return { node, client, keyPair };
}

describe('Security tests', () => {
  test('forged signature transaction rejected', async () => {
    const { node, client, keyPair } = await setupNode();

    const attacker = CryptoManager.generateKeyPair();
    const cred = CRED('cred-forge');

    const unsigned = {
      protocolVersion: '1.0',
      transactionVersion: 1,
      id: `f-${Date.now()}`,
      type: TransactionType.CREDENTIAL_ISSUE,
      timestamp: new Date().toISOString(),
      sender: keyPair.keyId,
      nonce: client.getNonce(),
      payload: {
        ...cred,
        issuerId: 'uni-1',
      },
    };
    const signingData = getSigningData(unsigned);
    const forgedSignature = CryptoManager.sign(signingData, attacker.privateKey);
    const forgedTx = { ...unsigned, signature: forgedSignature };

    const res = await client.submitRawTransaction(forgedTx);
    expect(res.success).toBe(false);

    await node.stop();
  });

  test('modified payload rejected', async () => {
    const { node, client, keyPair } = await setupNode();

    const cred = CRED('cred-mod');
    const signed = client.signTransaction(TransactionType.CREDENTIAL_ISSUE, {
      ...cred,
      issuerId: 'uni-1',
    });
    signed.payload.credentialHash = CryptoManager.generateKeyPair().keyId.substring(0, 64);
    if (signed.payload.credentialHash.length !== 64) signed.payload.credentialHash = 'f'.repeat(64);

    const res = await client.submitRawTransaction(signed);
    expect(res.success).toBe(false);

    await node.stop();
  });

  test('replayed transaction rejected', async () => {
    const { node, client, keyPair } = await setupNode();

    const tx = client.signTransaction(TransactionType.CREDENTIAL_ISSUE, {
      ...CRED('cred-replay'),
      issuerId: 'uni-1',
    });

    const first = await client.submitRawTransaction(tx);
    await waitFor(2000);
    const second = await client.submitRawTransaction(tx);
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);

    await node.stop();
  });

  test('duplicate credential id rejected', async () => {
    const { node, client, keyPair } = await setupNode();

    const cred = CRED('cred-dup');
    const r1 = await client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, { ...cred, issuerId: 'uni-1' });
    await waitFor(2000);

    // attempt to issue same credential id again under a new tx
    const r2 = await client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, { ...cred, issuerId: 'uni-1' });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);

    await node.stop();
  });

  test('unauthorized issuer rejected', async () => {
    const { node, client, keyPair } = await setupNode();

    const res = await client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, {
      ...CRED('cred-unauth'),
      issuerId: 'nonexistent-issuer',
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('UNKNOWN_ISSUER');

    await node.stop();
  });

  test('unknown sender rejected', async () => {
    const { node, client, keyPair } = await setupNode();

    const unsigned = {
      protocolVersion: '1.0',
      transactionVersion: 1,
      id: `u-${Date.now()}`,
      type: TransactionType.ISSUER_REGISTER,
      timestamp: new Date().toISOString(),
      sender: CryptoManager.generateKeyPair().keyId,
      nonce: 1,
      payload: { issuerId: 'rogue', name: 'Rogue', publicKey: 'pk' },
    };
    const signingData = getSigningData(unsigned);
    const sig = CryptoManager.sign(signingData, CryptoManager.generateKeyPair().privateKey);
    const tx = { ...unsigned, signature: sig };

    const res = await client.submitRawTransaction(tx);
    expect(res.success).toBe(false);
    expect(['UNAUTHORIZED_SENDER', 'INVALID_SIGNATURE']).toContain(res.error);

    await node.stop();
  });
});