# Source Archive

This checkout or source archive is not the Codex app install ZIP.

Use this source form for development, validation, and release generation. Build the
installable Codex app artifact with:

```bash
npm ci
npm run build
npm run release:zip
```

Install only `.tmp/release/generic-codex-workbench-CODEX-APP-INSTALL.zip` in
Codex app. That release ZIP includes `packages/loop-orchestrator/dist`,
`CODEX_APP_INSTALL.md`, and `release-manifest.json`.
