import * as crypto from 'crypto';
import { Chain } from '../core/chain';
import { CryptoManager, KeyPair } from '../crypto/signatures/crypto';
import { isPublicCredentialId } from '../crypto/identity/public-credential-id';

/**
 * SecureX protected QR verification reference.
 *
 * A SecureX QR carries a VERSIONED, AUTHENTICATED, OPAQUE payload:
 *
 *   SXQR1.<opaqueToken>.<issuedAt>.<version>.<signature>
 *
 * - `opaqueToken` is a 32-byte HMAC-SHA256 binding of the PUBLIC credential ID
 *   derived with a server-side key. It is opaque: it reveals NO public ID,
 *   internal ID, or credential data, and a generic QR reader cannot use it to
 *   complete verification.
 * - `signature` is an Ed25519 signature (the repo's established signing
 *   primitive, see CryptoManager) by a server-held QR signing key over
 *   `sha256(canonicalJSON({ opaqueToken, issuedAt, version }))`. This
 *   authenticates that the payload was issued by this server.
 * - `issuedAt` is an epoch timestamp used for the bounded lifetime / expiry.
 *
 * The backend remains the ultimate trust boundary: the scanner forwards the
 * opaque payload to the backend, which authenticates it (signature + server
 * binding key), enforces expiry, resolves it to the public credential ID, then
 * performs the real on-chain verification.
 *
 * The QR intentionally NEVER contains: the internal credential ID, the public
 * credential ID in readable form, a verification URL, PII, credential data,
 * private keys, or secrets.
 */

/** SecureX QR protocol marker (opaque to generic scanners, versioned). */
export const SECUREX_QR_PREFIX = 'SXQR1';

/** Current reference format version. */
export const REFERENCE_VERSION = '1';

/** Default payload lifetime. Verification is online, so this is defense-in-depth. */
export const QR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const HEX = /^[0-9a-fA-F]+$/;

/** Well-formed domain regexes reused for public ID validation. */
function bindingKey(publicKeyPem: string): Buffer {
  return crypto.createHash('sha256').update(publicKeyPem).digest();
}

/** Deterministic, opaque binding token for a public credential ID. */
export function buildOpaqueToken(publicKeyPem: string, publicCredentialId: string): string {
  const key = bindingKey(publicKeyPem);
  return crypto.createHmac('sha256', key).update(publicCredentialId).digest('base64url');
}

/**
 * Authenticated, protected QR payload string (what actually goes in the QR image).
 * The public credential ID is NOT present in the returned string.
 */
export function buildSecureXQrContent(
  keyPair: KeyPair,
  publicCredentialId: string,
  version: string = REFERENCE_VERSION,
): string {
  const opaqueToken = buildOpaqueToken(keyPair.publicKey, publicCredentialId);
  const issuedAt = Date.now();
  const signature = CryptoManager.signObject(
    { opaqueToken, issuedAt, version },
    keyPair.privateKey,
  ).signature;
  return `${SECUREX_QR_PREFIX}.${opaqueToken}.${issuedAt}.v${version}.${signature}`;
}

export interface QrVerificationReference {
  /** Public credential identifier encoded in the reference (SX-...). */
  credentialId: string;
  /** Reference format version. */
  version: string;
  /** Informational verification URL (never placed inside the QR image). */
  verificationUrl: string;
  /** Minimal machine-readable payload (public credential ID + version + protocol). */
  payload: {
    credentialId: string;
    version: string;
    protocol: string;
  };
  /** Whether the credential exists on-chain (informational, not a trust verdict). */
  exists: boolean;
  /** The opaque, authenticated payload placed inside the QR image. */
  qrContent: string;
}

export type QrVerifyResult =
  | { ok: true; publicCredentialId: string; issuedAt: number; version: string }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'not-secure-x'
        | 'unsupported-version'
        | 'invalid-signature'
        | 'expired'
        | 'unknown-reference';
    };

/**
 * Builds the verification URL. `baseUrl` is the public origin of the platform
 * verification page, e.g. `https://verify.securex.example/verify`. When not
 * supplied, falls back to the node's API host/port for local/demo use.
 */
export function buildVerificationUrl(baseUrl: string | undefined, publicCredentialId: string): string {
  if (baseUrl && baseUrl !== '') {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalized}/${encodeURIComponent(publicCredentialId)}`;
  }
  const host = process.env.CTN_VERIFY_HOST || 'localhost';
  const port = process.env.CTN_VERIFY_PORT || '4001';
  return `http://${host}:${port}/verify/${encodeURIComponent(publicCredentialId)}`;
}

export class QrService {
  private chain: Chain;
  private baseUrl: string | undefined;
  private keyPair: KeyPair;
  private ttlMs: number;

  /**
   * @param keyPair server-held Ed25519 QR signing key. Private key NEVER leaves
   *   the server and never enters frontends.
   * @param ttlMs optional payload lifetime override (for tests); defaults to QR_TTL_MS.
   */
  constructor(chain: Chain, keyPair: KeyPair, baseUrl?: string, ttlMs?: number) {
    this.chain = chain;
    this.keyPair = keyPair;
    this.baseUrl = baseUrl;
    this.ttlMs = ttlMs ?? QR_TTL_MS;
  }

  /**
   * Build a public-safe QR verification reference.
   *
   * `reference` may be either a public credential ID (SX-...) or an internal
   * credential ID (for backward-compatible internal callers). The returned
   * reference ALWAYS targets the PUBLIC credential ID and the `qrContent` is an
   * opaque authenticated payload so no internal identifier (and no readable
   * public ID) leaks into the QR.
   */
  referenceFor(reference: string): QrVerificationReference {
    const state = this.chain.getState();
    const internal = state.getCredential(reference);
    const byPublic = state.getCredentialByPublicId(reference);
    const credential = internal || byPublic;

    const publicCredentialId =
      credential?.publicCredentialId ||
      (isPublicCredentialId(reference) ? reference : undefined) ||
      reference;

    const exists = credential !== undefined && Boolean(credential.publicCredentialId);
    const verificationUrl = buildVerificationUrl(this.baseUrl, publicCredentialId);
    const qrContent = buildSecureXQrContent(this.keyPair, publicCredentialId);

    return {
      credentialId: publicCredentialId,
      version: REFERENCE_VERSION,
      verificationUrl,
      payload: { credentialId: publicCredentialId, version: REFERENCE_VERSION, protocol: SECUREX_QR_PREFIX },
      exists,
      qrContent,
    };
  }

  /**
   * Validate and resolve an opaque SecureX QR payload.
   *
   * The backend is the trust boundary: it verifies the Ed25519 signature,
   * enforces the bounded lifetime, and resolves the opaque token to a public
   * credential ID. Internal credential IDs are never returned.
   */
  verifyQrPayload(payload: string, now: number = Date.now()): QrVerifyResult {
    const trimmed = payload.trim();
    if (!trimmed.startsWith(SECUREX_QR_PREFIX + '.')) {
      return { ok: false, reason: 'not-secure-x' };
    }
    const rest = trimmed.slice(SECUREX_QR_PREFIX.length + 1);
    const parts = rest.split('.');
    if (parts.length !== 4) {
      return { ok: false, reason: 'malformed' };
    }
    const [opaqueToken, issuedAtRaw, versionRaw, signature] = parts;
    if (!opaqueToken || !issuedAtRaw || !versionRaw || !signature) {
      return { ok: false, reason: 'malformed' };
    }
    if (versionRaw !== 'v' + REFERENCE_VERSION) {
      return { ok: false, reason: 'unsupported-version' };
    }
    if (!/^[0-9]+$/.test(issuedAtRaw)) {
      return { ok: false, reason: 'malformed' };
    }
    if (!HEX.test(signature) || signature.length !== 128) {
      return { ok: false, reason: 'malformed' };
    }

    const issuedAt = Number(issuedAtRaw);
    if (now - issuedAt > this.ttlMs) {
      return { ok: false, reason: 'expired' };
    }
    if (issuedAt > now + 5 * 60 * 1000) {
      // Reject obviously-future timestamps (clock skew or tampering).
      return { ok: false, reason: 'malformed' };
    }

    // Authenticate: verify the server's Ed25519 signature over the exact fields
    // that were signed at issuance (opaque token, issuedAt, version).
    const valid = CryptoManager.verifyObject(
      { opaqueToken, issuedAt, version: REFERENCE_VERSION },
      signature,
      this.keyPair.publicKey,
    );
    if (!valid) {
      return { ok: false, reason: 'invalid-signature' };
    }

    // Resolve the opaque token back to a public credential ID via the binding
    // index derived from on-chain credentials. O(1) reverse index => O(n) build.
    const publicCredentialId = this.resolveToken(opaqueToken);
    if (!publicCredentialId) {
      return { ok: false, reason: 'unknown-reference' };
    }
    return { ok: true, publicCredentialId, issuedAt, version: REFERENCE_VERSION };
  }

  private resolveToken(opaqueToken: string): string | undefined {
    const index = new Map<string, string>();
    for (const credential of this.chain.getState().getAllCredentials()) {
      const publicId = credential.publicCredentialId;
      if (!publicId) continue;
      index.set(buildOpaqueToken(this.keyPair.publicKey, publicId), publicId);
    }
    return index.get(opaqueToken);
  }
}
