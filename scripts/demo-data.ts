/**
 * SecureX Demo Data Generator.
 *
 * Deterministic demo-data mechanism for the SIH 2026 demonstration.
 *
 * IMPORTANT: This generates DEMO data through the REAL blockchain transaction
 * pipeline. It does NOT directly modify blockchain state. Demo institutions and
 * credentials are clearly identifiable as DEMO (issuer names prefixed with
 * "SecureX Demo ...") and MUST never be presented as real-world institutional
 * data.
 *
 * Usage:
 *   npm run demo:data             (starts its own node, seeds, then stops)
 *
 * It creates a fresh node in a temp dir (safe — never overwrites an existing
 * production chain without explicit action).
 */
import * as os from 'os';
import * as path from 'path';
import { CtnNode } from '../src/node';
import { NodeConfig, DEFAULT_GENESIS_TIMESTAMP, normalizeConfig } from '../src/config/config';
import { CryptoManager, KeyPair } from '../src/crypto/signatures/crypto';
import { BlockchainClient } from '../src/api/client';
import { TransactionType } from '../src/core/transaction/transaction';
import { SHA256Hasher } from '../src/crypto/hashing/hash';

export interface DemoInstitution {
  issuerId: string;
  name: string;
  credentials: Array<{
    credentialId: string;
    type: string;
    subject: string;
    hashData: string;
    lifecycle?: Array<'suspend' | 'revoke'>;
  }>;
}

const DEMO_INSTITUTIONS: DemoInstitution[] = [
  {
    issuerId: 'securex-demo-university',
    name: 'SecureX Demo University',
    credentials: [
      { credentialId: 'sxu-btech-2026-0001', type: 'B.Tech', subject: 'Computer Science Engineering', hashData: 'btech-cse-2026', lifecycle: ['suspend'] },
      { credentialId: 'sxu-mtech-2026-0001', type: 'M.Tech', subject: 'Artificial Intelligence', hashData: 'mtech-ai-2026' },
      { credentialId: 'sxu-mba-2026-0001', type: 'MBA', subject: 'Business Administration', hashData: 'mba-2026', lifecycle: ['suspend', 'revoke'] },
    ],
  },
  {
    issuerId: 'securex-demo-technical-institute',
    name: 'SecureX Technical Institute',
    credentials: [
      { credentialId: 'sxti-bca-2026-0001', type: 'BCA', subject: 'Computer Applications', hashData: 'bca-2026' },
      { credentialId: 'sxti-mca-2026-0001', type: 'MCA', subject: 'Computer Applications', hashData: 'mca-2026', lifecycle: ['suspend'] },
      { credentialId: 'sxti-pro-cert-2026-0001', type: 'Professional Certification', subject: 'Blockchain Engineering', hashData: 'pro-cert-blockchain-2026' },
    ],
  },
  {
    issuerId: 'securex-demo-professional-academy',
    name: 'SecureX Professional Academy',
    credentials: [
      { credentialId: 'sxpa-intern-2026-0001', type: 'Internship Certificate', subject: 'Cybersecurity Intern', hashData: 'intern-cyber-2026', lifecycle: ['revoke'] },
      { credentialId: 'sxpa-pro-cert-2026-0001', type: 'Professional Certification', subject: 'Data Privacy Officer', hashData: 'pro-cert-dpo-2026' },
    ],
  },
];

export function demoHash(data: string): string {
  return SHA256Hasher.hash(data);
}

export async function runDemoDataSeed(options?: {
  dataDir?: string;
  apiPort?: number;
  p2pPort?: number;
  blockIntervalMs?: number;
}): Promise<{ node: CtnNode; client: BlockchainClient; keyPair: KeyPair; config: NodeConfig }> {
  const keyPair = CryptoManager.generateKeyPair();
  const dataDir = options?.dataDir || path.join(os.tmpdir(), `securex-demo-data-${process.pid}-${Date.now()}`);
  const apiPort = options?.apiPort || 4101;
  const p2pPort = options?.p2pPort || 3201;

  const config: NodeConfig = normalizeConfig({
    nodeId: keyPair.keyId,
    port: p2pPort,
    apiPort,
    dataDir,
    validators: [keyPair.keyId],
    genesisTimestamp: DEFAULT_GENESIS_TIMESTAMP,
    blockInterval: options?.blockIntervalMs ?? 200,
    maxPeers: 0,
    heartbeatInterval: 60000,
  });

  const node = new CtnNode({ config, keyPair });
  await node.start();

  const client = new BlockchainClient({
    baseUrl: `http://localhost:${apiPort}`,
    nodeId: keyPair.keyId,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  });

  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  const waitCommitted = async (txId: string): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const found = await client.getTransaction(txId);
      if (found.success) return;
      await wait(150);
    }
    throw new Error(`Transaction ${txId} was not committed`);
  };

  // Register a signing key for each demo institution then register the issuer.
  // These are validator-authorized operations.
  for (const inst of DEMO_INSTITUTIONS) {
    const issuerKey = CryptoManager.generateKeyPair();
    const keyId = CryptoManager.deriveNodeId(issuerKey.publicKey);

    const keyRes = await client.submitTransaction(
      TransactionType.KEY_REGISTER,
      { keyId: `key-${inst.issuerId}-1`, ownerId: inst.issuerId, publicKey: issuerKey.publicKey, algorithm: 'ed25519', purpose: 'signing' },
    );
    if (!keyRes.success) throw new Error(`KEY_REGISTER rejected: ${JSON.stringify(keyRes.error)}`);
    await waitCommitted(keyRes.data.id);

    const issuerRes = await client.submitTransaction(
      TransactionType.ISSUER_REGISTER,
      { issuerId: inst.issuerId, name: inst.name, publicKey: issuerKey.publicKey, metadata: { demo: true, demoInstitution: true } },
    );
    if (!issuerRes.success) throw new Error(`ISSUER_REGISTER rejected: ${JSON.stringify(issuerRes.error)}`);
    await waitCommitted(issuerRes.data.id);

    // Track nonce for the issuer's own V2 transactions.
    const nonces: Record<string, number> = {};

    // Issue credentials and apply lifecycle transitions as the ISSUER through
    // the hardened V2 validation path.
    for (const cred of inst.credentials) {
      nonces[keyId] = (nonces[keyId] || 0) + 1;
      const issueRes = await client.submitV2TransactionAs(
        TransactionType.CREDENTIAL_ISSUE,
        {
          credentialId: cred.credentialId,
          issuerId: inst.issuerId,
          credentialHash: demoHash(cred.hashData),
          schemaVersion: '1.0',
          metadata: { type: cred.type, subject: cred.subject, demo: true, credentialType: cred.type },
        },
        { sender: keyId, privateKey: issuerKey.privateKey },
        nonces[keyId],
      );
      if (!issueRes.success) throw new Error(`CREDENTIAL_ISSUE rejected: ${JSON.stringify(issueRes.error)}`);
      await waitCommitted(issueRes.data.id);

      if (cred.lifecycle?.includes('suspend')) {
        nonces[keyId] += 1;
        const snoRes = await client.submitV2TransactionAs(
          TransactionType.CREDENTIAL_SUSPEND,
          { credentialId: cred.credentialId, reason: 'demo: under academic review' },
          { sender: keyId, privateKey: issuerKey.privateKey },
          nonces[keyId],
        );
        if (!snoRes.success) throw new Error(`CREDENTIAL_SUSPEND rejected: ${JSON.stringify(snoRes.error)}`);
        await waitCommitted(snoRes.data.id);
      }
      if (cred.lifecycle?.includes('revoke')) {
        nonces[keyId] += 1;
        const revRes = await client.submitV2TransactionAs(
          TransactionType.CREDENTIAL_REVOKE,
          { credentialId: cred.credentialId, reason: 'demo: administrative correction' },
          { sender: keyId, privateKey: issuerKey.privateKey },
          nonces[keyId],
        );
        if (!revRes.success) throw new Error(`CREDENTIAL_REVOKE rejected: ${JSON.stringify(revRes.error)}`);
        await waitCommitted(revRes.data.id);
      }
    }
  }

  return { node, client, keyPair, config };
}

async function main(): Promise<void> {
  console.log('=== SecureX Demo Data Generator ===');
  console.log('Generating DEMO data through the real blockchain transaction pipeline...\n');

  const { node, client } = await runDemoDataSeed();

  const state = await client.getStateSummary();
  console.log('Demo chain height:', state.data?.height);
  console.log('Issuers:', state.data?.issuers, '| Credentials:', state.data?.credentials);

  const issuers = await client.getIssuers();
  console.log('\nRegistered demo institutions:');
  for (const i of issuers.data || []) {
    console.log(`  - ${i.name} (${i.issuerId}) [${i.status}]`);
  }

  for (const inst of DEMO_INSTITUTIONS) {
    for (const cred of inst.credentials) {
      const res = await client.verifyCredential(cred.credentialId);
      console.log(`\n  Verify ${cred.credentialId} (${cred.type}) -> ${res.data?.status}`);
    }
  }

  console.log('\nDemo data generated successfully through real transactions.');
  console.log('Note: All demo records are marked demo:true and MUST NOT be presented as real-world institutional data.');

  await node.stop();
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Demo data generation failed:', err.message);
    process.exit(1);
  });
}
