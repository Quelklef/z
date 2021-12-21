{ pkgs ? import <nixpkgs> {} }: let

static = pkgs.runCommand "z-static" {} ''
  mkdir $out
  cp ${pkgs.fetchurl { url = "http://tikzjax.com/v1/tikzjax.js"; sha256 = "08bjcrgp5brllwmbm2l6q05ps1pkjcb3hjkc4hzmw539fwa6msrk"; }} "$out/tikzjax.js"
  cp ${pkgs.fetchurl { url = "http://tikzjax.com/7620f557a41f2bf40820e76ba1fd4d89a484859d.gz"; sha256 = "0jnf8hmqlvd7flsirw3an44257xbnqsmnzija3c8sm5qajrvda1g"; }} "$out/7620f557a41f2bf40820e76ba1fd4d89a484859d.gz"
  cp ${pkgs.fetchurl { url = "http://tikzjax.com/ef253ef29e2f057334f77ead7f06ed8f22607d38.wasm"; sha256 = "1ipy4ihiccs5sh38ram7041ga1cwbbmsipscx2qxn5znbq2x2d97"; }} "$out/ef253ef29e2f057334f77ead7f06ed8f22607d38.wasm"
'';

in pkgs.stdenv.mkDerivation {
  name = "z";
  src = ./.;

  installPhase = ''
    cp -r $src/. .

    mkdir $out

    mv {app/,notes/,serve.js} $out

    mkdir $out/static
    cp -r ${static}/. $out/static

    echo "${pkgs.nodejs}/bin/node ./serve.js" > $out/run.sh
    chmod +x $out/run.sh
  '';

  shellHook = ''
    mkdir -p ./static
    cp -r ${static}/. ./static
  '';
}
