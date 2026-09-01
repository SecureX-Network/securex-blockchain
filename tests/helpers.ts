import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createFileStorage, Storage } from '../src/storage/file-store';
import { StateManager } from '../src/core/state/state';
import { ModuleRegistry } from '../src/modules/registry';
import { CredentialModule } from '../src/modules/credentials/module';
import { IssuerModule, IssuerUpdateModule } from '../src/modules/issuers/module';
import { RevokeModule, SuspendModule, ReinstateModule, ReissueModule } from '../src/modules/revocation/module';
import { KeyRegisterModule, KeyRotateModule } from '../src/modules/keys/module';
import { TransactionValidator } from '../src/core/validation/tx-validator';
import { CryptoManager } from '../src/crypto/signatures/crypto';
import { Transaction, TransactionType, getSigningData } from '../src/core/transaction/transaction';

let tmpCounter = 0;

export function makeTempDir(label: string): string {
  const dir = path.join(os.tmpdir(), `ctn-${label}-${process.pid}-${tmpCounter++}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function makeStorage(label: string): Storage {
  return createFileStorage(makeTempDir(label));
}

export function makeRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register(new CredentialModule());
  registry.register(new IssuerModule());
  registry.register(new IssuerUpdateModule());
  registry.register(new RevokeModule());
  registry.register(new SuspendModule());
  registry.register(new ReinstateModule());
  registry.register(new ReissueModule());
  registry.register(new KeyRegisterModule());
  registry.register(new KeyRotateModule());
  return registry;
}

export interface TestIdentity {
  keyPair: ReturnType<typeof CryptoManager.generateKeyPair>;
  nodeId: string;
}

export function makeIdentity(): TestIdentity {
  const keyPair = CryptoManager.generateKeyPair();
  return { keyPair, nodeId: keyPair.keyId };
}

export function makeState(): StateManager {
  return new StateManager();
}

export function getValidator(registry: ModuleRegistry): TransactionValidator {
  return new TransactionValidator(registry);
}

export function signTx(
  tx: Omit<Transaction, 'signature'>,
  privateKey: string,
): Transaction {
  return {
    ...tx,
    signature: CryptoManager.sign(
      getSigningData({
        protocolVersion: tx.protocolVersion,
        transactionVersion: tx.transactionVersion,
        id: tx.id,
        type: tx.type,
        timestamp: tx.timestamp,
        sender: tx.sender,
        nonce: tx.nonce,
        payload: tx.payload,
      }),
      privateKey,
    ),
  };
}

export function makeUnsignedTx(
  type: TransactionType,
  sender: string,
  nonce: number,
  payload: Record<string, any>,
): Omit<Transaction, 'signature'> {
  return {
    protocolVersion: '1.0',
    transactionVersion: 1,
    id: require('uuid').v4(),
    type,
    timestamp: new Date().toISOString(),
    sender,
    nonce,
    payload,
  };
}

export const hashOf = (data: string): string =>
  require('crypto').createHash('sha256').update(data).digest('hex');