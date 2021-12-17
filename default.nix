{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  name = "z";
  src = ./.;
  installPhase = ''
    cp -r $src/. .

    mkdir $out
    mv {src/,notes/,serve.js} $out
    echo "${pkgs.nodejs}/bin/node ./serve.js" > $out/run.sh
    chmod +x $out/run.sh
  '';
}
