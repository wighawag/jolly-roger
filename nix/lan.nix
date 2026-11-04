# This repo's game packaged for a LAN box (github:wighawag/ethereum-lan-node),
# in the shape its game module expects:
#
#   $out/web/              the SvelteKit static build
#   $out/bin/<deployBin>   puts the contracts on the box's chain, idempotently
#   passthru.lan           how the box should run it (no server: the game is
#                          the chain plus the page)
#
# GENERIC. Nothing here names a game: what does is in nix/game.nix, which each
# repo of the template tree sets for itself. Change this file in the template
# that introduced it (jolly-roger), so that every game gets the change.
#
# Built with NO network, like every Nix build, which is the point: nothing the
# game needs at play time may come from the internet either.
#
# - Solidity: hardhat would download solc; it is given the official WASM build
#   instead (SOLC_PATH, see contracts/hardhat.config.ts): the same compiler, so
#   the same bytecode.
# - Addresses: the contracts are deployed at BUILD time into a throwaway chain
#   with the box's chain id (contracts/scripts/deploy-lan-build.ts). Every one
#   goes through the CREATE2 factory the box's genesis predeploys, so the box
#   gets the same addresses; the web app is built with them, and the deploy
#   command replays the recorded transactions on the box (nix/lan-deploy.sh).
# - URLs: web/.env.lan names only same-host urls (`//:8545`, the faucet at
#   `//:34010`), so one build works on the hotspot, on a venue network and by
#   name.
{
  src,
  rev,
  lib,
  stdenv,
  fetchurl,
  nodejs_24,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
  writeShellApplication,
  runCommand,
  foundry,
  jq,
}: let
  pnpm = pnpm_10;
  game = import ./game.nix;
  webConfig = lib.importJSON "${src}/web/src/web-config.json";
  packageJson = lib.importJSON "${src}/package.json";
  name = game.name or packageJson.name;
  deployBin = game.deployBin or "${name}-deploy";

  # The official WASM build of solc (https://binaries.soliditylang.org/wasm/list.json,
  # whose sha256 the hash is): the same compiler as the native build hardhat
  # would download, with nothing to patch. (The native build wants /lib64's
  # loader, and once patched, hardhat's binary-or-wasm sniffing takes it for
  # text.) The version must be the one in contracts/hardhat.config.ts: a repo
  # that compiles with another one says so in nix/game.nix.
  solcBuild = game.solc or {
    version = "0.8.28+commit.7893614a";
    hash = "sha256-cu9YCm7FlDEwAo5SlDE/JOlDVSCsyJ+Mnb/QE52a4UY=";
  };
  solc = fetchurl {
    url = "https://binaries.soliditylang.org/wasm/soljson-v${solcBuild.version}.js";
    inherit (solcBuild) hash;
  };

  # The deploy needs `cast` alone: copied out of foundry, it is 90 MB instead
  # of foundry's 370 (forge, anvil, chisel...), which matters when the closure
  # is copied to the box over an event's network.
  cast = runCommand "cast-${foundry.version}" {} ''
    install -Dm755 ${foundry}/bin/cast $out/bin/cast
  '';

  /** The box's chain id: ethereum-lan-node's nix/genesis.json. */
  chainId = 19216801;

  deploy = writeShellApplication {
    name = "${deployBin}-unwrapped";
    runtimeInputs = [cast jq];
    text = builtins.readFile ./lan-deploy.sh;
  };
in
  stdenv.mkDerivation (finalAttrs: {
    pname = "${name}-lan";
    version = "0.0.0";
    inherit src;

    nativeBuildInputs = [nodejs_24 pnpm pnpmConfigHook];

    pnpmDeps = fetchPnpmDeps {
      inherit (finalAttrs) pname version src;
      inherit pnpm;
      fetcherVersion = 3;
      hash = game.pnpmDepsHash;
    };

    env = {
      LAN_CHAIN_ID = toString chainId;
      SOLC_PATH = "${solc}";
      HARDHAT_DISABLE_TELEMETRY_PROMPT = "true";
      # package.json pins a pnpm (packageManager), which pnpm would otherwise
      # try to download to run itself as; the one nixpkgs gives is a 10 too.
      npm_config_manage_package_manager_versions = "false";
    };

    preBuild = game.preBuild or "";

    buildPhase = ''
      export HOME=$TMPDIR
      runHook preBuild

      # The contracts, deployed into a throwaway chain with the box's chain id;
      # the transactions are kept for the deploy command, the records exported
      # to the app.
      pushd contracts
      pnpm exec hardhat compile --build-profile production
      LAN_TRANSACTIONS=$TMPDIR/lan.transactions.json \
        pnpm exec hardhat run --build-profile production scripts/deploy-lan-build.ts
      pnpm exec rocketh-export -e lan --ts ../web/src/lib/deployments.ts
      # The package's JS (dist/), which the web app may import: with/embedded-
      # chain's offline demo runs the deploy scripts in the browser.
      pnpm exec tsc
      popd

      pushd web
      # svelte.config.js names the build after `git rev-parse`, falling back to a
      # timestamp that each build process computes differently, and then the
      # prerendered HTML names another build than its JS and never hydrates (as
      # found in conquest-demo's nix/lan.nix). There is no git here: pin it.
      substituteInPlace svelte.config.js \
        --replace-fail 'let VERSION = `timestamp_''${Date.now()}`;' 'let VERSION = "${rev}";'
      # PWA icons: cosmetic on a LAN (no service worker over plain http).
      pnpm generate-pwa-icons || echo "${name}: pwa icons skipped"
      pnpm exec svelte-kit sync
      pnpm exec vite build --mode lan
      popd
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out/bin $out/share/${name}
      cp -r web/build $out/web
      cp $TMPDIR/lan.transactions.json $out/share/${name}/
      cat > $out/bin/${deployBin} <<EOF
      #!${stdenv.shell}
      export TRANSACTIONS=$out/share/${name}/lan.transactions.json
      export NAME=${deployBin}
      exec ${deploy}/bin/${deployBin}-unwrapped "\$@"
      EOF
      chmod +x $out/bin/${deployBin}
      runHook postInstall
    '';

    passthru.lan = {
      title = game.title or webConfig.title;
      description = game.description or webConfig.description;
      # SvelteKit's SPA shell for routes that were not prerendered.
      fallback = "/404.html";
      deploy.bin = deployBin;
    };

    meta = {
      # The repo's own, from package.json, when it declares one.
      license = lib.optionals (packageJson ? license) [(lib.getLicenseFromSpdxId packageJson.license)];
      platforms = ["x86_64-linux"];
    };
  })
