export const none = false;
// TODO (see ./client.ts)
// import type {DocumentNode} from 'graphql';
// import {createRequest, OperationContext} from '@urql/core';
// import {pipe, fromValue, concat, scan, map, subscribe} from 'wonka';
// import client from './client';
// import {initialState} from './constants';
// import type {Readable} from 'svelte/store';

// type T = any; // TODO
//
// export const subscription = (
//   args: {query: string | DocumentNode; variables?: Record<string, unknown>; context?: Partial<OperationContext>},
//   handler?: (data: T, partialData: T) => void
// ): Readable<T> => {
//   const request = createRequest(args.query, args.variables);
//   const queryResult$ = pipe(
//     concat([
//       fromValue({fetching: true, stale: false}),
//       pipe(
//         client.executeSubscription(request, args.context),
//         map(({stale, data, error, extensions}) => ({
//           fetching: false,
//           stale: !!stale,
//           data,
//           error,
//           extensions,
//         }))
//       ),
//       fromValue({fetching: false, stale: false}),
//     ]),
//     scan((result, p) => {
//       const partial = p as any; // TODO check
//       console.log({partial, result});
//       const data =
//         partial.data !== undefined
//           ? typeof handler === 'function'
//             ? handler(result.data, partial.data)
//             : partial.data
//           : result.data;
//       return {...result, ...partial, data};
//     }, initialState)
//   );

//   return {
//     subscribe(onValue) {
//       return pipe(queryResult$, subscribe(onValue)).unsubscribe;
//     },
//   };
// };
