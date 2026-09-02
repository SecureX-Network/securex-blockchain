import { Chain } from '../core/chain';
import { PermissionedConsensus } from '../consensus/permissioned/consensus';
import { NodeNetwork } from '../network/peer/node';
import { PROTOCOL_VERSION } from '../core/version';

export interface NodeMetrics {
  chain: {
    height: number;
    blockCount: number;
    latestBlockHash: string;
    transactionCount: number;
    stateHeight: number;
  };
  validators: {
    count: number;
    active: number;
    pendingWithoutKey: number;
  };
  network: {
    peerCount: number;
    knownPeers: number;
    connectedNodeIds: string[];
  };
  consensus: {
    status: string;
    currentProposer: string | null;
    minSignatures: number;
    panelSize: number;
  };
  node: {
    nodeId: string;
    version: string;
    protocolVersion: string;
    uptimeSeconds: number;
  };
  credentials: {
    total: number;
    active: number;
    suspended: number;
    revoked: number;
    reissued: number;
  };
}

export class ObservabilityService {
  private chain: Chain;
  private consensus: PermissionedConsensus;
  private network: NodeNetwork | null;
  private nodeId: string;
  private startedAt: number;

  constructor(
    chain: Chain,
    consensus: PermissionedConsensus,
    network: NodeNetwork | null,
    nodeId: string,
  ) {
    this.chain = chain;
    this.consensus = consensus;
    this.network = network;
    this.nodeId = nodeId;
    this.startedAt = Date.now();
  }

  getStatus(): any {
    const state = this.chain.getState();
    const credentials = state.getAllCredentials();
    const validators = state.getValidators();

    return {
      nodeId: this.nodeId,
      protocolVersion: PROTOCOL_VERSION,
      status: 'RUNNING',
      height: this.chain.getHeight(),
      peerCount: this.network ? this.network.getPeerCount() : 0,
      validators: validators.length,
      activeValidators: validators.filter(v => v.status === 'ACTIVE').length,
      currentProposer: this.consensus.getProposerForHeight(this.chain.getHeight() + 1),
      pendingTransactions: this.consensus.getPendingTransactions().length,
      blockCount: this.chain.getStorage().blockStore.getBlockCount(),
      transactionCount: this.chain.getStorage().transactionStore.getTransactionCount(),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  getMetrics(): NodeMetrics {
    const state = this.chain.getState();
    const validators = state.getValidators();
    const credentials = state.getAllCredentials();
    const latest = this.chain.getStorage().blockStore.getLatestBlock();

    return {
      chain: {
        height: this.chain.getHeight(),
        blockCount: this.chain.getStorage().blockStore.getBlockCount(),
        latestBlockHash: latest ? latest.hash : '',
        transactionCount: this.chain.getStorage().transactionStore.getTransactionCount(),
        stateHeight: this.chain.getStorage().stateStore.getHeight(),
      },
      validators: {
        count: validators.length,
        active: validators.filter(v => v.status === 'ACTIVE').length,
        pendingWithoutKey: validators.filter(v => v.status === 'ACTIVE' && !v.publicKey).length,
      },
      network: {
        peerCount: this.network ? this.network.getPeerCount() : 0,
        knownPeers: this.chain.getStorage().peerStore.getPeers().length,
        connectedNodeIds: this.network ? this.network.getConnectedNodeIds() : [],
      },
      consensus: {
        status: 'RUNNING',
        currentProposer: this.consensus.getProposerForHeight(this.chain.getHeight() + 1),
        minSignatures: this.consensus.getMinSignatures(),
        panelSize: this.consensus.getPanel().length,
      },
      node: {
        nodeId: this.nodeId,
        version: '2.0.0',
        protocolVersion: PROTOCOL_VERSION,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      },
      credentials: {
        total: credentials.length,
        active: credentials.filter(c => c.status === 'ACTIVE').length,
        suspended: credentials.filter(c => c.status === 'SUSPENDED').length,
        revoked: credentials.filter(c => c.status === 'REVOKED').length,
        reissued: credentials.filter(c => c.status === 'REISSUED').length,
      },
    };
  }

  isReady(): boolean {
    return this.chain.getHeight() >= 0;
  }

  isHealthy(): boolean {
    return this.chain.getStorage().blockStore.getBlockCount() > 0;
  }
}
