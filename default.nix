{ pkgs ? import <nixpkgs> {} }: let

npmlock2nix =
  let fetched = builtins.fetchGit {
        url = "https://github.com/tweag/npmlock2nix.git";
        rev = "8ada8945e05b215f3fffbd10111f266ea70bb502";
      };
  in import fetched { inherit pkgs; };

gitignoreSource =
  let fetched = builtins.fetchGit {
        url = "https://github.com/hercules-ci/gitignore.nix";
        rev = "80463148cd97eebacf80ba68cf0043598f0d7438";
      };
  in (import fetched { inherit (pkgs) lib; }).gitignoreSource;

src = gitignoreSource ./.;

in pkgs.stdenv.mkDerivation {
  name = "z";
  inherit src;

  buildInputs = [ pkgs.nodejs-15_x pkgs.texlive.combined.scheme-full ];

  installPhase = ''
    mkdir $out
    cp -r ${npmlock2nix.node_modules { inherit src; }}/. .
    cp -r ${./notes} ./notes
    node compile.js
    mv ./out/* $out
  '';
}
