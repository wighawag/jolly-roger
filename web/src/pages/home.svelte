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
    <code>npx init-from wighawag/jolly-roger &lt;your-app-folder&gt;</code>
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
<!--TEMPLATE_REMOVE-->
<footer class="bg-white dark:bg-black">
  <div
    class="max-w-screen-xl mx-auto py-12 px-4 sm:px-6 md:flex md:items-center md:justify-between lg:px-8">
    <div class="flex justify-center space-x-6 md:order-2">
      <a
        href="https://twitter.com/wighawag"
        class="text-gray-400 hover:text-gray-500">
        <span class="sr-only">Twitter</span>
        <svg
          class="h-6 w-6"
          aria-hidden="true"
          fill="currentColor"
          viewBox="0 0 24 24">
          <path
            d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
        </svg>
      </a>
      <a
        href="https://github.com/wighawag"
        class="text-gray-400 hover:text-gray-500">
        <span class="sr-only">GitHub</span>
        <svg
          class="h-6 w-6"
          aria-hidden="true"
          fill="currentColor"
          viewBox="0 0 24 24">
          <path
            fill-rule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            clip-rule="evenodd" />
        </svg>
      </a>
      <a
        href="https://ronan.eth.link"
        class="text-gray-400 hover:text-gray-500">
        <span class="sr-only">Web</span>
        <svg
          class="h-6 w-6"
          aria-hidden="true"
          fill="currentColor"
          viewBox="0 0 24 24">
          <path
            fill-rule="evenodd"
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c5.51 0 10-4.48 10-10S17.51 2 12 2zm6.605 4.61a8.502 8.502 0 011.93 5.314c-.281-.054-3.101-.629-5.943-.271-.065-.141-.12-.293-.184-.445a25.416 25.416 0 00-.564-1.236c3.145-1.28 4.577-3.124 4.761-3.362zM12 3.475c2.17 0 4.154.813 5.662 2.148-.152.216-1.443 1.941-4.48 3.08-1.399-2.57-2.95-4.675-3.189-5A8.687 8.687 0 0112 3.475zm-3.633.803a53.896 53.896 0 013.167 4.935c-3.992 1.063-7.517 1.04-7.896 1.04a8.581 8.581 0 014.729-5.975zM3.453 12.01v-.26c.37.01 4.512.065 8.775-1.215.25.477.477.965.694 1.453-.109.033-.228.065-.336.098-4.404 1.42-6.747 5.303-6.942 5.629a8.522 8.522 0 01-2.19-5.705zM12 20.547a8.482 8.482 0 01-5.239-1.8c.152-.315 1.888-3.656 6.703-5.337.022-.01.033-.01.054-.022a35.318 35.318 0 011.823 6.475 8.4 8.4 0 01-3.341.684zm4.761-1.465c-.086-.52-.542-3.015-1.659-6.084 2.679-.423 5.022.271 5.314.369a8.468 8.468 0 01-3.655 5.715z"
            clip-rule="evenodd" />
        </svg>
      </a>
    </div>
    <div class="mt-8 md:mt-0 md:order-1">
      <p class="text-center text-base leading-6 text-gray-400">
        &copy; 2020 Ronan Sandford. All rights reserved.
      </p>
    </div>
  </div>
</footer>
<!--TEMPLATE_REMOVE-->
