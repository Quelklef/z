rm -rf ./out && { find -name '*.mjs'; find notes; } | entr -c node compile.mjs
