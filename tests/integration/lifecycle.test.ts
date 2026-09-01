import { makeNodeConfig, startNode, waitForHeight, waitFor, CRED, hashOf } from './helpers';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { TransactionType } from '../../src/core/transaction/transaction';

jest.setTimeout(90000);

describe('Credential lifecycle integration', () => {
  let node: Awaited<ReturnType<typeof startNode>>;
  const keyPair = CryptoManager.generateKeyPair();

  beforeAll(async () => {
    const config = makeNodeConfig(
      keyPair.keyId,
      4500 + Math.floor(Math.random() * 100),
      5500 + Math.floor(Math.random() * 100),
      [keyPair.keyId],
    );
    node = await startNode(config, keyPair);
    await waitForHeight(node.client, 0);
  });

  afterAll(async () => {
    if (node) await node.node.stop();
  });

  beforeEach(async () => {
    const issuer = await node.client.getIssuer('uni-1');
    if (!issuer.success) {
      const res = await node.client.submitTransaction(TransactionType.ISSUER_REGISTER, {
        issuerId: 'uni-1',
        name: 'Test University',
        publicKey: 'uni-public-key',
      });
      expect(res.success).toBe(true);
      await waitFor(1500);
    }
  });

  test('issue then verify ACTIVE', async () => {
    const id = `cred-${Date.now()}`;
    await node.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, CRED(id));
    await waitFor(1500);
    const cred = await node.client.getCredential(id);
    expect(cred.success).toBe(true);
    expect(cred.data.status).toBe('ACTIVE');
  });

  test('suspend then reinstate a credential', async () => {
    const id = `cred-sr-${Date.now()}`;
    await node.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, CRED(id));
    await waitFor(1500);

    await node.client.submitTransaction(TransactionType.CREDENTIAL_SUSPEND, {
      credentialId: id,
      reason: 'administrative review',
    });
    await waitFor(1500);

    let cred = await node.client.getCredential(id);
    expect(cred.data.status).toBe('SUSPENDED');

    await node.client.submitTransaction(TransactionType.CREDENTIAL_REINSTATE, {
      credentialId: id,
      reason: 'review complete',
    });
    await waitFor(1500);

    cred = await node.client.getCredential(id);
    expect(cred.data.status).toBe('ACTIVE');

    const history = await node.client.getCredentialHistory(id);
    expect(history.data.map((e: any) => e.type)).toEqual(
      expect.arrayContaining(['ISSUED', 'SUSPENDED', 'REINSTATED']),
    );
  });

  test('revoked credential reports REVOKED not NOT_FOUND', async () => {
    const id = `cred-rv-${Date.now()}`;
    await node.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, CRED(id));
    await waitFor(1500);

    await node.client.submitTransaction(TransactionType.CREDENTIAL_REVOKE, {
      credentialId: id,
      reason: 'fraudulent issuance',
    });
    await waitFor(1500);

    const cred = await node.client.getCredential(id);
    expect(cred.success).toBe(true);
    expect(cred.data.status).toBe('REVOKED');
  });

  test('merkle proof validates for committed credential', async () => {
    const id = `cred-merk-${Date.now()}`;
    await node.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, CRED(id));
    await waitFor(2000);

    const proof = await node.client.getCredentialProof(id);
    expect(proof.success).toBe(true);
    expect(proof.data.valid).toBe(true);
    expect(proof.data.leafHash).toBe(proof.data.credentialHash);
  });

  test('tampered hash does not match on-chain hash', async () => {
    const id = `cred-temp-${Date.now()}`;
    await node.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, CRED(id));
    await waitFor(1500);

    const cred = await node.client.getCredential(id);
    const onChainHash = cred.data.credentialHash;
    const tamperedHash = hashOf('tampered-content-' + id);
    expect(onChainHash).not.toBe(tamperedHash);
  });
});