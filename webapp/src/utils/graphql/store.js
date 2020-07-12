import {writable} from 'svelte/store';
// import {query} from './query';
import {subscription} from './subscription';

export function graphqlStore(queryString, transform) {
  if (!transform) {
    transform = (v) => v;
  }
  if (typeof transform === 'string') {
    const field = transform;
    transform = (v) => v[field];
  }
  const $data = {};
  const {subscribe, set} = writable($data);

  function _set(data) {
    Object.assign($data, data);
    set($data);
  }

  function onResult(result) {
    if (result.fetching) {
      _set({status: 'Loading'});
    }
    if (result.stale) {
      _set({stale: result.stale});
    }
    if (result.error) {
      _set({error: data.error});
    }
    if (result.data) {
      const data = transform(result.data);
      _set({status: 'Ready', data});
    }
    // if (result.extensions) {
    //   // TODO ?
    //   console.log({extensions: result.extensions});
    // }
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
      query: queryString,
      // for query pollInterval: 2000, // required to ensure polling (unless urql has a biggger default delay)
      // for query requestPolicy: "cache-and-network" // required as cache-first will not try to get new data
    }).subscribe(onResult);
  }

  return {
    subscribe,
    listen,
  };
}
