import WalletStores from 'web3w';
import {TorusModuleLoader} from 'web3w-torus-loader';
import {WalletConnectModuleLoader} from 'web3w-walletconnect-loader';
import contractsInfo from '../contracts.json';

const chainId = import.meta.env.VITE_CHAIN_ID;
let fallbackUrl: string | undefined;
if (chainId === '1337' || chainId === '31337') {
  fallbackUrl = 'http://localhost:8545';
}

const walletStores = WalletStores({
  chainConfigs: contractsInfo,
  builtin: {autoProbe: true},
  options: [
    'builtin',
    new TorusModuleLoader({verifier: 'google', fallbackUrl, chainId}),
    new TorusModuleLoader({verifier: 'facebook', fallbackUrl, chainId}),
    new TorusModuleLoader({verifier: 'discord', fallbackUrl, chainId}),
    new WalletConnectModuleLoader({fallbackUrl, chainId}),
  ],
});

if (typeof window !== 'undefined') {
  // console.log('adding walletStores');
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).walletStores = walletStores;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const {wallet, transactions, builtin, chain, balance, flow} = walletStores;
