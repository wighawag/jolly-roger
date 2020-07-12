import {graphqlStore} from '../utils/graphql';
export default graphqlStore(
  `
  subscription {
    namedEntities(first: 5) {
      id
      name
    }
  }
`,
  'namedEntities'
);
