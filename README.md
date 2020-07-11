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

## SETUP

```
yarn && yarn yarn-install
```

## START

```
yarn shell:dev
```

This will launch
- a graph-node (https://thegraph.com)
- an ethereum node on localhost:8545
- a webapp on localhost:3000

Plus it will deploy the contract and a subgraph

