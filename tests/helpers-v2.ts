import { Chain } from '../src/core/chain';
import { createFileStorage, Storage } from '../src/storage/file-store';
import { ModuleRegistry } from '../src/modules/registry';
import { CredentialModule } from '../src/modules/credentials/module';
import { IssuerModule, IssuerUpdateModule } from '../src/modules/issuers/module';
import { RevokeModule, SuspendModule, ReinstateModule, ReissueModule } from '../src/modules/revocation/module';
import { KeyRegisterModule, KeyRotateModule } from '../src/modules/keys/module';
import { BatchAnchorModule } from '../src/modules/batch';
import { Transaction, TransactionType, getSigningData } from '../src/core/transaction/transaction';
import { CryptoManager, KeyPair } from '../src/crypto/signatures/crypto';
import { SHA256Hasher } from '../src/crypto/hashing/hash';
import { getBlockSigningData } from '../src/core/block/block';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function buildV2Registry(): ModuleRegistry {
  const r = new ModuleRegistry();
  r.register(new CredentialModule());
  r.register(new IssuerModule());
  r.register(new IssuerUpdateModule());
  r.register(new RevokeModule());
  r.register(new SuspendModule());
  r.register(new ReinstateModule());
  r.register(new ReissueModule());
  r.register(new KeyRegisterModule());
  r.register(new KeyRotateModule());
  r.register(new BatchAnchorModule());
  return r;
}

export function signV2Tx(
  type: TransactionType,
  sender: string,
  nonce: number,
  payload: any,
  privKey: string,
): Transaction {
  const unsigned = {
    protocolVersion: '2.0',
    transactionVersion: 2,
    id: require('crypto').randomBytes(16).toString('hex'),
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    sender,
    nonce,
    payload,
  };
  const sig = CryptoManager.sign(getSigningData(unsigned), privKey);
  return { ...unsigned, signature: sig };
}

export interface TestChain {
  chain: Chain;
  storage: Storage;
  tmpDir: string;
  validatorKey: KeyPair;
  commit: (tx: Transaction, proposerId?: string, proposerKey?: string) => void;
  resetNonceLog: () => void;
}

export function setupV2TestChain(): TestChain {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-v2x-'));
  const storage = createFileStorage(tmpDir);
  const chain = new Chain(storage, buildV2Registry());
  chain.initGenesis('2026-01-01T00:00:00.000Z', ['validator-1']);
  const validatorKey = CryptoManager.generateKeyPair();
  chain.updateValidatorKey('validator-1', validatorKey.publicKey);

  const commit = (tx: Transaction, proposerId = 'validator-1', proposerKey?: string) => {
    const key = proposerKey || validatorKey.privateKey;
    const block = chain.createBlockV2(proposerId, [tx], chain.getTip());
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: proposerId, signature: CryptoManager.sign(sd, key) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    const err = chain.commitBlock(block);
    if (err) throw new Error(`commit failed: ${err}`);
  };

  return { chain, storage, tmpDir, validatorKey, commit, resetNonceLog: () => {} };
}

export function cleanupV2TestChain(tc: TestChain): void {
  try {
    fs.rmSync(tc.tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function hashOf(data: string): string {
  return SHA256Hasher.hash(data);
}
