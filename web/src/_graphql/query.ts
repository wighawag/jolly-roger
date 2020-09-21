import type {DocumentNode} from 'graphql';
import type {OperationContext} from '@urql/core';
import {pipe, fromValue, concat, scan, map, subscribe} from 'wonka';
import client from './client';
import {initialState} from './constants';

export function query<
  Data extends Record<string, unknown>,
  Variables extends Record<string, unknown> = Record<string, unknown>
>(args: {
  query: DocumentNode | string;
  variables?: Variables;
  context?: Partial<OperationContext>;
}): {
  subscribe: (
    value: (value: {
      fetching: boolean;
      stale: boolean;
      data: Data;
      error: unknown;
      extensions: Record<string, unknown>;
    }) => void
  ) => () => void;
} {
  const queryResult$ = pipe(
    concat([
      fromValue({fetching: true, stale: false}),
      pipe(
        client.query(args.query, args.variables, args.context),
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
}
