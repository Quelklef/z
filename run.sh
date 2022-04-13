# run this in the nix-shell
export Z_SYMLINKS_OK=1  # working locally, so symlink assets instead of copying them for speed
node main.js "$@"

