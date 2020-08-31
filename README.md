<!-- {{% it.template }} -->

# decentralised-application

A template to build a decentralised applicaiton using ethereum, buidler, svelte and thegraph

to make an app out of it, execute the following

```
npx init-from wighawag/decentralised-application <your-app-folder>
```

or if you want the name to be different than the folder or the contract name to be different too

```
npx init-from wighawag/decentralised-application <your-app-folder> --name "<Your App Name>" --contractName "<your Contract Name>"
```

<!-- {{%}}  -->

# Setup

## requirements :

### docker and docker-compose

`docker` and `docker-compose` are used to setup the external services (an ethereum node, an ipfs node and a [subgraph](https://thegraph.com) node)

If you prefer (or do not have access to docker/docker-compose) you can run them independently

### node

This app requires [node.js](https://nodejs.org/) (tested on v12+)

### pnpm

This repo use `pnpm` for package management : https://pnpm.js.org

```bash
npx pnpm add -g pnpm
```

`pnpm` is mainly used because it has proper mono-repo support which this project relies on.
You might be able to switch to `yarn` but will most likely have to configure it to fix hoisting issues.
If you decide to use `yarn` you ll have to remove the script "preinstall" that by default force the use of `pnpm`

## intall dependencies :

```bash
pnpm install
```

# Development

The following command will start everything up.

```bash
pnpm run shell:start
```

It will bring 5 shells up

1. docker-compose: running the ethereum node, ipfs node and subgraph node.
1. common-lib: watching for changes and recompiling to js.
1. web app: watching for changes. Hot Module Replacement enabled. (will reload on common-lib changes)
1. contracts: watching for changes. For every code changes, contract are redeployed, with proxies keeping their addresses.
1. subgraph: watch for code or template changes and redeploy.

Once docker-compose is running, you can stop the other shells and restart them if needed via

```bash
pnpm run shell:dev
```

Alternatively you can call the following first : this will setup the external services only (ipfs, ethereum and graph nodes)

```bash
pnpm run shell:setup
```

and then run `pnpm run shell:dev` to bring up the rest in watch mode.

You can also always run them individually

# production

## web

To export the web app (ipfs ready) execute the following:

```bash
pnpm run production:web:build
```

Note that if you change any of the application.json setting or icon.svg you'll need to first regenerate the html via `pnpm run web:generate`

## full deployment

You need to gather the following environment variables :
- THEGRAPH_TOKEN=<graph token used to deploy the subgraph on thegraph.come>
- INFURA_TOKEN=<infura token to talk to a network>
- IPFS_DEPLOY_PINATA__API_KEY=<pinata api key>
- IPFS_DEPLOY_PINATA__SECRET_API_KEY=<pinata secret key>
- MNEMONIC=<mnemonic of the account that will deploy the contract>

Note that pinata is currently the default ipfs provider setup but ipfs-deploy, the tool used to deploy to ipfs support other providers, see : https://github.com/ipfs-shipyard/ipfs-deploy

For production and staging, you would need to set MENMONIC too in the respective `.env.production` and `.env.staging` files.

You can remove the env if you want to use the same as the one in `.env`

You ll also need to update the following for staging and production :
- SUBGRAPH_NAME=<thegraph account name>/<subgraph name>
- VITE_THE_GRAPH_HTTP=https://api.thegraph.com/subgraphs/name/<thegraph account name>/<subgraph name>
- VITE_THE_GRAPH_WS=wss://api.thegraph.com/subgraphs/name/<thegraph account name>/<subgraph name>

you then need to ensure you have a subgraph already created on thegraph.com with that name

finally execute the following for staging :

```
pnpm run staging
```

for production (ethereum mainnet):

```
pnpm run production
```
