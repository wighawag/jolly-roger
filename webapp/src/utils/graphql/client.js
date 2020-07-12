import {Client, defaultExchanges, subscriptionExchange} from '@urql/core';
import {devtoolsExchange} from '@urql/devtools';
import {SubscriptionClient} from 'subscriptions-transport-ws';

const subscriptionClient = new SubscriptionClient(process.env.THE_GRAPH_WS, {
  reconnect: true,
});

let exchanges = [];
if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) {
  exchanges.push(devtoolsExchange);
}
exchanges = exchanges.concat(defaultExchanges);
exchanges.push(
  subscriptionExchange({
    forwardSubscription(operation) {
      return subscriptionClient.request(operation);
    },
  })
);

export default new Client({
  url: process.env.THE_GRAPH_HTTP,
  exchanges,
});
