import type {Readable} from 'svelte/store';
import {derived} from 'svelte/store';
import type {TransactionStore} from 'web3w';
import type {Invalidator, Subscriber, Unsubscriber} from 'web3w/dist/esm/utils/internals';
import {SUBGRAPH_ENDPOINT} from '$lib/blockchain/subgraph';
import {transactions} from '$lib/blockchain/wallet';
import type {QueryState, QueryStore} from '$lib/utils/stores/graphql';
import {HookedQueryStore} from '$lib/utils/stores/graphql';
import type {EndPoint} from '$lib/utils/graphql/endpoint';
import {chainTempo} from '$lib/blockchain/chainTempo';

type Messages = {
  id: string;
  message: string;
  timestamp: string;
  pending: boolean;
}[];

// TODO web3w needs to export the type
type TransactionStatus = 'pending' | 'cancelled' | 'success' | 'failure' | 'mined';
type TransactionRecord = {
  hash: string;
  from: string;
  submissionBlockTime: number;
  acknowledged: boolean;
  status: TransactionStatus;
  nonce: number;
  confirmations: number;
  finalized: boolean;
  lastAcknowledgment?: TransactionStatus;
  to?: string;
  gasLimit?: string;
  gasPrice?: string;
  data?: string;
  value?: string;
  contractName?: string;
  method?: string;
  args?: unknown[];
  eventsABI?: unknown; // TODO
  metadata?: unknown;
  lastCheck?: number;
  blockHash?: string;
  blockNumber?: number;
  events?: unknown[]; // TODO
};

class MessagesStore implements QueryStore<Messages> {
  private queryStore: QueryStore<Messages>;
  private store: Readable<QueryState<Messages>>;
  constructor(endpoint: EndPoint, private transactions: TransactionStore) {
    this.queryStore = new HookedQueryStore(
      endpoint,
      `
    query {
      messageEntries(orderBy: timestamp, orderDirection: desc, first: 10) {
        id
        message
        timestamp
      }
    }`,
      chainTempo,
      {path: 'messageEntries'}
    );
    this.store = derived([this.queryStore, this.transactions], (values) => this.update(values)); // lambda ensure update is not bound and can be hot swapped on HMR
  }

  private update([$query, $transactions]: [QueryState<Messages>, TransactionRecord[]]): QueryState<Messages> {
    if (!$query.data) {
      return $query;
    } else {
      let newData = $query.data.concat();
      for (const tx of $transactions) {
        if (!tx.finalized && tx.args) {
          // based on args : so need to ensure args are available
          if (tx.status != 'cancelled' && tx.status !== 'failure') {
            const foundIndex = newData.findIndex((v) => v.id.toLowerCase() === tx.from.toLowerCase());
            if (foundIndex >= 0) {
              newData[foundIndex].message = tx.args[0] as string;
              newData[foundIndex].pending = tx.confirmations < 1;
              newData[foundIndex].timestamp = Math.floor(Date.now() / 1000).toString();
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
      newData = newData.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
      return {
        step: $query.step,
        error: $query.error,
        data: newData,
      };
    }
  }

  acknowledgeError() {
    return this.queryStore.acknowledgeError();
  }

  subscribe(
    run: Subscriber<QueryState<Messages>>,
    invalidate?: Invalidator<QueryState<Messages>> | undefined
  ): Unsubscriber {
    return this.store.subscribe(run, invalidate);
  }
}

export const messages = new MessagesStore(SUBGRAPH_ENDPOINT, transactions);
