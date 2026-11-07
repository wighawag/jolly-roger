{
  description = "The game packaged for a LAN box (github:wighawag/ethereum-lan-node): nix build .#lan";

  # Node and pnpm are deliberately NOT provided as a devshell: the template
  # tree leaves them to the host. This flake only packages the game for a box,
  # and even that is ethereum-lan-node's: lib.mkRockethGame builds it, from
  # this repo and nix/game.nix (see "On a LAN box, with no internet" in
  # README.md). A repo that never goes on a box can drop this file and
  # nix/game.nix (list them in .offshoot-omissions).

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    ethereum-lan-node = {
      url = "github:wighawag/ethereum-lan-node";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      ethereum-lan-node,
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      # x86_64-linux only, as the box is.
      packages.${system} = {
        lan = ethereum-lan-node.lib.mkRockethGame pkgs (
          {
            src = self;
            rev = self.shortRev or self.dirtyShortRev or "unknown";
          }
          // import ./nix/game.nix
        );
      };
    };
}
