import {writable} from 'svelte/store';
import {query} from '../utils/graphql';

export type NamesData = {
  id: string;
  name: string;
};

const $data: {
  status: string | undefined;
  error: unknown;
  listenning: boolean;
  data?: NamesData[];
} = {
  status: undefined,
  error: undefined,
  listenning: false,
};
const {subscribe, set} = writable($data);

function _set(data) {
  // TODO remove:
  // console.log('PLANETS', data);
  Object.assign($data, data);
  set($data);
}

function transform(result) {
  // console.log({result});
  if (result.fetching) {
    _set({status: 'Loading'});
  }
  if (result.stale) {
    // console.log({stale: result.stale});
  }
  if (result.error) {
    _set({error: result.error});
  }
  if (result.data) {
    // console.log({data: result.data});
    _set({status: 'Ready'});
    if (result.data.namedEntities) {
      const names = result.data.namedEntities;
      _set({data: names});
    } else {
      _set({data: {{{!"}"}}});
    }
  }
  if (result.extensions) {
    console.log({extensions: result.extensions});
  }
}

async function listen() {
  if ($data.listenning) {
    return;
  }
  _set({listenning: true});

  if ($data.status !== 'loaded') {
    _set({status: 'loading'});
  }

  query({
    query: `
      query {
        namedEntities {
          id
          name
        }
      }
    `,
    context: {
      pollInterval: 2000, // required to ensure polling (unless urql has a biggger default delay)
      requestPolicy: 'cache-and-network', // required as cache-first will not try to get new data
    },
  }).subscribe(transform);
}

let dataStore;
export default dataStore = {
  subscribe,
  listen,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
if (typeof window !== 'undefined') {
  (window as any).names = dataStore;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
