#!/usr/bin/env bash
# Starts the mock API, runs the simulated-browser tests, stops the mock API.
#   cd ui/test && npm install && ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
python3 mock_api.py &
MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
sleep 1
node ui.test.mjs
