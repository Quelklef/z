[ "$IN_NIX_SHELL" ] || { echo >&2 'Run in nix-shell'; exit 1; }
export Z_SYMLINKS_OK=1  # working locally, so symlink assets instead of copying them for speed
export Z_EMIT_SENSITIVE_INFO=1
node main.js "$@"

