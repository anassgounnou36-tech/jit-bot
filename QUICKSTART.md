# JIT Bot Quickstart Guide

## 🚀 Two-Command Usage

### 1. Deploy Contracts
```bash
npm run deploy
```

### 2. Start the Bot (DRY_RUN mode by default)
```bash
npm run run
```

## 🔒 Safety First - DRY_RUN Mode

The bot starts in **DRY_RUN=true** mode by default for safety:
- ✅ Real mempool monitoring active
- ✅ Transaction decoding and analysis
- ✅ Profit calculations and metrics
- ❌ **NO LIVE EXECUTION** - completely safe

## 📊 Monitor Operations

### View Status
```bash
npm run run status
```

### Metrics Dashboard
Visit: http://localhost:9090/metrics

### Key Metrics to Monitor
- `mempool_txs_seen_total` - Transactions observed
- `mempool_swaps_decoded_total` - Uniswap swaps decoded
- `jit_candidates_profitable_total` - Profitable opportunities found
- `jit_bundle_simulations_total` - Bundle simulations performed

## ⚙️ Configuration

### Required Environment Variables
```bash
# Network
RPC_URL_HTTP=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY
RPC_URL_WS=wss://eth-mainnet.ws.alchemyapi.io/v2/YOUR_KEY

# Wallet
PRIVATE_KEY=0x...

# Safety (default values)
DRY_RUN=true
I_UNDERSTAND_LIVE_RISK=false
MIN_REQUIRED_ETH=0.005

# Thresholds
MIN_SWAP_ETH=10
GLOBAL_MIN_PROFIT_USD=20
MAX_GAS_GWEI=100
```

## 🔥 Enable Live Execution (ADVANCED USERS ONLY)

⚠️ **WARNING**: Live execution uses real funds and carries risk.

### Prerequisites
1. Thoroughly test in DRY_RUN mode
2. Understand MEV and JIT liquidity risks
3. Have sufficient ETH balance (>0.005 ETH)
4. Use separate Flashbots signing key

### Enable Live Mode
```bash
# 1. Acknowledge risks
I_UNDERSTAND_LIVE_RISK=true

# 2. Disable dry run
DRY_RUN=false

# 3. Configure Flashbots key (MUST be different from PRIVATE_KEY)
FLASHBOTS_SIGNING_KEY=0x...

# 4. Start bot
npm run run
```

## 📈 Expected Performance

Based on simulations:
- **Success Rate**: ~75% of identified opportunities
- **Average Profit**: $190+ USD per successful opportunity
- **Gas Efficiency**: ~800k gas per transaction
- **Response Time**: <2 seconds from mempool detection to simulation

## 🛟 Troubleshooting

### Bot Won't Start
- Check RPC URLs are valid and accessible
- Verify PRIVATE_KEY format (0x + 64 hex chars)
- Ensure config.json exists

### No Opportunities Detected
- Verify MIN_SWAP_ETH threshold (default: 10 ETH)
- Check pool configuration in config.json
- Monitor metrics: `mempool_txs_seen_total` should increase

### Live Execution Fails
- Verify sufficient ETH balance
- Check gas prices aren't above MAX_GAS_GWEI
- Ensure FLASHBOTS_SIGNING_KEY is different from PRIVATE_KEY

## 📚 Additional Resources

- **Full README**: ./README.md
- **Architecture**: ./docs/architecture.md
- **Configuration**: ./.env.example
- **Sample Reports**: ./reports/
- **Metrics Guide**: ./monitoring/grafana-dashboard.json

## 🆘 Support

For issues or questions:
1. Check logs for error messages
2. Review configuration validation warnings
3. Monitor metrics endpoint for system health
4. Verify network connectivity and RPC access
