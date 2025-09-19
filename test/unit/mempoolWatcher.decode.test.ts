import { expect } from 'chai';
import { ethers } from 'ethers';
import { MempoolWatcher, PendingSwapDetected } from '../../src/watcher/mempoolWatcher';

describe('MempoolWatcher Decode Tests', () => {
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
        if (method === 'eth_getRawTransactionByHash') {
          return null; // Simulate raw tx unavailable
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
      getBlockNumber: async () => {
        return 18000000;
      }
    };

    // Create mock config with pools
    mockConfig = {
      allowReconstructRawTx: true,
      logTargetPoolSwaps: true,
      minSwapEth: 0,
      minSwapUsd: 0,
      pools: [
        {
          pool: 'WETH-USDC-0.05%',
          address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
          token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          fee: 500,
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
      warn: () => {} 
    };
    
    // Add router addresses
    (watcher as any).UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    (watcher as any).UNISWAP_V3_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
    
    // Add signatures
    (watcher as any).UNISWAP_V3_SIGNATURES = {
      exactInputSingle: '0x414bf389',
      exactInput: '0xc04b8d59',
      multicall: '0xac9650d8',
      multicallWithDeadline: '0x5ae401dc',
      swap: '0x128acb08'
    };

    // Initialize target pools
    (watcher as any).targetPools = new Map();
    (watcher as any).initializeTargetPools();

    // Add mock metrics
    (watcher as any).metrics = {
      incrementMempoolSwapsDecoded: () => {}
    };
  });

  function createMockTransaction(txHash: string, to?: string, data?: string): ethers.providers.TransactionResponse {
    return {
      hash: txHash,
      to: to || '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Default to SwapRouter
      from: '0x1234567890123456789012345678901234567890',
      nonce: 1,
      gasLimit: ethers.BigNumber.from('200000'),
      gasPrice: ethers.BigNumber.from('20000000000'),
      data: data || '0x414bf389', // Default to exactInputSingle signature
      value: ethers.BigNumber.from('0'),
      chainId: 1,
      r: '0x123',
      s: '0x456',
      v: 27,
      type: 2,
      confirmations: 0,
      wait: async () => ({ 
        to: to || '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        from: '0x1234567890123456789012345678901234567890',
        contractAddress: null,
        transactionIndex: 0,
        gasUsed: ethers.BigNumber.from('150000'),
        logsBloom: '0x',
        blockHash: '0x789',
        transactionHash: txHash,
        logs: [],
        blockNumber: 18000000,
        confirmations: 1,
        cumulativeGasUsed: ethers.BigNumber.from('150000'),
        effectiveGasPrice: ethers.BigNumber.from('20000000000'),
        status: 1,
        type: 2,
        byzantium: true
      })
    };
  }

  function createExactInputSingleCalldata(): string {
    // Create mock exactInputSingle calldata
    const iface = new ethers.utils.Interface([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))'
    ]);
    
    const params = {
      tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      fee: 500,
      recipient: '0x1234567890123456789012345678901234567890',
      deadline: Math.floor(Date.now() / 1000) + 300,
      amountIn: ethers.utils.parseUnits('1000', 6), // 1000 USDC
      amountOutMinimum: ethers.utils.parseEther('0.28'), // Min 0.28 ETH
      sqrtPriceLimitX96: 0
    };
    
    return iface.encodeFunctionData('exactInputSingle', [params]);
  }

  function createExactInputCalldata(): string {
    // Create mock exactInput calldata with encoded path
    const iface = new ethers.utils.Interface([
      'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum))'
    ]);
    
    // Encode path: USDC -> 0.05% -> WETH  
    const path = ethers.utils.solidityPack(
      ['address', 'uint24', 'address'],
      ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 500, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']
    );
    
    const params = {
      path,
      recipient: '0x1234567890123456789012345678901234567890',
      deadline: Math.floor(Date.now() / 1000) + 300,
      amountIn: ethers.utils.parseUnits('1000', 6), // 1000 USDC
      amountOutMinimum: ethers.utils.parseEther('0.28') // Min 0.28 ETH
    };
    
    return iface.encodeFunctionData('exactInput', [params]);
  }

  function createMulticallCalldata(): string {
    // Create multicall containing exactInputSingle
    const iface = new ethers.utils.Interface([
      'function multicall(bytes[] data)'
    ]);
    
    const innerCallData = createExactInputSingleCalldata();
    return iface.encodeFunctionData('multicall', [[innerCallData]]);
  }

  function createDirectPoolSwapCalldata(): string {
    // Create direct pool swap calldata
    const iface = new ethers.utils.Interface([
      'function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data)'
    ]);
    
    return iface.encodeFunctionData('swap', [
      '0x1234567890123456789012345678901234567890', // recipient
      true, // zeroForOne (token0 -> token1, USDC -> WETH)
      ethers.utils.parseUnits('1000', 6), // 1000 USDC
      0, // sqrtPriceLimitX96
      '0x' // callback data
    ]);
  }

  describe('Router Transaction Detection', () => {
    it('should detect SwapRouter transactions', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0xE592427A0AEce92De3Edee1F18E0157C05861564');
      expect(isUniswap).to.be.true;
    });

    it('should detect SwapRouter02 transactions', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');
      expect(isUniswap).to.be.true;
    });

    it('should detect direct pool transactions', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
      expect(isUniswap).to.be.true;
    });

    it('should reject non-Uniswap transactions', () => {
      const isUniswap = (watcher as any).isUniswapV3Transaction('0x1234567890123456789012345678901234567890');
      expect(isUniswap).to.be.false;
    });
  });

  describe('exactInputSingle Decoding', () => {
    it('should decode exactInputSingle transaction and emit candidate', async () => {
      const calldata = createExactInputSingleCalldata();
      const tx = createMockTransaction('0xtest1', '0xE592427A0AEce92De3Edee1F18E0157C05861564', calldata);
      
      const result = await (watcher as any).parseSwapTransaction(tx, '');
      
      expect(result).to.not.be.null;
      expect(result.txHash).to.equal('0xtest1');
      expect(result.poolAddress).to.equal('0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
      expect(result.tokenIn).to.equal('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(result.tokenOut).to.equal('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(result.feeTier).to.equal(500);
      expect(result.direction).to.equal('token0->token1');
      expect(result.amountInHuman).to.not.be.empty;
      expect(result.decodedCall.method).to.equal('exactInputSingle');
      expect(result.amountOutMin).to.not.be.undefined;
    });
  });

  describe('exactInput Decoding', () => {
    it('should decode exactInput path correctly', async () => {
      const calldata = createExactInputCalldata();
      const tx = createMockTransaction('0xtest2', '0xE592427A0AEce92De3Edee1F18E0157C05861564', calldata);
      
      const result = await (watcher as any).parseSwapTransaction(tx, '');
      
      expect(result).to.not.be.null;
      expect(result.txHash).to.equal('0xtest2');
      expect(result.poolAddress).to.equal('0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
      expect(result.tokenIn).to.equal('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(result.tokenOut).to.equal('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(result.feeTier).to.equal(500);
      expect(result.decodedCall.method).to.equal('exactInput');
      expect(result.amountOutMin).to.not.be.undefined;
    });
  });

  describe('Multicall Decoding', () => {
    it('should decode multicall containing exactInputSingle', async () => {
      const calldata = createMulticallCalldata();
      const tx = createMockTransaction('0xtest3', '0xE592427A0AEce92De3Edee1F18E0157C05861564', calldata);
      
      const result = await (watcher as any).parseSwapTransaction(tx, '');
      
      expect(result).to.not.be.null;
      expect(result.txHash).to.equal('0xtest3');
      expect(result.poolAddress).to.equal('0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
      expect(result.decodedCall.method).to.equal('multicall->exactInputSingle');
    });
  });

  describe('Direct Pool Swap Decoding', () => {
    it('should decode direct pool swap using zeroForOne', async () => {
      const calldata = createDirectPoolSwapCalldata();
      const tx = createMockTransaction('0xtest4', '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', calldata);
      
      const result = await (watcher as any).parseSwapTransaction(tx, '');
      
      expect(result).to.not.be.null;
      expect(result.txHash).to.equal('0xtest4');
      expect(result.poolAddress).to.equal('0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8');
      expect(result.tokenIn).to.equal('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // USDC (token0)
      expect(result.tokenOut).to.equal('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'); // WETH (token1)
      expect(result.direction).to.equal('token0->token1');
      expect(result.feeTier).to.equal(500);
      expect(result.decodedCall.method).to.equal('swap');
    });
  });

  describe('Raw Transaction Reconstruction', () => {
    it('should reconstruct raw transaction when v/r/s present', () => {
      const tx = createMockTransaction('0xtest5');
      
      const reconstructed = (watcher as any).reconstructRawTransaction(tx);
      
      expect(reconstructed).to.not.be.null;
      expect(reconstructed).to.be.a('string');
      expect(reconstructed).to.match(/^0x[0-9a-fA-F]+$/);
    });

    it('should return null when signature components missing', () => {
      const tx = createMockTransaction('0xtest6');
      delete tx.v;
      delete tx.r;
      delete tx.s;
      
      const reconstructed = (watcher as any).reconstructRawTransaction(tx);
      
      expect(reconstructed).to.be.null;
    });
  });

  describe('Candidate Emission', () => {
    it('should emit candidates with correct payload structure', async () => {
      const calldata = createExactInputSingleCalldata();
      const tx = createMockTransaction('0xtest7', '0xE592427A0AEce92De3Edee1F18E0157C05861564', calldata);
      
      const result = await (watcher as any).parseSwapTransaction(tx, '0xrawdata');
      
      expect(result).to.not.be.null;
      expect(result).to.have.property('candidateId');
      expect(result).to.have.property('txHash');
      expect(result).to.have.property('rawTxHex');
      expect(result).to.have.property('poolAddress');
      expect(result).to.have.property('tokenIn');
      expect(result).to.have.property('tokenOut');
      expect(result).to.have.property('amountIn');
      expect(result).to.have.property('amountInHuman');
      expect(result).to.have.property('feeTier');
      expect(result).to.have.property('direction');
      expect(result).to.have.property('estimatedUsd');
      expect(result).to.have.property('blockNumberSeen');
      expect(result).to.have.property('timestamp');
      expect(result).to.have.property('provider');
      expect(result).to.have.property('decodedCall');
      
      expect(result.decodedCall).to.have.property('method');
      expect(result.decodedCall).to.have.property('params');
    });

    it('should emit candidates even when rawTxHex is empty', async () => {
      const calldata = createExactInputSingleCalldata();
      const tx = createMockTransaction('0xtest8', '0xE592427A0AEce92De3Edee1F18E0157C05861564', calldata);
      
      const result = await (watcher as any).parseSwapTransaction(tx, '');
      
      expect(result).to.not.be.null;
      expect(result.rawTxHex).to.equal('');
      expect(result.poolAddress).to.not.be.empty;
      expect(result.amountInHuman).to.not.be.empty;
    });
  });
});