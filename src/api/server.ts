import express, { Express, Request, Response } from 'express';
import { Chain } from '../core/chain';
import { PermissionedConsensus } from '../consensus/permissioned/consensus';
import { NodeNetwork } from '../network/peer/node';
import { Transaction, TransactionType } from '../core/transaction/transaction';
import { CryptoManager } from '../crypto/signatures/crypto';
import { canonicalJSON } from '../crypto/hashing/hash';
import { MerkleTree } from '../merkle/merkle';
import { getLogger } from '../utils/logger';
import { createHash } from 'crypto';
import { ObservabilityService } from '../services/observability';
import { CredentialVerificationService, VerificationStatus } from '../services/verification';
import { ChainEvidenceProvider } from '../services/evidence';
import { MerkleProofService } from '../merkle/proofs';
import { PROTOCOL_VERSION } from '../core/version';
import {
  corsMiddleware,
  requestIdMiddleware,
  okResponse,
  failResponse,
  accessLogMiddleware,
  paginate,
} from './middleware';
import { AuditService } from '../services/audit';
import { HistoryService } from '../services/history';
import { TamperCheckService } from '../services/tamper-check';
import { QrService } from '../services/qr';
import { QrSigningKeyStore } from '../services/qr-keystore';
import { isPublicCredentialId } from '../crypto/identity/public-credential-id';
import * as path from 'path';

export interface ApiServerConfig {
  port: number;
  apiHost?: string;
  nodeId: string;
  publicKey: string;
  privateKey: string;
  qrKeysDir?: string;
  allowedOrigins?: string[];
  corsEnabled?: boolean;
  verifyBaseUrl?: string;
  requestLimitBytes?: number;
  logLevel?: string;
}

const HASH_RE = /^[a-f0-9]{64}$/i;

export class ApiServer {
  private app: Express;
  private config: ApiServerConfig;
  private chain: Chain;
  private consensus: PermissionedConsensus;
  private network: NodeNetwork;
  private server: any;
  private observability: ObservabilityService;
  private verification: CredentialVerificationService;
  private evidence: ChainEvidenceProvider;
  private audit: AuditService;
  private history: HistoryService;
  private tamper: TamperCheckService;
  private qr: QrService;

  constructor(
    config: ApiServerConfig,
    chain: Chain,
    consensus: PermissionedConsensus,
    network: NodeNetwork,
    audit?: AuditService,
  ) {
    this.config = config;
    this.chain = chain;
    this.consensus = consensus;
    this.network = network;
    this.audit = audit || new AuditService();
    this.observability = new ObservabilityService(chain, consensus, network, config.nodeId);
    this.verification = new CredentialVerificationService(chain);
    this.evidence = new ChainEvidenceProvider(chain);
    this.history = new HistoryService(chain);
    this.tamper = new TamperCheckService(chain, this.audit);
    const qrKeysDir =
      config.qrKeysDir ||
      path.join(process.cwd(), '.ctn', 'issuers', 'qr-key');
    const qrKeyStore = new QrSigningKeyStore(qrKeysDir);
    this.qr = new QrService(chain, qrKeyStore.keyPairRef, config.verifyBaseUrl);
    this.app = express();

    this.app.use(requestIdMiddleware);
    this.app.use(accessLogMiddleware());
    this.app.use(
      corsMiddleware({
        enabled: config.corsEnabled ?? true,
        allowedOrigins: config.allowedOrigins && config.allowedOrigins.length > 0 ? config.allowedOrigins : ['*'],
      }),
    );
    this.app.use(
      express.json({
        limit: config.requestLimitBytes || 2 * 1024 * 1024,
      }),
    );
    this.app.use((err: any, _req: Request, res: Response, next: any) => {
      if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
        failResponse(res, { code: 'INVALID_REQUEST_BODY', message: 'Request body is invalid or exceeds the configured limit' }, 400);
        return;
      }
      next(err);
    });
    this.app.use((err: any, req: Request, res: Response, _next: any) => {
      getLogger().error(`Unhandled error on ${req.method} ${req.path}: ${err?.message || 'unknown'}`);
      failResponse(res, { code: 'INTERNAL_ERROR', message: 'An internal error occurred' }, 500);
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get('/health', (_req, res) => this.health(res));
    this.app.get('/ready', (_req, res) => this.ready(res));
    this.app.get('/status', (_req, res) => this.status(res));
    this.app.get('/metrics', (_req, res) => this.metrics(res));
    this.app.get('/blocks', (req, res) => this.getBlocks(req, res));
    this.app.get('/blocks/:height', (req, res) => this.getBlockByHeight(req, res));
    this.app.get('/blocks/hash/:hash', (req, res) => this.getBlockByHash(req, res));
    this.app.get('/transactions/:id', (req, res) => this.getTransaction(req, res));
    this.app.post('/transactions', (req, res) => this.submitTransaction(req, res));
    this.app.get('/state/issuers', (req, res) => this.getIssuers(res));
    this.app.get('/state/issuers/:id', (req, res) => this.getIssuer(req, res));
    this.app.get('/state/issuers/:id/history', (req, res) => this.getIssuerHistory(req, res));
    this.app.get('/state/credentials/:id', (req, res) => this.getCredential(req, res));
    this.app.get('/state/credentials/:id/history', (req, res) => this.getCredentialHistory(req, res));
    this.app.post('/state/credentials/:id/proof', (req, res) => this.getCredentialProof(req, res));
    this.app.get('/state/credentials/:id/evidence', (req, res) => this.getSecurityEvidence(req, res));
    this.app.get('/state/keys', (_req, res) => this.getKeys(res));
    this.app.get('/state/keys/:id', (req, res) => this.getKey(req, res));
    this.app.get('/state/keys/owner/:ownerId', (req, res) => this.getKeysByOwner(req, res));
    this.app.get('/verify/:id', (req, res) => this.verifyCredential(req, res));
    this.app.post('/verify', (req, res) => this.verifyCredential(req, res));
    this.app.post('/verify/qr', (req, res) => this.verifyQrReference(req, res));
    this.app.get('/evidence/:id', (req, res) => this.getEvidence(req, res));
    this.app.get('/state/credentials/:id/evidence', (req, res) => this.getSecurityEvidence(req, res));
    this.app.get('/state/credentials/:id/history', (req, res) => this.getCredentialHistory(req, res));
    this.app.post('/state/credentials/:id/proof', (req, res) => this.getCredentialProof(req, res));
    this.app.get('/qr/:credentialId', (req, res) => this.getQrReference(req, res));
    this.app.get('/state/validators', (_req, res) => this.getValidators(res));
    this.app.get('/network/peers', (_req, res) => this.getPeers(res));
    this.app.get('/network/status', (_req, res) => this.getNetworkStatus(res));
    this.app.get('/state', (_req, res) => this.getState(res));
    this.app.post('/contracts/tamper-check', (req, res) => this.tamperCheck(req, res));
    this.app.post('/contracts/fraud/anchor', (req, res) => this.fraudAnchor(req, res));
    this.app.get('/audit/events', (req, res) => this.getAuditEvents(req, res));
    this.app.get('/audit/summary', (_req, res) => this.getAuditSummary(res));
    this.app.get('/openapi.json', (_req, res) => this.getOpenApi(res));
  }

  private health(res: Response): void {
    okResponse(res, {
      nodeId: this.config.nodeId,
      version: '3.0.0',
      protocolVersion: PROTOCOL_VERSION,
      height: this.chain.getHeight(),
      peerCount: this.network.getPeerCount(),
      uptime: process.uptime(),
      status: this.observability.isHealthy() ? 'UP' : 'DEGRADED',
    });
  }

  private ready(res: Response): void {
    okResponse(res, {
      ready: this.observability.isReady(),
      height: this.chain.getHeight(),
      stateValidated: this.chain.getStorage().stateStore.getHeight() >= this.chain.getHeight(),
    });
  }

  private status(res: Response): void {
    okResponse(res, this.observability.getStatus());
  }

  private metrics(res: Response): void {
    okResponse(res, this.observability.getMetrics());
  }

  private getQrReference(req: Request, res: Response): void {
    const credentialId = req.params.credentialId;
    if (!credentialId || typeof credentialId !== 'string') {
      return failResponse(res, { code: 'INVALID_INPUT', message: 'credentialId required' }, 400);
    }
    okResponse(res, this.qr.referenceFor(credentialId));
  }

  private verifyQrReference(req: Request, res: Response): void {
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'string') {
      return failResponse(res, { code: 'INVALID_INPUT', message: 'QR payload required' }, 400);
    }

    const result = this.qr.verifyQrPayload(payload);
    if (!result.ok) {
      const message =
        result.reason === 'expired'
          ? 'This SecureX QR reference has expired. Ask the holder to refresh it.'
          : 'This SecureX QR reference is not authentic or could not be resolved. Scan a valid SecureX QR.';
      return failResponse(res, { code: 'INVALID_QR_REFERENCE', message }, 400);
    }

    const state = this.chain.getState();
    const credential = state.getCredentialByPublicId(result.publicCredentialId);
    if (!credential) {
      return okResponse(res, {
        status: VerificationStatus.NOT_FOUND,
        credentialId: result.publicCredentialId,
        errorMessage: 'Credential not found on the SecureX ledger.',
      });
    }

    const base = this.verification.verifyCredentialSync(credential.credentialId);
    const securityChecks = this.buildSecurityChecks(credential.credentialId, base);
    okResponse(
      res,
      this.buildVerifyResponse(base, credential, securityChecks, undefined, result.publicCredentialId),
    );
  }

  private verifyCredential(req: Request, res: Response): void {
    const rawId = req.params.id || (req.body && req.body.credentialId) || '';
    const documentHash = (req.body && req.body.documentHash) || undefined;
    if (!rawId || typeof rawId !== 'string') {
      return failResponse(res, { code: 'INVALID_INPUT', message: 'credentialId required' }, 400);
    }
    const id = rawId.trim();

    const state = this.chain.getState();

    const isPublic = isPublicCredentialId(id);
    let internalId = id;
    let resolvedPublicId: string | undefined;

    if (isPublic) {
      const credential = state.getCredentialByPublicId(id);
      if (!credential) {
        return okResponse(res, {
          status: VerificationStatus.NOT_FOUND,
          credentialId: id,
          errorMessage: 'Credential not found on the SecureX ledger.',
        });
      }
      internalId = credential.credentialId;
      resolvedPublicId = id;
    }

    const base = this.verification.verifyCredentialSync(internalId);
    const credential = state.getCredential(internalId);

    const securityChecks = this.buildSecurityChecks(internalId, base);

    const tamper = documentHash !== undefined ? this.runDocumentHashCheck(internalId, documentHash) : undefined;

    okResponse(res, this.buildVerifyResponse(base, credential, securityChecks, tamper, resolvedPublicId));
  }

  private buildVerifyResponse(
    base: any,
    credential: any,
    securityChecks: Record<string, boolean>,
    tamper: any,
    publicId?: string,
  ): any {
    const evidenceFor = {
      status: base.status,
      credentialId: publicId ?? base.credentialId,
      credentialHash: base.credentialHash,
      issuer: base.issuer,
      lifecycle: base.lifecycle,
      transaction: base.transaction,
      block: base.block,
      issuerSignatureValid: base.issuerSignatureValid,
      keyStatus: base.keyStatus,
      protocolCompatible: base.protocolCompatible,
      verifiedAt: base.verifiedAt,
    };

    const credentialSummary = credential
      ? {
          credentialId: publicId ?? credential.credentialId,
          issuerId: credential.issuerId,
          status: credential.status,
          schemaVersion: credential.schemaVersion,
          issuedAt: credential.issuedAt,
          lastUpdated: credential.lastUpdated,
        }
      : undefined;

    const documentHashCheck = tamper ? this.scrubTamperResult(tamper, publicId) : undefined;

    return {
      ...evidenceFor,
      status: base.status,
      securityChecks,
      documentHashCheck,
      credential: credentialSummary,
    };
  }

  private scrubTamperResult(tamper: any, publicId?: string): any {
    if (!tamper) return undefined;
    const clean = { ...tamper };
    if (publicId && typeof clean.credentialId === 'string') {
      clean.credentialId = publicId;
    }
    return clean;
  }

  private runDocumentHashCheck(credentialId: string, documentHash: string): any {
    if (typeof documentHash !== 'string' || !HASH_RE.test(documentHash)) {
      return { suppliedHash: documentHash, status: 'UNVERIFIABLE', message: 'documentHash must be 64-char hex', suppliedHashClean: false };
    }
    const result = this.tamper.check(credentialId, documentHash);
    return { ...result, credential: this.chain.getState().getCredential(credentialId) ? true : false };
  }

  private buildSecurityChecks(credentialId: string, base: any): Record<string, boolean> {
    const state = this.chain.getState();
    const credential = state.getCredential(credentialId);
    const issuer = credential ? state.getIssuer(credential.issuerId) : undefined;
    return {
      credentialExists: !!credential,
      issuerRecognized: !!issuer,
      issuerActive: issuer ? issuer.status === 'ACTIVE' : false,
      signatureValid: !!base.issuerSignatureValid,
      credentialHashStored: credential ? HASH_RE.test(credential.credentialHash) : false,
      transactionValid: !!base.transaction,
      blockValid: !!base.block,
      merkleProofValid: base.status !== VerificationStatus.UNVERIFIABLE && !!base.proof,
      lifecycleValid: base.status === VerificationStatus.VALID,
      expiryValid: base.status !== VerificationStatus.EXPIRED,
      protocolCompatible: base.protocolCompatible !== false,
    };
  }

  private getEvidence(req: Request, res: Response): void {
    const id = req.params.id;
    const result = this.evidence.verifyInclusion(id);
    okResponse(res, result);
  }

  private getSecurityEvidence(req: Request, res: Response): void {
    const id = req.params.id;
    const state = this.chain.getState();
    const credential = state.getCredential(id);
    if (!credential) {
      return failResponse(res, { code: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' }, 404);
    }
    const verification = this.verification.verifyCredentialSync(id);
    const issuance = this.evidence.getIssuanceTransaction(id);
    const block = this.evidence.getContainingBlock(id);
    const proof = this.evidence.getInclusionProof(id);
    const history = this.history.getCredentialHistory(id);
    const issuer = state.getIssuer(credential.issuerId);
    const anchor = this.tamper.getAnchorEvidence(credential);

    okResponse(res, {
      credentialId: id,
      status: verification.status,
      verification,
      transaction: issuance.available ? issuance.evidence?.transaction || null : null,
      block: block.available ? block.evidence?.block || null : null,
      merkleProofValid: proof.available ? proof.evidence?.inclusionProof : null,
      proof: proof.available ? proof.evidence : undefined,
      issuer: issuer ? {
        issuerId: issuer.issuerId,
        name: issuer.name,
        publicKey: issuer.publicKey,
        status: issuer.status,
      } : null,
      issuerSignatureValid: verification.issuerSignatureValid,
      lifecycle: history,
      anchor,
      verifiedAt: verification.verifiedAt || new Date().toISOString(),
    });
  }

  private getBlocks(req: Request, res: Response): void {
    const page = paginate(req.query, { offset: 0, limit: 50, maxLimit: 200 });
    const blocks = this.chain.getStorage().blockStore.iterBlocks().reverse().slice(page.offset, page.offset + page.limit);
    okResponse(res, blocks);
  }

  private getBlockByHeight(req: Request, res: Response): void {
    const height = parseInt(req.params.height, 10);
    if (!Number.isFinite(height)) return failResponse(res, { code: 'INVALID_INPUT', message: 'Invalid height' }, 400);
    const block = this.chain.getBlockByHeight(height);
    if (!block) return failResponse(res, { code: 'BLOCK_NOT_FOUND', message: 'Block not found' }, 404);
    okResponse(res, block);
  }

  private getBlockByHash(req: Request, res: Response): void {
    const block = this.chain.getBlockByHash(req.params.hash);
    if (!block) return failResponse(res, { code: 'BLOCK_NOT_FOUND', message: 'Block not found' }, 404);
    okResponse(res, block);
  }

  private getTransaction(req: Request, res: Response): void {
    const record = this.chain.getTransaction(req.params.id);
    if (!record) return failResponse(res, { code: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found' }, 404);
    okResponse(res, record);
  }

  private submitTransaction(req: Request, res: Response): void {
    try {
      const tx = req.body as Transaction;
      if (!tx || !tx.id) return failResponse(res, { code: 'INVALID_TRANSACTION', message: 'Invalid transaction' }, 400);

      const error = this.consensus.addTransaction(tx);
      if (error) {
        this.audit.onTransactionRejected(error, tx);
        return failResponse(res, { code: error, message: error }, 400);
      }

      this.network.broadcastTransaction(tx);
      okResponse(res, { submitted: true, id: tx.id, status: 'PENDING' });
    } catch (e: any) {
      failResponse(res, { code: 'INTERNAL_ERROR', message: 'An internal error occurred' }, 500);
    }
  }

  private getIssuers(res: Response): void {
    okResponse(res, this.chain.getState().getAllIssuers());
  }

  private getIssuer(req: Request, res: Response): void {
    const issuer = this.chain.getState().getIssuer(req.params.id);
    if (!issuer) return failResponse(res, { code: 'UNKNOWN_ISSUER', message: 'Issuer not found' }, 404);
    okResponse(res, issuer);
  }

  private getIssuerHistory(req: Request, res: Response): void {
    const history = this.history.getIssuerLifecycle(req.params.id);
    if (!history) return failResponse(res, { code: 'UNKNOWN_ISSUER', message: 'Issuer not found' }, 404);
    // include credential lifecycle authored by this issuer
    const creds = this.chain.getState().getAllCredentials().filter(c => c.issuerId === req.params.id);
    const credentialSummaries = creds.map(c => this.history.summarizeCredential(c));
    okResponse(res, { issuerHistory: history, credentials: credentialSummaries });
  }

  private getCredential(req: Request, res: Response): void {
    const credential = this.chain.getState().getCredential(req.params.id);
    if (!credential) return failResponse(res, { code: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' }, 404);
    okResponse(res, credential);
  }

  private getCredentialHistory(req: Request, res: Response): void {
    const history = this.history.getCredentialHistory(req.params.id);
    if (!history) return failResponse(res, { code: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' }, 404);
    okResponse(res, history);
  }

  private getCredentialProof(req: Request, res: Response): void {
    const credential = this.chain.getState().getCredential(req.params.id);
    if (!credential) return failResponse(res, { code: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' }, 404);

    const height = Number(req.body?.blockHeight ?? this.chain.getHeight());
    const block = this.chain.getBlockByHeight(height);
    if (!block) return failResponse(res, { code: 'BLOCK_NOT_FOUND', message: 'Block not found' }, 404);

    const leafHash = credential.credentialHash;
    const leaves = block.transactions.map(tx => tx.payload?.credentialHash || tx.id);
    const tree = new MerkleTree(leaves);

    const leafIndex = leaves.findIndex(l => l === leafHash);
    if (leafIndex === -1) return failResponse(res, { code: 'CREDENTIAL_NOT_IN_BLOCK', message: 'Credential not in block' }, 404);

    const proof = tree.getProof(leafIndex);
    const root = tree.getRoot();

    okResponse(res, {
      credentialId: credential.credentialId,
      credentialHash: credential.credentialHash,
      leafHash,
      leafIndex,
      proof,
      root,
      blockHeight: height,
      blockHash: block.hash,
      blockPreviousHash: block.header.previousHash,
      blockProposer: block.header.proposerId,
      blockTimestamp: block.header.timestamp,
      issuerSignatureValid: this.verification.verifyCredentialSync(req.params.id).issuerSignatureValid,
      valid: MerkleTree.verifyProof(leafHash, proof, root),
    });
  }

  private getKeys(res: Response): void {
    okResponse(res, this.chain.getState().getAllKeys());
  }

  private getKey(req: Request, res: Response): void {
    const key = this.chain.getState().getKey(req.params.id);
    if (!key) return failResponse(res, { code: 'UNKNOWN_KEY', message: 'Key not found' }, 404);
    okResponse(res, key);
  }

  private getKeysByOwner(req: Request, res: Response): void {
    const keys = this.chain.getState().getAllKeys().filter(k => k.ownerId === req.params.ownerId);
    okResponse(res, keys);
  }

  private getValidators(res: Response): void {
    okResponse(res, this.chain.getState().getValidators());
  }

  private getPeers(res: Response): void {
    okResponse(res, {
      connected: this.network.getConnectedNodeIds(),
      known: this.chain.getStorage().peerStore.getPeers(),
      peerCount: this.network.getPeerCount(),
    });
  }

  private getNetworkStatus(res: Response): void {
    okResponse(res, {
      nodeId: this.config.nodeId,
      height: this.chain.getHeight(),
      peerCount: this.network.getPeerCount(),
      validators: this.chain.getState().getValidators().length,
      currentProposer: this.consensus.getProposerForHeight(this.chain.getHeight() + 1),
      pendingTransactions: this.consensus.getPendingTransactions().length,
      protocolVersion: PROTOCOL_VERSION,
      status: 'RUNNING',
      consensus: 'Permissioned Proof of Authority (single proposer)',
    });
  }

  private getState(res: Response): void {
    okResponse(res, {
      height: this.chain.getHeight(),
      issuers: this.chain.getState().getAllIssuers().length,
      credentials: this.chain.getState().getAllCredentials().length,
      validators: this.chain.getState().getValidators().length,
      keys: this.chain.getState().getAllKeys().length,
    });
  }

  private tamperCheck(req: Request, res: Response): void {
    const { credentialId, documentHash } = req.body || {};
    if (!credentialId || typeof credentialId !== 'string') {
      return failResponse(res, { code: 'INVALID_INPUT', message: 'credentialId required' }, 400);
    }
    if (!documentHash || typeof documentHash !== 'string' || !HASH_RE.test(documentHash)) {
      return failResponse(res, { code: 'INVALID_INPUT', message: 'documentHash must be 64-char hex' }, 400);
    }
    const result = this.tamper.check(credentialId, documentHash);
    okResponse(res, result);
  }

  private fraudAnchor(req: Request, res: Response): void {
    const { credentialId } = req.body || {};
    if (!credentialId || typeof credentialId !== 'string') {
      return failResponse(res, { code: 'INVALID_INPUT', message: 'credentialId required' }, 400);
    }
    const credential = this.chain.getState().getCredential(credentialId);
    if (!credential) {
      return failResponse(res, { code: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found' }, 404);
    }
    const anchor = this.tamper.getAnchorEvidence(credential);
    okResponse(res, {
      credentialId,
      documentHash: credential.credentialHash,
      anchoredAt: credential.issuedAt,
      ...anchor,
    });
  }

  private getAuditEvents(req: Request, res: Response): void {
    const page = paginate(req.query, { offset: 0, limit: 100, maxLimit: 1000 });
    okResponse(res, this.audit.getEvents(page.limit, page.offset));
  }

  private getAuditSummary(res: Response): void {
    okResponse(res, this.audit.summarize());
  }

  private getOpenApi(res: Response): void {
    res.json(openApiDocument(this.config));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const host = this.config.apiHost || '0.0.0.0';
      this.server = this.app.listen(this.config.port, host, () => {
        getLogger().info(`API server listening on ${host}:${this.config.port}`);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) this.server.close();
  }
}

function openApiDocument(config: ApiServerConfig): any {
  const basePath = `/`;
  return {
    openapi: '3.0.0',
    info: {
      title: 'SecureX Blockchain API',
      version: '3.0.0',
      description: 'Permissioned Proof-of-Authority blockchain for digital credential verification.',
    },
    servers: [{ url: basePath }],
    components: {
      schemas: {
        Envelope: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
        QrReference: {
          type: 'object',
          properties: {
            credentialId: { type: 'string' },
            version: { type: 'string' },
            verificationUrl: { type: 'string' },
            exists: { type: 'boolean' },
            qrContent: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/health': { get: { summary: 'Node health', responses: { '200': { description: 'ok' } } } },
      '/ready': { get: { summary: 'Node readiness', responses: { '200': { description: 'ok' } } } },
      '/status': { get: { summary: 'Node status', responses: { '200': { description: 'ok' } } } },
      '/metrics': { get: { summary: 'Node metrics', responses: { '200': { description: 'ok' } } } },
      '/blocks': { get: { summary: 'List blocks (paginated)', responses: { '200': { description: 'ok' } } } },
      '/blocks/{height}': { get: { summary: 'Block by height', parameters: [{ name: 'height', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/blocks/hash/{hash}': { get: { summary: 'Block by hash', parameters: [{ name: 'hash', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/transactions/{id}': { get: { summary: 'Transaction by id', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/transactions': { post: { summary: 'Submit a signed transaction', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'submitted' }, '400': { description: 'rejected' } } } },
      '/state/issuers': { get: { summary: 'List issuers', responses: { '200': { description: 'ok' } } } },
      '/state/issuers/{id}': { get: { summary: 'Get issuer', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/issuers/{id}/history': { get: { summary: 'Issuer history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/credentials/{id}': { get: { summary: 'Get credential', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/credentials/{id}/history': { get: { summary: 'Credential lifecycle history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/credentials/{id}/proof': { post: { summary: 'Merkle proof', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/credentials/{id}/evidence': { get: { summary: 'Security evidence', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/keys': { get: { summary: 'List keys', responses: { '200': { description: 'ok' } } } },
      '/state/keys/{id}': { get: { summary: 'Get key', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' }, '404': { description: 'not found' } } } },
      '/state/keys/owner/{ownerId}': { get: { summary: 'Keys by owner', parameters: [{ name: 'ownerId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/verify/{id}': { get: { summary: 'Verify a credential (public)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/verify': { post: { summary: 'Verify a credential, optionally against a document hash (public)', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { credentialId: { type: 'string' }, documentHash: { type: 'string' } } } } } }, responses: { '200': { description: 'ok' }, '400': { description: 'invalid input' } } } },
      '/qr/{credentialId}': { get: { summary: 'Generate QR verification reference (public)', parameters: [{ name: 'credentialId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/evidence/{id}': { get: { summary: 'Blockchain evidence (public)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      '/state/validators': { get: { summary: 'List validators', responses: { '200': { description: 'ok' } } } },
      '/network/peers': { get: { summary: 'Network peers', responses: { '200': { description: 'ok' } } } },
      '/network/status': { get: { summary: 'Network status', responses: { '200': { description: 'ok' } } } },
      '/state': { get: { summary: 'State summary', responses: { '200': { description: 'ok' } } } },
      '/contracts/tamper-check': { post: { summary: 'Tamper check a document hash against an anchored credential', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { credentialId: { type: 'string' }, documentHash: { type: 'string' } } } } } }, responses: { '200': { description: 'ok' }, '400': { description: 'invalid input' } } } },
      '/contracts/fraud/anchor': { post: { summary: 'Get fraud anchor evidence for a credential', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { credentialId: { type: 'string' } } } } } }, responses: { '200': { description: 'ok' } } } },
      '/audit/events': { get: { summary: 'Audit/security events', responses: { '200': { description: 'ok' } } } },
      '/audit/summary': { get: { summary: 'Audit summary', responses: { '200': { description: 'ok' } } } },
      '/openapi.json': { get: { summary: 'OpenAPI document', responses: { '200': { description: 'ok' } } } },
    },
  };
}
