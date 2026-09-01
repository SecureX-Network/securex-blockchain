import { makeNodeConfig, startNode, waitFor, waitForHeight, RunningNode } from '../integration/helpers';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { TransactionType } from '../../src/core/transaction/transaction';
import { BlockchainClient } from '../../src/api/client';

jest.setTimeout(120000);

describe('Network resilience', () => {
  const validators: RunningNode[] = [];

  beforeAll(async () => {
    const keys = [0, 1, 2].map(() => CryptoManager.generateKeyPair());
    const validatorIds = keys.map(k => k.keyId);
    const p2pBase = 5200 + Math.floor(Math.random() * 300);
    const apiBase = 6200 + Math.floor(Math.random() * 300);

    for (let i = 0; i < 3; i++) {
      const peers = validatorIds.map((_, j) => `ws://localhost:${p2pBase + j}`).filter((_, j) => j !== i);
      const config = makeNodeConfig(validatorIds[i], p2pBase + i, apiBase + i, validatorIds, peers);
      validators.push(await startNode(config, keys[i]));
    }
    for (const v of validators) await waitForHeight(v.client, 0);
    await waitFor(2000);
  });

  afterAll(async () => {
    for (const v of validators) await v.node.stop();
  });

  test('nodes remember known peers', async () => {
    const peers = await validators[0].client.getPeers();
    expect(peers.data.known.length).toBeGreaterThanOrEqual(2);
  });

  test('dishonest duplicate transaction is not double-applied', async () => {
    const client = validators[0].client;
    const tx = client.signTransaction(TransactionType.ISSUER_REGISTER, {
      issuerId: 'dup-uni',
      name: 'Dup University',
      publicKey: CryptoManager.generateKeyPair().publicKey,
    });

    const r1 = await client.submitRawTransaction(tx);
    await waitForHeight(validators[1].client, 1, 30000);
    const r2 = await validators[1].client.submitRawTransaction(tx);

    // duplicate should be rejected here
    expect(r2.success).toBe(false);
  });

  test('all nodes reach same height after transactions', async () => {
    const client = validators[0].client;
    const res = await client.submitTransaction(TransactionType.ISSUER_REGISTER, {
      issuerId: 'uni-2',
      name: 'Second University',
      publicKey: CryptoManager.generateKeyPair().publicKey,
    });
    expect(res.success).toBe(true);

    await waitForHeight(validators[1].client, 2, 30000);
    await waitFor(1500);

    const heights = await Promise.all(validators.map(v => v.client.getHealth()));
    const heightSet = new Set(heights.map((h: any) => h.data.height));
    expect(heightSet.size).toBe(1);
    expect(heightSet.has(2)).toBe(true);
  });
});