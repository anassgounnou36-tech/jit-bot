module.exports = {
  require: ['ts-node/register', 'dotenv/config', './test/setup/mockProvider.js'],
  extensions: ['ts'],
  spec: 'test/unit/**/*.test.ts',
  timeout: 10000,
  recursive: true,
  env: {
    NODE_ENV: 'test',
    RPC_URL_HTTP: 'https://rpc.ankr.com/eth',
    RPC_URL_WS: 'wss://rpc.ankr.com/eth/ws',
    PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
    CHAIN: 'ethereum',
    SIMULATION_MODE: 'true',
    MAX_GAS_GWEI: '100',
    PROMETHEUS_PORT: '3001'
  }
};