# JIT Liquidity Provision Bot for Uniswap V3

A production-ready Just-In-Time (JIT) liquidity provision bot that automatically detects large pending swaps and provides concentrated liquidity to capture fees.

## 🚀 Features

- **Mempool Monitoring**: Real-time detection of large Uniswap V3 swaps
- **Flash Loan Integration**: Zero-capital strategy using Balancer (primary) and Aave (fallback) flash loans
- **Concentrated Liquidity**: Automated positioning around expected swap prices
- **Flashbots Integration**: MEV-protected bundle execution
- **Risk Management**: Comprehensive safety checks and profit thresholds
- **Monitoring & Metrics**: Built-in Prometheus metrics and HTTP dashboard
- **Multi-chain Support**: Ethereum mainnet and Arbitrum

## 📋 Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Usage](#usage)
- [Monitoring](#monitoring)
- [Risk Management](#risk-management)
- [Development](#development)
- [Contributing](#contributing)

## 🏗️ Architecture

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
   - `JitExecutor.sol`: Core contract handling flash loans and LP operations
   - `BalancerFlashReceiver.sol`: Balancer Vault flash loan adapter
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
   
   # Bot Configuration
   MIN_PROFIT_THRESHOLD=0.01
   MAX_LOAN_SIZE=1000000
   ```

3. **Configure target pools** (edit `config.json`)
   ```json
   {
     "targets": [
       {
         "pool": "WETH-USDC-0.3%",
         "address": "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8",
         "token0": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
         "token1": "0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E",
         "fee": 3000
       }
     ]
   }
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

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### Docker Deployment
```bash
docker-compose up -d
```

### CLI Commands
```bash
# Start the bot
node dist/bot/index.js start

# Check status
node dist/bot/index.js status

# Run simulation
npm run simulate
```

## 📊 Monitoring

### Metrics Dashboard
Access the built-in dashboard at `http://localhost:3001/metrics`

### Prometheus Metrics
Metrics are available at `http://localhost:3001/metrics/prometheus`

### Key Metrics
- `jit_bot_swaps_detected_total`: Total swaps detected
- `jit_bot_bundles_submitted_total`: Total bundles submitted
- `jit_bot_success_rate`: Bundle inclusion success rate
- `jit_bot_total_profit_eth`: Total profit in ETH
- `jit_bot_net_profit_eth`: Net profit after gas costs

### Grafana Dashboard
Import the provided Grafana dashboard from `monitoring/grafana-dashboard.json`

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
│   └── metrics/        # Monitoring & metrics
├── test/               # Test files
├── scripts/            # Deployment & utility scripts
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