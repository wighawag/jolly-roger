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
      <div class="space-y-5 sm:flex sm:justify-center sm:space-y-0 sm:space-x-3">
        <Button class="big secondary" href="Demo" label="Try ethereum integration">Demo</Button>
        <Button class="big secondary" href="Wallet" label="Check wallet status">Wallet</Button>
        <Button
          class="big secondary"
          href="https://github.com/wighawag/decentralised-application"
          label="get it from github!">
          Get It
        </Button>
      </div>
    </div>
  </div>
  <div class="py-12 dark:bg-black bg-white">
    <h2 class="text-3xl underline mb-4 text-gray-600 dark:text-gray-400">Features</h2>
    <div class="max-w-xl mx-auto px-4 sm:px-6 lg:max-w-screen-xl lg:px-8">
      <div class="lg:grid lg:grid-cols-3 lg:gap-8">
        <Feature title="All Included">
          This template include setup for smart contracts, subgraph and frontend. All is setup as a monorepo with a
          shared common library.
        </Feature>
        <Feature title="Everything Hot Reload">
          On contract changes, contract get to keep their address and code get updated automatically. On frontend
          changes, module get replaced using blazing fast <a
            class="text-blue-600"
            href="https://github.com/vitejs/vite">vite</a> es module hot reload. On subgraph changes, the graph get updated
          and rexecuted.
        </Feature>
        <Feature title="PWA ready: 100% Lighthouse score">
          The web app is fully PWA compliant, with offline caching, etc... The javascript code necessary to launch the
          app is only 15kB. The rest is loaded on demand.
        </Feature>
        <Feature title="Fully IPFS Ready">
          Fully IPFS ready. The web app works on both IPFS's hash based url and ENS/DNS url (not an easy feat by the
          way). PWA works on IPFS too with scoped service workers.
        </Feature>
        <Feature title="All in Typescript">The whole app including contracts test is written in typescript.</Feature>
        <Feature title="Great Dev experience">
          buidler for contracts, buidler-deploy for contract deployment, thegraph for contract caching, waffle for chai
          matchers
        </Feature>
        <Feature title="One command deploy">
          Everything is setup, except for the private ENV variable to deploy the contracts, the subgraph and the web
          app, all at once.
        </Feature>
      </div>
    </div>
  </div>
</section>
