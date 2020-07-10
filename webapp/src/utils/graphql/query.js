import {pipe, fromValue, concat, scan, map, subscribe} from 'wonka';
import client from './client';
import {initialState} from './constants';

export const query = (args) => {
  const queryResult$ = pipe(
    concat([
      fromValue({fetching: true, stale: false}),
      pipe(
        client.query(args.query, args.variables, {
          requestPolicy: args.requestPolicy,
          pollInterval: args.pollInterval,
          ...args.context,
        }),
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
    scan(
      (result, partial) => ({
        ...result,
        ...partial,
      }),
      initialState
    )
  );

  return {
    subscribe(onValue) {
      return pipe(queryResult$, subscribe(onValue)).unsubscribe;
    },
  };
};
