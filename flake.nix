{
  inputs = {
    pkgs.url = "github:nixos/nixpkgs";
    npmlock2nix = {
      url = "github:tweag/npmlock2nix";
      flake = false;
    };
  };
  outputs = inputs: let
    system = "x86_64-linux";
    pkgs = import inputs.pkgs { inherit system; };
    npmlock2nix = import inputs.npmlock2nix { inherit pkgs; };
    runtime-deps = with pkgs; [
      nodejs-18_x
      texlive.combined.scheme-full
      dhall-json
    ];
  in
  {
    devShells.${system}.default =
      pkgs.mkShell { buildInputs = runtime-deps; };
    packages.x86_64-linux.default =
      pkgs.writeScript "z" ''
        #!${pkgs.bash}/bin/bash
        export PATH=''${PATH:+''${PATH}:}${pkgs.lib.strings.makeBinPath runtime-deps}
        export NODE_PATH=${npmlock2nix.node_modules { src = ./.; }}/node_modules
        node ${./.}/main.js "$@"
      '';
  };
}
