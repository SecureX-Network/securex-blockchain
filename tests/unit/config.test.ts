import {
  defaultNodeConfig,
  normalizeConfig,
  loadConfig,
  DEFAULT_GENESIS_TIMESTAMP,
  DEFAULT_PROTOCOL_VERSION,
} from '../../src/config/config';

describe('Config system', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads .env values into default config', () => {
    process.env.CTN_API_PORT = '9100';
    process.env.CTN_P2P_PORT = '9200';
    process.env.CTN_DATA_DIR = '/tmp/custom-data';
    const cfg = defaultNodeConfig();
    expect(cfg.apiPort).toBe(9100);
    expect(cfg.port).toBe(9200);
    expect(cfg.dataDir).toBe('/tmp/custom-data');
  });

  it('uses CTN_HOST / CTN_API_HOST', () => {
    process.env.CTN_HOST = '127.0.0.1';
    process.env.CTN_API_HOST = '127.0.0.1';
    const cfg = defaultNodeConfig();
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.apiHost).toBe('127.0.0.1');
  });

  it('parses validator and peer lists from comma-separated env', () => {
    process.env.CTN_VALIDATORS = 'a,b,c';
    process.env.CTN_BOOTSTRAP_NODES = 'ws://x,ws://y';
    const cfg = defaultNodeConfig();
    expect(cfg.validators).toEqual(['a', 'b', 'c']);
    expect(cfg.peers).toEqual(['ws://x', 'ws://y']);
  });

  it('defaults protocol version to 2.0', () => {
    expect(defaultNodeConfig().protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it('configures consensus, cors, request limits, and log level', () => {
    const cfg = defaultNodeConfig();
    expect(cfg.consensus.minSignatures).toBeGreaterThanOrEqual(1);
    expect(cfg.consensus.blockInterval).toBeGreaterThan(0);
    expect(cfg.cors.enabled).toBe(true);
    expect(Array.isArray(cfg.cors.allowedOrigins)).toBe(true);
    expect(cfg.requestLimitBytes).toBeGreaterThan(0);
    expect(typeof cfg.logLevel).toBe('string');
  });

  it('backs off harmless invalid env numbers to defaults', () => {
    process.env.CTN_API_PORT = 'not-a-number';
    const cfg = defaultNodeConfig();
    expect(cfg.apiPort).toBe(4001);
  });

  it('normalizeConfig fills all required fields from partial input', () => {
    const cc = normalizeConfig({
      nodeId: 'n1',
      port: 7000,
      apiPort: 7001,
      validators: ['n1'],
    });
    expect(cc.nodeId).toBe('n1');
    expect(cc.port).toBe(7000);
    expect(cc.apiPort).toBe(7001);
    expect(cc.genesisTimestamp).toBe(DEFAULT_GENESIS_TIMESTAMP);
    expect(cc.consensus.blockInterval).toBeGreaterThan(0);
    expect(cc.cors.allowedOrigins.length).toBeGreaterThan(0);
  });

  it('generate a deterministic default data dir relative to cwd', () => {
    process.env.CTN_DATA_DIR = '';
    delete process.env.CTN_DATA_DIR;
    const cfg = defaultNodeConfig();
    expect(cfg.dataDir).toContain('.ctn');
  });
});
