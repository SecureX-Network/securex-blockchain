import { BlockValidator, TipInfo } from '../../src/core/validation/block-validator';
import { TransactionValidator } from '../../src/core/validation/tx-validator';
import { makeRegistry, makeIdentity, signTx, makeUnsignedTx, hashOf } from '../helpers';
import { StateManager } from '../../src/core/state/state';
import { TransactionType } from '../../src/core/transaction/transaction';
import { Block, getBlockSigningData, GENESIS_HASH } from '../../src/core/block/block';
import { CryptoManager } from '../../src/crypto/signatures/crypto';

describe('BlockValidator', () => {
  let registry: ReturnType<typeof makeRegistry>;
  let txValidator: TransactionValidator;
  let blockValidator: BlockValidator;
  let state: StateManager;
  let proposer: { keyPair: any; nodeId: string };

  beforeEach(() => {
    registry = makeRegistry();
    txValidator = new TransactionValidator(registry);
    blockValidator = new BlockValidator(txValidator);
    state = new StateManager();
    proposer = makeIdentity();

    state.setValidator({
      validatorId: proposer.nodeId,
      publicKey: proposer.keyPair.publicKey,
      status: 'ACTIVE',
      addedAt: new Date().toISOString(),
    });

    state.setIssuer({
      issuerId: 'uni-1',
      name: 'Test University',
      publicKey: proposer.keyPair.publicKey,
      status: 'ACTIVE',
      registeredAt: new Date().toISOString(),
      metadata: {},
    });
  });

  const signBlock = (block: Block): Block => {
    const signingData = getBlockSigningData({ header: block.header, transactions: block.transactions });
    const signature = CryptoManager.sign(signingData, proposer.keyPair.privateKey);
    return {
      ...block,
      validatorSignatures: [{ validatorId: proposer.nodeId, signature }],
    };
  };

  const completeBlock = (header: Block['header'], txs: any[]): Block => {
    return signBlock({ header, transactions: txs, validatorSignatures: [], hash: '' });
  };

  const buildBlock = (height: number, prevHash: string, txs: any[] = [], merkleRootOverride?: string): Block => {
    const merkleRoot = merkleRootOverride ?? (txs.length ? blockValidator.computeMerkleRoot(txs) : '0'.repeat(64));
    return completeBlock(
      {
        version: 1,
        height,
        timestamp: new Date().toISOString(),
        previousHash: prevHash,
        merkleRoot,
        proposerId: proposer.nodeId,
      },
      txs,
    );
  };

  test('accepts a valid block', () => {
    const tx = signTx(
      makeUnsignedTx(TransactionType.CREDENTIAL_ISSUE, proposer.nodeId, 1, {
        credentialId: 'cred-1',
        issuerId: 'uni-1',
        credentialHash: hashOf('credential-data'),
      }),
      proposer.keyPair.privateKey,
    );
    state.setNonce(proposer.nodeId, 0);

    const block = buildBlock(1, 'prev-hash', [tx]);
    const tip: TipInfo = { height: 0, hash: 'prev-hash' };
    expect(blockValidator.validate(state, block, tip)).toBeNull();
  });

  test('rejects block with unknown validator', () => {
    const block = buildBlock(1, 'prev');
    block.header.proposerId = 'nonexistent-validator';
    expect(blockValidator.validate(state, block, { height: 0, hash: 'prev' })).toBe('UNKNOWN_VALIDATOR');
  });

  test('rejects unauthorized (inactive) validator', () => {
    state.setValidator({
      validatorId: proposer.nodeId,
      publicKey: proposer.keyPair.publicKey,
      status: 'INACTIVE',
      addedAt: new Date().toISOString(),
    });
    const block = buildBlock(1, 'prev');
    expect(blockValidator.validate(state, block, { height: 0, hash: 'prev' })).toBe('UNAUTHORIZED_VALIDATOR');
  });

  test('rejects wrong previous hash', () => {
    const block = buildBlock(1, 'wrong-prev');
    expect(blockValidator.validate(state, block, { height: 0, hash: 'correct-prev' })).toBe('INVALID_PREVIOUS_HASH');
  });

  test('rejects wrong height', () => {
    const block = buildBlock(2, 'prev');
    expect(blockValidator.validate(state, block, { height: 0, hash: 'prev' })).toBe('INVALID_BLOCK_HEIGHT');
  });

  test('rejects wrong merkle root', () => {
    const tx = signTx(
      makeUnsignedTx(TransactionType.CREDENTIAL_ISSUE, proposer.nodeId, 1, {
        credentialId: 'cred-1',
        issuerId: 'uni-1',
        credentialHash: hashOf('data'),
      }),
      proposer.keyPair.privateKey,
    );
    const block = buildBlock(1, 'prev', [tx], 'f'.repeat(64));
    expect(blockValidator.validate(state, block, { height: 0, hash: 'prev' })).toBe('INVALID_MERKLE_ROOT');
  });

  test('rejects block missing proposer signature', () => {
    const block = buildBlock(1, 'prev');
    block.validatorSignatures = [];
    expect(blockValidator.validate(state, block, { height: 0, hash: 'prev' })).toBe('INVALID_PROPOSER_SIGNATURE');
  });

  test('validates genesis block rules', () => {
    const badGenesis = buildBlock(0, 'not-zero', []);
    expect(blockValidator.validate(state, badGenesis, { height: -1, hash: GENESIS_HASH })).toBe('INVALID_GENESIS_PREVIOUS_HASH');
  });

  test('invalid tx inside block is rejected', () => {
    const tx = signTx(
      makeUnsignedTx(TransactionType.CREDENTIAL_ISSUE, proposer.nodeId, 1, {
        credentialId: 'cred-1',
        issuerId: 'missing-issuer',
        credentialHash: hashOf('data'),
      }),
      proposer.keyPair.privateKey,
    );
    const block = buildBlock(1, 'prev', [tx]);
    const result = blockValidator.validate(state, block, { height: 0, hash: 'prev' });
    expect(result).toMatch(/^INVALID_TX_IN_BLOCK/);
  });
});