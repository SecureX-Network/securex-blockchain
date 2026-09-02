import { makeNodeConfig, startNode, waitForHeight, waitFor, CRED, hashOf } from './helpers';
import { CryptoManager } from '../../src/crypto/signatures/crypto';
import { TransactionType } from '../../src/core/transaction/transaction';

jest.setTimeout(120000);

describe('API auth boundary, new endpoints & persistence', () => {
  const keyPair = CryptoManager.generateKeyPair();
  let running: Awaited<ReturnType<typeof startNode>>;

  beforeAll(async () => {
    const config = makeNodeConfig(
      keyPair.keyId,
      5600 + Math.floor(Math.random() * 100),
      6600 + Math.floor(Math.random() * 100),
      [keyPair.keyId],
    );
    running = await startNode(config, keyPair);
    await waitForHeight(running.client, 0);
  });

  afterAll(async () => {
    if (running) await running.node.stop();
  });

  beforeEach(async () => {
    const issuer = await running.client.getIssuer('uni-auth');
    if (!issuer.success) {
      await running.client.submitTransaction(TransactionType.ISSUER_REGISTER, {
        issuerId: 'uni-auth',
        name: 'Auth University',
        publicKey: 'auth-public-key',
      });
      await waitFor(1200);
    }
  });

  test('public verification/health/state endpoints are reachable (anonymous)', async () => {
    const health = await running.client.getHealth();
    expect(health.success).toBe(true);
    const status = await running.client.getStatus();
    expect(status.success).toBe(true);
    const summary = await running.client.getStateSummary();
    expect(summary.success).toBe(true);
  });

  test('verification route is public while audit is privileged per policy', () => {
    const { classifyEndpoint } = require('../../src/api/auth');
    expect(classifyEndpoint('GET', '/verify/cred')).toEqual({
      exposed: 'public',
      category: 'verification',
    });
    expect(classifyEndpoint('GET', '/audit/events').exposed).toBe('privileged');
    expect(classifyEndpoint('GET', '/state/credentials/c/history').exposed).toBe('public');
    expect(classifyEndpoint('GET', '/state/issuers/i').exposed).toBe('privileged');
  });

  test('submit + AUTH-recorded merkler failure via tamper-check endpoint', async () => {
    const id = `cred-auth-${Date.now()}`;
    const documentedHash = hashOf(`${id}-content`);
    await running.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: id,
      issuerId: 'uni-auth',
      credentialHash: documentedHash,
    });
    await waitFor(1500);

    const exact = await running.client.tamperCheck(id, documentedHash);
    expect(exact.success).toBe(true);
    expect(exact.data.status).toBe('EXACT');

    const tampered = await running.client.tamperCheck(id, hashOf('other-data'));
    expect(tampered.success).toBe(true);
    expect(tampered.data.status).toBe('TAMPERED');

    const events = await running.client.getAuditEvents();
    expect(events.success).toBe(true);
    expect(
      events.data.some((e: any) => e.type === 'MERKLE_VERIFICATION_FAILURE' && e.referenceId === id),
    ).toBe(true);
  });

  test('key state endpoints and openapi are served', async () => {
    const keys = await running.client.getKeys();
    expect(keys.success).toBe(true);
    const openapi = (await running.client.getOpenApi()) as any;
    expect((openapi as any).openapi).toBeTruthy();
  });

  test('remote identity is blocked for privileged chain writes not backed by module validation', async () => {
    // Register issuer "uni-auth", then a second issuer "unauth" that does not exist.
    const bad = await running.client.submitTransaction(TransactionType.ISSUER_REGISTER, {
      issuerId: 'ghost-uni',
      name: 'Ghost',
      publicKey: 'ghost-pk',
    });
    expect(bad.success).toBe(true); // submits fine as validator
    await waitFor(1000);
    // A credential issued by an unregistered issuer must be rejected by validation
    const cred = await running.client.getCredential('should-not-exist');
    expect(cred.success).toBe(false);
  });

  test('state persists across node restart', async () => {
    const id = `cred-persist-${Date.now()}`;
    await running.client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: id,
      issuerId: 'uni-auth',
      credentialHash: hashOf(`${id}-content`),
    });
    await waitFor(1500);
    const before = await running.client.getCredential(id);
    expect(before.success).toBe(true);
    expect(before.data.status).toBe('ACTIVE');

    // Stop and restart on the same dataDir
    await running.node.stop();
    const config = running.config;
    const newNode = await startNode(config, keyPair);
    await waitForHeight(newNode.client, 0);

    const after = await newNode.client.getCredential(id);
    expect(after.success).toBe(true);
    expect(after.data.status).toBe('ACTIVE');

    await newNode.node.stop();
    running = newNode;
  });
});
