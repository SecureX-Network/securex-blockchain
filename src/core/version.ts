export const PROTOCOL_VERSION = '2.0';
export const BLOCK_VERSION = 2;
export const TRANSACTION_VERSION = 2;

export const SUPPORTED_PROTOCOL_VERSIONS = ['1.0', '2.0'];
export const SUPPORTED_BLOCK_VERSIONS = [1, 2];
export const SUPPORTED_TRANSACTION_VERSIONS = [1, 2];

export function isSupportedProtocolVersion(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

export function isSupportedBlockVersion(version: number): boolean {
  return SUPPORTED_BLOCK_VERSIONS.includes(version);
}

export function isSupportedTransactionVersion(version: number): boolean {
  return SUPPORTED_TRANSACTION_VERSIONS.includes(version);
}
