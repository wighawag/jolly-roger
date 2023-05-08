# Jolly-Roger

A template to develop decentralised applications

## How to use?

We are assuming here that you already setup your env as specified in the [initial setup section](#initial-setup)

### install deps

```bash
pnpm i
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
pnpm start:local_node
```

```bash
pnpm start:contracts:deploy
```

```bash
pnpm start:indexer
```

```bash
pnpm start:web
```

## Initial Setup

You need to have these installed

- [nodejs](https://nodejs.org/en)

  For windows (see more info [here](#windows)), you will need to select the option "Automatically install the necessary tools....". Note that process will open a powershell window and will take a while (it does not even show progress).

  This step will allow foundry/forge to work

- [pnpm](https://pnpm.io/)

  ```bash
  npm i -g pnpm
  ```

- [foundry](https://getfoundry.sh/)

  ```bash
  curl -L https://foundry.paradigm.xyz | bash;
  export PATH=$HOME/.foundry/bin:$PATH # or load it from your shell config which the script above should have configured
  foundryup
  ```

Then you need to install the local dependencies with the following command:

```bash
pnpm i
```

We also recommend to install [zellij](https://zellij.dev/) to have your dev env setup in one go via `pnpm start`

### Windows

Tested from a fresh install of : https://www.microsoft.com/en-US/software-download/windows10ISO on [virtualbox](https://www.virtualbox.org/).

You first install bash if you do not have already. For that we are using git which comes with bash.

You can install it via [scoop](https://scoop.sh/).

```bat
scoop install git
```

Or you can use the installer from https://gitforwindows.org/.

If you that last option, you can choose "Use Git and optional Unix tolls from the Command Prompt" and you'll have bash accessible from cmd.exe. otherwise you need to use "Git Bash Here"

Anyway after that you should be able to get into a bash shell.

```bat
bash
```

There you can clone the repo if you did not already and cd into it.

```bash
git clone https://github.com/wighawag/template-foundry.git
cd template-foundry
```

Then you can install the dependencies as stated in the [install deps section](#install-deps)

#### wezterm

on Windows [zellij](https://zellij.dev/) multiplexer is not available

We recommend you install [wezterm](https://wezfurlong.org/wezterm/install/windows.html) instead

With that you can do the following to get started:

```bash
pnpm start:wezterm
```
