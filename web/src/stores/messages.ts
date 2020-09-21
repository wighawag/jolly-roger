import {queryStore} from '../_graphql';

export default queryStore<
  {
    id: string;
    message: string;
    timestamp: string;
  }[]
>(
  `
query {
  messageEntries(orderBy: timestamp, orderDirection: desc, first: 10) {
    id
    message
    timestamp
  }
}`,
  {path: 'messageEntries'} // allow to access messages directly
);
