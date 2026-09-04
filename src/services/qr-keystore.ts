import * as fs from 'fs';
import * as path from 'path';
import { CryptoManager, KeyPair } from '../crypto/signatures/crypto';

/**
 * Server-side custody of the SecureX QR signing key.
 *
 * The protected SecureX QR payload is authenticated with an Ed25519 signature
 * using a server-held key. This store keeps that key on the BACKEND ONLY —
 * the private key never leaves the server and never enters frontends or QR
 * payloads. The public key is used to verify QR payloads; the derived binding
 * key (HMAC over the public key) makes the opaque token resolvable.
 *
 * The key is loaded from a directory on disk (default `.../issuers/qr-key`)
 * and created + persisted (private key mode 0600) on first boot so it is
 * stable across restarts (never regenerated per boot, which would invalidate
 * previously issued QRs).
 */
export class QrSigningKeyStore {
  private keyPair: KeyPair;

  constructor(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const existing = CryptoManager.loadKeyPair(dir);
    if (existing) {
      this.keyPair = existing;
      return;
    }
    this.keyPair = CryptoManager.generateKeyPair();
    CryptoManager.saveKeyPair(this.keyPair, dir);
  }

  get pubKey(): string {
    return this.keyPair.publicKey;
  }

  get keyPairRef(): KeyPair {
    return this.keyPair;
  }
}
