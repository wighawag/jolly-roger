import WalletStores from 'web3w';
import contractsInfo from '../contracts.json';

const walletStores = WalletStores({
  // log: console,
  // debug: true,
  chainConfigs: contractsInfo,
  builtin: {autoProbe: true, metamaskReloadFix: true},
});

if (typeof window !== 'undefined') {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).walletStores = walletStores;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const {wallet, transactions, builtin, chain, balance} = walletStores;
