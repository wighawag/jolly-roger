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

export type QueryStore<T> = Readable<QueryState<T>> & {
  acknowledgeError: () => void;
};

class BaseQueryStore<T, V extends Record<string, unknown> = Record<string, unknown>>
  extends BaseStoreWithData<QueryState<T>, T>
  implements QueryStore<T>
{
  public constructor(
    private endpoint: EndPoint,
    private query: string,
    private options?: {
      variables?: V;
      path?: string;
    }
  ) {
    super({
      step: 'IDLE',
    });
  }

  acknowledgeError(): void {
    this.setPartial({error: undefined});
  }

  protected async fetch(): Promise<void> {
    console.info('fetching....');
    try {
      const result = await this.endpoint.query<Record<string, unknown>, V>({
        query: this.query,
        variables: this.options?.variables,
        context: {
          requestPolicy: 'cache-and-network', // required as cache-first will not try to get new data
        },
      });

      if (!result.data) {
        this.setPartial({error: `cannot fetch from thegraph node`});
        throw new Error(`cannot fetch from thegraph node`);
      }

      const data = (this.options?.path ? result.data[this.options.path] : result.data) as T;

      this.setPartial({data, step: 'READY'});
    } catch (e) {
      console.error(e);
    }
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

  protected async fetch(): Promise<void> {
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
      this.stopUpdates = this.hook.subscribe(() => this.fetch());
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
