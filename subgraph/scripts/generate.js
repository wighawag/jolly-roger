const fs = require("fs-extra");
const path = require("path");
const Handlebars = require("handlebars");

const args = process.argv.slice(2);
// if (args)

const contractsInfo = JSON.parse(fs.readFileSync(args[0]).toString());
const contracts = contractsInfo.contracts;

fs.emptyDirSync("./abis");
for (const contractName of Object.keys(contracts)) {
  const contractInfo = contracts[contractName];
  fs.writeFileSync(path.join("abis", contractName + ".json"), JSON.stringify(contractInfo.abi));
}

const template = Handlebars.compile(fs.readFileSync("./templates/subgraph.yaml").toString());
const result = template(contractsInfo);
fs.writeFileSync("./subgraph.yaml", result);
