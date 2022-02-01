let

inherit (import ./pins.nix) pkgs purs-nix npmlock2nix gitignoreSource elmish-latest;

nixed = purs-nix.purs
  { srcs = [ ../app ];
    dependencies =
      with purs-nix.ps-pkgs;
      [ console
        effect
        lists
        maybe
        node-fs
        elmish-latest
        aff
        aff-promise
      ];
  };

static = pkgs.runCommand "z-static" {} ''
  mkdir $out

  cp ${pkgs.fetchurl
    { url = "http://tikzjax.com/v1/tikzjax.js";
      sha256 = "08bjcrgp5brllwmbm2l6q05ps1pkjcb3hjkc4hzmw539fwa6msrk";
    }} "$out/tikzjax.js"

  cp ${pkgs.fetchurl
    { url = "http://tikzjax.com/7620f557a41f2bf40820e76ba1fd4d89a484859d.gz";
      sha256 = "0jnf8hmqlvd7flsirw3an44257xbnqsmnzija3c8sm5qajrvda1g";
    }} "$out/7620f557a41f2bf40820e76ba1fd4d89a484859d.gz"

  cp ${pkgs.fetchurl
    { url = "http://tikzjax.com/ef253ef29e2f057334f77ead7f06ed8f22607d38.wasm";
      sha256 = "1ipy4ihiccs5sh38ram7041ga1cwbbmsipscx2qxn5znbq2x2d97";
    }} "$out/ef253ef29e2f057334f77ead7f06ed8f22607d38.wasm"
'';

notes = pkgs.stdenv.mkDerivation {
  name = "z-notes";
  src = [ ../notes ];
  installPhase = "cp -r $src $out";
};

in {

  deriv = pkgs.stdenv.mkDerivation {
    name = "z";
    src = [ (gitignoreSource ../.) ];

    buildInputs = [ pkgs.nodejs ];

    installPhase = ''
      mkdir -p $out

      cp -r $src/{app/index.html,serve.js} $out

      mkdir $out/notes
      cp -r ${notes}/. $out/notes

      mkdir $out/static
      cp -r ${static}/. $out/static

      cp ${nixed.modules.Main.bundle {}} $out/index.js
    '';
  };

  shell = pkgs.mkShell {
    buildInputs =
      [ (nixed.command { srcs = [ ''$(realpath "$PWD/app")'' ]; })
        pkgs.nodejs
        pkgs.entr
      ];

    shellHook = ''

      function z.build-inc {(
        echo
      )}

      function z.build-full {(
        set -eo pipefaile
        rm -rf .working
        z.build-inc
      )}

      function z.workflow-build {
        echo Watching
        { find app; find notes; echo serve.js; } | entr -sc '
          set -eo pipefail
          echo "Inc build"

          mkdir -p .working
          cd .working

          [ -d static ] || {
            mkdir static
            cp -r ${static}/. ./static
          }

          rm -rf app index.html serve.js notes
          cp -r ../{app/,app/index.html,serve.js,notes/} .

          purs-nix bundle
        '
      }

      function z.workflow-serve {(
        cd .working && ls serve.js | entr -cr node serve.js
      )}

    '';
  };

}
