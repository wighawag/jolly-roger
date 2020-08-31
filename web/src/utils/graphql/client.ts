import {Client, defaultExchanges} from '@urql/core'; // , subscriptionExchange
import {devtoolsExchange} from '@urql/devtools'; // TODO only in dev

// TODO investigate alternative to 'subscriptions-transport-ws';
// it currently fails to work with `vite` as it is not an es module and seem to have node dependencies that need to be shimmed

// import {SubscriptionClient} from 'subscriptions-transport-ws';
// const subscriptionClient = new SubscriptionClient(process.env.THE_GRAPH_WS, {
//   reconnect: true,
// });

// TODO devtools only in dev mode
export default new Client({
  url: import.meta.env.VITE_THE_GRAPH_HTTP,
  exchanges: [
    devtoolsExchange,
    ...defaultExchanges,
    // subscriptionExchange({
    //   forwardSubscription(operation) {
    //     return subscriptionClient.request(operation);
    //   },
    // }),
  ],
});
