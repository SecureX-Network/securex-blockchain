import { KeyPair, CryptoManager } from '../signatures/crypto';
import { getLogger } from '../../utils/logger';

export interface NodeIdentity {
  nodeId: string;
  keyPair: KeyPair;
  role: 'validator' | 'full' | 'light';
}

export class IdentityManager {
  private identity: NodeIdentity | null = null;

  init(keyPair: KeyPair, role: 'validator' | 'full' | 'light' = 'full'): NodeIdentity {
    this.identity = {
      nodeId: keyPair.keyId,
      keyPair,
      role,
    };
    getLogger().info(`Node identity initialized: ${this.identity.nodeId} (role: ${role})`);
    return this.identity;
  }

  getIdentity(): NodeIdentity {
    if (!this.identity) throw new Error('Identity not initialized');
    return this.identity;
  }

  getNodeId(): string {
    return this.getIdentity().nodeId;
  }

  getPublicKey(): string {
    return this.getIdentity().keyPair.publicKey;
  }

  getPrivateKey(): string {
    return this.getIdentity().keyPair.privateKey;
  }

  isValidator(): boolean {
    return this.getIdentity().role === 'validator';
  }

  sign(data: string): string {
    return CryptoManager.sign(data, this.getPrivateKey());
  }

  verify(data: string, signature: string, publicKey?: string): boolean {
    return CryptoManager.verify(data, signature, publicKey || this.getPublicKey());
  }

  signObject(obj: any): string {
    const { signature } = CryptoManager.signObject(obj, this.getPrivateKey());
    return signature;
  }

  verifyObject(obj: any, signature: string, publicKey: string): boolean {
    return CryptoManager.verifyObject(obj, signature, publicKey);
  }
}
