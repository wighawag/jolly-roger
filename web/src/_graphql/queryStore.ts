import {writable} from 'svelte/store';
import {query} from './query';

export type QueryState<T> = {
  state: 'Idle' | 'Fetching' | 'Ready';
  error: unknown;
  polling: boolean;
  stale: boolean;
  data?: T;
};

export function queryStore<T>(
  queryString: string,
  options: {
    variables?: Record<string, unknown>;
    once?: boolean;
    transform?: string | ((v: unknown) => T);
  } = {}
): {
  subscribe: typeof subscribe;
  fetch: typeof fetch;
  cancel: typeof cancel;
  acknowledgeError: typeof acknowledgeError;
} {
  let stopCurrentQuery: () => void;

  const $data: QueryState<T> = {
    state: 'Idle',
    error: undefined,
    polling: false,
    stale: false,
  };
  const {subscribe, set} = writable($data);

  function _set(data: Partial<QueryState<T>>) {
    Object.assign($data, data);
    set($data);
  }

  function onResult(result) {
    if (result.fetching) {
      _set({state: 'Fetching'});
    }
    _set({stale: result.stale});
    if (result.error) {
      _set({error: result.error});
    } else if (result.data) {
      let data = result.data;
      if (typeof options?.transform === 'string') {
        if (data[options.transform]) {
          data = data[options.transform];
        } else {
          _set({
            error: {
              code: 11,
              message: `${options.transform} does not exist in result.data: ${data}`,
            },
          });
        }
      } else if (options.transform) {
        data = options.transform(data);
      }
      _set({state: 'Ready', polling: !options.once});
      _set({data});
    }
  }

  const store = {
    subscribe,
    fetch,
    cancel,
    acknowledgeError,
  };

  function fetch() {
    if ($data.state !== 'Idle') {
      return;
    }

    stopCurrentQuery = query({
      query: queryString,
      variables: options.variables,
      context: {
        pollInterval: options.once ? undefined : 2000,
        requestPolicy: 'cache-and-network', // required as cache-first will not try to get new data
      },
    }).subscribe(onResult);

    return store;
  }

  function cancel(options: {clear?: boolean} = {}) {
    if (stopCurrentQuery) {
      stopCurrentQuery();
      _set({state: 'Idle', polling: false, stale: false, error: undefined});
      if (options.clear) {
        _set({data: undefined});
      }
    }
  }

  function acknowledgeError() {
    _set({error: undefined});
  }

  return store;
}
