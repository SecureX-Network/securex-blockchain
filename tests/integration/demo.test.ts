import { runDemoDataSeed, demoHash } from '../../scripts/demo-data';
import { TransactionType } from '../../src/core/transaction/transaction';

jest.setTimeout(120000);

describe('Demo data generator (real transaction pipeline)', () => {
  it('seeds demo institutions/credentials and reaches expected lifecycle states', async () => {
    const apiPort = 7700 + Math.floor(Math.random() * 100);
    const p2pPort = 4700 + Math.floor(Math.random() * 100);
    const { node, client } = await runDemoDataSeed({
      dataDir: `/tmp/securex-demo-test-${process.pid}-${Date.now()}`,
      apiPort,
      p2pPort,
      blockIntervalMs: 150,
    });

    try {
      const issuers = await client.getIssuers();
      expect(issuers.success).toBe(true);
      const names = (issuers.data || []).map((i: any) => i.name);
      expect(names).toContain('SecureX Demo University');
      expect(names).toContain('SecureX Technical Institute');

      // Demo issuers are explicitly flagged demo
      const uni = (issuers.data || []).find((i: any) => i.issuerId === 'securex-demo-university');
      expect(uni.metadata?.demo).toBe(true);

      // Verify lifecycle states via the real verification endpoint
      const suspended = await client.verifyCredential('sxu-btech-2026-0001');
      expect(suspended.data.status).toBe('SUSPENDED');

      const revoked = await client.verifyCredential('sxu-mba-2026-0001');
      expect(revoked.data.status).toBe('REVOKED');

      const valid = await client.verifyCredential('sxu-mtech-2026-0001');
      expect(valid.data.status).toBe('VALID');

      // Validate the anchored hash matches on-chain data
      const cred = await client.getCredential('sxu-mtech-2026-0001');
      expect(cred.data.credentialHash).toBe(demoHash('mtech-ai-2026'));
    } finally {
      await node.stop();
    }
  });
});
