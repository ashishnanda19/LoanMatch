#!/usr/bin/env bash
# Writes ui/config.js with the deployed API URL (gitignored; ui/index.html reads it).
set -euo pipefail
cd "$(dirname "$0")/.."
url="$(terraform -chdir=infra output -raw api_url)"
printf 'window.CONFIG = { API_URL: "%s" };\n' "$url" > ui/config.js
echo "ui/config.js -> $url"
echo "Serve the UI:  python3 -m http.server 8000 --directory ui   then open http://localhost:8000"
