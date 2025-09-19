import { expect } from 'chai';
import { loadConfig } from '../../src/config';

describe('Config ABI Fallback Support', () => {
  beforeEach(() => {
    // Clean environment
    delete process.env.USE_ABI_PENDING_FALLBACK;
  });

  afterEach(() => {
    // Clean environment
    delete process.env.USE_ABI_PENDING_FALLBACK;
  });

  it('should default useAbiPendingFallback to true', () => {
    // Setup minimal required env vars for config loading
    process.env.RPC_URL_HTTP = 'http://localhost:8545';
    process.env.RPC_URL_WS = 'ws://localhost:8546';
    process.env.PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
    process.env.CHAIN = 'ethereum';
    process.env.DRY_RUN = 'true';
    
    const config = loadConfig();
    expect(config.useAbiPendingFallback).to.be.true;
  });

  it('should respect USE_ABI_PENDING_FALLBACK=false', () => {
    process.env.USE_ABI_PENDING_FALLBACK = 'false';
    process.env.RPC_URL_HTTP = 'http://localhost:8545';
    process.env.RPC_URL_WS = 'ws://localhost:8546';
    process.env.PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
    process.env.CHAIN = 'ethereum';
    process.env.DRY_RUN = 'true';
    
    const config = loadConfig();
    expect(config.useAbiPendingFallback).to.be.false;
  });

  it('should respect USE_ABI_PENDING_FALLBACK=true', () => {
    process.env.USE_ABI_PENDING_FALLBACK = 'true';
    process.env.RPC_URL_HTTP = 'http://localhost:8545';
    process.env.RPC_URL_WS = 'ws://localhost:8546';
    process.env.PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
    process.env.CHAIN = 'ethereum';
    process.env.DRY_RUN = 'true';
    
    const config = loadConfig();
    expect(config.useAbiPendingFallback).to.be.true;
  });
});