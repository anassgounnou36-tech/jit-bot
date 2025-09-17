import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

// Normalize mainnet URL with fallback and warning
const mainnetUrl = process.env.ETHEREUM_RPC_URL || process.env.RPC_URL_HTTP || "";
if (!mainnetUrl) {
  console.warn("⚠️ Warning: No mainnet RPC URL configured. Set ETHEREUM_RPC_URL or RPC_URL_HTTP");
} else if (!process.env.ETHEREUM_RPC_URL && process.env.RPC_URL_HTTP) {
  console.log("ℹ️ Info: Using RPC_URL_HTTP as fallback for ETHEREUM_RPC_URL");
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      }
    ],
  },
  networks: {
    hardhat: {
      forking: mainnetUrl ? {
        url: mainnetUrl,
        blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined,
      } : undefined,
      allowUnlimitedContractSize: true,
      gas: 12000000,
      blockGasLimit: 12000000,
    },
    fork: {
      url: "http://127.0.0.1:8545",
      timeout: 60000,
    },
    mainnet: {
      url: mainnetUrl,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
};

export default config;