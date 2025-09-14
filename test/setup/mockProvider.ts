// Global provider mock to prevent network calls in unit tests.
// Loaded via .mocharc.cjs `require` so imports that create providers won't reach the network.

import { ethers } from 'ethers';

// Fixed network data to satisfy getNetwork()
const FixedNetwork = { name: 'homestead', chainId: 1 };

class MockJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  constructor(..._args: any[]) {
    // Intentionally pass a dummy URL; we override network methods so no socket is opened.
    super('http://localhost:0');
  }
  // Prevent provider from trying to detect the network
  async getNetwork() {
    return FixedNetwork as any;
  }
  async getBlockNumber() {
    return 18500000; // stable mock block
  }
  async getGasPrice() {
    return ethers.BigNumber.from('20000000000'); // 20 gwei
  }
}

class MockWebSocketProvider extends ethers.providers.WebSocketProvider {
  constructor(..._args: any[]) {
    super('ws://localhost:0');
  }
  async getNetwork() {
    return FixedNetwork as any;
  }
}

// Monkey-patch ethers providers globally
(ethers.providers as any).JsonRpcProvider = MockJsonRpcProvider;
(ethers.providers as any).WebSocketProvider = MockWebSocketProvider;

export {};