# Bundle Ordering and Victim Transaction Inclusion

This document explains the critical bundle ordering requirements for the JIT bot and how victim transactions are captured and included in Flashbots bundles.

## Why Bundle Ordering Matters

For JIT (Just-In-Time) liquidity provision to be profitable, the victim's swap transaction must execute against our concentrated liquidity position. This requires precise ordering:

1. **JIT Mint**: Create concentrated liquidity position around expected swap price
2. **Victim Swap**: The user's transaction executes, trading against our liquidity
3. **JIT Burn/Collect**: Remove liquidity and collect fees earned from the victim's swap

If the victim transaction doesn't execute between our mint and burn operations, we won't capture any fees and will likely lose money on gas costs and flashloan fees.

## Bundle Structure

### Standard Bundle Order
```
Transaction 0: JIT Flashloan + Mint (our transaction)
Transaction 1: Victim Swap (captured from mempool)
Transaction 2: JIT Burn/Collect + Repay (our transaction)
```

### Alternative: Single Callback Bundle
```
Transaction 0: JIT Flashloan Call (includes mint/burn in callback)
Transaction 1: Victim Swap (executed during callback execution)
```

## Victim Transaction Capture

### Raw Transaction Bytes
The bot captures raw signed transaction bytes from the mempool for two reasons:

1. **Deterministic Inclusion**: Raw bytes ensure the exact transaction is included in our bundle
2. **Precise Ordering**: We control exactly where the victim transaction appears in the bundle

### Implementation

#### Mempool Watcher Enhancement
```typescript
export interface PendingSwap {
  // ... existing fields
  rawTransaction?: string; // Raw signed transaction bytes
}
```

#### Capturing Raw Bytes
```typescript
private serializeTransaction(tx: ethers.providers.TransactionResponse): string | undefined {
  try {
    // In production, capture raw signed bytes from mempool
    // This example shows reconstruction for testing
    const txData = {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      nonce: tx.nonce,
      type: tx.type || 0,
      chainId: tx.chainId
    };
    
    return ethers.utils.serializeTransaction(txData);
  } catch (error) {
    return undefined;
  }
}
```

### Provider Requirements

#### Production Setup
For live execution, you need access to raw mempool transactions:

1. **Local Node**: Run your own Ethereum node with mempool access
2. **Custom RPC**: Use a provider that exposes `eth_getRawTransactionByHash` or similar
3. **WebSocket Mempool Stream**: Subscribe to real-time pending transaction feeds

#### Fallback Strategy
If raw transaction bytes are unavailable:
- Candidate is rejected (safer approach)
- Or use alternative deterministic ordering (document your approach)

## Bundle Creation Process

### Enhanced Bundle Creation
```typescript
async createEnhancedBundle(params: EnhancedBundleParams): Promise<FlashbotsBundle> {
  // Validate victim transaction is present
  if (!params.victimTransaction) {
    throw new Error('Victim transaction required for enhanced bundle creation');
  }

  // Create bundle with precise ordering
  const bundle: FlashbotsBundle = {
    transactions: jitTxRequests,
    targetBlockNumber: params.targetBlockNumber,
    maxBlockNumber: params.targetBlockNumber + 3,
    victimTransaction: {
      rawTx: params.victimTransaction.rawTx,
      hash: params.victimTransaction.hash,
      insertAfterIndex: 0 // Insert after first JIT transaction
    }
  };

  return bundle;
}
```

### Bundle Validation
```typescript
validateBundleOrdering(bundle: FlashbotsBundle): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check victim transaction inclusion
  if (bundle.victimTransaction) {
    if (!bundle.victimTransaction.rawTx) {
      issues.push('Victim transaction raw bytes required');
    }
    
    if (!bundle.victimTransaction.hash) {
      issues.push('Victim transaction hash required');
    }
  }

  return { valid: issues.length === 0, issues };
}
```

## Test Fixtures

### Fixture Format
Test fixtures include victim transaction data for E2E testing:

```json
{
  "poolAddress": "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8",
  "blockNumber": 18500000,
  "victimTransaction": {
    "hash": "0x1234567890abcdef...",
    "rawTx": "0x02f86d0182f618...",
    "data": "0x414bf389...",
    "from": "0xAbcdEf...",
    "to": "0xE592427A0AEce92De3Edee1F18E0157C05861564"
  },
  "swapParams": {
    "tokenIn": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "tokenOut": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "amountIn": "10000000000000000000",
    "fee": 3000
  }
}
```

### Generating Fixtures

#### Automatic Generation
```bash
# Generate fixtures from recent mainnet blocks
node scripts/generate-fixtures.js
```

#### Manual Creation
For testing, you can create fixtures manually:

1. Find a suitable Uniswap V3 swap transaction
2. Extract the raw transaction bytes (if available)
3. Create fixture JSON following the format above
4. Validate with the test suite

### Updating Fixtures

#### Regular Updates
```bash
# Update fixtures with recent transactions (weekly)
npm run fixtures:update
```

#### Fixture Validation
```bash
# Validate all fixtures are properly formatted
npm run fixtures:validate
```

## Testing Bundle Ordering

### Unit Tests
```typescript
describe('Bundle Ordering', () => {
  it('should create bundle with correct victim transaction placement', async () => {
    const bundle = await flashbotsManager.createEnhancedBundle({
      jitTransactions: mockJitTxs,
      victimTransaction: {
        rawTx: '0x02f86d0182f618...',
        hash: '0x1234567890abcdef...'
      },
      targetBlockNumber: 18500000
    });

    expect(bundle.victimTransaction).to.exist;
    expect(bundle.victimTransaction.insertAfterIndex).to.equal(0);
  });
});
```

### Integration Tests
```typescript
describe('E2E Bundle Simulation', () => {
  it('should simulate profitable execution with victim transaction', async () => {
    const fixture = loadFixture('fixture-USDC-WETH-0.3%-18500000.json');
    
    const result = await runPreflightSimulation({
      ...simulationParams,
      victimTransaction: fixture.victimTransaction
    });

    expect(result.simulationSteps.victimTxIncluded).to.be.true;
    expect(result.profitable).to.be.true;
  });
});
```

## Monitoring and Alerts

### Key Metrics
- `jit_bot_bundles_without_victim_tx_total`: Bundles created without victim transactions
- `jit_bot_raw_tx_capture_failures_total`: Failures to capture raw transaction bytes
- `jit_bot_bundle_ordering_violations_total`: Bundle ordering validation failures

### Alert Rules
```yaml
- alert: VictimTransactionMissing
  expr: jit_bot_bundles_without_victim_tx_total > 0
  for: 1m
  annotations:
    summary: "Bundles created without victim transactions"

- alert: RawTransactionCaptureFailure
  expr: increase(jit_bot_raw_tx_capture_failures_total[5m]) > 3
  for: 2m
  annotations:
    summary: "Failing to capture raw transaction bytes"
```

## Troubleshooting

### Common Issues

#### Missing Raw Transaction Bytes
**Symptom**: Bundles fail validation with "raw bytes required"
**Solution**: 
1. Check your RPC provider supports raw transaction access
2. Verify mempool watcher is capturing transactions correctly
3. Consider using static fixtures for testing

#### Bundle Ordering Violations
**Symptom**: Bundle validation fails with ordering issues
**Solution**:
1. Ensure victim transaction insert index is valid
2. Check JIT transaction count (should be exactly 2)
3. Validate bundle structure before submission

#### Simulation vs. Live Profit Deviation
**Symptom**: Actual profits differ significantly from simulation
**Solution**:
1. Check if victim transaction executed as expected
2. Verify gas price modeling accuracy
3. Review Uniswap V3 fee calculations

### Debug Commands
```bash
# Test bundle creation with specific fixture
node scripts/test-bundle-creation.js --fixture reports/fixture-USDC-WETH-0.3%-18500000.json

# Validate victim transaction format
node scripts/validate-victim-tx.js --hash 0x1234567890abcdef...

# Simulate bundle execution locally
npm run bundle:simulate -- --pool USDC-WETH --amount 10
```

## Security Considerations

### Raw Transaction Validation
Always validate victim transactions before inclusion:
- Verify transaction hash matches expected format
- Check transaction is actually a Uniswap V3 swap
- Ensure swap targets our monitored pools
- Validate swap amount meets minimum thresholds

### Bundle Submission Security
- Never submit bundles without proper validation
- Always simulate bundles before live submission
- Monitor for MEV sandwich attacks on our positions
- Implement profit guards to prevent unprofitable execution

## Production Checklist

Before enabling live execution with victim transaction inclusion:

- [ ] Raw transaction capture is working correctly
- [ ] Bundle validation passes for all test fixtures
- [ ] E2E tests pass with victim transaction inclusion
- [ ] Monitoring alerts are configured and tested
- [ ] Profit guards are active and tested
- [ ] Provider fallback logic is implemented
- [ ] Documentation is complete and up-to-date