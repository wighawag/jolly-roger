assume env variables are set, default as follow:

# GRAPH NODE HOST (not protocol)
GRAPH_NODE_API=127.0.0.1:8020

# GRAPH GRAPHQL ENDPOINT HOST (not protocol)
GRAPH_NODE_GRAPHQL=127.0.0.1:8000

# IPFS URL
IPFS_URL=http://127.0.0.1:5001

# SUBGRAPH NAME
SUBGRAPH_NAME=test/test

# setup graph name
`pnpm setup`

# deploy and watch for changes
`pnpm dev <contracts info path> <chainName>`

# deploy
`pnpm deploy <contracts info path> <chainName>`

# redeploy a graph
`pnpm redeploy`

# deploy on hosted service, expect env : THEGRAPH_TOKEN
`pnpm hosted:deploy <contracts info path> <chainName>`