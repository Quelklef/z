{ pkgs ? import <nixpkgs> {}
, port ? 8123
}:

{
  systemd.services.serve-z = {
    description = "ζ";
    after = [ "network.target" ];
    wantedBy = [ "default.target" ];
    script = ''
      export Z_PORT=${builtins.toString(port)}
      cd ${import ./default.nix { inherit pkgs; }}
      ./run.sh
    '';
    serviceConfig = {
      Type = "simple";
      Restart = "always";
    };
  };
}
