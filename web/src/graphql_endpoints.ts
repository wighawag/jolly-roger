import {EndPoint} from './lib/graphql';

export const SUBGRAPH_ENDPOINT = new EndPoint(
  import.meta.env.SNOWPACK_PUBLIC_THE_GRAPH_HTTP
);
