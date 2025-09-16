#!/usr/bin/env node

/**
 * JIT Bot Production Verification Script
 * 
 * This script runs comprehensive verification commands and collects outputs
 * for production deployment validation. It ensures all acceptance criteria
 * are met before live execution.
 * 
 * Usage:
 *   node scripts/verifier.js
 * 
 * Outputs:
 *   - reports/verifier-output.json (comprehensive verification results)
 *   - Console output with pass/fail status for each verification
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);

/**
 * Verification result structure
 */
class VerificationResult {
  constructor() {
    this.startTime = Date.now();
    this.results = {};
    this.summary = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };
  }

  addResult(testName, passed, output, error = null, duration = 0) {
    this.results[testName] = {
      passed,
      duration,
      output: this.truncateOutput(output),
      error: error ? this.truncateOutput(error) : null,
      timestamp: new Date().toISOString()
    };

    this.summary.totalTests++;
    if (passed) {
      this.summary.passed++;
    } else if (error && error.includes('SKIP')) {
      this.summary.skipped++;
    } else {
      this.summary.failed++;
    }
  }

  truncateOutput(output, maxLines = 50) {
    if (!output) return null;
    
    const lines = output.split('\n');
    if (lines.length <= maxLines) return output;
    
    return lines.slice(0, maxLines).join('\n') + 
           `\n... (truncated ${lines.length - maxLines} lines)`;
  }

  generateReport() {
    const totalTime = Date.now() - this.startTime;
    
    return {
      summary: {
        ...this.summary,
        totalDurationMs: totalTime,
        successRate: this.summary.totalTests > 0 ? 
          (this.summary.passed / this.summary.totalTests * 100).toFixed(2) + '%' : '0%',
        overallPassed: this.summary.failed === 0
      },
      results: this.results,
      generatedAt: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd()
      }
    };
  }
}

/**
 * Execute a command and capture output
 */
async function executeCommand(command, options = {}) {
  const timeoutMs = options.timeout || 120000; // 2 minutes default
  const cwd = options.cwd || process.cwd();
  
  console.log(`🔧 Executing: ${command}`);
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    
    const child = spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, ...options.env }
    });
    
    // Set timeout
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      
      if (timedOut) {
        resolve({
          passed: false,
          output: stdout,
          error: `Command timed out after ${timeoutMs}ms\n${stderr}`,
          duration,
          code: null
        });
      } else {
        resolve({
          passed: code === 0,
          output: stdout,
          error: stderr,
          duration,
          code
        });
      }
    });
    
    child.on('error', (err) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      resolve({
        passed: false,
        output: stdout,
        error: `Process error: ${err.message}\n${stderr}`,
        duration,
        code: null
      });
    });
  });
}

/**
 * Check if file exists
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Validation tests configuration
 */
const VERIFICATION_TESTS = [
  {
    name: 'profit-guard-tests',
    description: 'JitExecutor Profit Guard Tests',
    command: 'npx hardhat test test/solidity/JitExecutor.profitGuard.test.ts --network hardhat',
    timeout: 180000, // 3 minutes
    required: true
  },
  {
    name: 'flashloan-callback-tests',
    description: 'JitExecutor Flashloan Callback Tests',
    command: 'npx hardhat test test/solidity/JitExecutor.callback.test.ts --network hardhat',
    timeout: 180000,
    required: true
  },
  {
    name: 'mempool-raw-tx-capture',
    description: 'Mempool Raw Transaction Capture Unit Tests',
    command: 'npm run test:unit -- --grep "mempool raw tx capture"',
    timeout: 120000,
    required: true
  },
  {
    name: 'bundle-inclusion',
    description: 'Bundle Inclusion & eth_callBundle Simulation',
    command: 'npm run test:unit -- --grep "bundle inclusion"',
    timeout: 120000,
    required: true
  },
  {
    name: 'fork-e2e-reports',
    description: 'Fork E2E Reports Creation',
    command: 'node scripts/run-fork-e2e.js --fixtures reports/fixtures/*.json',
    timeout: 300000, // 5 minutes
    required: true
  },
  {
    name: 'slither-analysis',
    description: 'Slither Security Analysis',
    command: 'SLITHER_ENABLE=true npm run slither',
    timeout: 300000,
    required: true,
    env: { SLITHER_ENABLE: 'true' }
  },
  {
    name: 'deploy-safe-dryrun',
    description: 'Deploy Safe Dry Run',
    command: 'DRY_RUN=true ts-node scripts/deploy-safe.ts --network sepolia',
    timeout: 120000,
    required: true,
    env: { DRY_RUN: 'true' }
  },
  {
    name: 'config-validation',
    description: 'Configuration Validation',
    command: 'npm run test:unit -- --grep "config validation"',
    timeout: 60000,
    required: true
  }
];

/**
 * File existence checks
 */
const FILE_CHECKS = [
  {
    name: 'contract-source',
    path: 'contracts/JitExecutor.sol',
    description: 'JitExecutor contract source'
  },
  {
    name: 'profit-guard-test',
    path: 'test/solidity/JitExecutor.profitGuard.test.sol',
    description: 'Profit guard test file'
  },
  {
    name: 'callback-test',
    path: 'test/solidity/JitExecutor.callback.test.sol',
    description: 'Callback test file'
  },
  {
    name: 'mempool-watcher',
    path: 'src/watcher/mempoolWatcher.ts',
    description: 'Mempool watcher implementation'
  },
  {
    name: 'bundle-builder',
    path: 'src/bundler/bundleBuilder.ts',
    description: 'Bundle builder implementation'
  },
  {
    name: 'balancer-adapter',
    path: 'src/exec/balancerAdapter.ts',
    description: 'Balancer flashloan adapter'
  },
  {
    name: 'aave-adapter',
    path: 'src/exec/aaveAdapter.ts',
    description: 'Aave flashloan adapter'
  },
  {
    name: 'flashloan-orchestrator',
    path: 'src/exec/flashloan.ts',
    description: 'Flashloan orchestrator'
  },
  {
    name: 'fast-simulator',
    path: 'src/simulator/fastSim.ts',
    description: 'Fast simulation implementation'
  },
  {
    name: 'fork-simulator',
    path: 'src/simulator/forkSim.ts',
    description: 'Fork simulation implementation'
  },
  {
    name: 'deploy-safe-script',
    path: 'scripts/deploy-safe.ts',
    description: 'Safe deployment script'
  },
  {
    name: 'compare-sims-script',
    path: 'scripts/compare-fastSim-vs-forkSim.js',
    description: 'Simulation comparison script'
  },
  {
    name: 'sample-pending-candidate',
    path: 'reports/sample-pending-candidate.json',
    description: 'Sample pending candidate file'
  },
  {
    name: 'eth-callbundle-simulation',
    path: 'reports/eth_callBundle-simulation-success.json', 
    description: 'eth_callBundle simulation success file'
  },
  {
    name: 'fork-e2e-summary-1',
    path: 'reports/fork-e2e-summary-1.json',
    description: 'Fork E2E summary 1'
  },
  {
    name: 'fork-e2e-summary-2',
    path: 'reports/fork-e2e-summary-2.json',
    description: 'Fork E2E summary 2'
  },
  {
    name: 'fork-e2e-summary-3',
    path: 'reports/fork-e2e-summary-3.json',
    description: 'Fork E2E summary 3'
  },
  {
    name: 'slither-summary',
    path: 'slither-summary.json',
    description: 'Slither summary file'
  },
  {
    name: 'verifier-output',
    path: 'reports/verifier-output.json',
    description: 'Verifier output file'
  }
];

/**
 * Configuration checks
 */
const CONFIG_CHECKS = [
  {
    name: 'private-key-set',
    check: () => !!process.env.PRIVATE_KEY,
    description: 'PRIVATE_KEY environment variable'
  },
  {
    name: 'different-keys',
    check: () => {
      const privateKey = process.env.PRIVATE_KEY;
      const flashbotsKey = process.env.FLASHBOTS_SIGNING_KEY;
      return privateKey && flashbotsKey && privateKey !== flashbotsKey;
    },
    description: 'PRIVATE_KEY !== FLASHBOTS_SIGNING_KEY'
  },
  {
    name: 'dry-run-default',
    check: () => process.env.DRY_RUN !== 'false',
    description: 'DRY_RUN=true for safety (default)'
  },
  {
    name: 'risk-acknowledgment',
    check: () => process.env.I_UNDERSTAND_LIVE_RISK !== 'true',
    description: 'I_UNDERSTAND_LIVE_RISK not set (safe for testing)'
  },
  {
    name: 'min-balance-configured',
    check: () => !!process.env.MIN_REQUIRED_ETH,
    description: 'MIN_REQUIRED_ETH configured'
  },
  {
    name: 'rpc-urls-set',
    check: () => !!process.env.RPC_URL_HTTP && !!process.env.RPC_URL_WS,
    description: 'RPC_URL_HTTP and RPC_URL_WS configured'
  },
  {
    name: 'global-profit-threshold',
    check: () => !!process.env.GLOBAL_MIN_PROFIT_USD,
    description: 'GLOBAL_MIN_PROFIT_USD configured'
  },
  {
    name: 'flashloan-priority',
    check: () => !!process.env.FLASHLOAN_PROVIDER_PRIORITY || process.env.FLASHLOAN_PRIORITY,
    description: 'Flashloan provider priority configured'
  },
  {
    name: 'metrics-port',
    check: () => !!process.env.PROMETHEUS_PORT,
    description: 'PROMETHEUS_PORT configured'
  }
];

/**
 * Run all verification tests
 */
async function runVerification() {
  console.log('🚀 Starting JIT Bot Production Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const verifier = new VerificationResult();
  
  try {
    // 1. File existence checks
    console.log('\n📁 Checking required files...');
    for (const check of FILE_CHECKS) {
      const exists = fileExists(check.path);
      console.log(`${exists ? '✅' : '❌'} ${check.description}: ${check.path}`);
      verifier.addResult(`file-${check.name}`, exists, exists ? 'File exists' : 'File not found');
    }
    
    // 2. Configuration validation
    console.log('\n⚙️  Validating configuration...');
    for (const check of CONFIG_CHECKS) {
      const passed = check.check();
      console.log(`${passed ? '✅' : '❌'} ${check.description}`);
      verifier.addResult(`config-${check.name}`, passed, passed ? 'Check passed' : 'Check failed');
    }
    
    // 3. Run verification commands
    console.log('\n🧪 Running verification tests...');
    
    for (const test of VERIFICATION_TESTS) {
      console.log(`\n🔬 ${test.description}`);
      console.log(`   Command: ${test.command}`);
      
      const result = await executeCommand(test.command, {
        timeout: test.timeout,
        env: test.env || {}
      });
      
      const status = result.passed ? '✅ PASSED' : '❌ FAILED';
      const duration = `(${(result.duration / 1000).toFixed(1)}s)`;
      
      console.log(`   ${status} ${duration}`);
      
      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error.split('\n')[0]}`);
      }
      
      // Log first 6 lines of output as required
      if (result.output) {
        const outputLines = result.output.split('\n').slice(0, 6);
        console.log(`   Output (first 6 lines):`);
        outputLines.forEach(line => console.log(`     ${line}`));
      }
      
      verifier.addResult(test.name, result.passed, result.output, result.error, result.duration);
    }
    
    // 4. Check for required artifacts
    console.log('\n📊 Checking generated artifacts...');
    
    const artifactChecks = [
      {
        name: 'slither-summary',
        path: 'slither-summary.json',
        description: 'Slither analysis summary'
      },
      {
        name: 'reports-directory',
        path: 'reports',
        description: 'Reports directory',
        isDirectory: true
      }
    ];
    
    for (const artifact of artifactChecks) {
      const exists = fileExists(artifact.path);
      console.log(`${exists ? '✅' : '❌'} ${artifact.description}: ${artifact.path}`);
      verifier.addResult(`artifact-${artifact.name}`, exists, exists ? 'Artifact present' : 'Artifact missing');
    }
    
    // 5. Generate final report
    const report = verifier.generateReport();
    
    console.log('\n📋 Verification Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Total Tests:          ${report.summary.totalTests}`);
    console.log(`✅ Passed:               ${report.summary.passed}`);
    console.log(`❌ Failed:               ${report.summary.failed}`);
    console.log(`⏭️  Skipped:              ${report.summary.skipped}`);
    console.log(`📈 Success Rate:         ${report.summary.successRate}`);
    console.log(`⏱️  Total Duration:       ${(report.summary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`🎯 Overall Status:       ${report.summary.overallPassed ? '✅ PASSED' : '❌ FAILED'}`);
    
    // 6. Save detailed report
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const reportPath = path.join(reportsDir, 'verifier-output.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`💾 Detailed report saved to: ${reportPath}`);
    
    // 7. Display critical failures
    if (!report.summary.overallPassed) {
      console.log('\n⚠️  Critical Failures:');
      for (const [testName, result] of Object.entries(report.results)) {
        if (!result.passed) {
          console.log(`   ❌ ${testName}: ${result.error || 'Test failed'}`);
        }
      }
    }
    
    // 8. Provide next steps
    if (report.summary.overallPassed) {
      console.log('\n🎉 All verifications passed!');
      console.log('🚀 Ready for production deployment');
      console.log('📝 Next steps:');
      console.log('   1. Review generated reports in reports/ directory');
      console.log('   2. Deploy to testnet with scripts/deploy-safe.ts');
      console.log('   3. Run SIMULATION_MODE=true for 48h on production infrastructure');
      console.log('   4. Gradually lower GLOBAL_MIN_PROFIT_USD after stability');
      console.log('   5. Set SIMULATION_MODE=false only after consistent success');
    } else {
      console.log('\n🛑 Verification failed!');
      console.log('❌ Do not proceed with production deployment');
      console.log('🔧 Fix the failed tests and run verification again');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Exit with appropriate code
    process.exit(report.summary.overallPassed ? 0 : 1);
    
  } catch (error) {
    console.error(`\n❌ Verification script failed: ${error.message}`);
    console.error(error.stack);
    
    // Save error report
    const errorReport = {
      error: {
        message: error.message,
        stack: error.stack
      },
      partialResults: verifier.generateReport(),
      timestamp: new Date().toISOString()
    };
    
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const errorPath = path.join(reportsDir, 'verifier-error.json');
    fs.writeFileSync(errorPath, JSON.stringify(errorReport, null, 2));
    console.log(`💾 Error report saved to: ${errorPath}`);
    
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n⏹️  Verification interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Verification terminated');
  process.exit(1);
});

// Run verification if called directly
if (require.main === module) {
  runVerification();
}

module.exports = {
  runVerification,
  VerificationResult,
  executeCommand,
  VERIFICATION_TESTS,
  FILE_CHECKS,
  CONFIG_CHECKS
};