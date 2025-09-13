# JIT Liquidity Provision Bot for Uniswap V3

A production-ready Just-In-Time (JIT) liquidity provision bot that automatically detects large pending swaps and provides concentrated liquidity to capture fees. Supports both simulation and live mainnet execution modes.

## 🚨 Security Notice

**IMPORTANT: This release (PR1) is SIMULATION-ONLY for safety.**

- **Never commit private keys** to version control
- **Always use `.env` files** for sensitive configuration
- **Keep simulation mode enabled** (`SIMULATION_MODE=true`) until thoroughly tested
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
   - `FLASHBOTS_PRIVATE_KEY`: Separate key for Flashbots (optional)

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

**Note:** In PR1, all execution paths that would send real transactions are blocked. This ensures safe testing while validating the strategy logic.

## 🚀 Features

- **Multi-Pool Monitoring**: Concurrent monitoring of multiple Uniswap V3 pools with opportunity ranking
- **Mempool Monitoring**: Real-time detection of large Uniswap V3 swaps across all target pools
- **Opportunity Optimization**: Intelligent selection of the most profitable bundle per block
- **Flash Loan Integration**: Zero-capital strategy using Balancer (primary) and Aave (fallback) flash loans
- **Concentrated Liquidity**: Automated positioning around expected swap prices
- **Flashbots Integration**: MEV-protected bundle execution with retry logic
- **Pool-Level Risk Management**: Per-pool failure tracking, auto-disable, and cooldown mechanisms
- **Advanced Metrics**: Pool-specific profit tracking, success rates, and Prometheus metrics
- **Multi-chain Support**: Ethereum mainnet and Arbitrum
- **Live Execution**: Production-ready mainnet deployment with safety features
- **Emergency Controls**: Pause functionality and stuck fund recovery

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

2. **Configure environment variables**
   ```bash
   # RPC Endpoints
   ETHEREUM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY
   ARBITRUM_RPC_URL=https://arb-mainnet.alchemyapi.io/v2/YOUR_KEY
   
   # Wallet
   PRIVATE_KEY=0x...
   
   # Flashbots
   FLASHBOTS_RELAY_URL=https://relay.flashbots.net
   FLASHBOTS_PRIVATE_KEY=0x...
   
   # Multi-Pool Configuration
   ENABLE_MULTI_POOL=true
   POOL_IDS=WETH-USDC-0.05%,ETH-USDT-0.3%,WBTC-ETH-0.3%
   PROFIT_THRESHOLD_USD=100.0
   
   # Bot Configuration
   MIN_PROFIT_THRESHOLD=0.01
   MAX_LOAN_SIZE=1000000
   ```

3. **Configure target pools** (edit `config.json`)
   ```json
   {
     "targets": [
       {
         "pool": "WETH-USDC-0.05%",
         "address": "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
         "token0": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
         "token1": "0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E",
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

## 🚀 Deployment

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
npm run live
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
| `ETHEREUM_RPC_URL` | RPC endpoint | Yes | `https://...` |
| `MIN_PROFIT_THRESHOLD` | Min profit in ETH | No | `0.01` |
| `MAX_LOAN_SIZE` | Max loan size in ETH | No | `1000` |
| `VERIFY_CONTRACTS` | Verify on Etherscan | No | `true` |
| `ETHERSCAN_API_KEY` | Etherscan API key | No | `ABC123...` |

### Post-Deployment Steps

1. **Fund Contract**: Send ETH for gas costs
2. **Configure Monitoring**: Set up alerts and dashboards
3. **Test Execution**: Run simulation mode first
4. **Start Live Mode**: Only after thorough testing

## 🎯 Live Execution Mode

### Starting Live Mode

```bash
# Start in live mode (uses real funds!)
NODE_ENV=production npm run live
```

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
# Unit tests
npm test

# Coverage report
npm run test:coverage

# Mainnet fork tests
npm run test:fork
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