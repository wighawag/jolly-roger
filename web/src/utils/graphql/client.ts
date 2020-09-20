import {Client, defaultExchanges} from '@urql/core';
import {devtoolsExchange} from '@urql/devtools';

const exchanges = defaultExchanges.concat();

if (import.meta.env.MODE === 'development') {
  exchanges.unshift(devtoolsExchange);
}

export default new Client({
  url: import.meta.env.VITE_THE_GRAPH_HTTP,
  exchanges,
});
