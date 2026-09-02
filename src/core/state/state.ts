import { StateStoreInterface } from '../../storage/interfaces';
import { BlockchainError } from '../errors';

export enum CredentialStatus {
  CREATED = 'CREATED',
  ISSUED = 'ISSUED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
  REISSUED = 'REISSUED',
}

const VALID_TRANSITIONS: Record<CredentialStatus, CredentialStatus[]> = {
  [CredentialStatus.CREATED]: [CredentialStatus.ACTIVE, CredentialStatus.REVOKED],
  [CredentialStatus.ISSUED]: [CredentialStatus.ACTIVE, CredentialStatus.REVOKED],
  [CredentialStatus.ACTIVE]: [CredentialStatus.REVOKED, CredentialStatus.SUSPENDED, CredentialStatus.EXPIRED, CredentialStatus.REISSUED],
  [CredentialStatus.SUSPENDED]: [CredentialStatus.ACTIVE, CredentialStatus.REVOKED, CredentialStatus.EXPIRED],
  [CredentialStatus.REVOKED]: [CredentialStatus.REISSUED],
  [CredentialStatus.EXPIRED]: [CredentialStatus.ACTIVE, CredentialStatus.REISSUED],
  [CredentialStatus.REISSUED]: [],
};

export function canTransition(from: CredentialStatus, to: CredentialStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function describeCredentialStatus(status: CredentialStatus): string {
  return status;
}

export interface LifecycleValidationResult {
  valid: boolean;
  error?: BlockchainError;
}

export interface IssuerRecord {
  issuerId: string;
  name: string;
  publicKey: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  registeredAt: string;
  metadata: Record<string, any>;
}

export interface CredentialRecord {
  credentialId: string;
  issuerId: string;
  credentialHash: string;
  status: CredentialStatus;
  schemaVersion: string;
  issuedAt: string;
  lastUpdated: string;
  revokedAt?: string;
  suspendedAt?: string;
  reissuedFrom?: string;
  reissuedTo?: string;
  currentReissue?: string;
  metadata: Record<string, any>;
  lifecycle: LifecycleEvent[];
}

export interface LifecycleEvent {
  type: string;
  timestamp: string;
  reason?: string;
  blockHeight: number;
  txId: string;
}

export interface KeyRecord {
  keyId: string;
  ownerId: string;
  publicKey: string;
  algorithm: string;
  status: 'ACTIVE' | 'RETIRED' | 'COMPROMISED' | 'ROTATED';
  registeredAt: string;
  metadata: Record<string, any>;
}

export interface ValidatorRecord {
  validatorId: string;
  publicKey: string;
  status: 'ACTIVE' | 'INACTIVE';
  addedAt: string;
}

export interface ChainState {
  issuers: Map<string, IssuerRecord>;
  credentials: Map<string, CredentialRecord>;
  keys: Map<string, KeyRecord>;
  validators: Map<string, ValidatorRecord>;
  nonces: Map<string, number>;
}

export class StateManager {
  private state: ChainState;
  private store?: StateStoreInterface;

  constructor(store?: StateStoreInterface) {
    this.store = store;
    this.state = {
      issuers: new Map(),
      credentials: new Map(),
      keys: new Map(),
      validators: new Map(),
      nonces: new Map(),
    };

    if (store) {
      const saved = store.getState();
      if (saved) {
        this.fromJSON(saved);
      }
    }
  }

  fromJSON(json: any): void {
    this.state = {
      issuers: new Map(Object.entries(json.issuers || {})),
      credentials: new Map(Object.entries(json.credentials || {})),
      keys: new Map(Object.entries(json.keys || {})),
      validators: new Map(Object.entries(json.validators || {})),
      nonces: new Map(Object.entries(json.nonces || {})),
    };
  }

  toJSON(): any {
    return {
      issuers: Object.fromEntries(this.state.issuers),
      credentials: Object.fromEntries(this.state.credentials),
      keys: Object.fromEntries(this.state.keys),
      validators: Object.fromEntries(this.state.validators),
      nonces: Object.fromEntries(this.state.nonces),
    };
  }

  persist(height: number): void {
    if (this.store) {
      this.store.putState(this.toJSON(), height);
    }
  }

  getIssuer(issuerId: string): IssuerRecord | undefined {
    return this.state.issuers.get(issuerId);
  }

  getAllIssuers(): IssuerRecord[] {
    return Array.from(this.state.issuers.values());
  }

  setIssuer(issuer: IssuerRecord): void {
    this.state.issuers.set(issuer.issuerId, issuer);
  }

  getCredential(credentialId: string): CredentialRecord | undefined {
    return this.state.credentials.get(credentialId);
  }

  getAllCredentials(): CredentialRecord[] {
    return Array.from(this.state.credentials.values());
  }

  setCredential(credential: CredentialRecord): void {
    this.state.credentials.set(credential.credentialId, credential);
  }

  getKey(keyId: string): KeyRecord | undefined {
    return this.state.keys.get(keyId);
  }

  getAllKeys(): KeyRecord[] {
    return Array.from(this.state.keys.values());
  }

  setKey(key: KeyRecord): void {
    this.state.keys.set(key.keyId, key);
  }

  getValidator(validatorId: string): ValidatorRecord | undefined {
    return this.state.validators.get(validatorId);
  }

  getValidators(): ValidatorRecord[] {
    return Array.from(this.state.validators.values());
  }

  setValidator(validator: ValidatorRecord): void {
    this.state.validators.set(validator.validatorId, validator);
  }

  isAuthorizedValidator(validatorId: string): boolean {
    const v = this.state.validators.get(validatorId);
    return v !== undefined && v.status === 'ACTIVE';
  }

  validateTransition(credentialId: string, to: CredentialStatus): LifecycleValidationResult {
    const credential = this.getCredential(credentialId);
    if (!credential) {
      return { valid: false, error: BlockchainError.UNKNOWN_CREDENTIAL };
    }
    if (!canTransition(credential.status, to)) {
      return { valid: false, error: BlockchainError.INVALID_STATE_TRANSITION };
    }
    return { valid: true };
  }

  isActiveIssuer(issuerId: string): boolean {
    const issuer = this.getIssuer(issuerId);
    return issuer !== undefined && issuer.status === 'ACTIVE';
  }

  isAuthorizedIssuer(issuerId: string, expectedIssuerId: string): boolean {
    if (issuerId !== expectedIssuerId) return false;
    return this.isActiveIssuer(issuerId);
  }

  getNonce(sender: string): number {
    return this.state.nonces.get(sender) || 0;
  }

  setNonce(sender: string, nonce: number): void {
    const current = this.getNonce(sender);
    if (nonce > current) {
      this.state.nonces.set(sender, nonce);
    }
  }

  getState(): ChainState {
    return this.state;
  }
}
