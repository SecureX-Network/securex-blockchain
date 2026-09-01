#!/usr/bin/env node
import * as os from 'os';
import * as path from 'path';
import { CtnNode } from '../src/node';
import { NodeConfig, DEFAULT_GENESIS_TIMESTAMP } from '../src/config/config';
import { CryptoManager, KeyPair } from '../src/crypto/signatures/crypto';
import { BlockchainClient } from '../src/api/client';
import { TransactionType } from '../src/core/transaction/transaction';

let counter = 0;

function makeConfig(
  nodeId: string,
  port: number,
  apiPort: number,
  validators: string[],
  peers: string[],
): NodeConfig {
  return {
    nodeId,
    port,
    dataDir: path.join(os.tmpdir(), `ctn-demo-${nodeId}-${process.pid}-${counter++}-${Date.now()}`),
    peers,
    validators,
    apiPort,
    blockInterval: 300,
    maxPeers: 50,
    heartbeatInterval: 5000,
    genesisTimestamp: DEFAULT_GENESIS_TIMESTAMP,
  };
}

async function start(
  config: NodeConfig,
  keyPair: KeyPair,
): Promise<{ node: CtnNode; client: BlockchainClient }> {
  const node = new CtnNode({ config, keyPair });
  await node.start();
  const client = new BlockchainClient({
    baseUrl: `http://localhost:${config.apiPort}`,
    nodeId: keyPair.keyId,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  });
  return { node, client };
}

const waitFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const hashOf = (data: string): string =>
  require('crypto').createHash('sha256').update(data).digest('hex');

async function main(): Promise<void> {
  const count = 3;
  const keys = Array.from({ length: count }, () => CryptoManager.generateKeyPair());
  const validatorIds = keys.map((k) => k.keyId);
  const p2pBase = 4200 + Math.floor(Math.random() * 400);
  const apiBase = 5200 + Math.floor(Math.random() * 400);

  const nodes: Array<{ node: CtnNode; client: BlockchainClient }> = [];

  async function waitForConvergence(minHeight = 0, timeoutMs = 30000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const heights = await Promise.all(nodes.map((n) => n.client.getHealth()));
      if (
        heights.every((h) => h.success) &&
        heights.every((h) => h.data.height >= minHeight) &&
        new Set(heights.map((h) => h.data.height)).size === 1
      ) {
        return heights[0].data.height;
      }
      await waitFor(200);
    }
    throw new Error('timed out waiting for convergence');
  }

  console.log('\n=== CTN Blockchain Demo ===\n');

  console.log('Starting', count, 'validator nodes...');
  for (let i = 0; i < count; i++) {
    const peers = validatorIds
      .map((_, j) => `ws://localhost:${p2pBase + j}`)
      .filter((_, j) => j !== i);
    const config = makeConfig(validatorIds[i], p2pBase + i, apiBase + i, validatorIds, peers);
    nodes.push(await start(config, keys[i]));
  }

  await waitForConvergence();
  await waitFor(2000);
  console.log('  All nodes at genesis. Peers:', (await nodes[0].client.getPeers()).data.connected.length);

  console.log('\n1) Register an issuer (uni-1)...');
  const before = (await nodes[0].client.getHealth()).data.height;
  const issuerPub = CryptoManager.generateKeyPair().publicKey;
  const reg = await nodes[0].client.submitTransaction(TransactionType.ISSUER_REGISTER, {
    issuerId: 'uni-1',
    name: 'Demo University',
    publicKey: issuerPub,
  });
  console.log('  Result:', reg.success ? 'SUCCESS' : `FAILED ${reg.error}`);
  const h1 = await waitForConvergence(before + 1, 30000);

  console.log('\n2) Issue credentials...');
  for (let i = 1; i <= 5; i++) {
    const res = await nodes[0].client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, {
      credentialId: `cred-00${i}`,
      issuerId: 'uni-1',
      credentialHash: hashOf(`demo-credential-${i}`),
      schemaVersion: '1.0',
    });
    if (!res.success) throw new Error(`issue failed: ${res.error}`);
  }
  const issueHeight = await waitForConvergence(h1 + 1, 30000);
  console.log('  Issued 5 credentials. Chain height on all nodes:', issueHeight);

  console.log('\n3) Verify a credential with a Merkle proof...');
  const proof = await nodes[1].client.getCredentialProof('cred-001');
  const cred = await nodes[1].client.getCredential('cred-001');
  console.log('  In proof:', JSON.stringify({
    valid: proof.data.valid,
    blockHeight: proof.data.blockHeight,
    root: proof.data.root.slice(0, 16) + '...',
  }));
  console.log('  In state:', JSON.stringify({
    status: cred.data.status,
    hashMatches: cred.data.credentialHash === hashOf('demo-credential-1'),
  }));

  console.log('\n4) Revoke a credential...');
  const beforeRevoke = (await nodes[0].client.getHealth()).data.height;
  await nodes[0].client.submitTransaction(TransactionType.CREDENTIAL_REVOKE, {
    credentialId: 'cred-002',
    issuerId: 'uni-1',
    reason: 'graduated',
  });
  await waitForConvergence(beforeRevoke + 1, 30000);
  const revoked = await nodes[1].client.getCredential('cred-002');
  console.log('  cred-002 status on a peer node:', revoked.data.status);

  console.log('\n5) Chain convergence...');
  const finalHeight = await waitForConvergence(h1, 30000);
  console.log('  All nodes converged at height:', finalHeight);

  console.log('\nDemo complete. Stopping nodes...');
  for (const n of nodes) await n.node.stop();
  console.log('Done.\n');
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});