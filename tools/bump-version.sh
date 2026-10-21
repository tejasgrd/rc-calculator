#!/bin/sh
# Stamp a new cache-busting version (?v=...) on every script and stylesheet link in the HTML pages.
# Run before committing a release so browsers fetch fresh files instead of mixing old and new.
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M)
for f in *.html; do
  sed -E -i '' "s#(src|href)=\"(assets/[^\"?]+\.(js|css))(\?v=[0-9]+)?\"#\1=\"\2?v=$V\"#g" "$f"
done
echo "Asset version set to $V in: $(ls *.html | tr '\n' ' ')"
