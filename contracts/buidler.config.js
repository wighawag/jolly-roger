require("dotenv").config();
const fs = require("fs");
usePlugin("buidler-deploy");
usePlugin("buidler-ethers-v5");

let mnemonic = process.env.MNEMONIC;
if (!mnemonic || mnemonic === "") {
  const mnemonicPath = process.env.MNEMONIC_PATH;
  if (mnemonicPath && mnemonicPath !== "") {
    mnemonic = fs.readFileSync(mnemonicPath).toString();
  }
}
let mainnetMnemonic;
if (mnemonic) {
  mainnetMnemonic = mnemonic;
} else {
  try {
    mnemonic = fs.readFileSync(".mnemonic").toString();
  } catch (e) {}
  try {
    mainnetMnemonic = fs.readFileSync(".mnemonic_mainnet").toString();
  } catch (e) {}
}
const accounts = mnemonic
  ? {
      mnemonic,
    }
  : undefined;
const mainnetAccounts = mainnetMnemonic
  ? {
      mnemonic: mainnetMnemonic,
    }
  : undefined;

module.exports = {
  solc: {
    version: "0.6.5",
    optimizer: {
      enabled: true,
      runs: 2000,
    },
  },
  paths: {
    sources: "src",
  },
  networks: {
    rinkeby: {
      url: "https://rinkeby.infura.io/v3/" + process.env.INFURA_TOKEN,
      accounts,
    },
    mainnet: {
      url: "https://mainnet.infura.io/v3/" + process.env.INFURA_TOKEN,
      accounts: mainnetAccounts,
    },
  },
  namedAccounts: {
    deployer: 0,
    others: "from:3",
  },
};
