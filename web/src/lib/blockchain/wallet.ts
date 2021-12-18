import {initWeb3W} from 'web3w';
import {WalletConnectModuleLoader} from 'web3w-walletconnect-loader';
import {contractsInfos} from '$lib/blockchain/contracts';
import {notifications} from '../web/notifications';
import {webWalletURL, finality, fallbackProviderOrUrl, chainId, localDev} from '$lib/config';
import {isCorrected, correctTime} from '$lib/time';
import {base} from '$app/paths';
import {chainTempo} from '$lib/blockchain/chainTempo';
import * as Sentry from '@sentry/browser';
import {get} from 'svelte/store';

const walletStores = initWeb3W({
  chainConfigs: get(contractsInfos),
  builtin: {autoProbe: true},
  transactions: {
    autoDelete: false,
    finality,
  },
  flow: {
    autoUnlock: true,
  },
  autoSelectPrevious: true,
  localStoragePrefix: (base && base.startsWith('/ipfs/')) || base.startsWith('/ipns/') ? base.slice(6) : undefined, // ensure local storage is not conflicting across web3w-based apps on ipfs gateways
  options: [
    'builtin',
    new WalletConnectModuleLoader({
      nodeUrl: typeof fallbackProviderOrUrl === 'string' ? fallbackProviderOrUrl : undefined,
      chainId,
      infuraId: 'bc0bdd4eaac640278cdebc3aa91fabe4',
    }),
  ],
  fallbackNode: fallbackProviderOrUrl,
  checkGenesis: localDev,
});

export const {wallet, transactions, builtin, chain, balance, flow, fallback} = walletStores;

function notifyFailure(tx: {hash: string}) {
  notifications.queue({
    id: tx.hash,
    delay: 0,
    title: 'Transaction Error',
    text: 'The Transaction failed',
    type: 'error',
    onAcknowledge: () => transactions.acknowledge(tx.hash, 'failure'),
  });
}

function notifyCancelled(tx: {hash: string}) {
  notifications.queue({
    id: tx.hash,
    delay: 3,
    title: 'Transaction Cancelled',
    text: 'The Transaction Has Been Replaced',
    type: 'info',
    onAcknowledge: () => transactions.acknowledge(tx.hash, 'cancelled'),
  });
}

transactions.subscribe(($transactions) => {
  for (const tx of $transactions.concat()) {
    if (tx.confirmations > 0 && !tx.acknowledged) {
      if (tx.status === 'failure') {
        notifyFailure(tx);
      } else if (tx.status === 'cancelled') {
        notifyCancelled(tx);
      } else {
        // auto acknowledge
        transactions.acknowledge(tx.hash, tx.status);
      }
    }
  }
});

chain.subscribe(async (v) => {
  chainTempo.startOrUpdateProvider(wallet.provider);
  if (!isCorrected()) {
    if (v.state === 'Connected' || v.state === 'Ready') {
      const latestBlock = await wallet.provider?.getBlock('latest');
      if (latestBlock) {
        correctTime(latestBlock.timestamp);
      }
    }
  }
});

fallback.subscribe(async (v) => {
  if (!isCorrected()) {
    if (v.state === 'Connected' || v.state === 'Ready') {
      const latestBlock = await wallet.provider?.getBlock('latest');
      if (latestBlock) {
        correctTime(latestBlock.timestamp);
      }
    }
  }
});

let lastAddress: string | undefined;
wallet.subscribe(async ($wallet) => {
  if (lastAddress !== $wallet.address) {
    lastAddress = $wallet.address;
    Sentry.setUser({address: $wallet.address});
  }
});

// TODO remove
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).walletStores = walletStores;
}

chainTempo.startOrUpdateProvider(wallet.provider);

contractsInfos.subscribe(async ($contractsInfo) => {
  await chain.updateContracts($contractsInfo);
});
