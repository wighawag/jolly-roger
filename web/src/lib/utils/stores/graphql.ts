import type {EndPoint} from '../graphql/endpoint';
import type {Readable} from 'svelte/store';
import {BaseStoreWithData} from './base';
import {logs} from 'named-logs';
const console = logs('graphql');

type ChainTempoInfo = {lastBlockNumber?: number; stale: boolean};

export type Hook = {subscribe: (f: (chainInfo: ChainTempoInfo) => void) => () => void};

export type QueryState<T> = {
  step: 'IDLE' | 'LOADING' | 'READY';
  data?: T;
  error?: string;
};

export type ListOptions =
  | {
      path?: string;
      getLastId?: (entries: unknown[]) => string;
    }
  | boolean;

export type QueryStore<T> = Readable<QueryState<T>> & {
  acknowledgeError: () => void;
};

export type QueryStoreWithFetch<T> = QueryStore<T> & {
  fetch(extraVariables?: Record<string, unknown>): Promise<void>;
};

export type QueryStoreWithRuntimeVariables<T> = QueryStoreWithFetch<T> & {
  runtimeVariables: Record<string, string>;
};

class BaseQueryStore<T, V extends Record<string, unknown> = Record<string, unknown>>
  extends BaseStoreWithData<QueryState<T>, T>
  implements QueryStoreWithRuntimeVariables<T>
{
  public runtimeVariables: Record<string, string> = {};
  public constructor(
    private endpoint: EndPoint,
    private query: string,
    private options?: {
      variables?: V;
      path?: string;
      list?: ListOptions;
    }
  ) {
    super({
      step: 'IDLE',
    });
  }

  acknowledgeError(): void {
    this.setPartial({error: undefined});
  }

  async fetch(extraVariables?: Record<string, unknown>): Promise<void> {
    console.info('fetching....');
    const first =
      typeof this.options?.variables?.first === 'number' ? (this.options?.variables?.first as number) : 1000;
    let numEntries = first;
    let lastId = '0x0';
    let data: T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let list: any[];
    while (numEntries === first) {
      try {
        const variables = {first, lastId, ...this.options?.variables, ...this.runtimeVariables, ...extraVariables};
        const querySplitted = this.query.split('?');
        let query = '';
        for (let i = 0; i < querySplitted.length; i++) {
          const split = querySplitted[i];
          if (split.startsWith('$')) {
            if (!variables[split.substr(1)]) {
              i++; // skip
            }
          } else {
            query += split;
          }
        }
        const result = await this.endpoint.query<Record<string, unknown>, V>(query, {
          variables,
          context: {
            requestPolicy: 'cache-and-network', // required as cache-first will not try to get new data
          },
        });

        if (!result.data) {
          this.setPartial({error: `cannot fetch from thegraph node`});
          throw new Error(`cannot fetch from thegraph node`);
        }

        const freshData = (this.options?.path ? result.data[this.options.path] : result.data) as T;
        if (!data) {
          data = freshData;
        }

        if (this.options?.list) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let freshList = freshData as unknown as any[];
          if (typeof this.options.list !== 'boolean' && this.options.list.path) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            freshList = freshData[this.options.list.path] as any[];
          }

          numEntries = freshList.length;
          if (numEntries > 0) {
            const newLastId =
              typeof this.options.list !== 'boolean' && this.options.list.getLastId !== undefined
                ? this.options.list.getLastId(freshList)
                : freshList[numEntries - 1].id;
            if (lastId === newLastId) {
              console.log('same query, stop');
              break;
            }
            lastId = newLastId;
          }

          if (!list) {
            list = freshList;
          } else {
            list.push(...freshList);
          }
        } else {
          numEntries = 0; // stop the loop
        }
      } catch (e) {
        numEntries = 0;
        console.error(e);
      }
    }
    this.setPartial({data, step: 'READY'});
  }
}

export class TimedQueryStore<T, V extends Record<string, unknown> = Record<string, unknown>>
  extends BaseQueryStore<T, V>
  implements QueryStore<T>
{
  private timeout: NodeJS.Timeout;
  private extraOptions: {frequency?: number};
  public constructor(
    endpoint: EndPoint,
    query: string,
    options?: {
      variables?: V;
      path?: string;
      frequency?: number;
    }
  ) {
    super(endpoint, query, options);
    this.extraOptions = options;
  }

  acknowledgeError(): void {
    this.setPartial({error: undefined});
  }

  async fetch(): Promise<void> {
    await super.fetch();
    this.timeout = setTimeout(this.fetch.bind(this), (this.extraOptions?.frequency || 1) * 1000);
  }

  start(): QueryStore<T> {
    if (this.$store.step === 'IDLE') {
      this.setPartial({step: 'LOADING'});
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.fetch();
    return this;
  }

  stop(): void {
    this.setPartial({step: 'IDLE'});
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}

export class HookedQueryStore<T, V extends Record<string, unknown> = Record<string, unknown>>
  extends BaseQueryStore<T, V>
  implements QueryStore<T>
{
  private hook: Hook;
  public constructor(
    endpoint: EndPoint,
    query: string,
    hook: Hook,
    options?: {
      variables?: V;
      path?: string;
      list?: ListOptions;
    }
  ) {
    super(endpoint, query, options);
    this.hook = hook;
  }

  acknowledgeError(): void {
    this.setPartial({error: undefined});
  }

  private listenerCount = 0;
  private stopUpdates?: () => void;
  subscribe(run: (value: QueryState<T>) => void, invalidate?: (value?: QueryState<T>) => void): () => void {
    this.listenerCount++;
    if (this.listenerCount === 1) {
      console.info(`start fetching`);
      this.stopUpdates = this.hook.subscribe((chainInfo: ChainTempoInfo) =>
        this.fetch({blockNumber: chainInfo.lastBlockNumber})
      );
    }
    const unsubscribe = this.store.subscribe(run, invalidate);
    return () => {
      this.listenerCount--;
      if (this.listenerCount === 0) {
        console.info(`stop fetching`);
        if (this.stopUpdates) {
          this.stopUpdates();
          this.stopUpdates = undefined;
        }
      }
      unsubscribe();
    };
  }
}
