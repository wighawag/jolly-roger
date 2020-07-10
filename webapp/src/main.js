import App from './App.svelte';
import {router} from './router.js';

const app = new App({
  target: document.body,
  props: {router},
});

export default app;
