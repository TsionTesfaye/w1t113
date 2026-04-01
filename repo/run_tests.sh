#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Keep date/time-dependent tests deterministic across hosts.
export TZ=UTC

# Prevent global npm engine-strict config from failing installs in Node 18 CI.
export npm_config_engine_strict=false

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run test
