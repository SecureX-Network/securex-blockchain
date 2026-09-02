import {
  Transaction,
  TransactionType,
  buildTransaction,
  createTransactionId,
  getSigningData,
} from '../core/transaction/transaction';
import { CryptoManager } from '../crypto/signatures/crypto';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function defaultBaseUrl(): string {
  return process.env.CTN_API_URL || 'http://localhost:4001';
}

export class BlockchainClient {
  private baseUrl: string;
  private nodeId: string;
  private publicKey: string;
  private privateKey: string;
  private nonce = 1;

  constructor(options?: {
    baseUrl?: string;
    nodeId?: string;
    publicKey?: string;
    privateKey?: string;
  }) {
    this.baseUrl = options?.baseUrl || defaultBaseUrl();
    this.nodeId = options?.nodeId || '';
    this.publicKey = options?.publicKey || '';
    this.privateKey = options?.privateKey || '';
  }

  setIdentity(nodeId: string, publicKey: string, privateKey: string): void {
    this.nodeId = nodeId;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  setNonce(nonce: number): void {
    this.nonce = nonce;
  }

  getNonce(): number {
    return this.nonce;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await response.json();
    return json as ApiResponse<T>;
  }

  signTransaction(type: TransactionType, payload: any, sender?: string, nonce?: number): Transaction {
    const id = createTransactionId();
    const unsigned = {
      protocolVersion: '1.0',
      transactionVersion: 1,
      id,
      type,
      timestamp: new Date().toISOString(),
      sender: sender || this.nodeId,
      nonce: nonce ?? this.nonce,
      payload,
    };

    const signingData = getSigningData(unsigned);
    const signature = CryptoManager.sign(signingData, this.privateKey);

    if (nonce === undefined) {
      this.nonce += 1;
    }

    return {
      ...unsigned,
      signature,
    } as Transaction;
  }

  async submitTransaction(type: TransactionType, payload: any): Promise<ApiResponse<any>> {
    const tx = this.signTransaction(type, payload);
    return this.request('POST', '/transactions', tx);
  }

  async submitRawTransaction(tx: Transaction): Promise<ApiResponse<any>> {
    return this.request('POST', '/transactions', tx);
  }

  async getHealth(): Promise<ApiResponse<any>> {
    return this.request('GET', '/health');
  }

  async getBlocks(offset = 0, limit = 50): Promise<ApiResponse<any>> {
    return this.request('GET', `/blocks?offset=${offset}&limit=${limit}`);
  }

  async getBlockByHeight(height: number): Promise<ApiResponse<any>> {
    return this.request('GET', `/blocks/${height}`);
  }

  async getBlockByHash(hash: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/blocks/hash/${hash}`);
  }

  async getTransaction(id: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/transactions/${id}`);
  }

  async getIssuers(): Promise<ApiResponse<any>> {
    return this.request('GET', '/state/issuers');
  }

  async getIssuer(issuerId: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/state/issuers/${issuerId}`);
  }

  async getCredential(credentialId: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/state/credentials/${credentialId}`);
  }

  async getCredentialState(credentialId: string): Promise<ApiResponse<any>> {
    return this.getCredential(credentialId);
  }

  async getCredentialHistory(credentialId: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/state/credentials/${credentialId}/history`);
  }

  async getCredentialProof(credentialId: string, blockHeight?: number): Promise<ApiResponse<any>> {
    return this.request('POST', `/state/credentials/${credentialId}/proof`, blockHeight ? { blockHeight } : {});
  }

  async getValidators(): Promise<ApiResponse<any>> {
    return this.request('GET', '/state/validators');
  }

  async getNetworkStatus(): Promise<ApiResponse<any>> {
    return this.request('GET', '/network/status');
  }

  async getPeers(): Promise<ApiResponse<any>> {
    return this.request('GET', '/network/peers');
  }

  async getReady(): Promise<ApiResponse<any>> {
    return this.request('GET', '/ready');
  }

  async getStatus(): Promise<ApiResponse<any>> {
    return this.request('GET', '/status');
  }

  async getMetrics(): Promise<ApiResponse<any>> {
    return this.request('GET', '/metrics');
  }

  async verifyCredential(credentialId: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/verify/${credentialId}`);
  }

  async getBlockchainEvidence(credentialId: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/evidence/${credentialId}`);
  }
}
