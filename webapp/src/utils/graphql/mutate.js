import client from './client';

export const mutate = (args) => {
  return client.mutation(args.query, args.variables, args.context).toPromise();
};
