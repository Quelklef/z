set -euo pipefail

echo "File watch + inc compilation + serve on localhost:8080"
sleep 1

rm -rf ./out
mkdir out

python3 -m http.server --directory out &
pid=$!
trap "kill $pid" EXIT

while :; do
  { find notes; find -name '*.mjs'; } | entr -c node compile.mjs || true
  echo "Restarting..."
  sleep 1
done
