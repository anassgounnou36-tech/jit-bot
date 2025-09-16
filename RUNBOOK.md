# Production Runbook - JIT Bot Operations

This runbook provides step-by-step procedures for managing the JIT Bot in production, including deployment, monitoring, emergency procedures, and maintenance operations.

## Pre-Production Checklist

Before flipping `SIMULATION_MODE=false`, ensure all acceptance criteria are met:

- [ ] All contract tests pass (profit guard, callbacks)
- [ ] Three reports/report-*.json files generated and validated
- [ ] Slither shows no High severity findings
- [ ] eth_callBundle simulation success confirmed
- [ ] deploy-safe.ts exists and tested on testnet
- [ ] verifier.js output shows all green
- [ ] PRIVATE_KEY !== FLASHBOTS_SIGNING_KEY validated
- [ ] I_UNDERSTAND_LIVE_RISK=true acknowledged

## 1. First Live Deployment Steps

### 1.1 Sepolia Testnet Deployment

```bash
# Deploy to testnet first
export NETWORK=sepolia
export DRY_RUN=false
export CONFIRM_TESTNET=true

ts-node scripts/deploy-safe.ts --network sepolia

# Verify deployment
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> \
  <MIN_PROFIT_THRESHOLD> <MAX_LOAN_SIZE> <PROFIT_RECIPIENT> <POSITION_MANAGER>
```

**Expected Output:**
- Contract address returned
- Etherscan verification successful
- Gas usage < 2M gas
- All constructor parameters validated

### 1.2 Testnet Smoke Tests

```bash
# Run smoke tests against deployed contract
export CONTRACT_ADDRESS=<SEPOLIA_CONTRACT_ADDRESS>
export SIMULATION_MODE=true

# Test flashloan capabilities
npm run test:unit -- --grep "flashloan orchestrator"

# Test mempool capture
npm run test:unit -- --grep "mempool raw tx"

# Test bundle construction  
npm run test:unit -- --grep "bundle inclusion"
```

**Success Criteria:**
- All tests pass with actual contract
- Raw transaction capture > 90% success rate
- Bundle validation passes
- No contract interaction failures

### 1.3 Production Infrastructure Setup

```bash
# Production environment configuration
export NODE_ENV=production
export SIMULATION_MODE=true  # Initially true for safety
export I_UNDERSTAND_LIVE_RISK=false  # Initially false

# Required environment variables
export RPC_URL_HTTP=<MAINNET_RPC>
export RPC_URL_WS=<MAINNET_WS>
export PRIVATE_KEY=<PRODUCTION_PRIVATE_KEY>
export FLASHBOTS_SIGNING_KEY=<DIFFERENT_SIGNING_KEY>
export CONTRACT_ADDRESS=<MAINNET_CONTRACT_ADDRESS>

# Safety limits
export MAX_GAS_GWEI=100
export GLOBAL_MIN_PROFIT_USD=50
export MAX_FLASHLOAN_AMOUNT_USD=300000

# Start in simulation mode
npm run live
```

## 2. Simulation Mode Validation (48 Hours)

### 2.1 Monitoring During Simulation

Monitor these metrics for 48 hours:

```bash
# Key metrics to watch
curl http://localhost:3001/metrics | grep -E "(mempool_raw_tx_capture_rate|bundle_success_rate|profit_opportunities_detected)"

# Log validation
tail -f logs/jit-bot.log | grep -E "(PendingSwapDetected|BundleCreated|SimulationResult)"
```

**Required Metrics (48h avg):**
- Raw TX capture rate > 90%
- Bundle simulation success > 95%
- Opportunities detected > 10/hour
- Zero contract interaction failures
- Memory usage stable < 1GB
- CPU usage < 50%

### 2.2 Daily Validation Checks

```bash
# Daily validation script
node scripts/daily-validation.js

# Check simulation reports
ls -la reports/simulation-*.json

# Validate profit estimates
node scripts/validate-profit-estimates.js --days 2
```

**Daily Checklist:**
- [ ] No errors in application logs
- [ ] Mempool connection stable
- [ ] Bundle simulations passing
- [ ] Profit estimates within 10% variance
- [ ] No memory leaks detected
- [ ] Database/storage healthy

## 3. Going Live (Remove Simulation Mode)

### 3.1 Final Pre-Live Checks

```bash
# Run full verification one more time
node scripts/verifier.js

# Check account balances
node scripts/check-balances.js

# Validate flashloan providers
node scripts/check-flashloan-liquidity.js
```

### 3.2 Enable Live Mode

```bash
# CRITICAL: Only proceed if all checks pass
export SIMULATION_MODE=false
export I_UNDERSTAND_LIVE_RISK=true
export ENABLE_FLASHBOTS=true

# Start with conservative settings
export GLOBAL_MIN_PROFIT_USD=100  # Start high, reduce gradually

# Restart application
npm run live
```

### 3.3 Live Mode Monitoring (First Hour)

Monitor extremely closely for the first hour:

```bash
# Real-time monitoring
tail -f logs/jit-bot.log | grep -E "(JitExecuted|JitFailed|ProfitTransferred)"

# Financial tracking
curl http://localhost:3001/metrics | grep -E "(profit_realized_usd|gas_spent_eth|flashloan_fees_paid)"

# Error monitoring
curl http://localhost:3001/metrics | grep -E "(errors_total|failed_bundles|rejected_opportunities)"
```

**Immediate Stop Conditions:**
- Any unexpected reverts
- Gas costs > expected profits
- Flashloan failures
- Bundle inclusion rate < 10%
- Mempool connection drops

## 4. Emergency Procedures

### 4.1 Emergency Pause

```bash
# Method 1: Application shutdown
pkill -f "jit-bot"

# Method 2: Contract pause (if accessible)
npx hardhat run scripts/emergency-pause.js --network mainnet

# Method 3: Emergency stop via contract
npx hardhat console --network mainnet
> const contract = await ethers.getContractAt("JitExecutor", "<ADDRESS>")
> await contract.pause()
```

### 4.2 Emergency Withdraw

```bash
# Withdraw all funds from contract
npx hardhat run scripts/emergency-withdraw.js --network mainnet

# Script should withdraw:
# - All ERC20 token balances
# - All ETH balance  
# - Transfer to owner address
```

### 4.3 Incident Response

**Level 1 - Minor Issues:**
- Profit below expectations
- Single bundle failures
- Minor gas price spikes

*Action:* Monitor closely, adjust parameters if needed

**Level 2 - Moderate Issues:**
- Multiple bundle failures
- Mempool connection issues
- Flashloan provider failures

*Action:* Pause bot, investigate, fix issue, resume

**Level 3 - Critical Issues:**
- Contract interactions failing
- Unexpected fund losses
- Security incident detected

*Action:* Emergency pause, emergency withdraw, full investigation

### 4.4 Emergency Contacts

```bash
# On-call rotation
PRIMARY_ONCALL=<primary_engineer_contact>
SECONDARY_ONCALL=<secondary_engineer_contact>
ESCALATION_CONTACT=<technical_lead_contact>

# Alert channels
SLACK_ALERT_CHANNEL=#jit-bot-alerts
PAGERDUTY_SERVICE=<service_id>
```

## 5. Key Rotation

### 5.1 Private Key Rotation

```bash
# Generate new key
node scripts/generate-keypair.js

# Update environment (do not restart yet)
export NEW_PRIVATE_KEY=<new_private_key>

# Test new key
node scripts/test-key.js --key=$NEW_PRIVATE_KEY

# Hot swap keys (zero downtime)
node scripts/rotate-keys.js --old=$PRIVATE_KEY --new=$NEW_PRIVATE_KEY
```

### 5.2 Flashbots Key Rotation

```bash
# Generate new Flashbots signing key
export NEW_FLASHBOTS_SIGNING_KEY=<new_signing_key>

# Register with Flashbots
node scripts/register-flashbots-key.js --key=$NEW_FLASHBOTS_SIGNING_KEY

# Update configuration
node scripts/update-flashbots-key.js --key=$NEW_FLASHBOTS_SIGNING_KEY
```

## 6. Rollback Procedures

### 6.1 Application Rollback

```bash
# Rollback to previous version
git checkout <previous_commit>
npm ci
npm run build

# Restore previous configuration
cp config/production-backup.json config/production.json

# Restart with rollback
NODE_ENV=production npm run live
```

### 6.2 Configuration Rollback

```bash
# Revert to simulation mode
export SIMULATION_MODE=true
export I_UNDERSTAND_LIVE_RISK=false

# Restore conservative limits
export GLOBAL_MIN_PROFIT_USD=100
export MAX_GAS_GWEI=50

# Restart application
npm run live
```

### 6.3 Contract Rollback

If contract needs to be replaced:

```bash
# Deploy new contract with same parameters
ts-node scripts/deploy-safe.ts --network mainnet

# Migrate state if necessary
node scripts/migrate-contract-state.js \
  --from=<OLD_CONTRACT> \
  --to=<NEW_CONTRACT>

# Update application configuration
export CONTRACT_ADDRESS=<NEW_CONTRACT_ADDRESS>
```

## 7. Monitoring and Alerting

### 7.1 Critical Alerts

Set up alerts for:

- **Bundle failure rate > 20%** (5 minute window)
- **No successful bundles for > 30 minutes**
- **Raw TX capture rate < 80%** (10 minute window)
- **Application crash/restart**
- **Out of memory conditions**
- **Disk space < 10%**
- **Network connectivity loss**

### 7.2 Business Metrics

Monitor daily:

- **Daily profit realized (USD)**
- **Gas costs vs profit ratio**
- **Opportunities detected vs captured**
- **Average profit per opportunity**
- **Flashloan provider success rates**

### 7.3 System Health

Monitor continuously:

- **CPU usage < 70%**
- **Memory usage < 80%**
- **Disk I/O latency < 100ms**
- **Network latency to RPC < 50ms**
- **Application uptime**

## 8. Maintenance Windows

### 8.1 Weekly Maintenance

Every Sunday 02:00-04:00 UTC:

```bash
# Graceful shutdown
node scripts/graceful-shutdown.js

# System updates
sudo apt update && sudo apt upgrade

# Log rotation
logrotate /etc/logrotate.d/jit-bot

# Database cleanup
node scripts/cleanup-old-data.js --days=30

# Health check and restart
node scripts/health-check.js && npm run live
```

### 8.2 Monthly Maintenance

First Sunday of each month:

```bash
# Full system backup
node scripts/backup-system.js

# Configuration audit
node scripts/audit-config.js

# Security scan
npm audit
node scripts/security-scan.js

# Performance analysis
node scripts/performance-report.js --days=30
```

## 9. Post-Incident Procedures

### 9.1 Immediate Post-Incident

1. **Confirm System Stability**
   - All alerts cleared
   - Normal operation resumed
   - No data corruption

2. **Collect Evidence**
   - Save all relevant logs
   - Export metrics data
   - Document timeline

3. **Notify Stakeholders**
   - Incident resolution
   - Impact assessment
   - Next steps

### 9.2 Post-Incident Analysis

Within 24 hours:

1. **Root Cause Analysis**
   - Technical analysis
   - Process review
   - Human factors

2. **Action Items**
   - Immediate fixes
   - Process improvements
   - Monitoring enhancements

3. **Documentation**
   - Update runbook
   - Update monitoring
   - Share learnings

## 10. Performance Optimization

### 10.1 Gradual Parameter Tuning

After 7 days of stable operation:

```bash
# Gradually reduce minimum profit threshold
export GLOBAL_MIN_PROFIT_USD=75  # Week 2
export GLOBAL_MIN_PROFIT_USD=50  # Week 3
export GLOBAL_MIN_PROFIT_USD=25  # Week 4

# Monitor impact on success rate and safety
```

### 10.2 Pool Management

```bash
# Enable additional pools gradually
node scripts/enable-pool.js --pool=<POOL_ADDRESS> --min-liquidity=1000000

# Monitor pool performance
node scripts/pool-performance.js --days=7

# Disable underperforming pools
node scripts/disable-pool.js --pool=<POOL_ADDRESS> --reason="Low profitability"
```

---

## Quick Reference

### Emergency Commands
```bash
# Immediate stop
pkill -f "jit-bot" && npx hardhat run scripts/emergency-pause.js

# Health check
curl http://localhost:3001/health

# Current status
curl http://localhost:3001/metrics | grep -E "(status|uptime|profit)"
```

### Log Locations
- Application logs: `/var/log/jit-bot/app.log`
- Error logs: `/var/log/jit-bot/error.log`
- Audit logs: `/var/log/jit-bot/audit.log`

### Configuration Files
- Production config: `config/production.json`
- Environment vars: `/etc/environment`
- Service config: `/etc/systemd/system/jit-bot.service`

---

**⚠️ CRITICAL REMINDER:** This system handles real funds on mainnet. Always err on the side of caution and follow the emergency procedures if anything seems abnormal.