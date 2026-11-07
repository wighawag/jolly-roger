# This game's identity as a LAN-box package: the arguments flake.nix passes to
# ethereum-lan-node's lib.mkRockethGame, i.e. the little it cannot work out by
# itself (its nix/rocketh-game/default.nix documents each one).
#
# PER REPO. Every repo of the template tree inherits this file and sets its own
# values. When a merge from the template conflicts here, keep yours (and, for
# the hash, recompute it as below): nothing in this file is meant to cascade.
{
  # fetchPnpmDeps' hash of the packages pnpm-lock.yaml names. After any
  # lockfile change, including one merged from the template, set it to
  # sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= and run
  #
  #   nix build git+file://$PWD#lan.pnpmDeps
  #
  # which fails with the right value ("got: sha256-..."). Do not rely on a
  # build passing: Nix trusts a hash it has already seen, so on a machine that
  # built the template, a descendant's stale hash quietly gets the TEMPLATE's
  # packages. Two lockfiles can also name the same packages, and so share a
  # hash.
  pnpmDepsHash = "sha256-u0xELFbGJ3NawTADvsSPgmuX8uNc5EVLddWWEmNEh40=";

  # Optional, shown with their defaults:
  #
  # name = <the root package.json's "name">;   the package is "<name>-lan"
  # title = <web/src/web-config.json's "title">;
  # description = <web/src/web-config.json's "description">;
  # deployBin = "<name>-deploy";               what the box runs to deploy
  # solc = { version = "0.8.28+commit.7893614a"; hash = "sha256-..."; };
  #                  the solc WASM build, which must be the version
  #                  contracts/hardhat.config.ts compiles with (the hash is the
  #                  sha256 in https://binaries.soliditylang.org/wasm/list.json,
  #                  as an SRI hash: nix hash convert --to sri sha256:<hex>)
  # preBuild = "";   shell, run from the repo root before the contracts are
  #                  compiled (what they or the web app need built first)
}
