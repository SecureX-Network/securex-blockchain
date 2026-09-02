/**
 * Platform Integration Contract (Repo #1 -> Repo #2).
 *
 * The SecureX platform frontend (Repo #1: ~/ctn-platform) should eventually consume
 * REAL blockchain-backed data for issuers, credentials, verification, blocks,
 * transactions, validators, network status, security evidence, and audit events.
 *
 * This contract documents the expected shapes and the REAL vs DEMO behavior.
 * It does NOT modify Repo #2. The blockchain backend is the source of truth.
 */

/**
 * Universal API response envelope returned by all endpoints.
 */
export interface PlatformEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    requestId: string;
    nodeId: string;
    protocolVersion: string;
  };
}

export interface PlatformIssuer {
  issuerId: string;
  name: string;
  publicKey: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  registeredAt: string;
  metadata: Record<string, unknown>;
}

export interface PlatformCredential {
  credentialId: string;
  issuerId: string;
  credentialHash: string;
  status: 'CREATED' | 'ISSUED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED' | 'REISSUED';
  schemaVersion: string;
  issuedAt: string;
  lastUpdated: string;
  revokedAt?: string;
  suspendedAt?: string;
  reissuedFrom?: string;
  reissuedTo?: string;
  metadata: Record<string, unknown>;
  lifecycle: PlatformLifecycleEvent[];
}

export interface PlatformLifecycleEvent {
  type: string;
  timestamp: string;
  reason?: string;
  blockHeight: number;
  txId: string;
}

export interface PlatformVerificationResult {
  status: 'VALID' | 'REVOKED' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'NOT_FOUND' | 'UNVERIFIABLE';
  credentialId?: string;
  issuer?: PlatformIssuer;
  proofValid?: boolean;
  issuerSignatureValid?: boolean;
  error?: string;
  errorMessage?: string;
}

export interface PlatformBlock {
  height: number;
  hash: string;
  previousHash: string;
  timestamp: string;
  merkleRoot: string;
  proposer: string;
  version: number;
  transactionCount: number;
}

export interface PlatformValidator {
  validatorId: string;
  publicKey: string;
  status: 'ACTIVE' | 'INACTIVE';
  addedAt: string;
}

export interface PlatformNetworkStatus {
  nodeId: string;
  height: number;
  peerCount: number;
  validators: number;
  currentProposer: string | null;
  pendingTransactions: number;
  status: 'RUNNING';
  protocolVersion: string;
}

export interface PlatformSecurityEvidence {
  credentialId: string;
  verified: boolean;
  blockHeight: number | null;
  blockHash: string | null;
  merkleProofValid: boolean | null;
  issuerValid: boolean | null;
  verifiedAt: string | null;
  message: string;
}

/**
 * REAL vs DEMO behavior contract.
 *
 * REAL endpoints reflect actual blockchain state derived from validated,
 * committed transactions. They are never synthesized from frontend mocks.
 *
 * DEMO data is inserted ONLY through the real transaction pipeline by the
 * demo-data generator and is identifiers as demo (issuer names prefixed with
 * "SecureX Demo ..."). The frontend MUST visually distinguish demo records and
 * MUST NOT present them as real-world institutional data.
 */
export type RealVsDemo = 'REAL' | 'DEMO';
