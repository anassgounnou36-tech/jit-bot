#!/usr/bin/env node
/**
 * Validate test fixtures for proper format and required fields
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = [
  'poolAddress',
  'blockNumber',
  'victimTransaction',
  'swapParams',
  'expectedResults',
  'metadata'
];

const REQUIRED_VICTIM_TX_FIELDS = [
  'hash',
  'rawTx',
  'data',
  'from',
  'to'
];

const REQUIRED_SWAP_PARAMS = [
  'tokenIn',
  'tokenOut',
  'amountIn',
  'fee'
];

function validateFixture(fixturePath) {
  console.log(`Validating ${path.basename(fixturePath)}...`);
  
  try {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    
    // Check required top-level fields
    for (const field of REQUIRED_FIELDS) {
      if (!(field in fixture)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate victim transaction fields
    for (const field of REQUIRED_VICTIM_TX_FIELDS) {
      if (!(field in fixture.victimTransaction)) {
        throw new Error(`Missing required victimTransaction field: ${field}`);
      }
    }
    
    // Validate swap parameters
    for (const field of REQUIRED_SWAP_PARAMS) {
      if (!(field in fixture.swapParams)) {
        throw new Error(`Missing required swapParams field: ${field}`);
      }
    }
    
    // Validate data types
    if (typeof fixture.blockNumber !== 'number') {
      throw new Error('blockNumber must be a number');
    }
    
    if (typeof fixture.swapParams.fee !== 'number') {
      throw new Error('swapParams.fee must be a number');
    }
    
    // Validate Ethereum addresses
    const addressFields = [
      ['poolAddress', fixture.poolAddress],
      ['victimTransaction.from', fixture.victimTransaction.from],
      ['victimTransaction.to', fixture.victimTransaction.to],
      ['swapParams.tokenIn', fixture.swapParams.tokenIn],
      ['swapParams.tokenOut', fixture.swapParams.tokenOut]
    ];
    
    for (const [fieldName, address] of addressFields) {
      if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error(`Invalid Ethereum address in ${fieldName}: ${address}`);
      }
    }
    
    // Validate transaction hash
    if (!fixture.victimTransaction.hash.match(/^0x[a-fA-F0-9]{64}$/)) {
      throw new Error(`Invalid transaction hash: ${fixture.victimTransaction.hash}`);
    }
    
    // Validate raw transaction starts with 0x
    if (!fixture.victimTransaction.rawTx.startsWith('0x')) {
      throw new Error('rawTx must start with 0x');
    }
    
    console.log(`✓ ${path.basename(fixturePath)} is valid`);
    return true;
    
  } catch (error) {
    console.error(`❌ ${path.basename(fixturePath)}: ${error.message}`);
    return false;
  }
}

function main() {
  const reportsDir = path.join(process.cwd(), 'reports');
  
  if (!fs.existsSync(reportsDir)) {
    console.log('No reports directory found. Creating example fixture...');
    
    // Create reports directory and example fixture
    fs.mkdirSync(reportsDir, { recursive: true });
    
    const exampleFixture = {
      poolAddress: "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8",
      blockNumber: 18500000,
      victimTransaction: {
        hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        rawTx: "0x02f86d0182f618843b9aca0085012a05f200825208948ad599c3a0ff1de082011efddc58f1908eb6e6d8872386f26fc10000880de0b6b3a764000080c0",
        data: "0x414bf389000000000000000000000000a0b86a33e6427ff2b5b8b9a5e5d17b5c4c6f6b7c000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000bb8",
        from: "0xAbcdEfAbcdEfAbcdEfAbcdEfAbcdEfAbcdEfAbcdEf",
        to: "0xE592427A0AEce92De3Edee1F18E0157C05861564"
      },
      swapParams: {
        tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        tokenOut: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        amountIn: "10000000000000000000",
        fee: 3000
      },
      expectedResults: {
        profitable: true,
        estimatedNetProfitUSD: 75.50
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        chain: "ethereum",
        description: "Example test fixture"
      }
    };
    
    fs.writeFileSync(
      path.join(reportsDir, 'example-fixture.json'),
      JSON.stringify(exampleFixture, null, 2)
    );
    
    console.log('Created example fixture: reports/example-fixture.json');
    return;
  }
  
  const fixtures = fs.readdirSync(reportsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(reportsDir, f));
  
  if (fixtures.length === 0) {
    console.log('No fixture files found in reports/ directory');
    return;
  }
  
  console.log(`Found ${fixtures.length} fixture files to validate:`);
  
  let validCount = 0;
  let totalCount = 0;
  
  for (const fixturePath of fixtures) {
    totalCount++;
    if (validateFixture(fixturePath)) {
      validCount++;
    }
  }
  
  console.log(`\n=== Validation Summary ===`);
  console.log(`Valid fixtures: ${validCount}/${totalCount}`);
  
  if (validCount === totalCount) {
    console.log('✅ All fixtures are valid!');
    process.exit(0);
  } else {
    console.log('❌ Some fixtures have validation errors');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateFixture };