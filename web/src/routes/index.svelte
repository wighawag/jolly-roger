<script context="module">
  // export const hydrate = false;
</script>

<script lang="ts">
  import NavButton from '$lib/components/styled/navigation/NavButton.svelte';
  import Feature from '$lib/components/styled/Feature.svelte';
  import {url} from '$lib/utils/url';
  const name = 'Jolly Roger';

  function _select(elem: HTMLElement) {
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(elem);
    console.log({selection: range.toString()});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selection as any).removeAllRanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selection as any).addRange(range);
  }
  function select(e: MouseEvent) {
    _select(e.currentTarget as HTMLElement);
  }
</script>

<section class="py-2 px-4 text-center">
  <div class="max-w-auto md:max-w-lg mx-auto">
    <img
      class="mb-8 mx-auto"
      src="images/logo.svg"
      alt={name}
      style="width:256px;height:256px;"
      width="256px"
      height="256px"
    />
    <h2 class="text-6xl font-black mb-2 font-heading text-black dark:text-white">
      {name}
    </h2>
    <p class="m-6 text-gray-800 dark:text-gray-300 text-xl">
      Production-Ready Template To Build Decentralised Applications
    </p>
    <div class="max-w-md mx-auto pt-1 mt-5 space-y-3 md:mt-8 md:space-y-5">
      <div class="space-y-5 sm:flex sm:justify-center sm:space-y-0 sm:space-x-3">
        <NavButton class="big secondary" href={url('demo/')} label="Try the Demo!">Demo</NavButton>
        <NavButton
          blank={true}
          class="big secondary"
          href="https://github.com/wighawag/jolly-roger"
          label="Check it out on github!"
        >
          Github
        </NavButton>
      </div>
    </div>

    <div class="pt-3 pb-4 dark:bg-black bg-white">
      <h1 class="dark:text-gray-500 text-gray-500 m-4 font-semibold">Use it:</h1>
      <code id="jolly-roger-command" on:click={select} class="mb-5 text-pink-600 font-black"
        >npx degit wighawag/jolly-roger your-app-folder</code
      >
      <p class="mt-6 text-gray-500">
        Find out more on
        <a class="underline" href="https://github.com/wighawag/jolly-roger#readme" target="_blank" rel="noopener"
          >github</a
        >
      </p>
    </div>
  </div>

  <div class="pt-16 relative max-w-7xl mx-auto">
    <div class="text-center">
      <h2 class="text-3xl tracking-tight font-extrabold text-gray-900 dark:text-gray-100 sm:text-4xl">Showcase</h2>
      <p class="mt-3 max-w-2xl mx-auto text-xl text-gray-500 dark:text-gray-400 sm:mt-4">
        Here are examples of apps built using jolly-roger
      </p>
    </div>
    <div class="mt-12 max-w-lg mx-auto grid gap-5 lg:grid-cols-3 lg:max-w-none">
      <div class="flex flex-col rounded-lg shadow-lg dark:shadow-slate-400 dark:shadow-sm overflow-hidden">
        <div class="flex-shrink-0">
          <a href="https://bleeps.art" target="_blank"
            ><img class="h-48 w-full object-cover" src="https://bleeps.art/preview.png" alt="bleeps.art" /></a
          >
        </div>
        <div class="flex-1 bg-white dark:bg-black p-6 flex flex-col justify-between">
          <div class="flex-1">
            <p class="text-xl font-medium text-pink-600">
              <a href="https://bleeps.art" target="_blank" class="underline"> bleeps.art </a>
            </p>
            <div class="block mt-2">
              <p class="text-xl font-semibold text-gray-900 dark:text-gray-100">
                The Bleeps DAO and Its Fully Onchain Sounds
              </p>
              <p class="mt-3 text-base text-gray-700 dark:text-gray-300">
                The First Composable Sounds Fully Generated On-Chain With Zero Externalities, no backend, no ipfs, no
                client-code, and a melody minter where some of the proceeds goes to the Bleeps DAO and its members
              </p>
              <p class="mt-3 text-base text-gray-500">
                Source code available <a href="https://github.com/wighawag/bleeps" target="_blank" class="underline"
                  >here</a
                >
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col rounded-lg shadow-lg dark:shadow-slate-400 dark:shadow-sm overflow-hidden">
        <div class="flex-shrink-0">
          <a href="https://mandalas.eth.limo" target="_blank"
            ><img class="h-48 w-full object-cover" src="https://mandalas.eth.limo/preview.png" alt="mandalas.eth" /></a
          >
        </div>
        <div class="flex-1 bg-white dark:bg-black p-6 flex flex-col justify-between">
          <div class="flex-1">
            <p class="text-xl font-medium text-pink-600">
              <a href="https://mandalas.eth.limo" target="_blank" class="underline"> mandalas.eth </a>
            </p>
            <div class="block mt-2">
              <p class="text-xl font-semibold text-gray-900 dark:text-gray-100">
                On-chain Generative Bitmaps With Zero Externalities
              </p>
              <p class="mt-3 text-base text-gray-700 dark:text-gray-300">
                The First On-Chain Generative Art Project to make full use of token URI to remove all external
                dependencies. It generates SVG and Bitmap from the smart contract directly.
              </p>
              <p class="mt-3 text-base text-gray-500">
                Source code available <a href="https://github.com/wighawag/mandalas" target="_blank" class="underline"
                  >here</a
                >
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col rounded-lg shadow-lg dark:shadow-slate-400 dark:shadow-sm overflow-hidden">
        <div class="flex-shrink-0">
          <a href="https://conquest.eth.limo" target="_blank"
            ><img class="h-48 w-full object-cover" src="https://conquest.eth.limo/preview.png" alt="conquest.eth" /></a
          >
        </div>
        <div class="flex-1 bg-white dark:bg-black p-6 flex flex-col justify-between">
          <div class="flex-1">
            <p class="text-xl font-medium text-pink-600">
              <a href="https://conquest.eth.limo" target="_blank" class="underline"> conquest.eth </a>
            </p>
            <div class="block mt-2">
              <p class="text-xl font-semibold text-gray-900 dark:text-gray-100">
                A Game of Strategy and Diplomacy Running on the EVM
              </p>
              <p class="mt-3 text-base text-gray-700 dark:text-gray-300">
                An unstoppable game of strategy and diplomacy running on the EVM. It allows player to collaborate
                through on-chain alliances while remaining sovereign. A first of its kind.
              </p>
              <p class="mt-3 text-base text-gray-500">Source code not yet available</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="pt-16 pb-4 dark:bg-black bg-white">
      <h2 class="text-3xl tracking-tight font-extrabold text-gray-900 dark:text-gray-100 sm:text-4xl">Features</h2>
      <div class="max-w-xl mx-auto px-4 sm:px-6 lg:max-w-screen-xl lg:px-8">
        <div class="lg:grid lg:grid-cols-3 lg:gap-8">
          <Feature title="All Included">
            This template include setup for smart contracts, subgraph (contract api) and frontend. All is setup as a
            monorepo with a shared common library.
          </Feature>
          <Feature title="PWA ready: 100% Lighthouse score">
            The web app is fully PWA compliant, with offline caching, etc... The javascript code necessary to launch the
            app is less than 50kB (15kB compressed), including the home page content. The rest is loaded on demand.
          </Feature>
          <Feature title="Great Dev experience">
            <a class="text-blue-600" href="https://hardhat.org" target="_blank" rel="noopener">Hardhat</a>
            for contracts,
            <a class="text-blue-600" href="https://github.com/wighawag/hardhat-deploy" target="_blank" rel="noopener"
              >hardhat-deploy</a
            >
            for contract deployment,
            <a class="text-blue-600" href="https://thegraph.com" target="_blank" rel="noopener">The Graph</a>
            for contract api,
            <a class="text-blue-600" href="https://svelte.dev" target="_blank" rel="noopener">svelte + Svelte Kit</a>
            for frontend with HMR (Hot Module Replacement) and production build.
          </Feature>
          <Feature title="Everything Hot Reload">
            On contract changes, contract get to keep their address and code get updated automatically. On frontend
            changes, module get replaced using blazing fast
            <a class="text-blue-600" href="https://vite.dev" target="_blank" rel="noopener">Vite</a>
            es module hot reload. On subgraph changes, the graph get updated and reexecuted.
          </Feature>
          <Feature title="Fully IPFS Ready">
            Fully IPFS ready with proper url routing. The web app works on both IPFS urls and ENS/DNS urls. PWA works on
            IPFS too with scoped service workers.
          </Feature>
          <Feature title="All in Typescript">The whole app including contracts tests, is written in typescript.</Feature
          >
          <Feature title="Code Splitting and Tree Shaking">
            By using Svelte Kit (and so Vite) and ES modules, the frontend benefit from code splitting an dynamic
            imports as well as tree shaking.
          </Feature>
          <Feature title="VSCode Setup">
            The repo is setup as a vscode workspace with recommended plugins. Execute tests from the editor. Auto
            format, etc...
          </Feature>
          <Feature title="One command deploy">
            Everything is setup, except for the private ENV variable to deploy the contracts, the subgraph and the web
            app, all at once. It also include
            <a class="text-blue-600" href="https://fleek.co" target="_blank" rel="noopener">fleek</a>
            config for automatic web deployment on ipfs.
          </Feature>
        </div>
      </div>
    </div>
  </div>
</section>
