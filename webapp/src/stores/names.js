import {writable} from 'svelte/store';
import {query, subscription} from '../utils/graphql';

const $data = {};
const {subscribe, set} = writable($data);

function _set(data) {
  // TODO remove:
  console.log('collections', data);
  Object.assign($data, data);
  set($data);
}

function transform(result) {
  if (result.fetching) {
    _set({status: 'Loading'});
  }
  if (result.stale) {
    console.log({stale: result.stale}); // TODO ?
  }
  if (result.error) {
    _set({error: data.error});
  }
  if (result.data) {
    // console.log({data: result.data});
    _set({status: 'Ready'});
    if (result.data.namedEntities) {
      _set({data: result.data.namedEntities});
    } else {
      _set({data: {{{!"}"}}});
    }
  }
  if (result.extensions) {
    // TODO ?
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

  subscription({
    query: `
      subscription {
        namedEntities(first: 5) {
          id
          name
        }
      }
    `,
    // for query pollInterval: 2000, // required to ensure polling (unless urql has a biggger default delay)
    // for query requestPolicy: "cache-and-network" // required as cache-first will not try to get new data
  }).subscribe(transform);
}

let dataStore;
export default dataStore = {
  subscribe,
  listen,
};

// TODO remove ?
if (typeof window !== 'undefined') {
  window.names = $data;
}
