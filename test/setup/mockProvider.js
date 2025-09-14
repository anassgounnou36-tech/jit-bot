// Global provider mock to prevent network calls in unit tests.
// Loaded via .mocharc.cjs `require` so imports that create providers won't reach the network.

const { ethers } = require('ethers');

// Fixed network data to satisfy getNetwork()
const FixedNetwork = { name: 'homestead', chainId: 1 };

class MockJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  constructor(..._args) {
    // Intentionally pass a dummy URL; we override network methods so no socket is opened.
    super('http://localhost:0');
  }
  // Prevent provider from trying to detect the network
  async getNetwork() {
    return FixedNetwork;
  }
  async getBlockNumber() {
    return 18500000; // stable mock block
  }
  async getGasPrice() {
    return ethers.BigNumber.from('20000000000'); // 20 gwei
  }
  async getFeeData() {
    return {
      gasPrice: ethers.BigNumber.from('20000000000'), // 20 gwei
      maxFeePerGas: ethers.BigNumber.from('25000000000'), // 25 gwei
      maxPriorityFeePerGas: ethers.BigNumber.from('2000000000'), // 2 gwei
      lastBaseFeePerGas: ethers.BigNumber.from('23000000000') // 23 gwei
    };
  }
}

class MockWebSocketProvider extends ethers.providers.WebSocketProvider {
  constructor(..._args) {
    super('ws://localhost:0');
  }
  async getNetwork() {
    return FixedNetwork;
  }
}

// Monkey-patch ethers providers globally
ethers.providers.JsonRpcProvider = MockJsonRpcProvider;
ethers.providers.WebSocketProvider = MockWebSocketProvider;