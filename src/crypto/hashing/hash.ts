import { createHash } from 'crypto';

export class SHA256Hasher {
  static hash(data: string): string {
    return createHash('sha256').update(data, 'utf-8').digest('hex');
  }

  static hashBuffer(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  static hashObjects(...objects: any[]): string {
    const canonical = objects.map(o => canonicalJSON(o)).join('');
    return SHA256Hasher.hash(canonical);
  }

  static verify(data: string, expectedHash: string): boolean {
    return SHA256Hasher.hash(data) === expectedHash;
  }
}

export function canonicalJSON(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
  }
  return String(obj);
}
