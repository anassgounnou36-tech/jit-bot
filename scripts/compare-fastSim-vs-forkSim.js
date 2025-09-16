#!/usr/bin/env node

/**
 * Compare Fast Simulation vs Fork Simulation Performance and Accuracy
 * 
 * This script measures the accuracy drift between fastSim.ts (quick estimates) 
 * and forkSim.ts (full-state fork simulation) across test fixtures.
 * 
 * Usage:
 *   node scripts/compare-fastSim-vs-forkSim.js [--fixtures path/to/fixtures]
 * 
 * Outputs:
 *   - Median & P95 error metrics
 *   - Execution time comparison
 *   - Accuracy breakdown by pool
 *   - JSON report for CI/CD validation
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Import simulation modules
const { fastSimulate, quickProfitabilityCheck } = require('../src/simulator/fastSim');
const { runPreflightSimulation, forkSimulate } = require('../src/simulator/forkSim');

/**
 * Configuration
 */
const CONFIG = {
  fixtures: {
    path: process.argv.includes('--fixtures') 
      ? process.argv[process.argv.indexOf('--fixtures') + 1] 
      : 'reports/fixture-*.json',
    limit: 50 // Max fixtures to process
  },
  simulation: {
    timeoutMs: 30000,
    retries: 2
  },
  tolerance: {
    profitErrorThreshold: 0.10, // 10% error threshold
    gasErrorThreshold: 0.20,    // 20% gas estimate error threshold
    timeoutThreshold: 5000      // 5s max execution time
  }
};

/**
 * Performance and accuracy metrics
 */
class SimulationComparison {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  /**
   * Add comparison result
   */
  addResult(fixture, fastResult, forkResult, timings) {
    const comparison = this.calculateComparison(fastResult, forkResult);
    
    this.results.push({
      fixture: fixture.id || 'unknown',
      pool: fixture.pool || 'unknown',
      swapAmountUSD: fixture.swapAmountUSD || 0,
      timings,
      comparison,
      fastResult: this.sanitizeResult(fastResult),
      forkResult: this.sanitizeResult(forkResult)
    });
  }

  /**
   * Calculate comparison metrics
   */
  calculateComparison(fastResult, forkResult) {
    const comparison = {
      profitError: null,
      gasError: null,
      profitableMismatch: false,
      executionTimeDiff: null
    };

    try {
      // Profit comparison
      if (fastResult.expectedNetProfitUsd !== undefined && forkResult.expectedNetProfitUSD !== undefined) {
        const fastProfit = fastResult.expectedNetProfitUsd;
        const forkProfit = forkResult.expectedNetProfitUSD;
        
        if (forkProfit !== 0) {
          comparison.profitError = Math.abs(fastProfit - forkProfit) / Math.abs(forkProfit);
        }
      }

      // Gas comparison
      if (fastResult.gasEstimate && forkResult.gasUsed) {
        const fastGas = fastResult.gasEstimate.gasUsed || 0;
        const forkGas = forkResult.gasUsed || 0;
        
        if (forkGas > 0) {
          comparison.gasError = Math.abs(fastGas - forkGas) / forkGas;
        }
      }

      // Profitability mismatch
      comparison.profitableMismatch = fastResult.profitable !== forkResult.profitable;

    } catch (error) {
      console.warn(`Error calculating comparison: ${error.message}`);
    }

    return comparison;
  }

  /**
   * Sanitize result for JSON output
   */
  sanitizeResult(result) {
    const sanitized = { ...result };
    
    // Convert BigNumber instances to strings
    for (const [key, value] of Object.entries(sanitized)) {
      if (value && typeof value === 'object' && value._isBigNumber) {
        sanitized[key] = value.toString();
      } else if (value && typeof value === 'object') {
        sanitized[key] = this.sanitizeResult(value);
      }
    }
    
    return sanitized;
  }

  /**
   * Calculate statistics
   */
  calculateStatistics() {
    const validProfitErrors = this.results
      .map(r => r.comparison.profitError)
      .filter(e => e !== null && !isNaN(e));
    
    const validGasErrors = this.results
      .map(r => r.comparison.gasError)
      .filter(e => e !== null && !isNaN(e));
    
    const timings = {
      fastSim: this.results.map(r => r.timings.fastSimMs).filter(t => t > 0),
      forkSim: this.results.map(r => r.timings.forkSimMs).filter(t => t > 0)
    };

    return {
      profitAccuracy: {
        count: validProfitErrors.length,
        median: this.calculatePercentile(validProfitErrors, 0.5),
        p95: this.calculatePercentile(validProfitErrors, 0.95),
        mean: validProfitErrors.reduce((a, b) => a + b, 0) / validProfitErrors.length || 0
      },
      gasAccuracy: {
        count: validGasErrors.length,
        median: this.calculatePercentile(validGasErrors, 0.5),
        p95: this.calculatePercentile(validGasErrors, 0.95),
        mean: validGasErrors.reduce((a, b) => a + b, 0) / validGasErrors.length || 0
      },
      performance: {
        fastSimMedianMs: this.calculatePercentile(timings.fastSim, 0.5),
        forkSimMedianMs: this.calculatePercentile(timings.forkSim, 0.5),
        speedupRatio: this.calculatePercentile(timings.forkSim, 0.5) / this.calculatePercentile(timings.fastSim, 0.5)
      },
      mismatches: {
        profitabilityMismatches: this.results.filter(r => r.comparison.profitableMismatch).length,
        totalComparisons: this.results.length,
        mismatchRate: this.results.filter(r => r.comparison.profitableMismatch).length / this.results.length
      }
    };
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Generate summary report
   */
  generateReport() {
    const stats = this.calculateStatistics();
    const totalTimeMs = Date.now() - this.startTime;

    return {
      summary: {
        totalFixturesProcessed: this.results.length,
        totalExecutionTimeMs: totalTimeMs,
        generatedAt: new Date().toISOString()
      },
      accuracy: {
        profit: {
          medianError: `${(stats.profitAccuracy.median * 100).toFixed(2)}%`,
          p95Error: `${(stats.profitAccuracy.p95 * 100).toFixed(2)}%`,
          passesThreshold: stats.profitAccuracy.median < CONFIG.tolerance.profitErrorThreshold
        },
        gas: {
          medianError: `${(stats.gasAccuracy.median * 100).toFixed(2)}%`,
          p95Error: `${(stats.gasAccuracy.p95 * 100).toFixed(2)}%`,
          passesThreshold: stats.gasAccuracy.median < CONFIG.tolerance.gasErrorThreshold
        }
      },
      performance: {
        fastSimMedianMs: Math.round(stats.performance.fastSimMedianMs),
        forkSimMedianMs: Math.round(stats.performance.forkSimMedianMs),
        speedupFactor: `${stats.performance.speedupRatio.toFixed(1)}x`,
        meetsBenchmark: stats.performance.fastSimMedianMs < 1000 // < 1s for fast sim
      },
      profitabilityConsistency: {
        mismatchRate: `${(stats.mismatches.mismatchRate * 100).toFixed(2)}%`,
        totalMismatches: stats.mismatches.profitabilityMismatches,
        acceptable: stats.mismatches.mismatchRate < 0.05 // < 5% mismatch rate
      },
      rawStatistics: stats,
      detailedResults: this.results.slice(0, 5) // Include first 5 detailed results
    };
  }
}

/**
 * Load test fixtures
 */
async function loadFixtures() {
  try {
    const fixturesPath = path.resolve(CONFIG.fixtures.path.replace('*', ''));
    const fixturesDir = path.dirname(fixturesPath);
    const pattern = path.basename(CONFIG.fixtures.path);
    
    if (!fs.existsSync(fixturesDir)) {
      console.warn(`Fixtures directory not found: ${fixturesDir}`);
      return [];
    }

    const files = fs.readdirSync(fixturesDir)
      .filter(file => file.match(pattern.replace('*', '.*')))
      .slice(0, CONFIG.fixtures.limit);

    const fixtures = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(fixturesDir, file), 'utf8');
        const fixture = JSON.parse(content);
        fixtures.push({ ...fixture, filename: file });
      } catch (error) {
        console.warn(`Failed to load fixture ${file}: ${error.message}`);
      }
    }

    console.log(`✅ Loaded ${fixtures.length} fixtures from ${fixturesDir}`);
    return fixtures;

  } catch (error) {
    console.error(`❌ Failed to load fixtures: ${error.message}`);
    return [];
  }
}

/**
 * Convert fixture to simulation parameters
 */
function convertFixtureToParams(fixture) {
  try {
    return {
      // Fast simulation parameters
      fastParams: {
        poolAddress: fixture.poolAddress || fixture.pool,
        swapAmountIn: ethers.BigNumber.from(fixture.swapAmount || fixture.amountIn || '1000000000000000000'), // 1 ETH default
        swapTokenIn: fixture.tokenIn || fixture.token0,
        swapTokenOut: fixture.tokenOut || fixture.token1,
        expectedPriceImpact: fixture.priceImpact || 0.001,
        liquidityRatio: fixture.liquidityRatio || 0.1
      },
      
      // Fork simulation parameters  
      forkParams: {
        poolAddress: fixture.poolAddress || fixture.pool,
        swapAmountIn: ethers.BigNumber.from(fixture.swapAmount || fixture.amountIn || '1000000000000000000'),
        swapTokenIn: fixture.tokenIn || fixture.token0,
        swapTokenOut: fixture.tokenOut || fixture.token1,
        tickLower: fixture.tickLower || -1000,
        tickUpper: fixture.tickUpper || 1000,
        liquidityAmount: ethers.BigNumber.from(fixture.liquidityAmount || '500000000000000000'), // 0.5 ETH
        gasPrice: ethers.BigNumber.from(fixture.gasPrice || '20000000000'), // 20 gwei
        blockNumber: fixture.blockNumber
      }
    };
  } catch (error) {
    console.warn(`Failed to convert fixture: ${error.message}`);
    return null;
  }
}

/**
 * Run simulation comparison for a single fixture
 */
async function runComparison(fixture, params) {
  const timings = {
    fastSimMs: 0,
    forkSimMs: 0
  };

  try {
    // Run fast simulation
    const fastStart = Date.now();
    const fastResult = await Promise.race([
      fastSimulate(params.fastParams),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('FastSim timeout')), CONFIG.simulation.timeoutMs)
      )
    ]);
    timings.fastSimMs = Date.now() - fastStart;

    // Run fork simulation
    const forkStart = Date.now();
    const forkResult = await Promise.race([
      runPreflightSimulation(params.forkParams),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('ForkSim timeout')), CONFIG.simulation.timeoutMs)
      )
    ]);
    timings.forkSimMs = Date.now() - forkStart;

    return { fastResult, forkResult, timings };

  } catch (error) {
    console.warn(`Simulation failed for fixture ${fixture.filename}: ${error.message}`);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 Starting Fast vs Fork Simulation Comparison');
  console.log(`⚙️  Configuration: ${JSON.stringify(CONFIG, null, 2)}`);

  const comparison = new SimulationComparison();
  
  try {
    // Load fixtures
    const fixtures = await loadFixtures();
    if (fixtures.length === 0) {
      console.error('❌ No fixtures found to process');
      process.exit(1);
    }

    // Process each fixture
    console.log(`\n🧪 Processing ${fixtures.length} fixtures...`);
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i];
      console.log(`[${i + 1}/${fixtures.length}] Processing ${fixture.filename}...`);

      const params = convertFixtureToParams(fixture);
      if (!params) {
        failed++;
        continue;
      }

      const result = await runComparison(fixture, params);
      if (result) {
        comparison.addResult(fixture, result.fastResult, result.forkResult, result.timings);
        successful++;
        
        // Log quick status
        const { fastResult, forkResult } = result;
        const profitMatch = fastResult.profitable === forkResult.profitable ? '✅' : '❌';
        console.log(`  ${profitMatch} Fast: ${fastResult.profitable}, Fork: ${forkResult.profitable}`);
      } else {
        failed++;
      }
    }

    // Generate and save report
    const report = comparison.generateReport();
    
    console.log(`\n📊 Comparison Results:`);
    console.log(`✅ Successful: ${successful}, ❌ Failed: ${failed}`);
    console.log(`📈 Profit Accuracy - Median: ${report.accuracy.profit.medianError}, P95: ${report.accuracy.profit.p95Error}`);
    console.log(`⛽ Gas Accuracy - Median: ${report.accuracy.gas.medianError}, P95: ${report.accuracy.gas.p95Error}`);
    console.log(`⚡ Performance - FastSim: ${report.performance.fastSimMedianMs}ms, ForkSim: ${report.performance.forkSimMedianMs}ms (${report.performance.speedupFactor} speedup)`);
    console.log(`🎯 Profitability Consistency: ${report.profitabilityConsistency.mismatchRate} mismatch rate`);

    // Save detailed report
    const reportPath = path.join(__dirname, '../reports/fastSim-vs-forkSim-comparison.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`💾 Detailed report saved to: ${reportPath}`);

    // Exit code based on success criteria
    const success = 
      report.accuracy.profit.passesThreshold &&
      report.accuracy.gas.passesThreshold &&
      report.performance.meetsBenchmark &&
      report.profitabilityConsistency.acceptable;

    if (success) {
      console.log('🎉 All benchmarks passed!');
      process.exit(0);
    } else {
      console.log('⚠️  Some benchmarks failed - check detailed report');
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Comparison failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Comparison interrupted');
  process.exit(1);
});

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error(`❌ Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  SimulationComparison,
  loadFixtures,
  runComparison
};