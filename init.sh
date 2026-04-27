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
  if [ "${HARNESS_ALLOW_NPX_INSTALL:-0}" = "1" ]; then
    npx -p "typescript@${TS_VERSION}" tsc -b --force --pretty false
  else
    echo "Build failed. Run npm ci, or set HARNESS_ALLOW_NPX_INSTALL=1 to allow npx fallback." >&2
    exit 1
  fi
fi

cat <<'EOF'
Workbench identity: generic Codex workbench with a closed-loop harness engine.
Quick start:
  npm run test
  npm run loop:intent -- --json "<request>"
  npm run loop:intake -- --json "<product request>"
  npm run loop:prepare -- --json
EOF
