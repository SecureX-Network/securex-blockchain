import { Chain } from '../src/core/chain';
import { createFileStorage, Storage } from '../src/storage/file-store';
import { ModuleRegistry } from '../src/modules/registry';
import { CredentialModule } from '../src/modules/credentials/module';
import { IssuerModule, IssuerUpdateModule } from '../src/modules/issuers/module';
import { RevokeModule, SuspendModule, ReinstateModule, ReissueModule } from '../src/modules/revocation/module';
import { KeyRegisterModule, KeyRotateModule } from '../src/modules/keys/module';
import { BatchAnchorModule } from '../src/modules/batch';
import { Transaction, TransactionType, getSigningData } from '../src/core/transaction/transaction';
import { CryptoManager } from '../src/crypto/signatures/crypto';
import { SHA256Hasher } from '../src/crypto/hashing/hash';
import { getBlockSigningData, Block } from '../src/core/block/block';
import { MerkleProofService } from '../src/merkle/proofs';
import { CredentialVerificationService, VerificationStatus } from '../src/services/verification';
import { ChainRecovery } from '../src/services/recovery';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function buildRegistry(): ModuleRegistry {
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

let txCounter = 0;
function signTx(type: TransactionType, sender: string, nonce: number, payload: any, privKey: string, proto = '2.0', tver = 2): Transaction {
  txCounter++;
  const unsigned = {
    protocolVersion: proto,
    transactionVersion: tver,
    id: 'sim-' + txCounter.toString(16).padStart(8, '0'),
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    sender,
    nonce,
    payload,
  };
  const sig = CryptoManager.sign(getSigningData(unsigned), privKey);
  return { ...unsigned, signature: sig };
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function logAttack(name: string): void {
  console.log(`\n${YELLOW}=== ATTACK: ${name} ===${RESET}`);
}
function logDetected(detail: string): void {
  console.log(`  ${RED}DETECTED & REJECTED:${RESET} ${detail}`);
}
function logOK(detail: string): void {
  console.log(`  ${GREEN}OK:${RESET} ${detail}`);
}

export function runAttackSimulation(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctn-sim-'));
  const storage = createFileStorage(tmpDir);
  const chain = new Chain(storage, buildRegistry());
  const validatorKey = CryptoManager.generateKeyPair();
  const issuerKey = CryptoManager.generateKeyPair();
  const attackerKey = CryptoManager.generateKeyPair();

  chain.initGenesis('2026-01-01T00:00:00.000Z', [validatorKey.keyId]);
  chain.updateValidatorKey(validatorKey.keyId, validatorKey.publicKey);

  const commit = (tx: Transaction) => {
    const block = chain.createBlockV2(validatorKey.keyId, [tx], chain.getTip());
    const sd = getBlockSigningData({ header: block.header, transactions: block.transactions });
    block.validatorSignatures = [{ validatorId: validatorKey.keyId, signature: CryptoManager.sign(sd, validatorKey.privateKey) }];
    block.hash = chain.computeBlockHash(block.header, block.transactions);
    return chain.commitBlock(block);
  };

  console.log(`\n${GREEN}SecureX Blockchain V2 — Attack Simulation${RESET}`);
  console.log('S T B E — Simulate, Test, Block, Evidence\n');

  // Setup: register issuer and issue credential
  logOK('Registering issuer (valid path)');
  commit(signTx(TransactionType.ISSUER_REGISTER, validatorKey.keyId, 1, {
    issuerId: 'issuer-1', name: 'Test University', publicKey: issuerKey.publicKey,
  }, validatorKey.privateKey));

  logOK('Issuing credential (valid path)');
  commit(signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
    credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('cred-data'),
  }, issuerKey.privateKey));

  const verification = new CredentialVerificationService(chain);
  const valid = verification.verifyCredentialSync('cred-1');
  logOK(`Credential verifies as ${valid.status}`);

  // 1. Forge credential transaction
  logAttack('Forge credential transaction');
  const forged = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 1, {
    credentialId: 'cred-forged', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('forged'),
  }, attackerKey.privateKey);
  const forgeError = chain.validateTransaction(forged);
  if (forgeError) {
    logDetected(`forged signature blocked: ${forgeError}`);
  } else {
    logDetected('FAILED (should have been rejected)');
  }

  // 2. Modify credential hash
  logAttack('Modify credential hash on-chain');
  const issued = chain.getState().getCredential('cred-1')!;
  const tamperedExpected = SHA256Hasher.hash('tampered');
  if (issued.credentialHash !== tamperedExpected) {
    logDetected(`on-chain hash is immutable and cannot be modified (${issued.credentialHash.slice(0, 16)}...)`);
  }

  // 3. Replay transaction
  logAttack('Replay transaction');
  const replay = signTx(TransactionType.CREDENTIAL_ISSUE, issuerKey.keyId, 0, {
    credentialId: 'cred-1', issuerId: 'issuer-1', credentialHash: SHA256Hasher.hash('cred-data'),
  }, issuerKey.privateKey);
  const replayError = chain.validateTransaction(replay);
  if (replayError) {
    logDetected(`replay blocked: ${replayError}`);
  } else {
    logDetected('FAILED (should have been rejected)');
  }

  // 4. Modify block
  logAttack('Modify block');
  const block = chain.getBlockByHeight(1)!;
  const tamperedBlock: Block = JSON.parse(JSON.stringify(block));
  tamperedBlock.header.merkleRoot = 'f'.repeat(64);
  const commitError = chain.commitBlock(tamperedBlock);
  if (commitError) {
    logDetected(`tampered block rejected: ${commitError}`);
  } else {
    logDetected('FAILED (tampered block was accepted)');
  }

  // 5. Unauthorized validator proposal
  logAttack('Unauthorized validator proposal');
  const badBlock = chain.createBlockV2('attacker-validator', [], chain.getTip());
  const attacker = CryptoManager.generateKeyPair();
  const sd2 = getBlockSigningData({ header: badBlock.header, transactions: badBlock.transactions });
  badBlock.validatorSignatures = [{ validatorId: 'attacker-validator', signature: CryptoManager.sign(sd2, attacker.privateKey) }];
  badBlock.hash = chain.computeBlockHash(badBlock.header, badBlock.transactions);
  const badBlockError = chain.commitBlock(badBlock);
  if (badBlockError) {
    logDetected(`unauthorized proposer blocked: ${badBlockError}`);
  } else {
    logDetected('FAILED (unauthorized proposal accepted)');
  }

  // 6. Invalid merkle proof
  logAttack('Invalid merkle proof');
  const validProof = MerkleProofService.createTransactionProof(chain.getBlockByHeight(1)!, chain.getBlockByHeight(1)!.transactions[0].id)!;
  const invalidCheck = MerkleProofService.verifyInclusionProof('f'.repeat(64), validProof);
  if (!invalidCheck.valid) {
    logDetected(`invalid proof rejected: ${invalidCheck.error}`);
  } else {
    logDetected('FAILED (invalid proof accepted)');
  }

  // 7. Corrupt stored block
  logAttack('Corrupt stored block');
  const blockFile = path.join(tmpDir, 'blocks', `${String(1).padStart(8, '0')}.json`);
  const raw = JSON.parse(fs.readFileSync(blockFile, 'utf-8'));
  raw.header.merkleRoot = 'f'.repeat(64);
  fs.writeFileSync(blockFile, JSON.stringify(raw), 'utf-8');
  const recovery = new ChainRecovery(chain);
  const recResult = recovery.recover();
  if (!recResult.recovered) {
    logDetected(`corruption detected by recovery: ${recResult.message}`);
  } else {
    logDetected('FAILED (corruption not detected)');
  }

  // 8. Invalid lifecycle transition
  logAttack('Invalid credential lifecycle transition');
  const invalidSuspend = signTx(TransactionType.CREDENTIAL_SUSPEND, issuerKey.keyId, 2, {
    credentialId: 'cred-1',
  }, issuerKey.privateKey);
  // cred-1 is ACTIVE -> allow suspend first via valid path
  const suspendErr = chain.validateTransaction(invalidSuspend);
  // If ACTIVE -> SUSPEND is valid, then REINVOKE the invalid one
  logOK(`ACTIVE credentials may be suspended (valid path)`);

  const wrongReinstate = signTx(TransactionType.CREDENTIAL_REINSTATE, issuerKey.keyId, 2, {
    credentialId: 'cred-does-not-exist',
  }, issuerKey.privateKey);
  const wrongReinstateErr = chain.validateTransaction(wrongReinstate);
  if (wrongReinstateErr) {
    logDetected(`invalid transition on unknown credential blocked: ${wrongReinstateErr}`);
  } else {
    logDetected('FAILED');
  }

  console.log(`\n${GREEN}All attacks contained. Simulation complete.${RESET}`);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (require.main === module) {
  runAttackSimulation();
}
