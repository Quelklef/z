[ "$IN_NIX_SHELL" ] || { echo >&2 'Run in nix-shell'; exit 1; }
export Z_SYMLINKS_OK=1  # working locally, so symlink assets instead of copying them for speed
node main.js "$@"

