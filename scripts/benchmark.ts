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
    dataDir: path.join(os.tmpdir(), `ctn-bench-${nodeId}-${process.pid}-${counter++}-${Date.now()}`),
    peers,
    validators,
    apiPort,
    blockInterval: 100,
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

async function waitForHeight(client: BlockchainClient, height: number, timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await client.getHealth();
      if (h.success && h.data.height >= height) return;
    } catch {
      /* not ready */
    }
    await waitFor(100);
  }
  throw new Error(`timed out waiting for height ${height}`);
}

const hashOf = (data: string): string =>
  require('crypto').createHash('sha256').update(data).digest('hex');

async function main(): Promise<void> {
  const across = parseInt(process.argv[2] || '2', 10);
  const perNode = parseInt(process.argv[3] || '150', 10);

  const keys = Array.from({ length: across }, () => CryptoManager.generateKeyPair());
  const validatorIds = keys.map((k) => k.keyId);
  const p2pBase = 4300 + Math.floor(Math.random() * 400);
  const apiBase = 5300 + Math.floor(Math.random() * 400);

  const nodes: Array<{ node: CtnNode; client: BlockchainClient }> = [];

  console.log(`CTN benchmark: ${across} validators x ${perNode} issues`);
  console.log('Starting nodes...');
  for (let i = 0; i < across; i++) {
    const peers = validatorIds.map((_, j) => `ws://localhost:${p2pBase + j}`).filter((_, j) => j !== i);
    const config = makeConfig(validatorIds[i], p2pBase + i, apiBase + i, validatorIds, peers);
    nodes.push(await start(config, keys[i]));
  }
  for (const n of nodes) await waitForHeight(n.client, 0);
  await waitFor(2000);

  await nodes[0].client.submitTransaction(TransactionType.ISSUER_REGISTER, {
    issuerId: 'bench-uni',
    name: 'Benchmark University',
    publicKey: CryptoManager.generateKeyPair().publicKey,
  });
  await waitForHeight(nodes[1].client, 1);

  const startMs = Date.now();
  let submitted = 0;
  for (let i = 0; i < perNode; i++) {
    for (let v = 0; v < across; v++) {
      const res = await nodes[v].client.submitTransaction(TransactionType.CREDENTIAL_ISSUE, {
        credentialId: `bench-${i}-${v}`,
        issuerId: 'bench-uni',
        credentialHash: hashOf(`bench-${i}-${v}`),
        schemaVersion: '1.0',
      });
      if (!res.success) throw new Error(`submit failed: ${res.error}`);
      submitted++;
    }
  }
  const submitMs = Date.now() - startMs;

  let settled = false;
  const convergeStart = Date.now();
  while (!settled && Date.now() - convergeStart < 120000) {
    const heights = await Promise.all(nodes.map((n) => n.client.getHealth()));
    const nodeHeights = heights.map((h) => h.data.height);
    if (new Set(nodeHeights).size === 1) {
      const current = nodeHeights[0];
      await waitFor(1500);
      const again = await Promise.all(nodes.map((n) => n.client.getHealth()));
      if (again.every((h) => h.data.height === current)) settled = true;
    } else {
      await waitFor(150);
    }
  }
  if (!settled) throw new Error('timed out waiting for chain convergence');

  const heights = await Promise.all(nodes.map((n) => n.client.getHealth()));
  const converged = new Set(heights.map((h) => h.data.height)).size === 1;

  const totalMs = Date.now() - startMs;
  console.log('');
  console.log(`submissions      : ${submitted}`);
  console.log(`submit time      : ${submitMs} ms`);
  console.log(`expected height  : 1 + ${submitted} (not reached; txs batch by block)`);
  console.log(`converged height : ${heights[0].data.height}`);
  console.log(`all nodes equal  : ${converged}`);
  console.log(`throughput (submit/s) : ${Math.round(submitted / (submitMs / 1000))}`);
  console.log(`throughput (commit/s) : ${Math.round(submitted / (totalMs / 1000))}`);

  for (const n of nodes) await n.node.stop();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});