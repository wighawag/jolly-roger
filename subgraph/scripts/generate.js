/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs-extra');
const path = require('path');
const Handlebars = require('handlebars');

const args = process.argv.slice(2);
const pathArg = args[0];

if (!pathArg) {
  console.error(`please provide the path to contracts info, either a directory of deployemnt or a single export file`);
}
if (!fs.existsSync(pathArg)) {
  console.error(`file ${pathArg} doest not exits`);
}

const chainNames = {
  1: 'mainnet',
  3: 'ropsten',
  4: 'rinkeby',
  5: 'goerli',
  42: 'kovan',
  1337: 'mainnet',
  31337: 'mainnet',
};
// TODO use chain.network

const stat = fs.statSync(pathArg);
let contractsInfo;
if (stat.isDirectory()) {
  const chainId = fs.readFileSync(path.join(pathArg, '.chainId').toString());
  const chainName = chainNames[chainId];
  if (!chainName) {
    throw new Error(`chainId ${chainId} not know`);
  }
  contractsInfo = {
    contracts: {},
    chainName,
  };
  const files = fs.readdirSync(pathArg, {withFileTypes: true});
  for (const file of files) {
    if (!file.isDirectory() && file.name.substr(file.name.length - 5) === '.json' && !file.name.startsWith('.')) {
      const contractName = file.name.substr(0, file.name.length - 5);
      contractsInfo.contracts[contractName] = JSON.parse(fs.readFileSync(path.join(pathArg, file.name)).toString());
    }
  }
} else {
  const contractsInfoFile = JSON.parse(fs.readFileSync(pathArg).toString());
  contractsInfo = {
    contracts: contractsInfoFile.contracts,
    chainName: chainNames[contractsInfoFile.chainId],
  };
}

const contracts = contractsInfo.contracts;
fs.emptyDirSync('./abis');
for (const contractName of Object.keys(contracts)) {
  const contractInfo = contracts[contractName];
  fs.writeFileSync(path.join('abis', contractName + '.json'), JSON.stringify(contractInfo.abi));
}

const template = Handlebars.compile(fs.readFileSync('./templates/subgraph.yaml').toString());
const result = template(contractsInfo);
fs.writeFileSync('./subgraph.yaml', result);
