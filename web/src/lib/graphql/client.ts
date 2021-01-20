import {Client, defaultExchanges} from '@urql/core';
import {devtoolsExchange} from '@urql/devtools';

const exchanges = defaultExchanges.concat();

if (import.meta.env.MODE === 'development') {
  exchanges.unshift(devtoolsExchange);
}

let url: string = import.meta.env.SNOWPACK_PUBLIC_THE_GRAPH_HTTP;
try {
  const queryParams = new URLSearchParams(location.search);
  if (queryParams.has('subgraph')) {
    url = queryParams.get('subgraph') as string;
  }
} catch (e) {}

if (!url) {
  console.error(
    `no url specific either at build time or runtim (through query params) for subgraph`
  );
}

const client = new Client({
  url,
  exchanges,
});

export default client;
