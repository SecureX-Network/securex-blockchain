import { makeNodeConfig, startNode, waitFor, waitForHeight, RunningNode } from './helpers';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { TransactionType } from '../../src/core/transaction/transaction';

jest.setTimeout(120000);

describe('Multi-node network integration', () => {
  const validators: RunningNode[] = [];
  const issuerSigner = CryptoManager.generateKeyPair();

  beforeAll(async () => {
    const keys = [0, 1, 2, 3].map(() => CryptoManager.generateKeyPair());
    const validatorIds = keys.map(k => k.keyId);

    const p2pBase = 4100 + Math.floor(Math.random() * 500);
    const apiBase = 5100 + Math.floor(Math.random() * 500);

    for (let i = 0; i < 4; i++) {
      const peers = validatorIds
        .map((_, j) => `ws://localhost:${p2pBase + j}`)
        .filter((_, j) => j !== i);

      const config = makeNodeConfig(
        validatorIds[i],
        p2pBase + i,
        apiBase + i,
        validatorIds,
        peers,
      );

      validators.push(await startNode(config, keys[i]));
    }

    for (let i = 0; i < 4; i++) {
      await waitForHeight(validators[i].client, 0, 15000);
    }
    await waitFor(2000);
  });

  afterAll(async () => {
    for (const v of validators) {
      await v.node.stop();
    }
  });

  test('all four nodes start and reach genesis', async () => {
    for (const v of validators) {
      const health = await v.client.getHealth();
      expect(health.success).toBe(true);
      expect(health.data.height).toBeGreaterThanOrEqual(0);
    }
  });

  test('nodes discover each other as peers', async () => {
    await waitFor(3000);
    const peers = await validators[0].client.getPeers();
    expect(peers.success).toBe(true);
    expect(peers.data.connected.length).toBeGreaterThanOrEqual(1);
  });

  test('an ISSUER_REGISTER transaction is committed across all nodes', async () => {
    const client = validators[0].client;

    const issuerPublicKey = issuerSigner.publicKey;

    const result = await client.submitTransaction(TransactionType.ISSUER_REGISTER, {
      issuerId: 'uni-1',
      name: 'Test University',
      publicKey: issuerPublicKey,
    });

    expect(result.success).toBe(true);

    await waitForHeight(validators[1].client, 1, 30000);

    for (const v of validators) {
      const block = await v.client.getBlockByHeight(1);
      expect(block.success).toBe(true);
      expect(block.data.transactions).toHaveLength(1);
      expect(block.data.transactions[0].type).toBe('ISSUER_REGISTER');
    }
  });

  test('a CREDENTIAL_ISSUE transaction is committed and visible everywhere', async () => {
    const client = validators[0].client;

    const credentialHash = require('crypto').createHash('sha256').update('credential-data-1').digest('hex');

    const result = await client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: 'cred-001',
      issuerId: 'uni-1',
      credentialHash,
      schemaVersion: '1.0',
    });

    expect(result.success).toBe(true);

    await waitForHeight(validators[1].client, 2, 30000);
    await waitFor(1500);

    for (const v of validators) {
      const cred = await v.client.getCredential('cred-001');
      expect(cred.success).toBe(true);
      expect(cred.data.status).toBe('ACTIVE');
      expect(cred.data.credentialHash).toBe(credentialHash);
      expect(cred.data.issuerId).toBe('uni-1');
    }
  });

  test('nodes converge to same chain height', async () => {
    const heights = await Promise.all(validators.map(v => v.client.getHealth()));
    for (const h of heights) {
      expect(h.success).toBe(true);
    }
    const heightSet = new Set(heights.map(h => h.data.height));
    expect(heightSet.size).toBe(1);
  });
});