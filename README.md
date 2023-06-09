# Jolly-Roger

A template to develop decentralised applications

## How to use?

We are assuming here that you already setup your env as specified in the [initial setup section](#initial-setup)

### install dependencies

Note here that while you can use `pnpm i`, we recommend you follow the instruction here so you can have everything setup with your own project's name.

```bash
pnpm boot
```

This will set the app name to the folder nane or the name you provide (and change the files to reflect that) and then call `pnpm i`

You can also manually set the name yourself :

```bash
pnpm set-name [<new name>] && pnpm i
```

### start!

Then Assuming you have [zellij](https://zellij.dev/) installed

```bash
pnpm start
```

**And you are ready to go!**

Note that if you do not have [zellij](https://zellij.dev/) (on windows for example) you can use [wezterm](https://wezfurlong.org/wezterm/index.html)

```bash
pnpm start:wezterm
```

Or you can also launch each component in their own process

```bash
pnpm local_node
```

```bash
pnpm contracts:compile:watch
```

```bash
pnpm contracts:deploy:watch
```

```bash
pnpm indexer:dev
```

```bash
pnpm web:dev
```

## Deploying to a network

Just execute the following

```bash
pnpm contracts:deploy:prepare <network>
```

and it will ask you few questions and get your .env.local setup with the var needed to deploy on the network of your choice.

You just need to have a endpoint url and mnemonic ready for it.

You can of course configure it manually with more option if you need

Then you can deploy your contract

```bash
pnpm contracts:deploy <network>
```

## Initial Setup

You need to have these installed

- [nodejs](https://nodejs.org/en)

- [pnpm](https://pnpm.io/)

  ```bash
  npm i -g pnpm
  ```

Then you need to install the local dependencies with the following command:

```bash
pnpm i
```

We also recommend to install [zellij](https://zellij.dev/) to have your dev env setup in one go via `pnpm start`
