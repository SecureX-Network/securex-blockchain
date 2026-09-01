import express, { Express, Request, Response } from 'express';
import { Chain } from '../core/chain';
import { PermissionedConsensus } from '../consensus/permissioned/consensus';
import { NodeNetwork } from '../network/peer/node';
import { Transaction, TransactionType, buildTransaction } from '../core/transaction/transaction';
import { CryptoManager } from '../crypto/signatures/crypto';
import { canonicalJSON } from '../crypto/hashing/hash';
import { MerkleTree } from '../merkle/merkle';
import { getLogger } from '../utils/logger';
import { createHash } from 'crypto';

export interface ApiServerConfig {
  port: number;
  nodeId: string;
  publicKey: string;
  privateKey: string;
}

export class ApiServer {
  private app: Express;
  private config: ApiServerConfig;
  private chain: Chain;
  private consensus: PermissionedConsensus;
  private network: NodeNetwork;
  private server: any;

  constructor(
    config: ApiServerConfig,
    chain: Chain,
    consensus: PermissionedConsensus,
    network: NodeNetwork,
  ) {
    this.config = config;
    this.chain = chain;
    this.consensus = consensus;
    this.network = network;
    this.app = express();
    this.app.use(express.json({ limit: '2mb' }));
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get('/health', (_req, res) => this.health(res));
    this.app.get('/blocks', (req, res) => this.getBlocks(req, res));
    this.app.get('/blocks/:height', (req, res) => this.getBlockByHeight(req, res));
    this.app.get('/blocks/hash/:hash', (req, res) => this.getBlockByHash(req, res));
    this.app.get('/transactions/:id', (req, res) => this.getTransaction(req, res));
    this.app.post('/transactions', (req, res) => this.submitTransaction(req, res));
    this.app.get('/state/issuers', (_req, res) => this.getIssuers(res));
    this.app.get('/state/issuers/:id', (req, res) => this.getIssuer(req, res));
    this.app.get('/state/credentials/:id', (req, res) => this.getCredential(req, res));
    this.app.get('/state/credentials/:id/history', (req, res) => this.getCredentialHistory(req, res));
    this.app.post('/state/credentials/:id/proof', (req, res) => this.getCredentialProof(req, res));
    this.app.get('/state/validators', (_req, res) => this.getValidators(res));
    this.app.get('/network/peers', (_req, res) => this.getPeers(res));
    this.app.get('/network/status', (_req, res) => this.getNetworkStatus(res));
    this.app.get('/state', (_req, res) => this.getState(res));
  }

  private ok(res: Response, data: any): void {
    res.json({ success: true, data });
  }

  private fail(res: Response, error: string, status = 400): void {
    res.status(status).json({ success: false, error });
  }

  private health(res: Response): void {
    this.ok(res, {
      nodeId: this.config.nodeId,
      version: '1.0',
      height: this.chain.getHeight(),
      peerCount: this.network.getPeerCount(),
      uptime: process.uptime(),
      status: 'UP',
    });
  }

  private getBlocks(req: Request, res: Response): void {
    const offset = parseInt(String(req.query.offset || '0'), 10);
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    const blocks = this.chain.getStorage().blockStore.iterBlocks().slice(offset, offset + limit);
    this.ok(res, blocks);
  }

  private getBlockByHeight(req: Request, res: Response): void {
    const height = parseInt(req.params.height, 10);
    const block = this.chain.getBlockByHeight(height);
    if (!block) return this.fail(res, 'BLOCK_NOT_FOUND', 404);
    this.ok(res, block);
  }

  private getBlockByHash(req: Request, res: Response): void {
    const block = this.chain.getBlockByHash(req.params.hash);
    if (!block) return this.fail(res, 'BLOCK_NOT_FOUND', 404);
    this.ok(res, block);
  }

  private getTransaction(req: Request, res: Response): void {
    const record = this.chain.getTransaction(req.params.id);
    if (!record) return this.fail(res, 'TRANSACTION_NOT_FOUND', 404);
    this.ok(res, record);
  }

  private submitTransaction(req: Request, res: Response): void {
    try {
      const tx = req.body as Transaction;
      if (!tx || !tx.id) return this.fail(res, 'INVALID_TRANSACTION');

      const error = this.consensus.addTransaction(tx);
      if (error) return this.fail(res, error);

      this.network.broadcastTransaction(tx);
      this.ok(res, { submitted: true, id: tx.id, status: 'PENDING' });
    } catch (e: any) {
      this.fail(res, 'INTERNAL_ERROR: ' + e.message, 500);
    }
  }

  private getIssuers(res: Response): void {
    this.ok(res, this.chain.getState().getAllIssuers());
  }

  private getIssuer(req: Request, res: Response): void {
    const issuer = this.chain.getState().getIssuer(req.params.id);
    if (!issuer) return this.fail(res, 'UNKNOWN_ISSUER', 404);
    this.ok(res, issuer);
  }

  private getCredential(req: Request, res: Response): void {
    const credential = this.chain.getState().getCredential(req.params.id);
    if (!credential) return this.fail(res, 'CREDENTIAL_NOT_FOUND', 404);
    this.ok(res, credential);
  }

  private getCredentialHistory(req: Request, res: Response): void {
    const credential = this.chain.getState().getCredential(req.params.id);
    if (!credential) return this.fail(res, 'CREDENTIAL_NOT_FOUND', 404);
    this.ok(res, credential.lifecycle);
  }

  private getCredentialProof(req: Request, res: Response): void {
    const credential = this.chain.getState().getCredential(req.params.id);
    if (!credential) return this.fail(res, 'CREDENTIAL_NOT_FOUND', 404);

    const height = Number(req.body?.blockHeight ?? this.chain.getHeight());
    const block = this.chain.getBlockByHeight(height);
    if (!block) return this.fail(res, 'BLOCK_NOT_FOUND', 404);

    const leafHash = credential.credentialHash;
    const leaves = block.transactions.map(tx => tx.payload?.credentialHash || tx.id);
    const tree = new MerkleTree(leaves);

    const leafIndex = leaves.findIndex(l => l === leafHash);
    if (leafIndex === -1) return this.fail(res, 'CREDENTIAL_NOT_IN_BLOCK');

    const proof = tree.getProof(leafIndex);
    const root = tree.getRoot();

    this.ok(res, {
      credentialId: credential.credentialId,
      credentialHash: credential.credentialHash,
      leafHash,
      leafIndex,
      proof,
      root,
      blockHeight: height,
      blockHash: block.hash,
      valid: MerkleTree.verifyProof(leafHash, proof, root),
    });
  }

  private getValidators(res: Response): void {
    this.ok(res, this.chain.getState().getValidators());
  }

  private getPeers(res: Response): void {
    this.ok(res, {
      connected: this.network.getConnectedNodeIds(),
      known: this.chain.getStorage().peerStore.getPeers(),
      peerCount: this.network.getPeerCount(),
    });
  }

  private getNetworkStatus(res: Response): void {
    this.ok(res, {
      nodeId: this.config.nodeId,
      height: this.chain.getHeight(),
      peerCount: this.network.getPeerCount(),
      validators: this.chain.getState().getValidators().length,
      currentProposer: this.consensus.getProposerForHeight(this.chain.getHeight() + 1),
      pendingTransactions: this.consensus.getPendingTransactions().length,
      status: 'RUNNING',
    });
  }

  private getState(res: Response): void {
    this.ok(res, {
      height: this.chain.getHeight(),
      issuers: this.chain.getState().getAllIssuers().length,
      credentials: this.chain.getState().getAllCredentials().length,
      validators: this.chain.getState().getValidators().length,
      keys: this.chain.getState().getAllKeys().length,
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        getLogger().info(`API server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) this.server.close();
  }
}
