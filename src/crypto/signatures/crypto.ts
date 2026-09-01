import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalJSON } from '../hashing/hash';

export interface KeyPair {
  publicKey: string;
  privateKey: string;
  keyId: string;
}

export interface SignatureResult {
  signature: string;
  publicKey: string;
}

export class CryptoManager {
  static generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const keyId = CryptoManager.deriveNodeId(publicKey);

    return { publicKey, privateKey, keyId };
  }

  static deriveNodeId(publicKeyPem: string): string {
    return crypto.createHash('sha256').update(publicKeyPem).digest('hex').substring(0, 64);
  }

  static sign(data: string, privateKeyPem: string): string {
    return crypto.sign(null, Buffer.from(data, 'utf-8'), privateKeyPem).toString('hex');
  }

  static verify(data: string, signature: string, publicKeyPem: string): boolean {
    try {
      return crypto.verify(
        null,
        Buffer.from(data, 'utf-8'),
        publicKeyPem,
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  static signObject(obj: any, privateKeyPem: string): SignatureResult {
    const hash = crypto.createHash('sha256').update(canonicalJSON(obj)).digest('hex');
    const signature = CryptoManager.sign(hash, privateKeyPem);
    return { signature, publicKey: '' };
  }

  static verifyObject(obj: any, signature: string, publicKeyPem: string): boolean {
    const hash = crypto.createHash('sha256').update(canonicalJSON(obj)).digest('hex');
    return CryptoManager.verify(hash, signature, publicKeyPem);
  }

  static saveKeyPair(keyPair: KeyPair, dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'public.pem'), keyPair.publicKey, 'utf-8');
    fs.writeFileSync(path.join(dir, 'private.pem'), keyPair.privateKey, { encoding: 'utf-8', mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'key-id'), keyPair.keyId, 'utf-8');
  }

  static loadKeyPair(dir: string): KeyPair | null {
    const pubPath = path.join(dir, 'public.pem');
    const privPath = path.join(dir, 'private.pem');
    const idPath = path.join(dir, 'key-id');

    if (!fs.existsSync(pubPath) || !fs.existsSync(privPath)) return null;

    return {
      publicKey: fs.readFileSync(pubPath, 'utf-8'),
      privateKey: fs.readFileSync(privPath, 'utf-8'),
      keyId: fs.existsSync(idPath) ? fs.readFileSync(idPath, 'utf-8') : '',
    };
  }

  static publicKeyToHex(pem: string): string {
    const lines = pem.split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const b64 = lines.join('');
    return Buffer.from(b64, 'base64').toString('hex');
  }
}