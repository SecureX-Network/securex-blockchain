/**
 * Fraud Engine Integration Contract.
 *
 * Repo #3: ~/ctn-fraud-engine
 *
 * The blockchain anchors cryptographic evidence derived from uploaded documents.
 * It does NOT store entire documents / PII on-chain. The fraud engine produces:
 *   - document hash
 *   - fingerprint
 *   - tampering result
 *   - risk result
 *   - evidence references
 *
 * The blockchain should anchor only the tamper-evident evidence hashes, so that a
 * verification request can prove a document corresponds to an on-chain credential.
 *
 * These types define the integration boundary. No fraud results are fabricated here.
 * This file does NOT tightly couple to repo #3; it only declares the shared shape.
 */

export interface FraudAnalysisRequest {
  /** The credential to which the evidence belongs. */
  credentialId: string;
  /** SHA-256 of the raw document bytes, computed by the fraud engine. */
  documentHash: string;
  /** Optional file fingerprint (e.g. FileType/FileFingerprint signature). */
  fingerprint?: string;
  /** Uploaded document mime type, if available. */
  mimeType?: string;
}

export interface FraudAnalysisResult {
  credentialId: string;
  documentHash: string;
  fingerprint?: string;
  /** Whether the document was modified relative to the anchored hash. */
  tamperingResult: 'CLEAN' | 'TAMPERED' | 'UNKNOWN';
  /** Overall risk classification from the fraud engine. */
  riskResult: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  riskScore?: number;
  /** References to fraud-engine evidence (report IDs, artifact URLs). */
  evidenceReferences: Array<{
    type: string;
    id: string;
    url?: string;
  }>;
  analyzedAt: string;
}

/**
 * Evidence that the blockchain can anchor for a fraud analysis. Only the
 * minimal cryptographic digest is stored on-chain; the full document and
 * fraud artifacts remain off-chain.
 */
export interface BlockchainAnchorForFraud {
  credentialId: string;
  documentHash: string;
  fingerprintHash?: string;
  anchoredAt: string;
  txId?: string;
  blockHeight?: number;
  blockHash?: string;
}

/**
 * Result of checking whether a supplied document hash matches the on-chain
 * anchor for a credential (i.e. tampering detection against the ledger).
 */
export interface TamperCheckResult {
  credentialId: string;
  suppliedHash: string;
  anchoredHash: string | null;
  hashMatch: boolean;
  /** EXACT when hashes match; TAMPERED when they differ; UNVERIFIABLE when no anchor. */
  status: 'EXACT' | 'TAMPERED' | 'UNVERIFIABLE';
  verifiedAt: string;
}
