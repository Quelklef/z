{ echo *.mjs; find notes; } | entr -c node compile.mjs
