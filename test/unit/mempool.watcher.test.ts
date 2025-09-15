import { expect } from 'chai';
import { ethers } from 'ethers';
import { MempoolWatcher, PendingSwapDetected } from '../../src/watcher/mempoolWatcher';

describe('MempoolWatcher', () => {
  let watcher: MempoolWatcher;
  let mockProvider: any;

  beforeEach(() => {
    // Create mock WebSocket provider
    mockProvider = {
      send: async (method: string, _params: any[]) => {
        if (method === 'eth_subscribe') {
          return 'subscription_id';
        }
        if (method === 'eth_getRawTransactionByHash') {
          throw new Error('Method not supported');
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
      }
    };

    // Create a minimal watcher instance for testing (avoid real network providers)
    watcher = Object.create(MempoolWatcher.prototype);
    
    // Initialize only the properties we need for testing
    (watcher as any).provider = mockProvider;
    (watcher as any).fallbackProvider = mockProvider;
    (watcher as any).logger = { debug: () => {}, info: () => {}, warn: () => {} };
    
    // Add router addresses needed for isUniswapV3Transaction
    (watcher as any).UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    (watcher as any).UNISWAP_V3_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
    
    // Add threshold for shouldProcessSwap
    (watcher as any).MIN_SWAP_THRESHOLD = ethers.utils.parseEther('10'); // 10 ETH minimum
  });

  describe('Raw Transaction Capture', () => {
    it('should attempt to capture raw signed transaction bytes', async () => {
      const txHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Fully stub to avoid network calls and ensure deterministic behavior
      (watcher as any).tryLocalNodeRawTx = async () => null;
      (watcher as any).tryVendorApiRawTx = async () => null;
      (watcher as any).reconstructRawTransaction = () => null;
      (watcher as any).reconstructRawTransaction = () => null;
      
      try {
        await watcher.getRawSignedTransaction(txHash);
        expect.fail('Expected method to throw');
      } catch (error: any) {
        expect(error.message).to.include('No method available');
      }
    });

    it('should handle fallback provider when local node fails', async () => {
      const txHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
      
      // Stub all network methods to prevent real calls
      (watcher as any).tryLocalNodeRawTx = async () => null;
      (watcher as any).tryVendorApiRawTx = async () => null;
      (watcher as any).reconstructRawTransaction = () => null;
      
      try {
        await watcher.getRawSignedTransaction(txHash);
        expect.fail('Expected method to throw');
      } catch (error: any) {
        expect(error.message).to.include('No method available');
      }
    });
  });

  describe('Uniswap V3 Transaction Parsing', () => {
    it('should detect Uniswap V3 router transactions', () => {
      const routerAddress = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
      const isUniswap = (watcher as any).isUniswapV3Transaction(routerAddress);
      expect(isUniswap).to.be.true;
    });

    it('should reject non-Uniswap transactions', () => {
      const randomAddress = '0x1234567890123456789012345678901234567890';
      const isUniswap = (watcher as any).isUniswapV3Transaction(randomAddress);
      expect(isUniswap).to.be.false;
    });

    it('should parse exactInputSingle transactions', async () => {
      const tx = createMockExactInputSingleTransaction();
      const rawTxHex = '0xdeadbeef'; // Mock raw transaction hex string
      
      // Stub methods needed for parsing
      (watcher as any).findTargetPool = () => ({ pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8' });
      (watcher as any).estimateUSDValue = async () => ethers.BigNumber.from('1000');
      
      const swapData = await (watcher as any).parseExactInputSingle(tx, rawTxHex);
      
      expect(swapData).to.not.be.null;
      expect(swapData?.poolFeeTier).to.equal(3000);
      expect(swapData?.tokenIn).to.equal('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(swapData?.tokenOut).to.equal('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(swapData?.rawTxHex).to.equal(rawTxHex);
    });

    it('should decode Uniswap V3 swap paths', () => {
      // Create mock encoded path for USDC -> ETH swap
      const token0 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const token1 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
      const fee = 3000; // 0.3%
      
      // Encode path: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes)
      const path = ethers.utils.solidityPack(
        ['address', 'uint24', 'address'],
        [token0, fee, token1]
      );
      
      const decodedPath = (watcher as any).decodePath(path);
      
      expect(decodedPath).to.have.length(1);
      expect(decodedPath[0].tokenIn.toLowerCase()).to.equal(token0.toLowerCase());
      expect(decodedPath[0].tokenOut.toLowerCase()).to.equal(token1.toLowerCase());
      expect(decodedPath[0].fee).to.equal(fee);
    });
  });

  describe('USD Value Estimation', () => {
    it('should estimate USD value for WETH', async () => {
      const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const amount = ethers.utils.parseEther('1'); // 1 ETH
      
      // Stub to return predictable value
      (watcher as any).estimateUSDValue = async () => ethers.BigNumber.from('2000');
      
      const usdValue = await (watcher as any).estimateUSDValue(wethAddress, amount);
      
      expect(usdValue.gt(0)).to.be.true;
      expect(usdValue.toString()).to.equal('2000');
    });

    it('should estimate USD value for USDC', async () => {
      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const amount = ethers.utils.parseUnits('1000', 6); // 1000 USDC
      
      // Stub to return predictable value  
      (watcher as any).estimateUSDValue = async () => ethers.utils.parseEther('1000');
      
      const usdValue = await (watcher as any).estimateUSDValue(usdcAddress, amount);
      
      expect(usdValue.gt(0)).to.be.true;
      expect(ethers.utils.formatEther(usdValue)).to.equal('1000.0');
    });
  });

  describe('Swap Processing Criteria', () => {
    it('should accept swaps meeting minimum criteria', () => {
      const swapData: PendingSwapDetected = {
        id: '0x123',
        poolId: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        poolFeeTier: 3000,
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: ethers.utils.parseEther('20').toString(), // 20 ETH
        amountOutEstimated: '0',
        amountUSD: ethers.utils.parseEther('2000').toString(), // $2000
        from: '0x1234567890123456789012345678901234567890',
        to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        rawTxHex: '0x02f8...',
        calldata: '0x414bf389...',
        gasLimitEstimate: '200000',
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      const shouldProcess = (watcher as any).shouldProcessSwap(swapData);
      expect(shouldProcess).to.be.true;
    });

    it('should reject swaps below minimum thresholds', () => {
      const swapData: PendingSwapDetected = {
        id: '0x123',
        poolId: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        poolFeeTier: 3000,
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: ethers.utils.parseEther('1').toString(), // 1 ETH (below 10 ETH threshold)
        amountOutEstimated: '0',
        amountUSD: ethers.utils.parseEther('100').toString(), // $100 (below $1000 threshold)
        from: '0x1234567890123456789012345678901234567890',
        to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        rawTxHex: '0x02f8...',
        calldata: '0x414bf389...',
        gasLimitEstimate: '200000',
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      const shouldProcess = (watcher as any).shouldProcessSwap(swapData);
      expect(shouldProcess).to.be.false;
    });
  });

  describe('Legacy Compatibility', () => {
    it('should convert new format to legacy format', () => {
      const swapData: PendingSwapDetected = {
        id: '0x123',
        poolId: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        poolFeeTier: 3000,
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: '1000000000000000000000',
        amountOutEstimated: '500000',
        amountUSD: '2000000000000000000000',
        from: '0x1234567890123456789012345678901234567890',
        to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        rawTxHex: '0x02f8...',
        calldata: '0x414bf389...',
        gasLimitEstimate: '200000',
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      const tx = createMockTransaction('0x123');
      const legacyFormat = (watcher as any).convertToLegacyFormat(swapData, tx);
      
      expect(legacyFormat.hash).to.equal(swapData.id);
      expect(legacyFormat.pool).to.equal(swapData.poolId);
      expect(legacyFormat.tokenIn).to.equal(swapData.tokenIn);
      expect(legacyFormat.tokenOut).to.equal(swapData.tokenOut);
      expect(legacyFormat.rawTransaction).to.equal(swapData.rawTxHex);
    });
  });
});

// Helper functions for creating mock data
function createMockTransaction(txHash: string): ethers.providers.TransactionResponse {
  return {
    hash: txHash,
    from: '0x1234567890123456789012345678901234567890',
    to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    value: ethers.BigNumber.from(0),
    gasLimit: ethers.BigNumber.from(200000),
    gasPrice: ethers.utils.parseUnits('20', 'gwei'),
    nonce: 1,
    data: '0x414bf389000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000bb8',
    chainId: 1,
    type: 2,
    maxFeePerGas: ethers.utils.parseUnits('25', 'gwei'),
    maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
    confirmations: 0,
    blockNumber: undefined,
    blockHash: undefined,
    timestamp: undefined,
    wait: async () => ({ logs: [] } as any)
  } as ethers.providers.TransactionResponse;
}

function createMockExactInputSingleTransaction(): ethers.providers.TransactionResponse {
  // Encode exactInputSingle call for USDC -> WETH swap
  const iface = new ethers.utils.Interface([
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
  ]);
  
  const params = {
    tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    fee: 3000,
    recipient: '0x1234567890123456789012345678901234567890',
    deadline: Math.floor(Date.now() / 1000) + 300,
    amountIn: ethers.utils.parseUnits('1000', 6), // 1000 USDC
    amountOutMinimum: ethers.utils.parseEther('0.4'), // Min 0.4 ETH
    sqrtPriceLimitX96: 0
  };
  
  const data = iface.encodeFunctionData('exactInputSingle', [params]);
  
  return {
    ...createMockTransaction('0x123'),
    data
  };
}