# Bundle Ordering and Victim Transaction Inclusion

This document explains the critical bundle ordering requirements for JIT (Just-In-Time) MEV strategies and the exact mechanism for including victim transactions in Flashbots bundles.

## Overview

The JIT bot captures profitable opportunities by providing liquidity just before a large swap occurs, collecting fees, and then removing the liquidity. The bundle ordering is critical to ensure the strategy executes correctly.

## Required Bundle Structure

### Enhanced Bundle Format (Primary)

For MEV sandwich attacks and JIT strategies, the bundle **MUST** follow this exact ordering:

```
1. JitExecutor.executeFlashloan() - Triggers flashloan and mints JIT position
2. [VICTIM TRANSACTION] - Raw signed transaction from mempool  
3. JitExecutor.burnAndCollect() - Burns position and collects fees/profit
```

This ordering ensures:
- JIT liquidity is provided before the victim swap
- Victim swap executes against our liquidity 
- We immediately collect fees and remove liquidity
- Atomic execution prevents sandwich attacks on our position

### Standard Bundle Format (Fallback)

For simpler JIT strategies without victim transaction inclusion:

```
1. JitExecutor.executeJit() - Single-transaction JIT execution
```

## Victim Transaction Inclusion Mechanism

### Raw Transaction Bytes Requirement

The victim transaction **MUST** be included as raw signed transaction bytes (`rawTxHex`), not as a transaction request object. This is critical because:

1. **Exact Execution**: Raw bytes ensure the exact transaction (including signature) executes
2. **Nonce Management**: Prevents nonce conflicts and replacement attacks
3. **Gas Price Integrity**: Preserves original gas pricing and priority
4. **MEV Protection**: Cannot be front-run or modified

### Technical Implementation

#### 1. Mempool Capture

The mempool watcher captures raw transaction bytes using multiple strategies:

```typescript
// Primary: Local node raw transaction API
const rawTx = await provider.send('eth_getRawTransactionByHash', [txHash]);

// Fallback: Enhanced provider APIs  
const rawTx = await enhancedProvider.getRawTransaction(txHash);

// Last resort: Reconstruction (incomplete)
const rawTx = ethers.utils.serializeTransaction(txObject);
```

#### 2. Bundle Construction

```typescript
const bundle = {
  transactions: [signedJitMintTx, signedJitBurnTx], // Our JIT transactions
  victimTransaction: {
    rawTxHex: "0x02f8b20182...", // Raw signed bytes from mempool
    hash: "0x1234567890...",     // Transaction hash for verification
    insertAfterIndex: 0          // Insert after first JIT tx (mint)
  },
  targetBlockNumber: currentBlock + 1
};
```

#### 3. Flashbots Bundle Formatting

```typescript
// Final bundle sent to Flashbots
const flashbotsBundle = [
  signedJitMintTx,           // Signed transaction hex
  bundle.victimTransaction.rawTxHex, // Raw victim transaction  
  signedJitBurnTx            // Signed transaction hex
];
```

## Validation Requirements

### Bundle Ordering Validation

The `validateBundleOrdering()` function enforces these rules:

#### Enhanced Bundles (with victim transaction):
- ✅ **MUST** contain exactly 2 JIT transactions (mint + burn)
- ✅ **MUST** have `victimTransaction.rawTxHex` or `victimTransaction.rawTx`
- ✅ **MUST** have `victimTransaction.hash` for verification
- ✅ **MUST** set `insertAfterIndex = 0` (victim goes after mint)
- ✅ Total gas usage **MUST** be < 80% of block gas limit

#### Standard Bundles (no victim transaction):
- ✅ **MUST** contain at least 1 transaction
- ✅ **MUST** have valid transaction structure and signatures
- ✅ Supports single-transaction bundles for simple JIT operations

## Fallback Policies

### Missing Raw Transaction Bytes

If `rawTxHex` is not available, the default policy is:

1. **REJECT** the opportunity (configurable override available)
2. Log the rejection reason for debugging
3. Emit metrics for monitoring capture success rates

```typescript
// Default configuration
const REJECT_WITHOUT_RAW_TX = true; // Can be overridden via config

if (!pendingSwap.rawTxHex && REJECT_WITHOUT_RAW_TX) {
  logger.warn({
    msg: 'Rejecting opportunity: no raw transaction bytes',
    txHash: pendingSwap.hash,
    policy: 'REJECT_WITHOUT_RAW_TX'
  });
  return null;
}
```

### Victim Transaction Replacement

If the victim transaction is replaced or canceled:

1. **ABORT** bundle construction immediately
2. Log replacement detection with root cause analysis
3. Emit metrics for replacement rate monitoring
4. Optionally retry with new transaction (if replacement detected quickly)

```typescript
// Replacement detection
if (await provider.getTransaction(victimTxHash) === null) {
  logger.warn({
    msg: 'Victim transaction replaced or canceled',
    originalHash: victimTxHash,
    action: 'ABORT_BUNDLE'
  });
  throw new Error('Victim transaction no longer valid');
}
```

## Security Considerations

### Bundle Simulation

All bundles **MUST** pass `eth_callBundle` simulation before submission:

```typescript
const simulation = await flashbotsProvider.simulate(bundle, targetBlock);
if (!simulation.success) {
  throw new Error(`Bundle simulation failed: ${simulation.error}`);
}
```

### Gas Price Competition

JIT transactions should use competitive gas pricing:

```typescript
const baseFee = await provider.getBlock('latest').baseFeePerGas;
const maxFeePerGas = baseFee.mul(130).div(100); // 130% of base fee
const maxPriorityFeePerGas = ethers.utils.parseUnits('3', 'gwei'); // 3 gwei tip
```

### Profit Validation

On-chain profit guard **MUST** be enforced:

```solidity
if (finalAmount < repayAmount + minProfitThreshold) {
    revert InsufficientProfit(repayAmount + minProfitThreshold, finalAmount);
}
```

## Monitoring and Metrics

### Key Metrics to Track

1. **Raw TX Capture Rate**: % of opportunities with raw transaction bytes
2. **Bundle Success Rate**: % of submitted bundles that land on-chain  
3. **Victim TX Replacement Rate**: % of victims replaced before execution
4. **Profit Realization Rate**: % of expected profit actually captured

### Alerting Rules

- Alert if raw TX capture rate < 90%
- Alert if bundle success rate < 50%  
- Alert if victim replacement rate > 10%
- Alert if no successful bundles for > 30 minutes

## Examples

### Complete JIT Bundle Example

```json
{
  "transactions": [
    "0x02f87101...", // JIT mint transaction (signed)
    "0x02f87102...", // JIT burn transaction (signed)  
  ],
  "victimTransaction": {
    "rawTxHex": "0x02f8b20182059889...", // Victim's raw signed transaction
    "hash": "0x1234567890abcdef...",
    "insertAfterIndex": 0
  },
  "targetBlockNumber": 18500001,
  "minTimestamp": 1640995200,
  "maxTimestamp": 1640995260
}
```

### Sanitized Simulation Success Example

```json
{
  "bundleHash": "0xabcdef1234567890...",
  "simulation": {
    "success": true,
    "gasUsed": 450000,
    "effectiveGasPrice": "25000000000",
    "profit": "45000000000000000", // 0.045 ETH
    "transactions": [
      {"gasUsed": 180000, "success": true},
      {"gasUsed": 120000, "success": true}, // Victim
      {"gasUsed": 150000, "success": true}
    ]
  },
  "victimIncluded": true,
  "orderingValid": true
}
```

## References

- [Flashbots Bundle Documentation](https://docs.flashbots.net/flashbots-auction/searchers/advanced/bundle-pricing)
- [MEV Bundle Ordering Best Practices](https://github.com/flashbots/pm/blob/main/guides/searcher-onboarding.md)
- [Transaction Pool API Specification](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getrawTransactionByHash)