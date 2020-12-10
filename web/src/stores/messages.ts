import {derived, Readable} from 'svelte/store';
import {QueryState, queryStore} from '../_graphql';
import {transactions} from './wallet';

type Messages = {
  id: string;
  message: string;
  timestamp: string;
  pending: boolean;
}[];

const query = queryStore<Messages>(
  `
query {
  messageEntries(orderBy: timestamp, orderDirection: desc, first: 10) {
    id
    message
    timestamp
  }
}`,
  {transform: 'messageEntries'} // allow to access messages directly
);

export const messages: Readable<QueryState<Messages>> & {
  fetch: typeof query.fetch;
  cancel: typeof query.cancel;
  acknowledgeError: typeof query.acknowledgeError;
} = derived([query, transactions], ([$query, $transactions]) => {
  if (!$query.data) {
    return $query;
  } else {
    let newData = $query.data.concat();
    for (const tx of $transactions) {
      if (!tx.finalized && tx.args) {
        // based on args : so need to ensure args are available
        if (tx.status != 'cancelled' && tx.status !== 'failure') {
          const foundIndex = newData.findIndex(
            (v) => v.id.toLowerCase() === tx.from.toLowerCase()
          );
          if (foundIndex >= 0) {
            newData[foundIndex].message = tx.args[0] as string;
            newData[foundIndex].pending = tx.confirmations < 1;
            newData[foundIndex].timestamp = Math.floor(
              Date.now() / 1000
            ).toString();
          } else {
            newData.unshift({
              id: tx.from.toLowerCase(),
              message: tx.args[0] as string,
              timestamp: Math.floor(Date.now() / 1000).toString(),
              pending: tx.confirmations < 1,
            });
          }
        }
      }
    }
    newData = newData.sort(
      (a, b) => parseInt(b.timestamp) - parseInt(a.timestamp)
    );
    return {
      state: $query.state,
      error: $query.error,
      polling: $query.polling,
      stale: $query.stale,
      data: newData,
    };
  }
}) as typeof query;
messages.fetch = query.fetch.bind(query);
messages.cancel = query.cancel.bind(query);
messages.acknowledgeError = query.acknowledgeError.bind(query);
