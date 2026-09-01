import { CtnNode } from '../../src/node';
import { NodeConfig } from '../../src/config/config';
import { CryptoManager, KeyPair } from '../../src/crypto/signatures/crypto';
import { DEFAULT_GENESIS_TIMESTAMP } from '../../src/config/config';
import * as os from 'os';
import * as path from 'path';
import { BlockchainClient } from '../../src/api/client';
import { hashOf } from '../helpers';

export { hashOf } from '../helpers';

export interface RunningNode {
  node: CtnNode;
  config: NodeConfig;
  keyPair: KeyPair;
  client: BlockchainClient;
}

let counter = 0;

export function makeNodeConfig(
  nodeId: string,
  port: number,
  apiPort: number,
  validators: string[],
  peers: string[] = [],
): NodeConfig {
  return {
    nodeId,
    port,
    dataDir: path.join(os.tmpdir(), `ctn-int-${nodeId}-${process.pid}-${counter++}-${Date.now()}`),
    peers,
    validators,
    apiPort,
    blockInterval: 300,
    maxPeers: 50,
    heartbeatInterval: 5000,
    genesisTimestamp: DEFAULT_GENESIS_TIMESTAMP,
  };
}

export async function startNode(
  config: NodeConfig,
  keyPair: KeyPair,
): Promise<RunningNode> {
  const node = new CtnNode({ config, keyPair });
  await node.start();

  const client = new BlockchainClient({
    baseUrl: `http://localhost:${config.apiPort}`,
    nodeId: keyPair.keyId,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  });

  return { node, config, keyPair, client };
}

export function makeValidatorCredential(issuerId: string, name: string): { credentialId: string; credentialHash: string } {
  return {
    credentialId: `cred-${issuerId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    credentialHash: hashOf(`${name}-${Date.now()}-${Math.random()}`),
  };
}

export const waitFor = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function waitForHeight(
  client: BlockchainClient,
  expectedHeight: number,
  timeoutMs = 20000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await client.getHealth();
      if (health.success && health.data.height >= expectedHeight) return true;
    } catch {
      /* not ready yet */
    }
    await waitFor(200);
  }
  return false;
}

export const CRED = (id: string) => ({
  credentialId: id,
  issuerId: 'uni-1',
  credentialHash: hashOf(`${id}-data`),
});

export const CRED_INVALID_ISSUER = (id: string) => ({
  credentialId: id,
  issuerId: 'nonexistent-uni',
  credentialHash: hashOf(`${id}-data`),
});