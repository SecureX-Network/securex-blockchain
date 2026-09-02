import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { canonicalJSON } from '../../crypto/hashing/hash';
import { PROTOCOL_VERSION, TRANSACTION_VERSION } from '../version';

export enum TransactionType {
  ISSUER_REGISTER = 'ISSUER_REGISTER',
  ISSUER_UPDATE = 'ISSUER_UPDATE',
  CREDENTIAL_ISSUE = 'CREDENTIAL_ISSUE',
  CREDENTIAL_REVOKE = 'CREDENTIAL_REVOKE',
  CREDENTIAL_SUSPEND = 'CREDENTIAL_SUSPEND',
  CREDENTIAL_REINSTATE = 'CREDENTIAL_REINSTATE',
  CREDENTIAL_REISSUE = 'CREDENTIAL_REISSUE',
  KEY_REGISTER = 'KEY_REGISTER',
  KEY_ROTATE = 'KEY_ROTATE',
  BATCH_ANCHOR = 'BATCH_ANCHOR',
}

export const ALL_TRANSACTION_TYPES = Object.values(TransactionType);

export interface TransactionPayload {
  [key: string]: any;
}

export interface Transaction {
  protocolVersion: string;
  transactionVersion: number;
  id: string;
  type: TransactionType;
  timestamp: string;
  sender: string;
  nonce: number;
  payload: TransactionPayload;
  signature: string;
}

export interface UnsignedTransaction {
  protocolVersion: string;
  transactionVersion: number;
  id: string;
  type: TransactionType;
  timestamp: string;
  sender: string;
  nonce: number;
  payload: TransactionPayload;
}

export function createTransactionId(): string {
  return uuidv4();
}

export function getSigningData(tx: UnsignedTransaction): string {
  return canonicalJSON({
    protocolVersion: tx.protocolVersion,
    transactionVersion: tx.transactionVersion,
    id: tx.id,
    type: tx.type,
    timestamp: tx.timestamp,
    sender: tx.sender,
    nonce: tx.nonce,
    payload: tx.payload,
  });
}

export function computeTransactionHash(tx: Transaction): string {
  const hashData = canonicalJSON({
    protocolVersion: tx.protocolVersion,
    transactionVersion: tx.transactionVersion,
    id: tx.id,
    type: tx.type,
    timestamp: tx.timestamp,
    sender: tx.sender,
    nonce: tx.nonce,
    payload: tx.payload,
  });
  return createHash('sha256').update(hashData).digest('hex');
}

export function buildTransaction(
  type: TransactionType,
  sender: string,
  nonce: number,
  payload: TransactionPayload,
  signature: string,
  id?: string,
): Transaction {
  return {
    protocolVersion: '1.0',
    transactionVersion: 1,
    id: id || createTransactionId(),
    type,
    timestamp: new Date().toISOString(),
    sender,
    nonce,
    payload,
    signature,
  };
}

export function buildV2Transaction(
  type: TransactionType,
  sender: string,
  nonce: number,
  payload: TransactionPayload,
  signature: string,
  id?: string,
): Transaction {
  return {
    protocolVersion: PROTOCOL_VERSION,
    transactionVersion: TRANSACTION_VERSION,
    id: id || createTransactionId(),
    type,
    timestamp: new Date().toISOString(),
    sender,
    nonce,
    payload,
    signature,
  };
}
