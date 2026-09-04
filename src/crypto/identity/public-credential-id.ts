import { randomBytes } from 'crypto';

/**
 * Public Credential Verification ID.
 *
 * A public credential is identified by a stable, user-facing verification
 * reference that is DISTINCT from the internal credential ID (e.g.
 * `sxu-btech-2026-0001`). The public ID is what appears in public URLs, QR
 * codes, and printed credentials.
 *
 * Format: `SX-XXXX-XXXX-XXXX` where X is an uppercase hexadecimal character.
 *
 * Example: `SX-2F9C-A41B-8D7E`
 *
 * Properties:
 *   - cryptographically random (Node `crypto.randomBytes` — CSPRNG, NOT
 *     Math.random() and never timestamp/sequence derived)
 *   - non-sequential
 *   - globally unique in practice (12 hex chars = 48 bits of entropy); the
 *     persistence layer additionally enforces uniqueness with collision
 *     regeneration
 *   - immutable after issuance
 *   - never derived from the internal credential ID, holder, or metadata
 *   - safe to expose publicly
 */

export const PUBLIC_CREDENTIAL_ID_PREFIX = 'SX-';

/** Matches the canonical public credential ID format (uppercase hex groups). */
export const PUBLIC_CREDENTIAL_ID_REGEX = /^SX-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

const HEX_CHARS = '0123456789ABCDEF';
const GROUP_LENGTH = 4;
const GROUP_COUNT = 3;
const TOTAL_HEX_CHARS = GROUP_LENGTH * GROUP_COUNT; // 12 hex chars = 48 bits

/**
 * Generate a single uppercase-hex character from a cryptographically secure
 * source without modulo bias (rejection sampling).
 */
function randomLowercaseHexMap(): string[] {
  // Roll 12 hex chars, grouped.
  const chars: string[] = [];
  while (chars.length < TOTAL_HEX_CHARS) {
    const byte = randomBytes(1)[0];
    const value = byte % 16;
    chars.push(HEX_CHARS[value]);
  }
  return chars;
}

/**
 * Generate a new public credential ID.
 *
 * Returns a string of the form `SX-XXXX-XXXX-XXXX` from a CSPRNG. Callers are
 * responsible for enforcing global uniqueness at the persistence layer (see
 * StateManager) and regenerating on the rare collision.
 */
export function generatePublicCredentialId(): string {
  const chars = randomLowercaseHexMap();
  const groups: string[] = [];
  for (let g = 0; g < GROUP_COUNT; g++) {
    groups.push(chars.slice(g * GROUP_LENGTH, (g + 1) * GROUP_LENGTH).join(''));
  }
  return `${PUBLIC_CREDENTIAL_ID_PREFIX}${groups.join('-')}`;
}

/**
 * Validate whether a value is a well-formed public credential ID.
 * The check is format-only and does not confirm the ID exists on-chain.
 */
export function isPublicCredentialId(value: string): boolean {
  return PUBLIC_CREDENTIAL_ID_REGEX.test(value);
}
