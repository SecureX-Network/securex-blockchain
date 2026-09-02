import { Chain } from './core/chain';
import { PermissionedConsensus } from './consensus/permissioned/consensus';
import { NodeNetwork } from './network/peer/node';
import { ApiServer } from './api/server';
import { createFileStorage, Storage } from './storage/file-store';
import { ModuleRegistry } from './modules/registry';
import { CredentialModule } from './modules/credentials/module';
import { IssuerModule, IssuerUpdateModule } from './modules/issuers/module';
import {
  RevokeModule,
  SuspendModule,
  ReinstateModule,
  ReissueModule,
} from './modules/revocation/module';
import {
  KeyRegisterModule,
  KeyRotateModule,
} from './modules/keys/module';
import { BatchAnchorModule } from './modules/batch';
import { NodeConfig } from './config/config';
import { IdentityManager } from './crypto/identity/identity';
import { CryptoManager, KeyPair } from './crypto/signatures/crypto';
import { getLogger } from './utils/logger';
import { Block } from './core/block/block';
import { ChainRecovery } from './services/recovery';
import { AuditService } from './services/audit';

export interface CtnNodeOptions {
  config: NodeConfig;
  keyPair: KeyPair;
}

export class CtnNode {
  private config: NodeConfig;
  private keyPair: KeyPair;
  private identity: IdentityManager;
  private storage: Storage;
  private registry: ModuleRegistry;
  private chain: Chain;
  private consensus: PermissionedConsensus;
  private network: NodeNetwork | null = null;
  private api: ApiServer | null = null;
  private audit: AuditService;
  private startedAt: number;

  constructor(options: CtnNodeOptions) {
    this.config = options.config;
    this.keyPair = options.keyPair;
    this.identity = new IdentityManager();
    this.startedAt = Date.now();
    this.audit = new AuditService();

    const role = options.config.validators.includes(options.keyPair.keyId)
      ? 'validator'
      : 'full';

    this.identity.init(options.keyPair, role);

    this.storage = createFileStorage(this.config.dataDir);
    this.registry = this.buildRegistry();
    this.chain = new Chain(this.storage, this.registry, {
      onBlockCommitted: (block) => this.onBlockCommitted(block),
    });

    this.consensus = new PermissionedConsensus(
      this.chain,
      { blockInterval: this.config.blockInterval, minSignatures: 1 },
      this.keyPair.keyId,
      this.keyPair.privateKey,
      {
        onRejected: (err, tx, block) => {
          if (tx) this.audit.onTransactionRejected(err, tx);
          if (block) this.audit.onBlockRejected(err, block);
        },
      },
    );
  }

  private buildRegistry(): ModuleRegistry {
    const registry = new ModuleRegistry();
    registry.register(new CredentialModule());
    registry.register(new IssuerModule());
    registry.register(new IssuerUpdateModule());
    registry.register(new RevokeModule());
    registry.register(new SuspendModule());
    registry.register(new ReinstateModule());
    registry.register(new ReissueModule());
    registry.register(new KeyRegisterModule());
    registry.register(new KeyRotateModule());
    registry.register(new BatchAnchorModule());
    return registry;
  }

  async start(): Promise<void> {
    this.chain.initGenesis(this.config.genesisTimestamp, this.config.validators);

    const recovery = new ChainRecovery(this.chain).recover();
    if (!recovery.recovered) {
      getLogger().error(`Chain recovery FAILED at startup: ${recovery.message}`);
      throw new Error(`Chain recovery failed: ${recovery.message}`);
    }
    getLogger().info(
      `Chain recovery: ${recovery.blocksValidated} blocks validated at height ${recovery.height} (stateValidated=${recovery.stateValidated})`,
    );
    if (!recovery.stateValidated) {
      this.audit.onStateValidationFailure('Recovered chain state height mismatch', recovery.height);
    }

    this.resolveValidatorKeys();

    this.consensus.setPanel(this.config.validators);

    this.network = new NodeNetwork(
      {
        port: this.config.port,
        peers: this.config.peers,
        nodeId: this.keyPair.keyId,
        publicKey: this.keyPair.publicKey,
        privateKey: this.keyPair.privateKey,
      },
      this.chain,
      this.consensus,
    );
    this.network.start();

    this.consensus.start();

    this.audit.start();

    this.api = new ApiServer(
      {
        port: this.config.apiPort,
        apiHost: this.config.apiHost,
        nodeId: this.keyPair.keyId,
        publicKey: this.keyPair.publicKey,
        privateKey: this.keyPair.privateKey,
        allowedOrigins: this.config.cors.allowedOrigins,
        corsEnabled: this.config.cors.enabled,
        requestLimitBytes: this.config.requestLimitBytes,
        logLevel: this.config.logLevel,
      },
      this.chain,
      this.consensus,
      this.network,
      this.audit,
    );
    await this.api.start();

    getLogger().info(`CTN Node ${this.keyPair.keyId.slice(0, 8)} started at height ${this.chain.getHeight()}`);
  }

  private resolveValidatorKeys(): void {
    for (const validatorId of this.config.validators) {
      if (validatorId === this.keyPair.keyId) {
        this.chain.updateValidatorKey(validatorId, this.keyPair.publicKey);
      }
    }
  }

  private onBlockCommitted(block: Block): void {
    for (const tx of block.transactions) {
      this.audit.onLifecycle(
        lifecycleTypeFor(tx.type),
        tx,
        block,
        { referenceId: tx.payload?.credentialId || tx.sender },
      );
    }
    if (this.network) {
      this.network.broadcastBlock(block);
    }
  }

  async stop(): Promise<void> {
    this.consensus.stop();
    if (this.api) this.api.stop();
    if (this.network) this.network.stop();
    this.audit.stop();
    this.chain.getState().persist(this.chain.getHeight());
    getLogger().info(`CTN Node ${this.keyPair.keyId.slice(0, 8)} stopped at height ${this.chain.getHeight()}`);
  }

  getChain(): Chain {
    return this.chain;
  }

  getConsensus(): PermissionedConsensus {
    return this.consensus;
  }

  getNetwork(): NodeNetwork | null {
    return this.network;
  }

  getKeyPair(): KeyPair {
    return this.keyPair;
  }

  getAudit(): AuditService {
    return this.audit;
  }

  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}

function lifecycleTypeFor(txType: string): any {
  const map: Record<string, string> = {
    ISSUER_REGISTER: 'ISSUER_REGISTERED',
    ISSUER_UPDATE: 'ISSUER_UPDATED',
    CREDENTIAL_ISSUE: 'CREDENTIAL_ISSUED',
    CREDENTIAL_SUSPEND: 'CREDENTIAL_SUSPENDED',
    CREDENTIAL_REINSTATE: 'CREDENTIAL_REINSTATED',
    CREDENTIAL_REVOKE: 'CREDENTIAL_REVOKED',
    CREDENTIAL_REISSUE: 'CREDENTIAL_REISSUED',
    KEY_REGISTER: 'KEY_REGISTERED',
    KEY_ROTATE: 'KEY_ROTATED',
  };
  return map[txType] || txType;
}
