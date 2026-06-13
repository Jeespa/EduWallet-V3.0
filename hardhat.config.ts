import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
      evmVersion: "cancun",
    },
  },

  networks: {
    hardhat: {
      hardfork: "cancun",
      accounts: [
        // Account 0 — kept as custom key for existing deploy scripts
        {
          balance: "10000000000000000000000000000000",
          privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
        // Accounts 1-3 — standard Hardhat dev keys, used by tests
        {
          balance: "10000000000000000000000000000000",
          privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        },
        {
          balance: "10000000000000000000000000000000",
          privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
        },
        {
          balance: "10000000000000000000000000000000",
          privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
        },
      ],
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  // gas cost benchmarks
  // Run with: REPORT_GAS=true npx hardhat test test/gas-benchmarks.ts
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
    // coinmarketcap key omitted — USD estimates require live price feed
    // Run without it to get raw gas units, which is what the thesis uses
  },
};

export default config;
