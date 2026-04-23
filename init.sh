#!/usr/bin/env bash
set -euo pipefail

TS_VERSION="${TYPESCRIPT_PINNED_VERSION:-5.9.3}"

if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

mkdir -p evals/runs

if ! npm run build; then
  npx -p "typescript@${TS_VERSION}" tsc -b --force --pretty false
fi

cat <<'EOF'
Workbench identity: generic Codex workbench with a closed-loop harness engine.
Quick start:
  npm run test
  npm run loop:intent -- --json "<request>"
  npm run loop:intake -- --json "<product request>"
  npm run loop:prepare -- --json
EOF
