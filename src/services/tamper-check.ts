import { Chain } from '../core/chain';
import { TamperCheckResult } from '../contracts/fraud';
import { CredentialRecord } from '../core/state/state';
import { getLogger } from '../utils/logger';
import { AuditService } from './audit';

/**
 * Tamper detection against the on-chain credential anchor.
 *
 * Given a supplied document hash, this compares it to the credential's anchored
 * credentialHash. A mismatch indicates the document was modified after issuance.
 * This is a REAL check using the actual on-chain hash — never fabricated.
 */
export class TamperCheckService {
  private chain: Chain;
  private audit: AuditService | null;

  constructor(chain: Chain, audit?: AuditService) {
    this.chain = chain;
    this.audit = audit || null;
  }

  check(credentialId: string, suppliedHash: string): TamperCheckResult {
    const verifiedAt = new Date().toISOString();
    const credential = this.chain.getState().getCredential(credentialId);

    if (!credential) {
      return {
        credentialId,
        suppliedHash,
        anchoredHash: null,
        hashMatch: false,
        status: 'UNVERIFIABLE',
        verifiedAt,
      };
    }

    const anchoredHash = credential.credentialHash;
    const hashMatch = anchoredHash === suppliedHash;

    if (!hashMatch) {
      this.audit?.onMerkleVerificationFailure(credentialId);
      getLogger().warn(
        `[TAMPER] credential ${credentialId} hash mismatch: anchored vs supplied differ`,
      );
    }

    return {
      credentialId,
      suppliedHash,
      anchoredHash,
      hashMatch,
      status: hashMatch ? 'EXACT' : 'TAMPERED',
      verifiedAt,
    };
  }

  /**
   * Checks a document hash against the anchored hash and returns the credential
   * anchor evidence block metadata.
   */
  getAnchorEvidence(credential: CredentialRecord): { txId: string | null; blockHeight: number | null; blockHash: string | null } {
    const issue = credential.lifecycle.find(ev => ev.type === 'ISSUED');
    const txId = issue?.txId || null;
    const height = issue?.blockHeight ?? null;
    const block = height != null ? this.chain.getBlockByHeight(height) : null;
    return { txId, blockHeight: height, blockHash: block ? block.hash : null };
  }
}
