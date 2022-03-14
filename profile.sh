rm -rf out/.cache/notes &&
node --prof compile.js &&
node --prof-process isolate-* > stats.prof &&
rm -rf isolate-* &&
echo "Results written to stats.prof"
