{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  name = "z";
  src = ./.;
  buildInputs = [ pkgs.nodejs ];
  installPhase = ''
    cp -r $src/. .
    node compile.js
    mv out $out
  '';
}
