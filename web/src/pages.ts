import HomePage from './pages/home.svelte';
import WalletPage from './pages/wallet.svelte';
import NotFound from './pages/notfound.svelte';

export default [
  {
    name: 'Wallet',
    path: 'wallet',
    component: WalletPage,
  },
  {
    name: 'Home',
    path: '',
    component: HomePage,
  },
  {
    name: 'NotFound',
    path: '.*',
    component: NotFound,
  },
];
