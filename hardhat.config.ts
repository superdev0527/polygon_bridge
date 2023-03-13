import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { HttpNetworkUserConfig } from "hardhat/types";
import { HardhatUserConfig } from "hardhat/config";


import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";

import "./scripts/deploy-vault-task";
import "./scripts/deploy-periphery-task";

const {
  ALCHEMY_TOKEN_POLYGON,
  ALCHEMY_TOKEN_MUMBAI,
  ETHERSCAN_API_KEY_POLYGON,
  DEPLOYER_PRIVATE_KEY,
  DEPLOYER_MNEMONIC,
} = process.env;

const DEFAULT_MNEMONIC =
  "myth like bonus scare over problem client lizard pioneer submit female collect";

const sharedNetworkConfig: HttpNetworkUserConfig = {};

if (DEPLOYER_PRIVATE_KEY) {
  sharedNetworkConfig.accounts = [DEPLOYER_PRIVATE_KEY];
} else {
  sharedNetworkConfig.accounts = {
    mnemonic: DEPLOYER_MNEMONIC || DEFAULT_MNEMONIC,
  };
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [{ version: "0.8.17", settings: {} }],
  },
  networks: {
    hardhat: {
      forking: {
        url:
          "https://polygon-mainnet.g.alchemy.com/v2/" + ALCHEMY_TOKEN_POLYGON,
        blockNumber: 35364715,
      },
      gasPrice: 4985670377180,
      gas: 16000000,
    },
    localhost: {},
    polygon: {
      ...sharedNetworkConfig,
      url: "https://polygon-mainnet.g.alchemy.com/v2/" + ALCHEMY_TOKEN_POLYGON,
    },
    mumbai: {
      ...sharedNetworkConfig,
      url: "https://polygon-mumbai.g.alchemy.com/v2/" + ALCHEMY_TOKEN_MUMBAI,
    },
    coverage: {
      url: "http://127.0.0.1:8555", // Coverage launches its own ganache-cli client
    },
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: {
      polygon: ETHERSCAN_API_KEY_POLYGON,
    }
  },
  namedAccounts: {
    deployer: {
      default: 0, // use the first account (index = 0).
    },
  },
};

export default config;
