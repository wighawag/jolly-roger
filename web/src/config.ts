const chainId = import.meta.env.SNOWPACK_PUBLIC_CHAIN_ID;
let nodeUrl: string | undefined;
let finality = 12;
let blockTime = 15;
if (chainId !== '1') {
  finality = 5; // TODO
}

if (chainId === '1337' || chainId === '31337') {
  const localEthNode = import.meta.env.SNOWPACK_PUBLIC_ETH_NODE_URI_LOCALHOST;
  if (localEthNode && localEthNode !== '') {
    nodeUrl = localEthNode;
  } else {
    nodeUrl = 'http://localhost:8545';
  }
  finality = 2;
  blockTime = 5;
}

const chainNames: {[chainId: string]: string} = {
  '1': 'mainnet',
  '3': 'ropsten',
  '4': 'rinkeby',
  '5': 'goerli',
  '42': 'kovan',
  '1337': 'localhost chain',
  '31337': 'localhost chain',
};

const chainName = (() => {
  const name = chainNames[chainId];
  if (name) {
    return name;
  }
  return `chain with id ${chainId}`;
})();

if (!nodeUrl) {
  const url = import.meta.env.SNOWPACK_PUBLIC_ETH_NODE_URI;
  if (url && url !== '') {
    nodeUrl = url;
  }
}

export {finality, nodeUrl, chainId, blockTime, chainName};
