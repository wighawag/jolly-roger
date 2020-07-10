import {createRequest} from '@urql/core';
import {pipe, fromValue, concat, scan, map, subscribe} from 'wonka';
import client from './client';
import {initialState} from './constants';

export const subscription = (args, handler) => {
  const request = createRequest(args.query, args.variables);

  const queryResult$ = pipe(
    concat([
      fromValue({fetching: true, stale: false}),
      pipe(
        client.executeSubscription(request, args.context),
        map(({stale, data, error, extensions}) => ({
          fetching: false,
          stale: !!stale,
          data,
          error,
          extensions,
        }))
      ),
      fromValue({fetching: false, stale: false}),
    ]),
    scan((result, partial) => {
      const data =
        partial.data !== undefined
          ? typeof handler === 'function'
            ? handler(result.data, partial.data)
            : partial.data
          : result.data;
      return {...result, ...partial, data};
    }, initialState)
  );

  return {
    subscribe(onValue) {
      return pipe(queryResult$, subscribe(onValue)).unsubscribe;
    },
  };
};
