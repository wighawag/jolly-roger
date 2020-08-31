import 'named-logs-console';
import './service-worker-handler';
import App from './App.svelte';

const app = new App({
  target: document.body,
});

export default app;
