import HomePage from './pages/home.svelte';

type ComponentModule = {default: unknown};
export default [
  {
    name: 'Wallet',
    path: 'wallet',
    asyncComponent: (): Promise<ComponentModule> => import('./pages/wallet.svelte'),
  },
  {
    name: 'Home',
    path: '',
    component: HomePage, // Home Page is builtin for faster interaction
  },
  {
    name: 'Demo',
    path: 'demo',
    asyncComponent: (): Promise<ComponentModule> => import('./pages/demo.svelte'),
  },
  {
    name: 'NotFound',
    path: '.*',
    asyncComponent: (): Promise<ComponentModule> => import('./pages/notfound.svelte'),
  },
];
