# Bundle Builder Compatibility Updates

This document describes the recent compatibility updates made to the bundle builder to support both test expectations and documented bundle ordering requirements.

## Changes Made

### 1. Enhanced FlashbotsBundle Interface

The `FlashbotsBundle` interface now includes additional optional fields for improved compatibility:

```typescript
export interface FlashbotsBundle {
  transactions: string[];
  blockNumber: number;
  targetBlockNumber?: number;    // NEW: For bundle ordering validation
  maxBlockNumber?: number;       // NEW: For Flashbots submission window
  minTimestamp?: number;
  maxTimestamp?: number;
  victimTransaction?: {
    rawTxHex: string;
    rawTx?: string;              // NEW: Compatibility alias
    hash: string;
    insertAfterIndex: number;
  };
}
```

### 2. Victim Transaction Compatibility

The bundle builder now provides both `rawTx` and `rawTxHex` fields:

- `rawTxHex`: Original field, maintains backward compatibility
- `rawTx`: New alias field, same value as `rawTxHex`, for test and docs compatibility

### 3. Block Number Fields

All bundles now include:

- `blockNumber`: Original field (unchanged)
- `targetBlockNumber`: Set to the same value as `blockNumber`
- `maxBlockNumber`: Set to `targetBlockNumber + 3` (3-block submission window)

### 4. Bundle Validation Helper

A new exported function `validateBundleOrdering()` provides flexible bundle validation:

```typescript
export function validateBundleOrdering(bundle: {
  transactions?: string[];
  blockNumber?: number;
  targetBlockNumber?: number;
  victimTransaction?: {
    rawTxHex?: string;
    rawTx?: string;
    hash?: string;
    insertAfterIndex?: number;
  };
}): { valid: boolean; issues: string[] }
```

**Key Features:**
- Accepts either `rawTx` OR `rawTxHex` (not both required)
- Validates `targetBlockNumber` with fallback to `blockNumber`
- Validates victim transaction structure when present
- Returns detailed validation results with specific issue descriptions

## Usage Examples

### Enhanced Bundle Creation

```typescript
const enhancedBundle = await bundleBuilder.buildEnhancedJitBundle(
  pendingSwap,
  jitParams,
  contractAddress
);

const flashbotsBundle = await bundleBuilder.convertToFlashbotsBundle(enhancedBundle);

// Bundle now includes all compatibility fields:
console.log(flashbotsBundle.targetBlockNumber);  // Available
console.log(flashbotsBundle.maxBlockNumber);     // Available  
console.log(flashbotsBundle.victimTransaction.rawTx);    // Available
console.log(flashbotsBundle.victimTransaction.rawTxHex); // Still available
```

### Bundle Validation

```typescript
import { validateBundleOrdering } from './src/bundler/bundleBuilder';

// Works with either rawTx or rawTxHex
const result1 = validateBundleOrdering({
  transactions: ['0x...'],
  blockNumber: 18000001,
  victimTransaction: {
    rawTx: '0x...',
    hash: '0x...',
    insertAfterIndex: 0
  }
});

const result2 = validateBundleOrdering({
  transactions: ['0x...'],
  targetBlockNumber: 18000001,
  victimTransaction: {
    rawTxHex: '0x...',
    hash: '0x...',
    insertAfterIndex: 0
  }
});

if (!result1.valid) {
  console.log('Validation issues:', result1.issues);
}
```

## Backward Compatibility

All existing code continues to work unchanged:

- Existing `rawTxHex` field still populated
- Original `blockNumber` field maintained
- No breaking changes to method signatures
- Legacy `buildJitBundle()` also includes new fields

## Test Compatibility

These changes specifically address test expectations:

- Tests expecting `victimTransaction.rawTx` now pass
- Bundle ordering tests with `targetBlockNumber` validation work
- `insertAfterIndex: 0` preserved for unit test compatibility
- Validation helper supports both documented and legacy formats

## Implementation Notes

- The `rawTx` field is an alias containing the same value as `rawTxHex`
- `maxBlockNumber` is always set to `targetBlockNumber + 3`
- The validation function is intentionally permissive about field presence to support various bundle formats
- All changes maintain full backward compatibility with existing bundle creation workflows