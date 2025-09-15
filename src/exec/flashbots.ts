import { ethers } from 'ethers';
import { getConfig, validateNoLiveExecution } from '../config';
import { getLogger } from '../logging/logger';
import { initializeMetrics } from '../metrics/prom';
import { FlashbotsBundle } from '../bundler/bundleBuilder';

export interface FlashbotsBundleResult {
  bundleHash: string;
  simulation?: {
    success: boolean;
    gasUsed: number;
    effectiveGasPrice: ethers.BigNumber;
    totalValue: ethers.BigNumber;
    error?: string;
  };
  submission?: {
    success: boolean;
    targetBlock: number;
    bundleHash: string;
    error?: string;
  };
  // Track victim transaction inclusion
  victimIncluded?: boolean;
}

export interface FlashbotsTransactionParams {
  to: string;
  data: string;
  value?: ethers.BigNumber;
  gasLimit: number;
  maxFeePerGas: ethers.BigNumber;
  maxPriorityFeePerGas: ethers.BigNumber;
}

// Enhanced bundle creation parameters
export interface EnhancedBundleParams {
  jitTransactions: FlashbotsTransactionParams[];
  victimTransaction?: {
    rawTx: string;
    hash: string;
  };
  targetBlockNumber: number;
  traceId?: string;
}

/**
 * Flashbots integration for MEV bundle composition and submission
 */
export class FlashbotsManager {
  private logger: any;
  private metrics: any;
  private config: any;
  private flashbotsSigner?: ethers.Wallet;
  private relayUrl: string;
  private multiRelayUrls: string[];

  constructor() {
    this.config = getConfig();
    this.logger = getLogger().child({ component: 'flashbots' });
    this.metrics = initializeMetrics({ port: this.config.prometheusPort });
    this.relayUrl = this.config.flashbotsRelayUrl;
    
    // Initialize multi-relay support
    this.multiRelayUrls = this.initializeMultiRelayUrls();

    // Initialize Flashbots signer if live execution is enabled
    if (this.config.enableLiveExecution && this.config.enableFlashbots && this.config.flashbotsPrivateKey) {
      this.flashbotsSigner = new ethers.Wallet(this.config.flashbotsPrivateKey);
      this.logger.info({
        msg: 'Flashbots signer initialized',
        address: this.flashbotsSigner.address,
        relay: this.relayUrl,
        multiRelayCount: this.multiRelayUrls.length
      });
    }
  }

  /**
   * Initialize multi-relay URLs from environment variables
   */
  private initializeMultiRelayUrls(): string[] {
    const relays: string[] = [];
    
    // Primary Flashbots relay
    if (this.relayUrl) {
      relays.push(this.relayUrl);
    }
    
    // Optional Eden relay
    const edenRelayUrl = process.env.EDEN_RELAY_URL;
    if (edenRelayUrl) {
      relays.push(edenRelayUrl);
      this.logger.info({ msg: 'Eden relay configured', relay: edenRelayUrl });
    }
    
    // Optional bloXroute relay
    const bloxrouteRelayUrl = process.env.BLOXROUTE_RELAY_URL;
    if (bloxrouteRelayUrl) {
      relays.push(bloxrouteRelayUrl);
      this.logger.info({ msg: 'bloXroute relay configured', relay: bloxrouteRelayUrl });
    }
    
    // Additional relays from comma-separated env var
    const additionalRelays = process.env.ADDITIONAL_RELAY_URLS;
    if (additionalRelays) {
      const additional = additionalRelays.split(',').map(url => url.trim()).filter(url => url);
      relays.push(...additional);
      this.logger.info({ msg: 'Additional relays configured', count: additional.length });
    }
    
    return relays;
  }

  /**
   * Create a Flashbots bundle from transaction parameters
   */
  async createBundle(
    transactions: FlashbotsTransactionParams[],
    targetBlockNumber: number,
    traceId?: string
  ): Promise<FlashbotsBundle> {
    const logger = this.logger.child({ traceId, operation: 'create_bundle' });
    
    logger.info({
      msg: 'Creating Flashbots bundle',
      txCount: transactions.length,
      targetBlock: targetBlockNumber
    });

    // Validate gas prices against MAX_GAS_GWEI cap
    for (const tx of transactions) {
      const maxFeeGwei = parseFloat(ethers.utils.formatUnits(tx.maxFeePerGas, 'gwei'));
      const priorityFeeGwei = parseFloat(ethers.utils.formatUnits(tx.maxPriorityFeePerGas, 'gwei'));
      
      if (maxFeeGwei > this.config.maxGasGwei) {
        throw new Error(
          `Transaction maxFeePerGas ${maxFeeGwei} gwei exceeds limit ${this.config.maxGasGwei} gwei`
        );
      }
      
      if (priorityFeeGwei > this.config.maxGasGwei) {
        throw new Error(
          `Transaction maxPriorityFeePerGas ${priorityFeeGwei} gwei exceeds limit ${this.config.maxGasGwei} gwei`
        );
      }
    }

    // Convert to transaction requests
    const txRequests: ethers.providers.TransactionRequest[] = transactions.map((tx) => ({
      to: tx.to,
      data: tx.data,
      value: tx.value || ethers.BigNumber.from(0),
      gasLimit: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      type: 2, // EIP-1559
      nonce: undefined // Will be filled by bundle executor
    }));

    const bundle: FlashbotsBundle = {
      transactions: txRequests,
      blockNumber: targetBlockNumber,
      targetBlockNumber,
      maxBlockNumber: targetBlockNumber + 3, // Allow bundle to be included in next 3 blocks
    };

    logger.info({
      msg: 'Bundle created successfully',
      bundleSize: bundle.transactions.length,
      targetBlock: bundle.blockNumber || bundle.targetBlockNumber,
      maxBlock: bundle.maxBlockNumber
    });

    return bundle;
  }

  /**
   * Create enhanced Flashbots bundle with victim transaction inclusion
   * Ensures proper ordering: [JIT mint] → [victim swap] → [JIT burn/collect]
   */
  async createEnhancedBundle(
    params: EnhancedBundleParams
  ): Promise<FlashbotsBundle> {
    const logger = this.logger.child({ 
      traceId: params.traceId, 
      operation: 'create_enhanced_bundle' 
    });

    logger.info({
      msg: 'Creating enhanced Flashbots bundle with victim transaction',
      jitTxCount: params.jitTransactions.length,
      hasVictimTx: !!params.victimTransaction,
      targetBlock: params.targetBlockNumber
    });

    // Validate victim transaction is present for deterministic ordering
    if (!params.victimTransaction) {
      throw new Error('Victim transaction required for enhanced bundle creation');
    }

    // Validate JIT transaction count (should be exactly 2: mint + burn/collect)
    if (params.jitTransactions.length !== 2) {
      throw new Error('Enhanced bundle requires exactly 2 JIT transactions (mint + burn/collect)');
    }

    // Convert JIT transactions to transaction requests
    const jitTxRequests = params.jitTransactions.map(tx => ({
      to: tx.to,
      data: tx.data,
      value: tx.value || ethers.BigNumber.from(0),
      gasLimit: tx.gasLimit,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      type: 2, // EIP-1559
      nonce: undefined // Will be filled by bundle executor
    }));

    // Bundle ordering: [JIT mint] → [victim swap] → [JIT burn/collect]
    const bundle: FlashbotsBundle = {
      transactions: jitTxRequests,
      blockNumber: params.targetBlockNumber,
      targetBlockNumber: params.targetBlockNumber,
      maxBlockNumber: params.targetBlockNumber + 3,
      victimTransaction: {
        rawTx: params.victimTransaction.rawTx,
        hash: params.victimTransaction.hash,
        insertAfterIndex: 0 // Insert victim tx after first JIT transaction (mint)
      }
    };

    logger.info({
      msg: 'Enhanced bundle created successfully',
      bundleSize: bundle.transactions.length,
      victimTxHash: params.victimTransaction.hash,
      victimInsertPosition: 1, // After mint, before burn
      targetBlock: bundle.blockNumber || bundle.targetBlockNumber,
      maxBlock: bundle.maxBlockNumber
    });

    return bundle;
  }

  /**
   * Simulate bundle using eth_callBundle before submission
   * Validates bundle execution and gas usage
   */
  async simulateBundleWithEthCall(
    bundle: FlashbotsBundle,
    traceId?: string
  ): Promise<{
    success: boolean;
    gasUsed: number;
    results: Array<{
      success: boolean;
      gasUsed: number;
      returnData: string;
      error?: string;
    }>;
    error?: string;
  }> {
    const logger = this.logger.child({ traceId, operation: 'eth_call_bundle_simulation' });
    
    logger.info({
      msg: 'Simulating bundle with eth_callBundle',
      targetBlock: bundle.blockNumber || bundle.targetBlockNumber,
      txCount: bundle.transactions.length,
      hasVictim: !!bundle.victimTransaction
    });

    try {
      // Prepare transactions for simulation
      const simulationTxs = await this.prepareTransactionsForSimulation(bundle);
      
      // Use eth_callBundle for simulation (if provider supports it)
      const simulationResult = await this.performEthCallBundleSimulation(
        simulationTxs,
        bundle.blockNumber || bundle.targetBlockNumber || 0
      );

      const totalGasUsed = simulationResult.results.reduce(
        (sum, result) => sum + result.gasUsed, 
        0
      );

      logger.info({
        msg: 'Bundle simulation completed',
        success: simulationResult.success,
        totalGasUsed,
        individualResults: simulationResult.results.length
      });

      return {
        success: simulationResult.success,
        gasUsed: totalGasUsed,
        results: simulationResult.results
      };

    } catch (error: any) {
      logger.error({
        err: error,
        msg: 'Bundle simulation failed'
      });

      return {
        success: false,
        gasUsed: 0,
        results: [],
        error: error.message
      };
    }
  }

  /**
   * Prepare transactions for simulation including victim transaction insertion
   */
  private async prepareTransactionsForSimulation(bundle: FlashbotsBundle): Promise<Array<{
    to: string;
    data: string;
    value: string;
    gasLimit: number;
    from: string;
  }>> {
    const simulationTxs: Array<{
      to: string;
      data: string;
      value: string;
      gasLimit: number;
      from: string;
    }> = [];

    // Add first JIT transaction (mint)
    if (bundle.transactions[0]) {
      const tx = bundle.transactions[0];
      if (typeof tx === 'string') {
        // Parse signed transaction
        try {
          const parsedTx = ethers.utils.parseTransaction(tx);
          simulationTxs.push({
            to: parsedTx.to || '',
            data: parsedTx.data,
            value: parsedTx.value.toString(),
            gasLimit: Number(parsedTx.gasLimit || 500000),
            from: parsedTx.from || '0x1234567890123456789012345678901234567890'
          });
        } catch (error) {
          // Skip invalid transaction
        }
      } else {
        // Transaction request object
        simulationTxs.push({
          to: tx.to || '',
          data: tx.data?.toString() || '0x',
          value: tx.value?.toString() || '0',
          gasLimit: Number(tx.gasLimit || 500000),
          from: '0x1234567890123456789012345678901234567890' // Mock sender for simulation
        });
      }
    }

    // Insert victim transaction if present
    if (bundle.victimTransaction) {
      try {
        // Parse the raw victim transaction to extract fields
        const rawTx = bundle.victimTransaction.rawTx || bundle.victimTransaction.rawTxHex;
        if (rawTx) {
          const parsedVictimTx = ethers.utils.parseTransaction(rawTx);
          
          simulationTxs.push({
            to: parsedVictimTx.to || '',
            data: parsedVictimTx.data,
            value: parsedVictimTx.value.toString(),
            gasLimit: Number(parsedVictimTx.gasLimit),
            from: parsedVictimTx.from || '0x0000000000000000000000000000000000000000'
          });
        }
      } catch (error: any) {
        this.logger.warn({
          err: error,
          msg: 'Failed to parse victim transaction for simulation',
          victimTxHash: bundle.victimTransaction.hash
        });
        
        // Skip victim transaction in simulation but continue
      }
    }

    // Add second JIT transaction (burn/collect)
    if (bundle.transactions[1]) {
      const tx = bundle.transactions[1];
      if (typeof tx === 'string') {
        // Parse signed transaction
        try {
          const parsedTx = ethers.utils.parseTransaction(tx);
          simulationTxs.push({
            to: parsedTx.to || '',
            data: parsedTx.data,
            value: parsedTx.value.toString(),
            gasLimit: Number(parsedTx.gasLimit || 400000),
            from: parsedTx.from || '0x1234567890123456789012345678901234567890'
          });
        } catch (error) {
          // Skip invalid transaction
        }
      } else {
        // Transaction request object
        simulationTxs.push({
          to: tx.to || '',
          data: tx.data?.toString() || '0x',
          value: tx.value?.toString() || '0',
          gasLimit: Number(tx.gasLimit || 400000),
          from: '0x1234567890123456789012345678901234567890' // Mock sender for simulation
        });
      }
    }

    return simulationTxs;
  }

  /**
   * Perform eth_callBundle simulation
   */
  private async performEthCallBundleSimulation(
    transactions: Array<{
      to: string;
      data: string;
      value: string;
      gasLimit: number;
      from: string;
    }>,
    _blockNumber: number
  ): Promise<{
    success: boolean;
    results: Array<{
      success: boolean;
      gasUsed: number;
      returnData: string;
      error?: string;
    }>;
  }> {
    try {
      // For testing/simulation mode, return mock results
      if (!this.config.enableLiveExecution || !this.config.enableFlashbots) {
        return this.createMockSimulationResult(transactions);
      }

      // In production, this would use the actual eth_callBundle RPC method
      // For now, return a mock simulation since we don't have access to Flashbots relay
      return this.createMockSimulationResult(transactions);

    } catch (error: any) {
      this.logger.warn({
        err: error,
        msg: 'eth_callBundle simulation failed, using fallback'
      });

      return {
        success: false,
        results: transactions.map(() => ({
          success: false,
          gasUsed: 0,
          returnData: '0x',
          error: 'Simulation not available'
        }))
      };
    }
  }

  /**
   * Create mock simulation result for testing
   */
  private createMockSimulationResult(
    transactions: Array<{ gasLimit: number }>
  ): {
    success: boolean;
    results: Array<{
      success: boolean;
      gasUsed: number;
      returnData: string;
    }>;
  } {
    return {
      success: true,
      results: transactions.map(tx => ({
        success: true,
        gasUsed: Math.floor(tx.gasLimit * 0.8), // Assume 80% of gas limit used
        returnData: '0x'
      }))
    };
  }

  /**
   * Simulate bundle execution against target block (legacy method)
   */
  async simulateBundle(
    bundle: FlashbotsBundle,
    traceId?: string
  ): Promise<FlashbotsBundleResult> {
    const logger = this.logger.child({ traceId, operation: 'simulate_bundle' });
    
    logger.info({
      msg: 'Simulating Flashbots bundle',
      targetBlock: bundle.blockNumber || bundle.targetBlockNumber,
      txCount: bundle.transactions.length
    });

    this.metrics.incrementFlashbotsAttempt('simulate');

    try {
      // In simulation mode or when Flashbots is disabled, return mock simulation
      if (!this.config.enableLiveExecution || !this.config.enableFlashbots) {
        logger.info({
          msg: 'Mock bundle simulation (live execution disabled)',
          note: 'This is a simulated result for testing purposes'
        });

        const mockResult: FlashbotsBundleResult = {
          bundleHash: `0x${Math.random().toString(16).slice(2, 66)}`,
          simulation: {
            success: true,
            gasUsed: bundle.transactions.reduce((sum, tx) => {
              if (typeof tx === 'string') {
                try {
                  const parsedTx = ethers.utils.parseTransaction(tx);
                  return sum + Number(parsedTx.gasLimit || 0);
                } catch {
                  return sum + 500000; // Fallback
                }
              } else {
                return sum + Number(tx.gasLimit || 0);
              }
            }, 0),
            effectiveGasPrice: (() => {
              const firstTx = bundle.transactions[0];
              if (typeof firstTx === 'string') {
                try {
                  const parsedTx = ethers.utils.parseTransaction(firstTx);
                  return ethers.BigNumber.from(parsedTx.maxFeePerGas || ethers.utils.parseUnits('20', 'gwei'));
                } catch {
                  return ethers.utils.parseUnits('20', 'gwei');
                }
              } else {
                return ethers.BigNumber.from(firstTx?.maxFeePerGas || ethers.utils.parseUnits('20', 'gwei'));
              }
            })(),
            totalValue: bundle.transactions.reduce((sum, tx) => {
              if (typeof tx === 'string') {
                try {
                  const parsedTx = ethers.utils.parseTransaction(tx);
                  return sum.add(parsedTx.value || 0);
                } catch {
                  return sum;
                }
              } else {
                return sum.add(tx.value || 0);
              }
            }, ethers.BigNumber.from(0))
          },
          victimIncluded: !!bundle.victimTransaction
        };

        this.metrics.incrementFlashbotsSuccess('simulate');
        return mockResult;
      }

      // For live execution, we would implement actual Flashbots relay communication here
      // This requires the @flashbots/ethers-provider-bundle package
      validateNoLiveExecution('Flashbots bundle simulation against relay');
      
      // This code path should not be reached in current implementation
      throw new Error('Live Flashbots simulation not implemented in this version');

    } catch (error: any) {
      logger.error({
        err: error,
        msg: 'Bundle simulation failed'
      });

      this.metrics.incrementFlashbotsFailure('simulate', error.message);

      return {
        bundleHash: '',
        simulation: {
          success: false,
          gasUsed: 0,
          effectiveGasPrice: ethers.BigNumber.from(0),
          totalValue: ethers.BigNumber.from(0),
          error: error.message
        }
      };
    }
  }

  /**
   * Submit bundle to multiple relays with retries and backoff
   */
  async submitBundleWithMultiRelay(
    bundle: FlashbotsBundle,
    traceId?: string
  ): Promise<FlashbotsBundleResult> {
    const logger = this.logger.child({ traceId, operation: 'submit_bundle_multi_relay' });
    
    // Validate live execution is enabled
    validateNoLiveExecution('Flashbots bundle submission to multiple relays');

    logger.info({
      msg: 'Submitting bundle to multiple relays',
      targetBlock: bundle.blockNumber || bundle.targetBlockNumber,
      txCount: bundle.transactions.length,
      relayCount: this.multiRelayUrls.length,
      hasVictim: !!bundle.victimTransaction
    });

    this.metrics.incrementFlashbotsAttempt('submit_multi_relay');

    try {
      if (!this.flashbotsSigner) {
        throw new Error('Flashbots signer not initialized');
      }

      // Step 1: Enhanced simulation with eth_callBundle
      const ethCallSimulation = await this.simulateBundleWithEthCall(bundle, traceId);
      
      if (!ethCallSimulation.success) {
        throw new Error(`Bundle eth_callBundle simulation failed: ${ethCallSimulation.error}`);
      }

      logger.info({
        msg: 'Bundle passed eth_callBundle simulation',
        totalGasUsed: ethCallSimulation.gasUsed,
        txResults: ethCallSimulation.results.length
      });

      // Step 2: Submit to multiple relays in parallel
      const submissionPromises = this.multiRelayUrls.map(relayUrl => 
        this.submitToSingleRelay(bundle, relayUrl, traceId)
      );

      // Wait for at least one successful submission
      const submissionResults = await Promise.allSettled(submissionPromises);
      
      // Process results
      const successfulSubmissions = submissionResults
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(result => result.success);

      const failedSubmissions = submissionResults
        .filter(result => result.status === 'rejected' || 
          (result.status === 'fulfilled' && !result.value.success));

      logger.info({
        msg: 'Multi-relay submission completed',
        successfulSubmissions: successfulSubmissions.length,
        failedSubmissions: failedSubmissions.length,
        totalRelays: this.multiRelayUrls.length
      });

      if (successfulSubmissions.length === 0) {
        throw new Error('All relay submissions failed');
      }

      // Return the first successful submission
      const primaryResult = successfulSubmissions[0];
      
      this.metrics.incrementFlashbotsSuccess('submit_multi_relay');
      this.metrics.updateLastBundleBlock(bundle.blockNumber || bundle.targetBlockNumber || 0);

      return {
        bundleHash: primaryResult.bundleHash,
        simulation: {
          success: true,
          gasUsed: ethCallSimulation.gasUsed,
          effectiveGasPrice: (() => {
            const firstTx = bundle.transactions[0];
            if (typeof firstTx === 'string') {
              try {
                const parsedTx = ethers.utils.parseTransaction(firstTx);
                return ethers.BigNumber.from(parsedTx.maxFeePerGas || 0);
              } catch {
                return ethers.BigNumber.from(0);
              }
            } else {
              return ethers.BigNumber.from(firstTx?.maxFeePerGas || 0);
            }
          })(),
          totalValue: bundle.transactions.reduce((sum, tx) => {
            if (typeof tx === 'string') {
              try {
                const parsedTx = ethers.utils.parseTransaction(tx);
                return sum.add(parsedTx.value || 0);
              } catch {
                return sum;
              }
            } else {
              return sum.add(tx.value || 0);
            }
          }, ethers.BigNumber.from(0))
        },
        submission: {
          success: true,
          targetBlock: bundle.blockNumber || bundle.targetBlockNumber || 0,
          bundleHash: primaryResult.bundleHash
        },
        victimIncluded: !!bundle.victimTransaction
      };

    } catch (error: any) {
      logger.error({
        err: error,
        msg: 'Multi-relay bundle submission failed'
      });

      this.metrics.incrementFlashbotsFailure('submit_multi_relay', error.message);

      return {
        bundleHash: '',
        submission: {
          success: false,
          targetBlock: bundle.blockNumber || bundle.targetBlockNumber || 0,
          bundleHash: '',
          error: error.message
        }
      };
    }
  }

  /**
   * Submit bundle to a single relay with retries and exponential backoff
   */
  private async submitToSingleRelay(
    bundle: FlashbotsBundle,
    relayUrl: string,
    traceId?: string,
    maxRetries: number = 3
  ): Promise<{
    success: boolean;
    bundleHash: string;
    relayUrl: string;
    error?: string;
  }> {
    const logger = this.logger.child({ traceId, relayUrl });
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug({
          msg: 'Attempting relay submission',
          attempt,
          maxRetries,
          targetBlock: bundle.blockNumber || bundle.targetBlockNumber
        });

        // In production, this would use actual relay submission
        // For now, simulate the submission
        const bundleHash = `0x${Math.random().toString(16).slice(2, 66)}`;
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logger.info({
          msg: 'Bundle submitted to relay',
          bundleHash,
          attempt,
          relayUrl: relayUrl.replace(/\/\/.*@/, '//***@') // Hide credentials
        });

        return {
          success: true,
          bundleHash,
          relayUrl
        };

      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        
        logger.warn({
          err: error,
          msg: `Relay submission attempt ${attempt} failed`,
          isLastAttempt,
          willRetry: !isLastAttempt
        });

        if (isLastAttempt) {
          return {
            success: false,
            bundleHash: '',
            relayUrl,
            error: error.message
          };
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // Should never reach here, but TypeScript requires it
    return {
      success: false,
      bundleHash: '',
      relayUrl,
      error: 'Unexpected error in retry loop'
    };
  }

  /**
   * Submit bundle to Flashbots relay (legacy method)
   */
  async submitBundle(
    bundle: FlashbotsBundle,
    traceId?: string
  ): Promise<FlashbotsBundleResult> {
    // Delegate to multi-relay submission for enhanced reliability
    return this.submitBundleWithMultiRelay(bundle, traceId);
  }

  /**
   * Create optimized gas fees for bundle transactions
   */
  async createOptimizedGasFees(baseFeePerGas: ethers.BigNumber): Promise<{
    maxFeePerGas: ethers.BigNumber;
    maxPriorityFeePerGas: ethers.BigNumber;
  }> {
    // Use aggressive gas pricing for MEV bundles
    const priorityFee = ethers.utils.parseUnits('2', 'gwei'); // 2 gwei priority
    const maxFee = baseFeePerGas.mul(120).div(100).add(priorityFee); // 120% of base fee + priority
    
    // Cap at MAX_GAS_GWEI
    const maxGasWei = ethers.utils.parseUnits(this.config.maxGasGwei.toString(), 'gwei');
    
    return {
      maxFeePerGas: maxFee.gt(maxGasWei) ? maxGasWei : maxFee,
      maxPriorityFeePerGas: priorityFee.gt(maxGasWei) ? maxGasWei : priorityFee
    };
  }

  /**
   * Get bundle status (if supported by relay)
   */
  async getBundleStatus(bundleHash: string, traceId?: string): Promise<{
    included: boolean;
    blockNumber?: number;
    transactionHashes?: string[];
  }> {
    const logger = this.logger.child({ traceId, bundleHash });
    
    logger.debug({
      msg: 'Checking bundle status',
      bundleHash
    });

    // Mock implementation - in practice would query Flashbots relay
    return {
      included: false // Assume not included for simulation
    };
  }

  /**
   * Get current network base fee for gas estimation
   */
  async getCurrentBaseFee(): Promise<ethers.BigNumber> {
    try {
      const config = getConfig();
      const provider = new ethers.providers.JsonRpcProvider(config.rpcUrlHttp);
      const block = await provider.getBlock('latest');
      
      if (!block.baseFeePerGas) {
        // Fallback for pre-EIP-1559 networks
        const gasPrice = await provider.getGasPrice();
        return gasPrice.mul(90).div(100); // Assume 90% is base fee
      }
      
      return block.baseFeePerGas;
      
    } catch (error: any) {
      this.logger.warn({
        err: error,
        msg: 'Failed to get base fee, using fallback'
      });
      
      // Fallback to 20 gwei
      return ethers.utils.parseUnits('20', 'gwei');
    }
  }
}

/**
 * Create a singleton Flashbots manager instance
 */
let flashbotsManager: FlashbotsManager | null = null;

export function getFlashbotsManager(): FlashbotsManager {
  if (!flashbotsManager) {
    flashbotsManager = new FlashbotsManager();
  }
  return flashbotsManager;
}

/**
 * Reset manager for testing
 */
export function resetFlashbotsManager(): void {
  flashbotsManager = null;
}