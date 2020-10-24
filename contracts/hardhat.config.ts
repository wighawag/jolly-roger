import 'dotenv';
import {Wallet} from '@ethersproject/wallet';
import {HardhatUserConfig} from 'hardhat/config';
import 'hardhat-deploy';
import 'hardhat-deploy-ethers';

let mnemonic = process.env.MNEMONIC;
if (!mnemonic) {
  mnemonic = Wallet.createRandom().mnemonic.phrase;
}
const accounts = {
  mnemonic,
};

const config: HardhatUserConfig = {
  solidity: {
    version: '0.7.1',
    settings: {
      optimizer: {
        enabled: true,
        runs: 2000,
      },
    },
  },
  namedAccounts: {
    deployer: 0,
  },
  networks: {
    coverage: {
      url: 'http://localhost:5458',
    },
    hardhat: {
      accounts,
    },
    localhost: {
      url: 'http://localhost:8545',
      accounts,
    },
    staging: {
      url: 'https://rinkeby.infura.io/v3/' + process.env.INFURA_TOKEN,
      accounts,
    },
    rinkeby: {
      url: 'https://rinkeby.infura.io/v3/' + process.env.INFURA_TOKEN,
      accounts,
    },
    kovan: {
      url: 'https://kovan.infura.io/v3/' + process.env.INFURA_TOKEN,
      accounts,
    },
    goerli: {
      url: 'https://goerli.infura.io/v3/' + process.env.INFURA_TOKEN,
      accounts,
    },
    mainnet: {
      url: 'https://mainnet.infura.io/v3/' + process.env.INFURA_TOKEN,
      accounts,
    },
  },
  paths: {
    sources: 'src',
  },
};

export default config;
