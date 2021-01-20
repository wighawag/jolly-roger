import {Client, defaultExchanges} from '@urql/core';
import {devtoolsExchange} from '@urql/devtools';

const exchanges = defaultExchanges.concat();

if (import.meta.env.MODE === 'development') {
  exchanges.unshift(devtoolsExchange);
}

let url: string = import.meta.env.VITE_THE_GRAPH_HTTP;
try {
  const queryParams = new URLSearchParams(location.search);
  if (queryParams.has('subgraph')) {
    url = queryParams.get('subgraph') as string;
  }
} catch (e) {}

export default new Client({
  url,
  exchanges,
});
