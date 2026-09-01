#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, saveConfig, defaultNodeConfig, NodeConfig } from '../config/config';
import { CryptoManager } from '../crypto/signatures/crypto';
import { CtnNode } from '../node';
import { BlockchainClient } from '../api/client';

const program = new Command();

program
  .version('1.0.0')
  .description('CTN Blockchain - Credential Trust Network node');

program
  .command('init')
  .description('Initialize a node identity (generate keys + config)')
  .option('-d, --dir <dir>', 'config directory', '.ctn')
  .action((opts) => {
    const configDir = path.join(process.cwd(), opts.dir);
    const keyDir = path.join(configDir, 'keys');

    if (fs.existsSync(path.join(keyDir, 'public.pem'))) {
      console.log('Node identity already exists in', keyDir);
      process.exit(1);
    }

    const keyPair = CryptoManager.generateKeyPair();
    CryptoManager.saveKeyPair(keyPair, keyDir);

    const config = defaultNodeConfig();
    config.nodeId = keyPair.keyId;

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    saveConfig(config, path.join(configDir, 'config.json'));

    console.log('Node initialized:');
    console.log('  Node ID:', keyPair.keyId);
    console.log('  Config :', path.join(configDir, 'config.json'));
    console.log('  Keys   :', keyDir);
    console.log('');
    console.log('Configure validators in config.json before starting.');
  });

program
  .command('start')
  .description('Start the node')
  .option('-c, --config <file>', 'config file path')
  .action(async (opts) => {
    const configDir = path.join(process.cwd(), '.ctn');
    const keyDir = path.join(configDir, 'keys');

    let config: NodeConfig;
    if (opts.config) {
      config = loadConfig(opts.config);
    } else {
      config = loadConfig(path.join(configDir, 'config.json'));
    }

    const keyPair = CryptoManager.loadKeyPair(keyDir);
    if (!keyPair) {
      console.error('No identity found. Run `ctn-node init` first.');
      process.exit(1);
    }

    const node = new CtnNode({ config, keyPair });
    await node.start();

    const shutdown = async () => {
      await node.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('status')
  .description('Show node status from the API')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:4001')
  .action(async (opts) => {
    const client = new BlockchainClient({ baseUrl: opts.url });
    const result = await client.getNetworkStatus();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('peers')
  .description('Show connected peers')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:4001')
  .action(async (opts) => {
    const client = new BlockchainClient({ baseUrl: opts.url });
    const result = await client.getPeers();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('blocks')
  .description('List blocks')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:4001')
  .option('-c, --count <count>', 'number of blocks', '20')
  .action(async (opts) => {
    const client = new BlockchainClient({ baseUrl: opts.url });
    const result = await client.getBlocks(0, parseInt(opts.count, 10));
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('tx')
  .description('Submit a raw transaction JSON')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:4001')
  .argument('<file>', 'path to transaction JSON file')
  .action(async (file, opts) => {
    const tx = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const client = new BlockchainClient({ baseUrl: opts.url });
    const result = await client.submitRawTransaction(tx);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('verify')
  .description('Verify a credential hash against the chain')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:4001')
  .option('-c, --credential <id>', 'credential ID')
  .option('-h, --hash <hash>', 'credential hash to verify')
  .option('-b, --block <height>', 'block height to verify against')
  .action(async (opts) => {
    const client = new BlockchainClient({ baseUrl: opts.url });

    if (!opts.credential) {
      console.error('--credential <id> is required');
      process.exit(1);
    }

    const credential = await client.getCredential(opts.credential);
    if (!credential.success) {
      console.log(JSON.stringify(credential, null, 2));
      process.exit(1);
    }

    const storedHash = credential.data.credentialHash;

    const result: any = {
      credentialId: opts.credential,
      status: credential.data.status,
      onChainHash: storedHash,
    };

    if (opts.hash) {
      result.verification = opts.hash === storedHash ? 'MATCH' : 'TAMPERED';
      result.expectedHash = opts.hash;
    }

    const proof = await client.getCredentialProof(
      opts.credential,
      opts.block ? parseInt(opts.block, 10) : undefined,
    );
    if (proof.success) {
      result.merkleProofValid = proof.data.valid;
      result.merkleRoot = proof.data.root;
      result.blockHeight = proof.data.blockHeight;
    }

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('validators')
  .description('List validators')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:4001')
  .action(async (opts) => {
    const client = new BlockchainClient({ baseUrl: opts.url });
    const result = await client.getValidators();
    console.log(JSON.stringify(result, null, 2));
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.help();
}
