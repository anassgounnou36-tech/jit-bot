# GitHub Actions Workflows

This repository includes two GitHub Actions workflows for testing and running the JIT bot safely.

## Workflows Overview

### 1. Smoke Test - Alchemy Endpoints (`smoke-alchemy.yml`)

**Purpose:** Safely test Alchemy RPC endpoints without sending any transactions.

**Triggers:** Manual workflow dispatch only

**Requirements:**
- Repository Secrets:
  - `RPC_URL_HTTP` - Your Alchemy HTTP endpoint URL
  - `RPC_URL_WS` - Your Alchemy WebSocket endpoint URL

**What it does:**
- Tests HTTP and WebSocket connectivity
- Verifies chain ID and retrieves latest block
- Performs read-only contract calls
- Generates visible traffic on your Alchemy dashboard
- Uploads test logs as artifacts

**How to run:**
1. Go to Actions tab in GitHub
2. Select "Smoke Test - Alchemy Endpoints"
3. Click "Run workflow"
4. Check results and download logs artifact

### 2. Live Bot - Short Run Test (`live-bot.yml`)

**Purpose:** Run the JIT bot live for a limited, configurable time window.

**Triggers:** Manual workflow dispatch only

**Requirements:**

#### Required Secrets:
- `RPC_URL_HTTP` - Ethereum mainnet RPC endpoint
- `RPC_URL_WS` - Ethereum mainnet WebSocket endpoint (optional)
- `PRIVATE_KEY` - Main execution wallet private key
- `FLASHBOTS_SIGNING_KEY` - Flashbots signing key (optional)
- `FLASHBOTS_RELAY_URL` - Flashbots relay URL (optional)
- `ETHERSCAN_API_KEY` - Etherscan API key for verification
- `BLOCKNATIVE_API_KEY` - Blocknative API key (optional)

#### Required Variables (Safety Toggles):
- `I_UNDERSTAND_LIVE_RISK` - Must be `"true"` to run
- `CONFIRM_MAINNET` - Must be `"true"` to run on mainnet

#### Optional Variables (Configuration):
- `SIMULATION_MODE` - Set to `"false"` for live execution
- `ENABLE_FLASHBOTS` - Enable Flashbots bundles
- `MAX_FLASHLOAN_AMOUNT_USD` - Maximum flashloan amount
- `GLOBAL_MIN_PROFIT_USD` - Minimum profit threshold
- `MAX_GAS_GWEI` - Maximum gas price
- `BUNDLE_GAS_LIMIT` - Gas limit for bundles
- `POOL_MAX_FAILURES` - Pool failure threshold
- `POOL_COOLDOWN_MS` - Cooldown between pool attempts
- `REQUIRE_RAW_TX_HEX` - Require raw transaction hex
- `ONE_BUNDLE_PER_BLOCK` - One bundle per block limit

**Configuration Options:**
- Duration: 30-600 seconds (default: 180)
- Execution mode: `ts-node` or `compiled`
- Log level: `debug`, `info`, or `warn`
- Memory guard: 1000-8000 MB (default: 5600)
- Debug options: Comma-separated flags (default: heap)
  - `heap`: Enable heap snapshots near heap limit for debugging
  - `trace-gc`: Enable V8 garbage collection tracing (verbose logs)
  - `none`: Disable all debug features
  - Multiple options: `heap,trace-gc`
- Node.js Heap: 6GB (automatically configured for memory-intensive operations)
- Job timeout: Managed internally (enforced via process-level timeout commands)
- Artifact timeout: 1-10 minutes (default: 3)
- Artifact compression: 0-9 level (default: 6)

**Safety Features:**
- Concurrency protection (only one run at a time)
- **Memory guard protection** (monitors RSS usage and prevents OOM crashes)
- **Enhanced timeout protection** (process-level timeouts via shell commands with reliable termination)
- **Process cleanup** (comprehensive background process tracking and cleanup)
- **Heap snapshot diagnostics** (captures memory snapshots before OOM for debugging)
- **Enhanced memory management** (6GB Node.js heap with configurable options)
- Preflight safety checks
- **Reliable logging** (logs and artifacts always uploaded with timeout protection)
- **Robust artifact upload** (timeout-protected, continue-on-error, configurable compression)
- Comprehensive logging and artifacts with extended retention

**How to run:**
1. Configure all required secrets and variables in repository settings
2. Go to Actions tab in GitHub
3. Select "Live Bot - Short Run Test"
4. Click "Run workflow"
5. Configure duration and options
6. Monitor execution and download logs

## Setup Instructions

### 1. Configure Repository Secrets

Go to Settings → Secrets and variables → Actions → Secrets:

```
RPC_URL_HTTP=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY
RPC_URL_WS=wss://eth-mainnet.ws.alchemyapi.io/v2/YOUR_KEY
PRIVATE_KEY=0x...
FLASHBOTS_SIGNING_KEY=0x...
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
ETHERSCAN_API_KEY=YOUR_KEY
BLOCKNATIVE_API_KEY=YOUR_KEY
```

### 2. Configure Repository Variables

Go to Settings → Secrets and variables → Actions → Variables:

```
I_UNDERSTAND_LIVE_RISK=true
CONFIRM_MAINNET=true
SIMULATION_MODE=false
ENABLE_FLASHBOTS=true
MAX_FLASHLOAN_AMOUNT_USD=300000
GLOBAL_MIN_PROFIT_USD=50
MAX_GAS_GWEI=100
BUNDLE_GAS_LIMIT=8000000
POOL_MAX_FAILURES=5
POOL_COOLDOWN_MS=30000
REQUIRE_RAW_TX_HEX=true
ONE_BUNDLE_PER_BLOCK=true
```

### 3. Safety Considerations

⚠️ **Important Safety Notes:**

- **Start with simulation mode** (`SIMULATION_MODE=true`) for testing
- **Use separate wallets** for testing and production
- **Monitor gas costs** and set conservative limits
- **Start with high profit thresholds** and reduce gradually
- **Always download and review** the log artifacts
- **Never commit private keys** to the repository

### 4. Monitoring and Logs

Both workflows generate detailed logs and upload them as artifacts:

- **Smoke Test Logs:** Connection tests and endpoint responses
- **Live Bot Logs:** Full bot execution logs, opportunity detection, and trade attempts

Artifacts are retained for 7 days and can be downloaded from the workflow run page.

## Troubleshooting

### Common Issues:

1. **"Required secrets not set"**
   - Verify all secrets are configured in repository settings
   - Check secret names match exactly (case-sensitive)

2. **"Safety toggles not confirmed"**
   - Set `I_UNDERSTAND_LIVE_RISK=true` and `CONFIRM_MAINNET=true` in variables
   - Understand these confirm you want to run with real funds

3. **"Bot failed to start"**
   - Check private key format (must start with 0x)
   - Verify RPC endpoints are accessible
   - Ensure wallet has sufficient ETH for gas

4. **"WebSocket connection failed"**
   - Some RPC providers may not support WebSocket
   - Bot can run with HTTP-only if WebSocket fails

### Support:

- Review the RUNBOOK.md for detailed operational guidance
- Check logs artifacts for specific error messages
- Verify configuration matches the README examples