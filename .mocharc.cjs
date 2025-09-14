module.exports = {
  require: ['ts-node/register', 'dotenv/config'],
  extensions: ['ts'],
  spec: 'test/unit/**/*.test.ts',
  timeout: 10000,
  recursive: true,
  env: {
    NODE_ENV: 'test',
    RPC_URL_HTTP: 'http://localhost:8545',
    RPC_URL_WS: 'ws://localhost:8545',
    PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
    CHAIN: 'ethereum',
    SIMULATION_MODE: 'true',
    MAX_GAS_GWEI: '100',
    PROMETHEUS_PORT: '3001'
  }
};