# JIT Liquidity Provision Bot for Uniswap V3

A production-ready Just-In-Time (JIT) liquidity provision bot that automatically detects large pending swaps and provides concentrated liquidity to capture fees. Supports simulation, fork-based preflight validation, and live mainnet execution with Flashbots integration.

## 🚨 Security Notice

**IMPORTANT: This release (PR2) supports live execution but defaults to simulation-only for safety.**

- **Never commit private keys** to version control
- **Always use `.env` files** for sensitive configuration
- **Start with simulation mode** (`ENABLE_LIVE_EXECUTION=false`) until thoroughly tested
- **Enable preflight simulation** (`ENABLE_FORK_SIM_PREFLIGHT=true`) for comprehensive validation
- **Use separate wallets** for testing and production
- **Monitor gas costs** carefully in live mode

### Secrets Management

1. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your secrets** (never commit this file):
   - `PRIVATE_KEY`: Your wallet private key (with 0x prefix)
   - `RPC_URL_HTTP`: Your HTTP RPC endpoint
   - `RPC_URL_WS`: Your WebSocket RPC endpoint
   - `FLASHBOTS_PRIVATE_KEY`: Separate key for Flashbots (required for live execution)
   - `EXECUTOR_PRIVATE_KEY`: Optional separate key for contract execution

3. **Verify `.env` is in `.gitignore`** to prevent accidental commits

## 🎮 Simulation Quickstart

Get started with risk-free simulation in 3 minutes:

```bash
# 1. Clone and install dependencies
git clone https://github.com/anassgounnou36-tech/jit-bot.git
cd jit-bot
npm install

# 2. Set up environment (simulation mode)
cp .env.example .env
# Edit .env and set your RPC_URL_HTTP and RPC_URL_WS

# 3. Run fork simulation
npm run fork:simulate

# 4. Start the bot in simulation mode
npm run dev
```

**Simulation Features:**
- ✅ **No real transactions** - completely safe testing
- ✅ **Real market data** - uses actual pool states and prices
- ✅ **Profit estimation** - calculates potential returns
- ✅ **Gas cost analysis** - includes realistic gas calculations
- ✅ **Multi-pool support** - test different pool strategies
- ✅ **Live metrics** - Prometheus metrics available at http://localhost:9090/metrics

## 🧪 Fork Simulation Preflight (PR2)

Enhanced validation with comprehensive end-to-end simulation:

```bash
# Run preflight simulation on a local fork
ENABLE_FORK_SIM_PREFLIGHT=true npm run dev
```

**Preflight Features:**
- ✅ **Full sequence simulation** - flashloan → mint → burn → repay on local fork
- ✅ **Real contract interactions** - validates against actual Uniswap V3 and Aave contracts
- ✅ **Profitability validation** - precise USD profit calculations with real token prices
- ✅ **Gas optimization** - accurate gas estimates for entire execution sequence
- ✅ **Risk validation** - checks flashloan availability, pool liquidity, and position risks

## ⚡ Live Execution Mode (PR2)

**⚠️ CAUTION: Live execution uses real funds and executes real transactions.**

### Prerequisites for Live Mode

1. **Separate Flashbots wallet** with sufficient ETH for gas
2. **Main execution wallet** with appropriate token balances
3. **Production-grade RPC endpoints** with reliable WebSocket connections
4. **Thorough testing** in simulation and fork modes

### Enabling Live Execution

```bash
# Required environment variables for live execution
ENABLE_LIVE_EXECUTION=true
ENABLE_FLASHBOTS=true
ENABLE_FORK_SIM_PREFLIGHT=true
FLASHBOTS_PRIVATE_KEY=0x...
FLASHLOAN_PROVIDER=aave-v3

# Production safety acknowledgment
NODE_ENV=production
I_UNDERSTAND_LIVE_RISK=true
```

### Live Execution Safety Features

- **Default disabled** - live execution is off by default
- **Preflight required** - fork simulation must pass before execution
- **Gas caps** - strict gas price limits (MAX_GAS_GWEI)
- **Flashbots only** - all live transactions routed through Flashbots
- **Profit thresholds** - configurable minimum profit requirements
- **Production guards** - explicit acknowledgment required for production

### Step-by-Step Live Execution Setup

1. **Test extensively in simulation mode:**
   ```bash
   ENABLE_LIVE_EXECUTION=false npm run dev
   ```

2. **Validate with fork simulation:**
   ```bash
   ENABLE_FORK_SIM_PREFLIGHT=true npm run dev
   ```

3. **Set up Flashbots wallet:**
   ```bash
   # Generate new wallet for Flashbots signing
   FLASHBOTS_PRIVATE_KEY=0x... # Fund with ETH for gas
   ```

4. **Configure live execution (testnet first!):**
   ```bash
   ENABLE_LIVE_EXECUTION=true
   ENABLE_FLASHBOTS=true
   FLASHBOTS_PRIVATE_KEY=0x...
   ```

5. **Production deployment:**
   ```bash
   NODE_ENV=production
   I_UNDERSTAND_LIVE_RISK=true
   npm run live -- start
   ```

**Note:** Live execution requires explicit configuration and safety acknowledgments. The default mode remains simulation-only for maximum safety.

## 🚀 Features

### Core Strategy
- **Multi-Pool Monitoring**: Concurrent monitoring of multiple Uniswap V3 pools with opportunity ranking
- **Mempool Monitoring**: Real-time detection of large Uniswap V3 swaps across all target pools  
- **Opportunity Optimization**: Intelligent selection of the most profitable bundle per block
- **Concentrated Liquidity**: Automated positioning around expected swap prices for maximum fee capture

### Execution Infrastructure (Production Hardened)
- **Dual Flashloan Providers**: Balancer Vault (primary, no fees) with Aave V3 fallback (0.05% fee)
- **Victim Transaction Inclusion**: Deterministic bundle ordering with raw signed transaction capture
- **Bundle Validation**: Comprehensive ordering validation and profit guards before submission
- **Flashbots Integration**: MEV-protected bundle execution with EIP-1559 gas optimization
- **Fork Simulation Preflight**: Complete end-to-end validation on local mainnet fork before execution
- **Live Execution Control**: Production-ready mainnet deployment with safety-first defaults

#### Bundle Ordering
Critical transaction ordering ensures profitable JIT execution:
```
Transaction 0: JIT Mint (create concentrated liquidity)
Transaction 1: Victim Swap (captured from mempool with raw bytes)
Transaction 2: JIT Burn/Collect (remove liquidity + collect fees)
```

See [BUNDLE_ORDERING.md](docs/BUNDLE_ORDERING.md) for detailed documentation.

### Risk Management
- **Pool-Level Risk Management**: Per-pool failure tracking, auto-disable, and cooldown mechanisms
- **Gas Price Controls**: Strict gas price caps and optimization with real-time market adaptation
- **Profitability Validation**: Multi-stage profit validation including USD-denominated thresholds
- **Emergency Controls**: Pause functionality and comprehensive error handling

### Observability
- **Advanced Metrics**: Pool-specific profit tracking, success rates, and comprehensive Prometheus metrics
- **Structured Logging**: Request tracing, performance monitoring, and detailed execution logs
- **Real-time Monitoring**: Live dashboards for opportunity detection, execution success, and system health

### Multi-chain & Configuration
- **Multi-chain Support**: Ethereum mainnet and Arbitrum with extensible chain configuration
- **Flexible Configuration**: Environment-based configuration with validation and hot-reloading
- **Provider Abstraction**: Extensible flashloan provider system (Aave V3, future Compound V3)

## 🛡️ Production Hardening (PR2)

This release includes comprehensive production hardening features designed for secure and reliable mainnet deployment:

### Enhanced Flashloan Infrastructure
- **Balancer Vault Primary**: Zero-fee flashloans with automatic liquidity checking
- **Aave V3 Fallback**: 0.05% fee fallback when Balancer liquidity insufficient
- **Provider Selection Logic**: Intelligent provider selection optimizing for cost and availability
- **Comprehensive Fee Calculation**: Real-time fee estimation and profit optimization

### Deterministic Bundle Ordering
- **Raw Transaction Capture**: Multi-strategy victim transaction capture from mempool
- **Strict Bundle Validation**: Comprehensive ordering validation before submission
- **Victim TX Inclusion**: Required victim transaction with raw signed bytes for deterministic execution
- **Bundle Structure Enforcement**: [JIT Mint] → [Victim Swap] → [JIT Burn/Collect] ordering

### Enhanced JIT Executor Contract
- **Dual Flashloan Callbacks**: Both Balancer `receiveFlashLoan` and Aave `executeOperation` support
- **Atomic Profit Guard**: On-chain profit validation with configurable minimum thresholds
- **Emergency Controls**: Pause/unpause, emergency withdraw, and configuration updates
- **Event Tracking**: Comprehensive event emission for monitoring and debugging

### Fork Simulation & Testing
- **Preflight Validation**: Complete end-to-end simulation on local mainnet fork
- **Test Fixture Generation**: Automated generation of real mainnet transaction fixtures
- **E2E Test Suite**: Comprehensive integration tests with profit validation
- **Bundle Ordering Tests**: Specific tests for victim transaction inclusion and ordering

### Enhanced CI/CD Pipeline
- **Multi-stage Validation**: lint-and-typecheck → build → validate-bundle-ordering → e2e-simulation
- **Environment-gated Jobs**: Slither analysis and E2E tests gated by environment variables
- **Artifact Generation**: Automated test reports and fixture validation
- **Production Readiness Gates**: Profit threshold validation and comprehensive testing

### Monitoring & Alerting
- **Bundle Ordering Metrics**: Track victim transaction inclusion and ordering violations
- **Provider Selection Telemetry**: Monitor flashloan provider performance and fallbacks
- **Profit Threshold Validation**: Ensure average profits meet production requirements ($25+ USD)
- **Raw Transaction Capture Monitoring**: Track success rates of victim transaction capture

### Documentation & Compliance
- **Bundle Ordering Guide**: Comprehensive documentation of victim transaction requirements
- **Production Deployment Guide**: Step-by-step production hardening checklist
- **Monitoring Playbooks**: Alert rules and troubleshooting guides
- **Security Best Practices**: Comprehensive security considerations and validation

## 📋 Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Usage](#usage)
- [Live Execution Mode](#live-execution-mode)
- [Monitoring](#monitoring)
- [Risk Management](#risk-management)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## 🏗️ Architecture

### Multi-Pool Mode (Default)
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Pool           │    │  Opportunity    │    │  Bundle Builder │
│  Coordinator    │───▶│  Ranking        │───▶│                 │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
    ┌────┴────┐                  │                       │
    ▼         ▼                  ▼                       ▼
┌─────────┐ ┌─────────┐  ┌─────────────────┐    ┌─────────────────┐
│ Pool A  │ │ Pool B  │  │  Metrics &      │    │  Flashbots      │
│ Watcher │ │ Watcher │  │  Monitoring     │    │  Executor       │
└─────────┘ └─────────┘  └─────────────────┘    └─────────────────┘
```

### Single-Pool Mode (Legacy)
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Mempool        │    │  Simulator      │    │  Bundle Builder │
│  Watcher        │───▶│                 │───▶│                 │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Metrics &      │    │  JIT Executor   │    │  Flashbots      │
│  Monitoring     │    │  Contract       │    │  Executor       │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Components

1. **Smart Contracts** (Solidity)
   - `SimpleJitExecutor.sol`: Core contract handling flash loans and LP operations
   - `AaveFlashReceiver.sol`: Aave V3 flash loan fallback
   - Libraries for Uniswap V3 math and safe swapping

2. **Bot Application** (TypeScript/Node.js)
   - **Mempool Watcher**: Detects pending Uniswap V3 swaps
   - **Simulator**: Validates profitability before execution
   - **Bundle Builder**: Constructs Flashbots bundles
   - **Executor**: Manages bundle submission and monitoring
   - **Metrics**: P&L tracking and operational monitoring

## 📋 Prerequisites

- Node.js 18+ and npm
- Ethereum RPC endpoint (Alchemy, Infura, or QuickNode)
- Private key with ETH for gas costs
- Flashbots access (optional but recommended)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/jit-bot.git
   cd jit-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile contracts**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

## ⚙️ Configuration

1. **Copy environment template**
   ```bash
   cp .env.example .env
   ```

## 🔢 Amount Units

**Important**: The orchestrator and all internal processing uses **18-decimal engine units** for amounts, independent of the actual token decimals (e.g., USDC has 6 decimals, but the orchestrator expects 18).

### Usage Guidelines

- **Scripts and API calls**: Always pass amounts with 18 decimals using `ethers.utils.parseUnits(amount, 18)`
- **Display formatting**: Convert for display using `ethers.utils.formatUnits(amount, 18)` 
- **Token-native decimals**: Only used for final on-chain token transfers, not for orchestrator logic

### Examples

```javascript
// ✅ Correct: Use 18 decimals for orchestrator
const amount100USDC = utils.parseUnits("100", 18);
await orchestrator.validateFlashloanParameters(usdcToken, amount100USDC, provider);

// ✅ Correct: Display with engine units
console.log(`Amount: ${utils.formatUnits(amount100USDC, 18)} engine units`);

// ❌ Incorrect: Don't use token-native decimals with orchestrator
const wrongAmount = utils.parseUnits("100", 6); // USDC native decimals
await orchestrator.validateFlashloanParameters(usdcToken, wrongAmount, provider); // Will fail validation
```

This convention prevents confusion between token-specific decimal places and ensures consistent internal calculations across all supported tokens.

2. **Configure environment variables**
   ```bash
   # ===============================
   # PR2: Live Execution Control
   # ===============================
   ENABLE_LIVE_EXECUTION=false         # Enable live transaction execution
   ENABLE_FLASHBOTS=false              # Enable Flashbots integration
   ENABLE_FORK_SIM_PREFLIGHT=true      # Enable fork simulation preflight
   
   # Production Safety (required for NODE_ENV=production with live execution)
   I_UNDERSTAND_LIVE_RISK=false        # Explicit acknowledgment for production live mode
   
   # RPC Endpoints
   RPC_URL_HTTP=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY
   RPC_URL_WS=wss://eth-mainnet.ws.alchemyapi.io/v2/YOUR_KEY
   
   # Wallet Configuration
   PRIVATE_KEY=0x...                   # Main wallet private key
   EXECUTOR_PRIVATE_KEY=0x...          # Optional: separate executor key
   
   # Flashbots Configuration (required for live execution)
   FLASHBOTS_RELAY_URL=https://relay.flashbots.net
   FLASHBOTS_PRIVATE_KEY=0x...         # Required when ENABLE_FLASHBOTS=true
   
   # Flashloan Configuration
   FLASHLOAN_PROVIDER=aave-v3          # Flashloan provider (aave-v3, compound-v3)
   
   # Multi-Pool Configuration
   POOL_IDS=WETH-USDC-0.05%,ETH-USDT-0.3%,WBTC-ETH-0.3%
   GLOBAL_MIN_PROFIT_USD=10.0          # Minimum profit threshold in USD
   MAX_GAS_GWEI=100                    # Maximum gas price in gwei
   
   # Fork Testing Configuration
   FORK_BLOCK_NUMBER=                  # Optional: specific block for fork testing
   
   # Metrics & Monitoring
   PROMETHEUS_PORT=9090                # Prometheus metrics port
   ```

3. **Configure target pools** (edit `config.json`)
   ```json
   {
     "targets": [
       {
         "pool": "WETH-USDC-0.05%",
         "address": "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
         "token0": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
         "token1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
         "fee": 500
       },
       {
         "pool": "ETH-USDT-0.3%",
         "address": "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36",
         "token0": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
         "token1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
         "fee": 3000
       }
     ]
   }
   ```

## 🔄 Multi-Pool Configuration

The bot supports monitoring multiple Uniswap V3 pools simultaneously and selects the most profitable opportunity per block.

### Pool Selection
```bash
# Enable multi-pool mode
ENABLE_MULTI_POOL=true

# Specify which pools to monitor (comma-separated)
POOL_IDS=WETH-USDC-0.05%,ETH-USDT-0.3%,WBTC-ETH-0.3%

# Global profit threshold (USD)
PROFIT_THRESHOLD_USD=100.0
```

### Per-Pool Configuration
```bash
# Pool-specific profit thresholds (optional)
POOL_PROFIT_THRESHOLD_USD__WETH_USDC_0_05_=150
POOL_PROFIT_THRESHOLD_USD__ETH_USDT_0_3_=120
POOL_PROFIT_THRESHOLD_USD__WBTC_ETH_0_3_=200

# Pool failure management
POOL_MAX_FAILURES=5          # Disable pool after N failures
POOL_COOLDOWN_MS=300000      # Re-enable after 5 minutes
MAX_CONCURRENT_WATCHERS=10   # Maximum concurrent pool watchers
```

## 🔎 Verbose Swap Logging (Targeted Pools)

To verify mempool monitoring end-to-end, you can enable a verbose logger that prints a line for every Uniswap v3 swap observed in your configured target pools.

Environment variable:

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_TARGET_POOL_SWAPS` | When `true`, logs token addresses, fee tier, direction, and human-readable amounts for every observed swap in targeted pools. Logs occur even if the swap is below thresholds. | `false` |

Example:

```bash
LOG_TARGET_POOL_SWAPS=true npm run run
```

Tip: To see more activity, set lower thresholds:

```bash
MIN_SWAP_ETH=0 MIN_SWAP_USD=0 LOG_TARGET_POOL_SWAPS=true npm run run
```

## 🔗 Enhanced Mempool Monitoring (Alchemy)

For improved mempool monitoring and swap detection, the bot supports Alchemy's enhanced `alchemy_pendingTransactions` subscription, which provides full transaction objects and better reliability for high-frequency swap detection.

Environment variable:

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_ALCHEMY_PENDING_TX` | When `true`, uses Alchemy's enhanced WebSocket subscription with Uniswap router filters. Receives full transaction objects directly and improves swap detection reliability. | `false` |

Benefits of Alchemy mode:
- ✅ **Full transaction objects** - receive complete tx data including input
- ✅ **Filtered subscriptions** - only get transactions to Uniswap routers  
- ✅ **Reduced latency** - skip additional RPC calls for transaction data
- ✅ **Higher reliability** - better detection of swap transactions
- ✅ **Fallback support** - automatically falls back to standard subscription if Alchemy is unavailable

Example configuration:

```bash
# Enable Alchemy enhanced monitoring
USE_ALCHEMY_PENDING_TX=true
LOG_TARGET_POOL_SWAPS=true
ALLOW_RECONSTRUCT_RAW_TX=true
MIN_SWAP_ETH=0
MIN_SWAP_USD=0

npm run run
```

The feature automatically filters for transactions sent to:
- `0xE592427A0AEce92De3Edee1F18E0157C05861564` (Uniswap V3 SwapRouter)
- `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (SwapRouter02)  
- `0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B` (Universal Router)

When enabled, you should see increased `SwapObserved` activity and `mempool_swaps_decoded_total` metrics.

## 🔗 ABI-Based Pending Transaction Fallback

For broader mempool coverage that works with any WebSocket-enabled Ethereum node, the bot supports an ABI-based pending transaction fallback that subscribes to generic pending transaction hashes and decodes Uniswap router swaps via ABI parsing.

Environment variable:

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_ABI_PENDING_FALLBACK` | When `true`, subscribes to generic pending tx hashes (eth_subscribe newPendingTransactions), fetches full tx objects, and decodes Uniswap router calls via ABI. Works with any WebSocket-enabled Ethereum node and provides broader mempool coverage. | `true` |

Benefits of ABI fallback:
- ✅ **Universal compatibility** - works with any WebSocket-enabled Ethereum node (Geth, Nethermind, Alchemy, Infura)
- ✅ **Broader coverage** - captures all pending transactions, not just pre-filtered ones
- ✅ **Provider independence** - not limited to specific RPC provider features
- ✅ **Retry logic** - includes exponential backoff for transaction fetching reliability
- ✅ **Deduplication** - runs in parallel with Alchemy mode when both are enabled

Example configuration:

```bash
# Enable ABI fallback for maximum coverage
USE_ABI_PENDING_FALLBACK=true

# Can be combined with Alchemy for dual coverage
USE_ALCHEMY_PENDING_TX=true
USE_ABI_PENDING_FALLBACK=true

# Monitoring and debugging
LOG_TARGET_POOL_SWAPS=true
ALLOW_RECONSTRUCT_RAW_TX=true

npm run run
```

### Dual Mode Operation

When both Alchemy and ABI fallback are enabled, the bot runs both subscriptions in parallel with automatic deduplication:

1. **Alchemy subscription** - filtered, fast, provider-specific
2. **ABI fallback subscription** - comprehensive, universal, slower
3. **Deduplication** - shared 5-minute TTL cache prevents duplicate processing
4. **Source tracking** - metrics and logs track which path decoded each transaction

Metrics include source labels to distinguish between capture methods:
- `mempool_swaps_decoded_total{source="alchemy"}` - swaps from Alchemy subscription
- `mempool_swaps_decoded_total{source="abi_fallback"}` - swaps from ABI fallback
- `mempool_txs_seen_total{provider="abi_fallback"}` - total transactions processed by fallback

### Router Address Filtering

Both modes filter for transactions sent to canonical Uniswap router addresses:
- `0xE592427A0AEce92De3Edee1F18E0157C05861564` (Uniswap V3 SwapRouter)
- `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (SwapRouter02)  
- `0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B` (Universal Router)

See `reports/sample-pending-abi.json` for an example of captured transaction structure from the ABI fallback path.

## 🔗 Pending Uniswap V3 Watcher

For reliably capturing pending Uniswap V3 swaps on Ethereum mainnet, the bot includes a specialized watcher that uses provider-agnostic WebSocket mempool access specifically optimized for Uniswap V3 router transactions.

Environment variable:

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_PENDING_UNISWAP_V3` | When `true`, enables dedicated Uniswap V3 pending transaction monitoring that subscribes to `eth_subscribe newPendingTransactions`, filters for V3 router addresses, and decodes swap functions with retry logic and concurrency limiting. | `true` |

### Uniswap V3 Focus

This watcher specifically targets Uniswap V3 mainnet router addresses:
- `0xE592427A0AEce92De3Edee1F18E0157C05861564` (SwapRouter)
- `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (SwapRouter02)

### Supported V3 Functions

The watcher decodes the following Uniswap V3 functions:
- **`exactInputSingle`** - Single-hop exact input swaps
- **`exactInput`** - Multi-hop exact input swaps (path-based)
- **`multicall`** and **`multicall(uint256,bytes[])`** - Batch transactions with recursive parsing

### Enhanced Features

- ✅ **Concurrency limiting** - Limits parallel `getTransaction` calls to prevent overwhelming RPC providers
- ✅ **Retry with backoff** - Exponential backoff for transient failures when fetching pending transactions
- ✅ **Pending-only processing** - Only processes transactions not yet included in blocks
- ✅ **Raw transaction capture** - Attempts to capture raw signed transaction data
- ✅ **Structured logging** - Logs with `source="pending-univ3"` and `component="mempool-watcher"`

### Example Configuration

```bash
# Enable pending Uniswap V3 monitoring
USE_PENDING_UNISWAP_V3=true

# Requires WebSocket RPC that supports eth_subscribe
RPC_URL_WS=wss://eth-mainnet.ws.alchemyapi.io/v2/YOUR_KEY

# Enable swap logging to see captured swaps
LOG_TARGET_POOL_SWAPS=true
MIN_SWAP_ETH=0
MIN_SWAP_USD=0
```

When enabled, you should see log messages like:
```
SwapObserved source=pending-univ3 txHash=0x... poolAddress=0x... amountIn=1000000000
PendingSwapDetected source=pending-univ3 candidateId=... decodedMethod=exactInputSingle
```

### Metrics and Monitoring

Dedicated metrics track pending V3 activity:
- `mempool_swaps_decoded_total{source="pending_univ3"}` - V3 swaps successfully decoded
- `mempool_txs_seen_total{provider="pending_univ3"}` - Total transactions processed
- `mempool_txs_raw_fetched_total{source="pending-univ3"}` - Raw transactions successfully captured

See `reports/sample-pending-univ3.json` for examples of captured V3 transactions with decoded `exactInputSingle`, `exactInput`, and `multicall` structures.

### Orchestration Behavior

1. **Concurrent Monitoring**: Each enabled pool runs its own mempool watcher
2. **Opportunity Ranking**: When multiple opportunities are detected in the same block:
   - All candidates are evaluated for profitability
   - Only the most profitable opportunity is executed
   - Other opportunities are skipped to avoid gas waste
3. **Pool Management**: 
   - Pools are automatically disabled after repeated failures
   - Disabled pools are re-enabled after a cooldown period
   - Pool status and metrics are tracked independently

### Metrics Dashboard

Pool-level metrics are available at `http://localhost:3001/metrics`:

```
# Pool-specific metrics
jit_bot_pool_profit_usd{pool="WETH_USDC_0_05_"} 1250.50
jit_bot_pool_success_rate{pool="WETH_USDC_0_05_"} 0.85
jit_bot_pool_failure_count{pool="ETH_USDT_0_3_"} 0
jit_bot_pool_enabled{pool="WBTC_ETH_0_3_"} 1
```

### Simulation Mode Metrics

In simulation mode (PR1), expect the following metric behavior:

```bash
# Core opportunity tracking
opportunities_detected_total{pool="0x88e6..."} 15    # Increments on swap detection
jit_attempt_total{pool="0x88e6...",result="queued"} 12  # Attempts queued for simulation
jit_failure_total{pool="0x88e6...",error_type="blocked_live_execution"} 8  # Blocked executions

# Pool state metrics (updated from on-chain data)
pool_price{pool="0x88e6...",token0="WETH",token1="USDC"} 3247.82  # Real-time pool price
pool_liquidity{pool="0x88e6...",token0="WETH",token1="USDC"} 24500000  # Active liquidity

# Simulation results (updated after each fastSim)
current_simulated_profit_usd{pool="0x88e6..."} 45.23  # Latest simulation result

# Gas tracking (single source of truth from gasEstimator)
gas_price_gwei 25.4  # Current network gas price, capped by MAX_GAS_GWEI
```

**Note:** In simulation mode, all `jit_failure_total` with `error_type="blocked_live_execution"` is expected as live execution is disabled for safety.

### Per-Pool Profit Tracking

Metrics now provide **per-pool last simulated profit** tracking:

```bash
# Each pool tracks its latest simulation result independently
current_simulated_profit_usd{pool="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"} 45.23  # WETH-USDC
current_simulated_profit_usd{pool="0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36"} 32.10  # ETH-USDT
current_simulated_profit_usd{pool="0xCBCdF9626bC03E24f779434178A73a0B4bad62eD"} 78.45  # WBTC-ETH
```

This enables monitoring profitability across different pools and fee tiers independently.

### Token Address Validation

⚠️ **USDC Address Correction**: The bot automatically detects and corrects the incorrect USDC address:

- **Incorrect**: `0xa0b86a33e6441b80b05fdc68f34f8c9c31c8e9a` ❌
- **Correct**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` ✅ (Canonical USDC mainnet address)

**Behavior:**
- **Simulation mode**: Automatically corrects and logs a warning
- **Live mode**: Throws an error and prevents execution with incorrect addresses

The bot normalizes all token addresses to proper checksum format and validates against known canonical addresses.

## 🚀 Deployment

### Environment Validation

Before deploying, validate your environment configuration:

```bash
# Validate environment for mainnet deployment
npm run validate:env mainnet

# Validate environment for testnet deployment
npm run validate:env sepolia
```

The validation script checks:
- ✅ **Private Key**: Format and presence validation
- ✅ **RPC URLs**: Automatic fallback from `RPC_URL_HTTP` to `ETHEREUM_RPC_URL`
- ✅ **Address Variables**: `PROFIT_RECIPIENT` and `POSITION_MANAGER` validation
- ✅ **Safety Settings**: DRY_RUN and live execution acknowledgment
- ✅ **Optional Settings**: Etherscan API key and contract verification

### Deployment Configuration

Key environment variables:

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `PRIVATE_KEY` | Deployer private key | Yes | - | `0x123...` |
| `ETHEREUM_RPC_URL` | Primary RPC endpoint | Yes* | - | `https://eth-mainnet.alchemyapi.io/v2/...` |
| `RPC_URL_HTTP` | Fallback RPC endpoint | No | - | `https://rpc.ankr.com/eth` |
| `PROFIT_RECIPIENT` | Address to receive profits | No | Deployer address | `0xabc...` |
| `POSITION_MANAGER` | Uniswap V3 Position Manager | No | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | - |
| `MIN_PROFIT_THRESHOLD` | Min profit in ETH | No | `0.01` | `0.01` |
| `MAX_LOAN_SIZE` | Max loan size in ETH | No | `1000` | `1000` |

**\*Note**: Either `ETHEREUM_RPC_URL` or `RPC_URL_HTTP` is required for mainnet deployment. The system will automatically use `RPC_URL_HTTP` as fallback if `ETHEREUM_RPC_URL` is not set.

### Fork Deployment (Testing)

Deploy to a Hardhat fork for testing:

```bash
# 1. Start a local fork
npm run fork

# 2. Deploy contracts to fork
npm run deploy:fork

# 3. Set contract address in .env
echo "JIT_CONTRACT_ADDRESS=<deployed_address>" >> .env
```

### Mainnet Deployment (Production)

**⚠️ CRITICAL SAFETY WARNING ⚠️**

Mainnet deployment involves real funds and carries significant financial risk. Only proceed if you:
- Have thoroughly tested on forks
- Understand MEV competition dynamics
- Have monitoring and alerting in place
- Are prepared for potential losses

```bash
# 1. Validate environment configuration first
npm run validate:env mainnet

# 2. Deploy to mainnet (with built-in validation)
npm run deploy:mainnet

# 3. Verify deployment (optional)
VERIFY_CONTRACTS=true npm run deploy:mainnet

# 4. Fund the contract with gas ETH
# Send ~0.1 ETH to the deployed contract address

# 5. Start monitoring
docker-compose -f docker-compose.monitoring.yml up -d
```

### Improved Error Handling

The deployment system now provides enhanced error detection and resolution:

- **Invalid Address Errors**: Clear messages identifying which environment variable contains an invalid address
- **Empty Variable Detection**: Distinguishes between unset and empty string environment variables
- **RPC URL Fallback**: Automatic fallback from `RPC_URL_HTTP` if `ETHEREUM_RPC_URL` is not set
- **Early Validation**: All parameters validated before contract deployment begins
- **Descriptive Failures**: Specific error messages for common deployment issues

**Example Error Messages:**
```bash
❌ Environment variable PROFIT_RECIPIENT contains invalid address: ""
❌ ETHEREUM_RPC_URL (or RPC_URL_HTTP) is required for mainnet deployment
❌ POSITION_MANAGER contains invalid address: "0xinvalid"
```

1. **Deploy contracts**
   ```bash
   npx hardhat run scripts/deploy.ts --network mainnet
   ```

2. **Update contract address**
   ```bash
   echo "JIT_CONTRACT_ADDRESS=0x..." >> .env
   ```

3. **Fund the contract**
   Send ETH to the deployed contract for gas costs.

## 🎮 Usage

### Multi-Pool Mode (Recommended)
```bash
# Set up multi-pool configuration
export ENABLE_MULTI_POOL=true
export POOL_IDS=WETH-USDC-0.05%,ETH-USDT-0.3%,WBTC-ETH-0.3%
export PROFIT_THRESHOLD_USD=100

# Start the bot
npm run dev
```

### Single-Pool Mode (Legacy)
```bash
# Disable multi-pool mode
export ENABLE_MULTI_POOL=false

# Start the bot
npm run dev
```

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### Live Execution Mode
```bash
# Set production environment
export NODE_ENV=production
export JIT_CONTRACT_ADDRESS=0x...
export PRIVATE_KEY=0x...

# Start in live mode
npm run live -- start
```

### Fork Simulation Mode
```bash
# Start a local fork of Ethereum mainnet
npm run fork

# Run JIT LP simulations against the fork
npm run fork:simulate
```

### Docker Deployment
```bash
docker-compose up -d
```

### CLI Commands
```bash
# Start the bot
node dist/bot/index.js start

# Check status (includes pool information)
node dist/bot/index.js status

# Run simulation
npm run simulate

# Run fork simulation with real mainnet state
npm run fork:simulate
```

### Monitoring Pool Status

The bot status command now includes detailed pool information:

```bash
node dist/bot/index.js status
```

Example output:
```json
{
  "isRunning": true,
  "mode": "simulation",
  "multiPool": {
    "enabled": true,
    "pools": {
      "WETH-USDC-0.05%": {
        "enabled": true,
        "failureCount": 0,
        "profitThresholdUSD": 150
      },
      "ETH-USDT-0.3%": {
        "enabled": true,
        "failureCount": 2,
        "profitThresholdUSD": 100
      }
    },
    "currentOpportunities": {
      "18500123": [
        {
          "poolId": "WETH-USDC-0.05%",
          "estimatedProfitUSD": 275
        }
      ]
    }
  }
}
```

## 🧪 Fork Simulation Environment

The JIT LP bot includes a comprehensive forked mainnet simulation environment that allows testing against real Ethereum state at specific block numbers.

### Running Fork Simulations

1. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and set ETHEREUM_RPC_URL
   ```

2. **Run simulation against current mainnet state:**
   ```bash
   npm run fork:simulate
   ```

3. **Run simulation at a specific block:**
   ```bash
   FORK_BLOCK_NUMBER=18500000 npm run fork:simulate
   ```

4. **Customize target pools:**
   ```bash
   TARGET_POOLS=WETH-USDC-0.05%,ETH-USDT-0.3% npm run fork:simulate
   ```

### Simulation Features

- **Real Pool State**: Uses actual Uniswap V3 pool states from mainnet
- **Multiple Swap Sizes**: Tests small (1 ETH), medium (10 ETH), and whale (100 ETH) swaps
- **Gas Cost Analysis**: Includes real gas costs at current network prices
- **Profit Calculation**: Accounts for LP fees, gas costs, and flash loan fees
- **Comprehensive Reporting**: Generates JSON reports and console tables

### Supported Pools

The simulation targets high-volume Uniswap V3 pools:

- **WETH/USDC 0.05%** (0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640)
- **ETH/USDT 0.3%** (0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36)  
- **WBTC/ETH 0.3%** (0xCBCdF9626bC03E24f779434178A73a0B4bad62eD)

### Configuration Options

Environment variables for fork simulation:

| Variable | Description | Default |
|----------|-------------|---------|
| `FORK_BLOCK_NUMBER` | Specific block to fork from | Latest |
| `TARGET_POOLS` | Comma-separated list of pools | All configured pools |
| `SIMULATION_GAS_PRICE_GWEI` | Gas price for simulations | 20 |
| `SIMULATION_REPORT_DIR` | Directory for reports | ./reports |

### Report Generation

Simulations generate detailed reports in the `/reports` directory:

- **JSON Reports**: Machine-readable with full simulation data
- **Console Tables**: Human-readable summary tables
- **Profit Analysis**: Net profit calculations in ETH and USD
- **Gas Analysis**: Detailed gas usage and costs
- **Success Metrics**: Profitability rates and optimal scenarios

Example report structure:
```json
{
  "metadata": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "totalSimulations": 9,
    "profitableCount": 2
  },
  "summary": {
    "totalProfitEth": "0.0408",
    "averageGasUsed": 480000,
    "bestPool": "WBTC-ETH-0.3%"
  },
  "results": [...]
}
```

## 🚀 Deployment

### Fork Deployment (Testing)

Deploy to a Hardhat fork for testing:

```bash
# 1. Start a local fork
npm run fork

# 2. Deploy contracts to fork
npm run deploy:fork

# 3. Set contract address in .env
echo "JIT_CONTRACT_ADDRESS=<deployed_address>" >> .env
```

### Mainnet Deployment (Production)

**⚠️ CRITICAL SAFETY WARNING ⚠️**

Mainnet deployment involves real funds and carries significant financial risk. Only proceed if you:
- Have thoroughly tested on forks
- Understand MEV competition dynamics
- Have monitoring and alerting in place
- Are prepared for potential losses

```bash
# 1. Verify configuration
cp .env.example .env
# Edit .env with your production values

# 2. Deploy to mainnet
npm run deploy:mainnet

# 3. Verify deployment (optional)
VERIFY_CONTRACTS=true npm run deploy:mainnet

# 4. Fund the contract with gas ETH
# Send ~0.1 ETH to the deployed contract address

# 5. Start monitoring
docker-compose -f docker-compose.monitoring.yml up -d
```

### Deployment Configuration

Environment variables for deployment:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `PRIVATE_KEY` | Deployer private key | Yes | `0x123...` |
| `ETHEREUM_RPC_URL` | Primary RPC endpoint | Yes* | `https://...` |
| `RPC_URL_HTTP` | Fallback RPC endpoint | No | `https://rpc.ankr.com/eth` |
| `PROFIT_RECIPIENT` | Profit recipient address | No | `0xabc...` (defaults to deployer) |
| `POSITION_MANAGER` | Uniswap V3 Position Manager | No | (defaults to mainnet address) |
| `MIN_PROFIT_THRESHOLD` | Min profit in ETH | No | `0.01` |
| `MAX_LOAN_SIZE` | Max loan size in ETH | No | `1000` |
| `VERIFY_CONTRACTS` | Verify on Etherscan | No | `true` |
| `ETHERSCAN_API_KEY` | Etherscan API key | No | `ABC123...` |

**\*Note**: Either `ETHEREUM_RPC_URL` or `RPC_URL_HTTP` is required. The system automatically uses `RPC_URL_HTTP` as fallback for backward compatibility.

### Post-Deployment Steps

1. **Fund Contract**: Send ETH for gas costs
2. **Configure Monitoring**: Set up alerts and dashboards
3. **Test Execution**: Run simulation mode first
4. **Start Live Mode**: Only after thorough testing

## 🎯 Live Execution Mode

### Starting Live Mode

```bash
# Start in live mode (uses real funds!)
npm run live -- start

# Quick status check
npm run live:status
```

**Cross-Platform Note:** The scripts now use `cross-env` for Windows compatibility. The `NODE_ENV=production` is handled automatically.

### Live Mode Features

- **Real-time Execution**: Monitors mainnet mempool for opportunities
- **Profit Thresholds**: Only executes above configured USD thresholds
- **Gas Price Limits**: Respects maximum gas price settings
- **Retry Logic**: Automatic retry with exponential backoff
- **Safety Checks**: Multiple validation layers before execution
- **Emergency Shutdown**: Automatic shutdown on critical errors

### Live Mode Configuration

| Variable | Description | Default | Mainnet Recommended |
|----------|-------------|---------|-------------------|
| `PROFIT_THRESHOLD_USD` | Min profit in USD | `10.0` | `50.0` - `100.0` |
| `MAX_GAS_GWEI` | Max gas price in gwei | `100` | `150` - `200` |
| `FLASHBOTS_RELAY_URL` | Flashbots endpoint | Required | `https://relay.flashbots.net` |
| `FLASHBOTS_PRIVATE_KEY` | Flashbots signing key | Optional | Recommended |

### Live Mode Safety Checks

Before each execution, the bot performs:

1. **Profit Verification**: Ensures estimated profit exceeds threshold
2. **Gas Price Check**: Validates current gas price is acceptable
3. **Contract Balance**: Confirms sufficient ETH for gas
4. **Network Status**: Verifies RPC connectivity and block progression
5. **Bundle Validation**: Comprehensive transaction validation

### Live Mode Monitoring

Essential monitoring for live mode:

```bash
# Health check
curl http://localhost:3001/health

# Live execution metrics
curl http://localhost:3001/live-executions

# Alert status
curl http://localhost:3001/alerts
```

### Emergency Procedures

#### Emergency Pause
```solidity
// Call from owner address
jitExecutor.setPaused(true);
```

#### Stuck Fund Recovery
```solidity
// Withdraw ETH
jitExecutor.emergencyWithdraw(address(0), amount);

// Withdraw ERC20 tokens
jitExecutor.emergencyWithdraw(tokenAddress, amount);
```

#### Emergency Shutdown
```bash
# Graceful shutdown
pkill -SIGTERM -f "npm run live"

# Force shutdown
pkill -SIGKILL -f "npm run live"
```

## 📊 Monitoring

### Production Monitoring Stack

Start the complete monitoring stack:

```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

This deploys:
- **Prometheus**: Metrics collection (`http://localhost:9090`)
- **Grafana**: Visualization (`http://localhost:3000`)
- **AlertManager**: Alert routing (`http://localhost:9093`)
- **Node Exporter**: System metrics

### Key Dashboards

#### JIT Bot Metrics (`http://localhost:3001/metrics`)
- Real-time profit tracking
- Execution success rates
- Error monitoring
- Performance metrics

#### Prometheus Metrics (`http://localhost:3001/metrics/prometheus`)
- `jit_bot_swaps_detected_total`: Total opportunities detected
- `jit_bot_bundles_included_total`: Successful executions
- `jit_bot_realized_profit_eth`: Live mode profits
- `jit_bot_success_rate`: Bundle inclusion rate
- `jit_bot_live_profit_usd`: USD profit tracking
- `jit_bot_gas_efficiency`: Profit/gas ratio

#### Health Checks (`http://localhost:3001/health`)
- System status
- Recent activity validation
- Error rate monitoring

### Alert Configuration

Configure Slack/Discord alerts in `monitoring/alertmanager.yml`:

```yaml
global:
  slack_api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK'

receivers:
  - name: 'critical-alerts'
    slack_configs:
      - channel: '#jit-bot-alerts'
        title: '🚨 CRITICAL: JIT Bot Alert'
```

### Critical Alerts

- **High Error Rate**: >30% execution failures
- **No Activity**: No swaps detected for 30+ minutes
- **Negative Profit**: Net losses detected
- **System Down**: Application unresponsive
- **Poor Gas Efficiency**: Low profit/gas ratios

## 🛡️ Risk Management

### Built-in Safety Features

1. **Profit Thresholds**: Configurable minimum profit requirements
2. **Position Limits**: Maximum loan size caps
3. **Slippage Protection**: Automatic slippage checks
4. **Emergency Pause**: Owner-controlled kill switch
5. **Gas Price Limits**: Protection against extreme gas costs

### Operational Best Practices

1. **Start Small**: Begin with low profit thresholds and small position sizes
2. **Monitor Closely**: Watch metrics and logs during initial operation
3. **Test Thoroughly**: Use testnet and simulations before mainnet
4. **Keep Reserves**: Maintain ETH reserves for gas costs
5. **Regular Updates**: Stay updated with protocol changes

### Risk Disclosure

⚠️ **Warning**: This bot involves significant financial risks:
- Smart contract risks
- Flash loan failures
- MEV competition
- Gas cost volatility
- Market manipulation
- Regulatory risks

Only use funds you can afford to lose and understand the risks involved.

## 🧪 Development

### Running Tests
```bash
# Unit tests (TypeScript - compatible with Node 20+)
npm run test:unit

# All tests (unit + integration)
npm test

# Coverage report
npm run test:coverage

# Mainnet fork tests
npm run test:fork

# CI pipeline (lint + unit tests)
npm run ci
```

### Simulation Scripts
```bash
# Run example simulation
npm run simulate

# Test specific scenario
npx ts-node scripts/simulateExample.ts
```

### Code Quality
```bash
# Linting
npm run lint

# Fix linting issues
npm run lint:fix
```

## 📁 Project Structure

```
jit-bot/
├── contracts/           # Solidity smart contracts
│   ├── JitExecutor.sol
│   ├── BalancerFlashReceiver.sol
│   ├── AaveFlashReceiver.sol
│   └── libraries/
├── src/                 # TypeScript bot application
│   ├── bot/            # Main bot orchestrator
│   ├── watcher/        # Mempool monitoring
│   ├── bundler/        # Bundle construction
│   ├── executor/       # Bundle execution
│   ├── metrics/        # Monitoring & metrics
│   └── fork/           # Fork simulation environment
│       ├── forkSimulator.ts    # Core simulation logic
│       └── reportGenerator.ts  # Report generation
├── test/               # Test files
├── scripts/            # Deployment & utility scripts
│   ├── forkSimulation.ts      # Main fork simulation runner
│   └── startFork.ts           # Fork node launcher
├── reports/            # Simulation reports (timestamped)
├── config.json         # Bot configuration
└── docker-compose.yml  # Docker deployment
```

## 🔍 How It Works

1. **Detection**: Bot monitors Ethereum mempool for large Uniswap V3 swaps
2. **Analysis**: Calculates optimal LP position parameters and profit potential
3. **Simulation**: Tests the strategy on a forked blockchain
4. **Execution**: If profitable, constructs and submits Flashbots bundle:
   - Flash loan tokens from Balancer/Aave
   - Mint concentrated LP position around expected price
   - Target swap executes (via bundle ordering)
   - Burn LP position and collect fees
   - Repay flash loan
   - Keep profit

## 📝 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `ETHEREUM_RPC_URL` | Ethereum RPC endpoint | Yes | - |
| `ARBITRUM_RPC_URL` | Arbitrum RPC endpoint | No | - |
| `PRIVATE_KEY` | Bot wallet private key | Yes | - |
| `FLASHBOTS_PRIVATE_KEY` | Flashbots signing key | No | - |
| `JIT_CONTRACT_ADDRESS` | Deployed contract address | Yes | - |
| `MIN_PROFIT_THRESHOLD` | Minimum profit in ETH | No | 0.01 |
| `MAX_LOAN_SIZE` | Maximum flash loan size | No | 1000000 |
| `METRICS_PORT` | Metrics server port | No | 3001 |
| `FORK_BLOCK_NUMBER` | Block number for forking | No | Latest |
| `TARGET_POOLS` | Pools for simulation | No | All configured |
| `SIMULATION_GAS_PRICE_GWEI` | Gas price for simulations | No | 20 |
| `SIMULATION_REPORT_DIR` | Reports directory | No | ./reports |

## 🔧 Troubleshooting

### Windows Cross-Platform Compatibility

The bot is now fully compatible with Windows thanks to cross-env. You can run the same commands on Windows CMD, PowerShell, or Unix systems.

#### Running the Bot on Windows

```bash
# Simulation mode (safe testing)
npm run dev

# Production mode with live execution
npm run live -- start

# Quick status check
npm run live:status
```

#### Setting Environment Variables

**Option 1: PowerShell (Recommended)**
```powershell
# Set environment variables for current session
$env:ENABLE_LIVE_EXECUTION = "true"
$env:NODE_ENV = "production"
$env:I_UNDERSTAND_LIVE_RISK = "true"
npm run live -- start
```

**Option 2: Windows CMD**
```cmd
REM Set environment variables for current session  
set ENABLE_LIVE_EXECUTION=true
set NODE_ENV=production
set I_UNDERSTAND_LIVE_RISK=true
npm run live -- start
```

**Option 3: Use .env file (Cross-platform)**
```bash
# Create/edit .env file with your configuration
echo ENABLE_LIVE_EXECUTION=true >> .env
echo NODE_ENV=production >> .env
echo I_UNDERSTAND_LIVE_RISK=true >> .env

# Then run (works on all platforms)
npm run live -- start
```

**Note:** The updated scripts use `cross-env` to handle environment variables consistently across Windows, macOS, and Linux. You no longer need to manually set `NODE_ENV` before running the `live` script.

### Fixing npm ERESOLVE on install (ethers v5)

This project uses **ethers v5** for compatibility reasons. If you encounter `ERESOLVE` peer dependency conflicts during `npm install`, follow these steps:

#### Windows Commands
```cmd
# Clean installation
rmdir /s /q node_modules
del package-lock.json
npm install
```

#### Linux/macOS Commands
```bash
# Clean installation
rm -rf node_modules package-lock.json
npm install
```

#### Understanding the Issue

The project maintains compatibility with **ethers v5** while many newer Hardhat plugins require **ethers v6**. This creates peer dependency conflicts.

**Our Solution:**
- Uses `@nomiclabs/hardhat-ethers@^2.2.3` (supports ethers v5)
- Instead of `@nomicfoundation/hardhat-ethers@^3.x` (requires ethers v6)
- Pins `ethers@^5.7.2` for stability
- Uses `@typechain/ethers-v5@^10.2.1` for proper TypeScript support

#### Last Resort Option

If you still encounter issues, you can use the legacy peer deps resolver (not recommended):
```bash
npm install --legacy-peer-deps
```

**Note:** Only use `--legacy-peer-deps` if the above clean installation doesn't work, as it may lead to unexpected behavior.

#### Verification

After installation, verify everything works:
```bash
# Check versions
npm ls ethers @nomiclabs/hardhat-ethers

# Test compilation (requires internet for Solidity compiler download)
npm run build

# Test TypeScript compilation
npx tsc --noEmit
```

Expected output should show:
- `ethers@5.x.x`
- `@nomiclabs/hardhat-ethers@2.x.x`

## 🔧 Troubleshooting

### Mempool Monitoring Issues

If you're seeing "0 opportunities" despite active trading on target pools:

1. **Enable detailed logging:**
   ```bash
   export LOG_TARGET_POOL_SWAPS=true
   export ALLOW_RECONSTRUCT_RAW_TX=true
   ```

2. **Lower thresholds for testing:**
   ```bash
   export MIN_SWAP_ETH=0
   export MIN_SWAP_USD=0
   ```

3. **Verify mempool connection:**
   - Check that `mempool_txs_seen_total` metric is increasing
   - Confirm WebSocket connection to your RPC provider
   - Look for "SwapObserved" log lines within a few minutes on mainnet

4. **Common fixes:**
   - Ensure your RPC provider supports `eth_getRawTransactionByHash`
   - Verify your WebSocket URL is correct and accessible
   - Check that your target pools are properly configured in `config.json`
   - Enable raw transaction reconstruction with `ALLOW_RECONSTRUCT_RAW_TX=true`

5. **Debug sequence:**
   ```bash
   # Start with maximum logging
   export LOG_TARGET_POOL_SWAPS=true
   export MIN_SWAP_ETH=0
   export MIN_SWAP_USD=0
   export ALLOW_RECONSTRUCT_RAW_TX=true
   
   # Run in development mode
   npm run dev
   
   # Watch for these log messages:
   # - "SwapObserved" = successful decode
   # - "PendingSwapDetected" = candidate emitted
   # - "mempool_txs_seen_total" = mempool activity
   ```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is provided "as-is" without any guarantees. The authors are not responsible for any financial losses incurred through the use of this software. Always conduct thorough testing and understand the risks before deploying on mainnet.

## 🆘 Support

- **Documentation**: Check this README and code comments
- **Issues**: Open a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions and ideas

## 🔗 Useful Links

- [Uniswap V3 Documentation](https://docs.uniswap.org/protocol/concepts/V3-overview/concentrated-liquidity)
- [Flashbots Documentation](https://docs.flashbots.net/)
- [Balancer Flash Loans](https://docs.balancer.fi/guides/arbitrageurs/flash-loans)
- [Aave Flash Loans](https://docs.aave.com/developers/guides/flash-loans)