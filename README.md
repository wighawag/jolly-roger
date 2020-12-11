<!--- -------------------------------------------- -->
# Jolly  Roger

This is a template to build a decentralised applicaiton using ethereum, hardhat, svelte and thegraph

to make an app out of it, execute the following

```
npx degit wighawag/jolly-roger <your-app-folder>
```

Alternatively create a repo from this template [here](https://github.com/wighawag/jolly-roger/generate)

-------------------------
<br/>
<br/>
<!--- -------------------------------------------- -->

# App Setup

## requirements :

This app requires [node.js](https://nodejs.org/) (tested on v12+)

### pnpm

This repo use `pnpm` for package management : https://pnpm.js.org

```bash
npx pnpm add -g pnpm
```

`pnpm` is mainly used because it has proper mono-repo support which this project relies on.
You might be able to switch to `yarn` but will most likely have to configure it to fix hoisting issues.
If you decide to use `yarn` you ll have to remove the script "preinstall" that by default force the use of `pnpm`

### docker and docker-compose

`docker` and `docker-compose` are used to setup the external services (an ethereum node, an ipfs node and a [subgraph](https://thegraph.com) node)

If you prefer (or do not have access to docker/docker-compose) you can run them independently.


## intall dependencies :

```bash
pnpm setup
```

This will set the app name (and change the files to reflect that) and then call `pnpm install`

You can also manually set the name yourself :

```bash
pnpm set-name [<new name>] && pnpm install
```

# Development

The following command will start everything up.

```bash
pnpm shell:start
```

This will run each processes in their own terminal window/tap. Note that you might need confiugration based on your system.

On linux it uses `xterm` by default (so you need that installed).

On windows it use `cmd.exe` by default.

If you need some other terminal to execute the separate processes, you can configure it in `.newsh.json`.

This command will bring 5 shells up

1. docker-compose: running the ethereum node, ipfs node and subgraph node.
2. common-lib: watching for changes and recompiling to js.
3. web app: watching for changes. Hot Module Replacement enabled. (will reload on common-lib changes)
4. contracts: watching for changes. For every code changes, contract are redeployed, with proxies keeping their addresses.
5. subgraph: watch for code or template changes and redeploy.

Once docker-compose is running, you can stop the other shells and restart them if needed via

```bash
pnpm shell:dev
```

Alternatively you can call the following first : this will setup the external services only (ipfs, ethereum and graph nodes)

```bash
pnpm externals
```

and then run `pnpm shell:dev` to bring up the rest in watch mode.

You can also always run them individually

You can also run them all in one process : `pnpm start` (no separate terminal window/tab) but this means all the log output is in the same window.

Basically the `shell:` version will execute each parallel processes in a new terminal window/tab while the non-shell version will execute all in one process sharing the same log output.

# production

## web

To export the web app (ipfs ready) execute the following:

```bash
pnpm production:web:build
```

## full deployment

You need to gather the following environment variables :

- `THEGRAPH_TOKEN=<graph token used to deploy the subgraph on thegraph.com>`
- `INFURA_TOKEN=<infura token to talk to a network>`
- `IPFS_DEPLOY_PINATA__API_KEY=<pinata api key>`
- `IPFS_DEPLOY_PINATA__SECRET_API_KEY=<pinata secret key>`
- `MNEMONIC=<mnemonic of the account that will deploy the contract>`

Note that pinata is currently the default ipfs provider setup but ipfs-deploy, the tool used to deploy to ipfs support other providers, see : https://github.com/ipfs-shipyard/ipfs-deploy

For production and staging, you would need to set MENMONIC too in the respective `.env.production` and `.env.staging` files.

You can remove the env if you want to use the same as the one in `.env`

You'll also need to update the following for staging and production :

- `SUBGRAPH_NAME=<thegraph account name>/<subgraph name>`
- `VITE_CHAIN_ID=<id of the chain where contracts lives>`
- `VITE_THE_GRAPH_HTTP=https://api.thegraph.com/subgraphs/name/<thegraph account name>/<subgraph name>`

you then need to ensure you have a subgraph already created on thegraph.com with that name: https://thegraph.com/explorer/dashboard

Furthermore, you need to ensure the values in [web/application.json](web/application.json) are to your liking. Similar for the the web/public/preview.png image that is used for open graph metadata. The application.json is also where you setup the ens name if any.

finally execute the following for staging :

```
pnpm staging
```

for production:

```
pnpm production
```

For `webapp:build` you can also use [fleek](https://fleek.co) so that building and ipfs deployment is done automatically. The repo provide a `.fleek.json` file already setup for staging.

The only thing needed is setting up the environment variables (VITE_THE_GRAPH_HTTP, VITE_CHAIN_ID). You can either set them in fleek dashboard or set them in `.fleek.json`
