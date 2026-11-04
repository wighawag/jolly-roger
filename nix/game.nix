# This game's identity as a LAN-box package (nix/lan.nix): the little that
# nix/lan.nix cannot work out by itself.
#
# PER REPO. Every repo of the template tree inherits this file and sets its own
# values. When a merge from the template conflicts here, keep yours (and, for
# the hash, recompute it as below): nothing in this file is meant to cascade.
{
  # fetchPnpmDeps' hash of the dependencies pnpm-lock.yaml names. It changes
  # whenever the lockfile does, and a stale one fails the build loudly with the
  # right value ("got: sha256-..."): build with `nix build .#lan`, then copy it
  # here. A lockfile change merged from the template needs the same.
  pnpmDepsHash = "sha256-u0xELFbGJ3NawTADvsSPgmuX8uNc5EVLddWWEmNEh40=";

  # Optional, shown with their defaults:
  #
  # name = <the root package.json's "name">;   the package is "<name>-lan"
  # title = <web/src/web-config.json's "title">;
  # description = <web/src/web-config.json's "description">;
  # deployBin = "<name>-deploy";               what the box runs to deploy
  # preBuild = "";   shell, run from the repo root before the contracts are
  #                  compiled (what they or the web app need built first)
}
