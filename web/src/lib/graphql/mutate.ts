import type {DocumentNode} from 'graphql';
import type {OperationContext, OperationResult} from '@urql/core';
import client from './client';

export function mutate<
  Data = unknown,
  Variables extends Record<string, unknown> = Record<string, unknown>
>(args: {
  query: DocumentNode | string;
  variables?: Variables;
  context?: Partial<OperationContext>;
}): Promise<OperationResult<Data>> {
  return client.mutation(args.query, args.variables, args.context).toPromise();
}
