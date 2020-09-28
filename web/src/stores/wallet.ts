import WalletStores from 'web3w';
import {TorusModuleLoader} from 'web3w-torus-loader';
import {WalletConnectModuleLoader} from 'web3w-walletconnect-loader';
import contractsInfo from '../contracts.json';

const chainId = import.meta.env.VITE_CHAIN_ID;
let nodeUrl: string | undefined;
if (chainId === '1337' || chainId === '31337') {
  nodeUrl = 'http://localhost:8545';
}

const walletStores = WalletStores({
  chainConfigs: contractsInfo,
  builtin: {autoProbe: true},
  localStoragePrefix: window.basepath && window.basepath.startsWith('/ipfs/') ? window.basepath.slice(6) : undefined, // ensure local storage is not shared across web3w apps on ipfs gateway
  options: [
    'builtin',
    new TorusModuleLoader({verifier: 'google', nodeUrl, chainId}),
    new TorusModuleLoader({verifier: 'facebook', nodeUrl, chainId}),
    new TorusModuleLoader({verifier: 'discord', nodeUrl, chainId}),
    new WalletConnectModuleLoader({nodeUrl, chainId, infuraId: 'bc0bdd4eaac640278cdebc3aa91fabe4'}),
  ],
});

// USEFUL FOR DEBUGGING:
if (typeof window !== 'undefined') {
  // console.log('adding walletStores');
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).walletStores = walletStores;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const {wallet, transactions, builtin, chain, balance, flow} = walletStores;
