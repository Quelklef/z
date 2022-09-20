let

pkgs =
  let fetched = builtins.fetchGit {
        url = "https://github.com/NixOS/nixpkgs";
        rev = "02b279323f3b5b031cd8aeb6440d76f0b735855e";
      };
  in import fetched { };

npmlock2nix =
  let fetched = builtins.fetchGit {
        url = "https://github.com/tweag/npmlock2nix.git";
        rev = "dd2897c3a6e404446704a63f40b9a29fa0acf752";
      };
  in import fetched { inherit pkgs; };

gitignoreSource =
  let fetched = builtins.fetchGit {
        url = "https://github.com/hercules-ci/gitignore.nix";
        rev = "80463148cd97eebacf80ba68cf0043598f0d7438";
      };
  in (import fetched { inherit (pkgs) lib; }).gitignoreSource;

src = gitignoreSource ./.;

runtime-deps = with pkgs; [
  nodejs-17_x
  texlive.combined.scheme-full
  dhall-json
];

deriv =
  pkgs.writeScript "z" ''
    #!${pkgs.bash}/bin/bash
    export PATH=''${PATH:+''${PATH}:}${pkgs.lib.strings.makeBinPath runtime-deps}
    export NODE_PATH=${npmlock2nix.node_modules { inherit src; }}/node_modules
    node ${./.}/main.js "$@"
  '';

shell =
  pkgs.mkShell {
    buildInputs = runtime-deps;
  };

in { inherit deriv shell; }
