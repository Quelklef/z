{ system }: let

pkgs =
  let
    rev = "02b279323f3b5b031cd8aeb6440d76f0b735855e";
    fetched = builtins.fetchTarball "https://github.com/NixOS/nixpkgs/archive/${rev}.tar.gz";
  in import fetched { inherit system; };

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


# Adds q.uiver.app's .sty file to the texlive installation
# Cobbled together on [2023-03-20] from:
# - https://nixos.wiki/wiki/TexLive
# - https://nixos.org/manual/nixpkgs/stable/#sec-language-texlive
# - https://github.com/NixOS/nixpkgs/issues/11893
with-quiver = texlive:
  let

    quiver-sty = builtins.fetchurl {
      url = "https://raw.githubusercontent.com/varkor/quiver/cc0b739399286858c8ad1af70c58321ef3edb5d3/src/quiver.sty";
      sha256 = "1a1v0y2qh45074r3i78j9852i5nr8yicismp4ywkkk5gx0y73zg6";
    };
    quiver-deriv = pkgs.stdenv.mkDerivation {
      name = "quiver";
      pname = "quiver";
      tlType = "run";
      dontUnpack = true;
      installPhase = ''
        mkdir -p $out/tex/latex
        cp ${quiver-sty} $out/tex/latex/quiver.sty
      '';
    };

  in
    texlive.combine {
      inherit (texlive) scheme-full;
      quiver = { pkgs = [ quiver-deriv ]; };
    };


runtime-deps = with pkgs; [
  nodejs-17_x
  (with-quiver pkgs.texlive)
  pdf2svg
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
