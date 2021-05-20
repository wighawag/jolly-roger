import type {EndPoint} from '$lib/graphql';
import type {Readable} from 'svelte/store';
import {BaseStoreWithData} from './stores';

export type QueryState<T> = {
  step: 'IDLE' | 'LOADING' | 'READY';
  data?: T;
  error?: string;
};

export type QueryStore<T> = Readable<QueryState<T>> & {
  start: () => QueryStore<T>;
  stop: () => void;
  acknowledgeError: () => void;
};

export class BasicQueryStore<T, V extends Record<string, unknown>>
  extends BaseStoreWithData<QueryState<T>, T>
  implements QueryStore<T>
{
  private timeout: NodeJS.Timeout;
  public constructor(
    private endpoint: EndPoint,
    private query: string,
    private options?: {
      variables?: V;
      path?: string;
      frequency?: number;
    }
  ) {
    super({
      step: 'IDLE',
    });
  }

  acknowledgeError(): void {
    this.setPartial({error: undefined});
  }

  async fetch(): Promise<void> {
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

    this.timeout = setTimeout(this.fetch.bind(this), (this.options?.frequency || 1) * 1000);
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
