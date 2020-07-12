import WalletStores from 'web3w';
import contractsInfo from 'contractsInfo';

import TorusModule from 'web3w-torus';

import WalletConnectModule from 'web3w-walletconnect';

const fallbackUrl = 'http://localhost:8545'; // TODO use env

const {wallet, builtin, chain, transactions, balance} = WalletStores({
  // log: console,
  // debug: true,
  chainConfigs: contractsInfo,
  options: [
    'builtin',
    new TorusModule({fallbackUrl}),
    new WalletConnectModule({fallbackUrl}),
  ],
  // builtin: {autoProbe: true, metamaskReloadFix: true},
});

// TODO remove
if (typeof window !== 'undefined') {
  window.wallet = wallet;
}

export {wallet, builtin, chain, transactions, balance};
