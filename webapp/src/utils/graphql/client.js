import {Client, defaultExchanges, subscriptionExchange} from '@urql/core';
import {devtoolsExchange} from '@urql/devtools';
import {SubscriptionClient} from 'subscriptions-transport-ws';

const subscriptionClient = new SubscriptionClient(process.env.THE_GRAPH_WS, {
  reconnect: true,
});

// TODO devtools only in dev mode
export default new Client({
  url: process.env.THE_GRAPH_HTTP,
  exchanges: [
    devtoolsExchange,
    ...defaultExchanges,
    subscriptionExchange({
      forwardSubscription(operation) {
        return subscriptionClient.request(operation);
      },
    }),
  ],
});
