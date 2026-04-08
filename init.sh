#!/usr/bin/env bash
set -euo pipefail

if [ ! -d node_modules ]; then
  npm install
fi

if ! npm run build; then
  npx -p typescript@5.8.3 tsc -b --force --pretty false
fi

cat <<'EOF'
Workbench identity: generic Codex workbench with a closed-loop harness engine.
Ready commands:
  npm run loop:intent -- --json "<request>"
  npm run loop:intake -- --json "<product request>"
  npm run loop:run -- --resume-run evals/runs/run-###
EOF
