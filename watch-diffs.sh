#!/usr/bin/env bash
set -euo pipefail

out=${1?Expected directory to watch}

echo '~ watch'
while true; do
  clear

  if [ ! -e $out/.git ]; then
    pushd $out
    echo '~ reset'
    rm -rf .git
    echo '~ init'
    echo '.cache' > .gitignore
    git init
    echo '~ commit'
    git add .
    git commit -m save
    popd
  fi

  pushd $out && git --no-pager diff && popd
  sleep 1
done
