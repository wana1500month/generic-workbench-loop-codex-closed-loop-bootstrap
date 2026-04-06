# Codex Auth

## Official model

This harness is designed around ChatGPT-managed Codex auth, not API-key auth.

- Preferred auth mode: `chatgpt`
- Preferred credentials store: file-backed `CODEX_HOME/auth.json`
- Repo-local `.codex/config.toml` only owns model and profile defaults
- Auth enforcement belongs to user or runner Codex state

Recommended user or runner config:

```toml
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
```

If you need to pin a specific ChatGPT workspace, set `forced_chatgpt_workspace_id`
in user or managed Codex config. Do not commit that setting to this repo.

## Local developer flow

1. Configure file-backed credentials in user Codex config.
2. Run `codex login`.
3. Use `codex login status` to confirm the CLI is logged in.
4. Keep the resulting `auth.json` under your `CODEX_HOME`.

If browser login is unavailable, use `codex login --device-auth` on a trusted
machine and then verify the resulting auth file.

## Auth file checks

Strict automation expects:

- `auth_mode == "chatgpt"`
- `auth.json` present under `CODEX_HOME`
- a non-empty refresh token

Example inspection command:

```bash
AUTH_FILE="${CODEX_HOME:-$HOME/.codex}/auth.json"
jq '{
  auth_mode,
  has_tokens: (.tokens != null),
  has_refresh_token: ((.tokens.refresh_token // "") != ""),
  last_refresh
}' "$AUTH_FILE"
```

Treat `auth.json` like a password. Do not commit it, upload it as evidence, or
attach it to tickets.

## Trusted CI pattern

Trusted automation should use one persistent self-hosted runner plus one
persistent `CODEX_HOME`.

- Keep `CODEX_HOME` on the runner filesystem
- Seed `auth.json` only if it is missing
- Let Codex refresh and rewrite that file in place
- Serialize jobs that share the same auth state

The real smoke workflow follows that pattern and reserves strict smoke for the
trusted runner only.

## Recovery

If real smoke starts failing because auth expired or became invalid:

1. Re-run `codex login` or `codex login --device-auth` on a trusted machine.
2. Verify `codex login status`.
3. Replace the runner's `auth.json` seed only if the persistent copy is broken.
4. Re-run `npm run validate:codex:real-smoke:strict`.
