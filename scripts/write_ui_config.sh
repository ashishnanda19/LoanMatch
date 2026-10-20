#!/usr/bin/env bash
# Writes ui/config.js with the deployed API URL (gitignored; the UI reads it).
set -euo pipefail
cd "$(dirname "$0")/.."
url="$(terraform -chdir=infra output -raw api_url)"
key="$(terraform -chdir=infra output -raw api_key)"
# config.js is gitignored: it holds the access key so the console opens without typing it (a shared deployment
# would leave API_KEY out and let each person enter it in the UI instead).
printf 'window.CONFIG = { API_URL: "%s", API_KEY: "%s" };\n' "$url" "$key" > ui/config.js
echo "ui/config.js -> $url (access key included; file is gitignored)"
echo "Serve the UI:  python3 -m http.server 8000 --directory ui   then open http://localhost:8000"
