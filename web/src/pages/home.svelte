<script lang="ts">
  import Button from '../components/Button.svelte';
  import Feature from '../components/Feature.svelte';
  const name = 'Jolly Roger';
</script>

<section class="py-8 px-4 text-center">
  <div class="max-w-auto md:max-w-lg mx-auto">
    <img
      class="mb-8 mx-auto"
      src="images/logo.svg"
      alt={name}
      style="width:256px;height:256px;"
      width="256px"
      height="256px" />
    <h2 class="text-5xl mb-2 font-heading">{name}</h2>
    <p class="m-6 text-gray-500 dark:text-gray-400 text-xl">
      Production-Ready Template To Build Decentralised Applications
    </p>
    <div class="max-w-md mx-auto mt-5 space-y-3 md:mt-8 md:space-y-5">
      <div
        class="space-y-5 sm:flex sm:justify-center sm:space-y-0 sm:space-x-3">
        <Button
          class="big secondary"
          href="Demo"
          label="Try ethereum integration">
          Demo
        </Button>
        <Button class="big secondary" href="Wallet" label="Check wallet status">
          Wallet
        </Button>
        <Button
          blank={true}
          class="big secondary"
          href="https://github.com/wighawag/jolly-roger"
          label="get it from github!">
          Github
        </Button>
      </div>
    </div>
  </div>
  <div class="py-4 dark:bg-black bg-white">
    <!-- <h2 class="text-3xl underline mb-4 text-gray-600 dark:text-gray-400">Create App</h2> -->
    <code>npx degit wighawag/jolly-roger &lt;your-app-folder&gt;</code>
  </div>
  <div class="py-4 dark:bg-black bg-white">
    <h2 class="text-3xl underline mb-4 text-gray-600 dark:text-gray-400">
      Features
    </h2>
    <div class="max-w-xl mx-auto px-4 sm:px-6 lg:max-w-screen-xl lg:px-8">
      <div class="lg:grid lg:grid-cols-3 lg:gap-8">
        <Feature title="All Included">
          This template include setup for smart contracts, subgraph (contract
          api) and frontend. All is setup as a monorepo with a shared common
          library.
        </Feature>
        <Feature title="PWA ready: 100% Lighthouse score">
          The web app is fully PWA compliant, with offline caching, etc... The
          javascript code necessary to launch the app is less than 50kB (15kB
          compressed), including the home page content. The rest is loaded on
          demand.
        </Feature>
        <Feature title="Great Dev experience">
          <a
            class="text-blue-600"
            href="https://hardhat.org"
            target="_blank">Hardhat</a>
          for contracts,
          <a
            class="text-blue-600"
            href="https://github.com/wighawag/hardhat-deploy"
            target="_blank">hardhat-deploy</a>
          for contract deployment,
          <a
            class="text-blue-600"
            href="https://thegraph.com"
            target="_blank">The Graph</a>
          for contract api,
          <a
            class="text-blue-600"
            href="https://getwaffle.io/"
            target="_blank">waffle</a>
          for chai matchers,
          <a
            class="text-blue-600"
            href="https://svelte.dev"
            target="_blank">svelte</a>
          for frontend,
          <a
            class="text-blue-600"
            href="https://github.com/vitejs/vite"
            target="_blank">vite</a>
          for HMR (Hot Module Replacement) and production build.
        </Feature>
        <Feature title="Everything Hot Reload">
          On contract changes, contract get to keep their address and code get
          updated automatically. On frontend changes, module get replaced using
          blazing fast
          <a
            class="text-blue-600"
            href="https://github.com/vitejs/vite"
            target="_blank">vite</a>
          es module hot reload. On subgraph changes, the graph get updated and
          reexecuted.
        </Feature>
        <Feature title="Fully IPFS Ready">
          Fully IPFS ready with proper url routing. The web app works on both
          IPFS urls and ENS/DNS urls. PWA works on IPFS too with scoped service
          workers.
        </Feature>
        <Feature title="All in Typescript">
          The whole app including contracts tests, is written in typescript.
        </Feature>
        <Feature title="Code Splitting and Tree Shaking">
          By using vite and ES modules, the frontend benefit from code splitting
          an dynamic imports as well as tree shaking.
        </Feature>
        <Feature title="VSCode Setup">
          The repo is setup as a vscode workspace with recommended plugins.
          Execute tests from the editor. Auto format, etc...
        </Feature>
        <Feature title="One command deploy">
          Everything is setup, except for the private ENV variable to deploy the
          contracts, the subgraph and the web app, all at once. It also include
          <a
            class="text-blue-600"
            href="https://fleek.co"
            target="_blank">fleek</a>
          config for automatic web deployment on ipfs.
        </Feature>
      </div>
    </div>
  </div>
</section>

