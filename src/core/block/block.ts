import { Transaction } from '../transaction/transaction';

export const GENESIS_HASH = '0'.repeat(64);

export interface ValidatorSignature {
  validatorId: string;
  signature: string;
}

export interface BlockHeader {
  version: number;
  height: number;
  timestamp: string;
  previousHash: string;
  merkleRoot: string;
  proposerId: string;
}

export interface Block {
  header: BlockHeader;
  transactions: Transaction[];
  validatorSignatures: ValidatorSignature[];
  hash: string;
}

export interface UnsignedBlock {
  header: BlockHeader;
  transactions: Transaction[];
}

export function getBlockSigningData(block: UnsignedBlock): string {
  return JSON.stringify({
    version: block.header.version,
    height: block.header.height,
    timestamp: block.header.timestamp,
    previousHash: block.header.previousHash,
    merkleRoot: block.header.merkleRoot,
    proposerId: block.header.proposerId,
  });
}
