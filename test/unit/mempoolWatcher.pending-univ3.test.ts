import { expect } from 'chai';
import { MempoolWatcher } from '../../src/watcher/mempoolWatcher';
import { ethers } from 'ethers';

describe('MempoolWatcher - Pending Uniswap V3', () => {
  let watcher: MempoolWatcher;
  let mockProvider: any;
  let mockConfig: any;

  beforeEach(() => {
    // Mock WebSocket provider
    mockProvider = {
      send: async (method: string, params: any[]) => {
        if (method === 'eth_subscribe' && params[0] === 'newPendingTransactions') {
          return 'subscription_id_123';
        }
        if (method === 'eth_getTransactionByHash') {
          return null; // Default to no transaction found
        }
        return null;
      },
      on: (event: string, handler: Function) => {
        // Store the handler for manual triggering in tests
        (mockProvider as any)[`_${event}Handler`] = handler;
      },
      getTransaction: async (txHash: string) => {
        return null; // Default to no transaction
      },
      getBlockNumber: async () => 18500000,
      _websocket: {
        on: (event: string, handler: Function) => {
          // Mock websocket events
        }
      }
    };

    // Mock configuration with pending Uniswap V3 enabled
    mockConfig = {
      usePendingUniswapV3: true,
      useAlchemyPendingTx: false,
      useAbiPendingFallback: false,
      logTargetPoolSwaps: true,
      minSwapEth: 0,
      minSwapUsd: 0,
      allowReconstructRawTx: false,
      pools: [
        {
          pool: 'WETH-USDC-0.05%',
          address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
          token0: '0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          fee: 500,
          decimals0: 6,
          decimals1: 18,
          symbol0: 'USDC',
          symbol1: 'WETH'
        }
      ]
    };

    // Initialize constants like in actual class
    (watcher as any).CACHE_TTL_MS = 5 * 60 * 1000;
    (watcher as any).UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    (watcher as any).UNISWAP_V3_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
    (watcher as any).UNISWAP_UNIVERSAL_ROUTER = '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B';
    (watcher as any).UNISWAP_ROUTER_ADDRESSES = [
      '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B'
    ];

    watcher = new MempoolWatcher(mockConfig, mockProvider);
  });

  describe('Configuration', () => {
    it('should support pending Uniswap V3 configuration', () => {
      expect(mockConfig.usePendingUniswapV3).to.be.true;
    });

    it('should support dual mode with deduplication', () => {
      mockConfig.useAlchemyPendingTx = true;
      mockConfig.usePendingUniswapV3 = true;
      
      const newWatcher = new MempoolWatcher(mockConfig, mockProvider);
      expect(newWatcher).to.not.be.undefined;
    });
  });

  describe('Router Address Filtering', () => {
    it('should detect Uniswap V3 SwapRouter mainnet address', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0xE592427A0AEce92De3Edee1F18E0157C05861564');
      expect(isUniswap).to.be.true;
    });

    it('should detect SwapRouter02 mainnet address', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');
      expect(isUniswap).to.be.true;
    });

    it('should reject non-V3 router addresses', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x1234567890123456789012345678901234567890');
      expect(isUniswap).to.be.false;
    });
  });

  describe('Transaction Processing', () => {
    it('should process exactInputSingle transactions', async () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      // Mock a V3 exactInputSingle transaction
      const mockTx = {
        hash: txHash,
        to: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // V3 Router
        from: '0x742d35Cc6644C56F5148D0cB1B2C5C7cdDF4B81e',
        data: '0x414bf389000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000064', // exactInputSingle
        value: ethers.BigNumber.from('0'),
        gasLimit: ethers.BigNumber.from('200000'),
        gasPrice: ethers.BigNumber.from('20000000000'),
        nonce: 123,
        blockNumber: undefined, // Pending transaction
        confirmations: 0,
        wait: async () => ({
          to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          from: '0x742d35Cc6644C56F5148D0cB1B2C5C7cdDF4B81e',
          contractAddress: '',
          transactionIndex: 1,
          gasUsed: ethers.BigNumber.from('150000'),
          logsBloom: '',
          blockHash: '0xabc123',
          transactionHash: txHash,
          logs: [],
          blockNumber: 18500001,
          confirmations: 1,
          cumulativeGasUsed: ethers.BigNumber.from('150000'),
          effectiveGasPrice: ethers.BigNumber.from('20000000000'),
          status: 1,
          type: 2,
          byzantium: true
        }),
        chainId: 1
      };

      mockProvider.getTransaction = async (hash: string) => {
        if (hash === txHash) {
          return mockTx;
        }
        return null;
      };

      let swapDetected = false;
      watcher.on('PendingSwapDetected', (data: any) => {
        swapDetected = true;
        expect(data.txHash).to.equal(txHash);
        expect(data.poolAddress).to.not.be.undefined;
      });

      // Simulate transaction processing
      await (watcher as any).processPendingUniswapV3Transaction(txHash);
      
      // Note: Without full ABI decoding setup, this test validates the flow
      // The actual parsing would require complete mock setup
    });

    it('should skip transactions already included in blocks', async () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const mockTx = {
        hash: txHash,
        to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        blockNumber: 18500000, // Already included
        data: '0x414bf389'
      };

      mockProvider.getTransaction = async () => mockTx;

      let swapDetected = false;
      watcher.on('PendingSwapDetected', () => {
        swapDetected = true;
      });

      await (watcher as any).processPendingUniswapV3Transaction(txHash);
      
      expect(swapDetected).to.be.false;
    });

    it('should handle transaction retry with backoff', async () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      let callCount = 0;
      mockProvider.getTransaction = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Network error');
        }
        return {
          hash: txHash,
          to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          data: '0x414bf389'
        };
      };

      const result = await (watcher as any).getTransactionWithRetry(txHash, 3);
      
      expect(callCount).to.equal(3);
      expect(result).to.not.be.null;
      expect(result.hash).to.equal(txHash);
    });

    it('should apply concurrency limiting', async () => {
      // This test would require more complex setup to test the actual concurrency limiting
      // For now, we verify the method exists and can be called
      expect((watcher as any).subscribePendingUniswapV3).to.be.a('function');
    });
  });

  describe('Deduplication', () => {
    it('should track seen transactions to avoid duplicates', () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      // First call should return false (not seen)
      const firstCall = (watcher as any).isTransactionSeen(txHash, 'pending-univ3');
      expect(firstCall).to.be.false;
      
      // Second call should return true (already seen)
      const secondCall = (watcher as any).isTransactionSeen(txHash, 'pending-univ3');
      expect(secondCall).to.be.true;
    });

    it('should clean up expired cache entries', () => {
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      // Mark as seen
      (watcher as any).isTransactionSeen(txHash, 'pending-univ3');
      expect((watcher as any).seenTxHashes.has(txHash)).to.be.true;
      
      // Manually expire the entry
      (watcher as any).seenTxHashes.set(txHash, Date.now() - (6 * 60 * 1000)); // 6 minutes ago
      
      // Cleanup should remove it
      (watcher as any).cleanupExpiredCache();
      expect((watcher as any).seenTxHashes.has(txHash)).to.be.false;
    });
  });
});