/**
 * Authentication / Authorization boundary for the SecureX blockchain API.
 *
 * The blockchain backend MUST NOT assume the frontend is trusted. Privileged
 * operations (issuer, validator/node, administrative) are eventually expected to
 * require authenticated and authorized callers.
 *
 * This module defines the clean interface for that boundary. It does NOT hardcode
 * production credentials and does NOT implement an insecure auth scheme. Operators
 * can supply their own Authenticator implementation; a no-op default is provided
 * for the single-node/demo deployment (public verification remains open, privileged
 * writes are constricted by the underlying module validation).
 */

export type PrincipalRole =
  | 'anonymous'
  | 'issuer'
  | 'validator'
  | 'admin';

export interface Principal {
  subject: string;
  role: PrincipalRole;
  authenticated: boolean;
}

export interface AuthContext {
  principal: Principal;
  /** Additional claims the authenticator may provide. */
  claims: Record<string, unknown>;
}

export interface AuthorizationPolicy {
  verifyPublic: boolean;
  issuerWrite: boolean;
  validatorWrite: boolean;
  adminWrite: boolean;
}

export interface Authenticator {
  /**
   * Authenticate a request and produce an AuthContext. Returns null when the
   * request cannot be authenticated (anonymous).
   */
  authenticate(token?: string): Promise<AuthContext | null>;
}

/**
 * Default no-op authenticator. In the single-node / demo deployment, all
 * requests are treated as anonymous. Privileged write operations are still
 * constrained by the cryptographic module-level validation within the chain.
 *
 * To enforce a real auth layer, provide a custom Authenticator implementation
 * and wire it into the API server. Never commit real credentials.
 */
export class AnonymousAuthenticator implements Authenticator {
  async authenticate(_token?: string): Promise<AuthContext | null> {
    return {
      principal: { subject: 'anonymous', role: 'anonymous', authenticated: false },
      claims: {},
    };
  }
}

export const DEFAULT_AUTHORIZATION_POLICY: AuthorizationPolicy = {
  verifyPublic: true,
  issuerWrite: true,
  validatorWrite: true,
  adminWrite: true,
};

/**
 * Classify an endpoint path into a privileged operation category so that hosts
 * can apply 0/1 pre-authentication policy.
 */
export function classifyEndpoint(method: string, path: string): { exposed: 'public' | 'privileged'; category: 'verification' | 'issuer' | 'validator' | 'admin' } {
  if (path.startsWith('/audit')) {
    return { exposed: 'privileged', category: 'admin' };
  }
  if (path.startsWith('/state/keys')) {
    return { exposed: 'privileged', category: 'validator' };
  }
  if (path.startsWith('/state/issuers')) {
    return { exposed: 'privileged', category: 'issuer' };
  }
  if (path.startsWith('/contracts/tamper-check') || path.startsWith('/contracts/fraud') || path.includes('ISSUER')) {
    return { exposed: 'privileged', category: 'issuer' };
  }
  if (method === 'GET') {
    return { exposed: 'public', category: 'verification' };
  }
  return { exposed: 'privileged', category: 'admin' };
}
