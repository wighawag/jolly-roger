{
  description = "The game packaged for a LAN box (github:wighawag/ethereum-lan-node): nix build .#lan";

  # Node and pnpm are deliberately NOT provided as a devshell: the template
  # tree leaves them to the host. This flake only packages the game for a box
  # (see nix/lan.nix, and "On a LAN box, with no internet" in README.md).

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      # x86_64-linux only, as the box is.
      packages.${system} = {
        lan = pkgs.callPackage ./nix/lan.nix {
          src = self;
          rev = self.shortRev or self.dirtyShortRev or "unknown";
        };
      };
    };
}
