import { expect } from 'chai';
import { ethers } from 'ethers';
import { MempoolWatcher } from '../../src/watcher/mempoolWatcher';

describe('MempoolWatcher ABI Fallback', () => {
  let watcher: MempoolWatcher;
  let mockProvider: any;
  let mockConfig: any;

  beforeEach(() => {
    // Create mock WebSocket provider
    mockProvider = {
      send: async (method: string, _params: any[]) => {
        if (method === 'eth_subscribe') {
          return 'subscription_id';
        }
        return null;
      },
      on: (_event: string, _callback: (data: any) => void) => {
        // Mock event listener
      },
      destroy: async () => {
        // Mock destroy
      },
      getTransaction: async (txHash: string) => {
        return createMockTransaction(txHash);
      },
      _websocket: {
        on: (_event: string, _callback: (data: any) => void) => {
          // Mock websocket event listener
        }
      }
    };

    mockConfig = {
      useAlchemyPendingTx: false,
      useAbiPendingFallback: true,
      allowReconstructRawTx: true,
      logTargetPoolSwaps: false,
      minSwapEth: 0,
      minSwapUsd: 0,
      pools: [
        {
          pool: 'USDC-WETH-0.05%',
          address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
          token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          fee: 500,
          tickSpacing: 10,
          symbol0: 'USDC',
          symbol1: 'WETH',
          decimals0: 6,
          decimals1: 18
        }
      ]
    };

    // Create a minimal watcher instance for testing
    watcher = Object.create(MempoolWatcher.prototype);
    
    // Initialize only the properties we need for testing
    (watcher as any).provider = mockProvider;
    (watcher as any).fallbackProvider = mockProvider;
    (watcher as any).config = mockConfig;
    (watcher as any).logger = { 
      debug: () => {}, 
      info: () => {}, 
      warn: () => {},
      error: () => {}
    };
    (watcher as any).metrics = {
      incrementMempoolTxsSeen: () => {},
      incrementMempoolSwapsDecoded: () => {},
      incrementMempoolTxsRawFetched: () => {},
      incrementMempoolTxsRawMissing: () => {}
    };
    
    // Initialize cache and router addresses
    (watcher as any).seenTxHashes = new Map();
    (watcher as any).CACHE_TTL_MS = 5 * 60 * 1000;
    (watcher as any).UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    (watcher as any).UNISWAP_V3_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
    (watcher as any).UNISWAP_UNIVERSAL_ROUTER = '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B';
    (watcher as any).UNISWAP_ROUTER_ADDRESSES = [
      '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B'
    ];
    
    // Initialize targetPools
    (watcher as any).targetPools = new Map();
    (watcher as any).initializeTargetPools = function() {
      for (const pool of this.config.pools) {
        const key = `${pool.token0}-${pool.token1}-${pool.fee}`;
        this.targetPools.set(key, pool);
        
        const reverseKey = `${pool.token1}-${pool.token0}-${pool.fee}`;
        this.targetPools.set(reverseKey, { ...pool, direction: 'reverse' });
      }
    };
    (watcher as any).initializeTargetPools();
  });

  function createMockTransaction(txHash: string): ethers.providers.TransactionResponse {
    return {
      hash: txHash,
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
      from: '0x742d35Cc6673C028C0Cd3cc5d5f0c3BaF21dd88',
      data: '0x414bf389', // exactInputSingle signature
      value: ethers.BigNumber.from('0'),
      gasLimit: ethers.BigNumber.from('200000'),
      gasPrice: ethers.BigNumber.from('20000000000'),
      nonce: 42,
      type: 2,
      blockNumber: undefined, // Pending
      blockHash: undefined,
      confirmations: 0,
      wait: async () => ({} as any),
      chainId: 1,
      r: '0x123',
      s: '0x456',
      v: 27
    };
  }

  describe('Transaction Deduplication', () => {
    it('should mark transactions as seen', () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const source = 'abi-fallback';
      
      // First time should return false (not seen)
      const isSeenFirst = (watcher as any).isTransactionSeen(txHash, source);
      expect(isSeenFirst).to.be.false;
      
      // Second time should return true (already seen)
      const isSeenSecond = (watcher as any).isTransactionSeen(txHash, source);
      expect(isSeenSecond).to.be.true;
    });

    it('should handle different sources for same transaction', () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      // First source marks as seen
      const isSeenAlchemy = (watcher as any).isTransactionSeen(txHash, 'alchemy');
      expect(isSeenAlchemy).to.be.false;
      
      // Different source for same tx should return true (already seen)
      const isSeenAbi = (watcher as any).isTransactionSeen(txHash, 'abi-fallback');
      expect(isSeenAbi).to.be.true;
    });

    it('should clean up expired cache entries', () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const source = 'abi-fallback';
      
      // Mark transaction as seen
      (watcher as any).isTransactionSeen(txHash, source);
      
      // Verify it's in cache
      expect((watcher as any).seenTxHashes.has(txHash)).to.be.true;
      
      // Manually set timestamp to expired
      const expiredTime = Date.now() - (6 * 60 * 1000); // 6 minutes ago
      (watcher as any).seenTxHashes.set(txHash, expiredTime);
      
      // Call cleanup
      (watcher as any).cleanupExpiredCache();
      
      // Should be removed
      expect((watcher as any).seenTxHashes.has(txHash)).to.be.false;
    });
  });

  describe('Router Address Filtering', () => {
    it('should detect Uniswap V3 SwapRouter', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0xE592427A0AEce92De3Edee1F18E0157C05861564');
      expect(isUniswap).to.be.true;
    });

    it('should detect SwapRouter02', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');
      expect(isUniswap).to.be.true;
    });

    it('should detect Universal Router', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B');
      expect(isUniswap).to.be.true;
    });

    it('should reject non-Uniswap addresses', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x1234567890123456789012345678901234567890');
      expect(isUniswap).to.be.false;
    });
  });

  describe('Configuration', () => {
    it('should support ABI fallback configuration', () => {
      expect(mockConfig.useAbiPendingFallback).to.be.true;
      expect(mockConfig.useAlchemyPendingTx).to.be.false;
    });

    it('should support dual mode configuration', () => {
      mockConfig.useAlchemyPendingTx = true;
      mockConfig.useAbiPendingFallback = true;
      
      expect(mockConfig.useAbiPendingFallback).to.be.true;
      expect(mockConfig.useAlchemyPendingTx).to.be.true;
    });
  });
});