# Target Families And Evidence Surfaces

This repository treats `project_kind` as the product shape inferred from intake,
and `target_family` as the evaluator/runtime bundle selected for the loop.
Explicit `verification_surfaces` and `evidence_surfaces` take priority over
family defaults.

## Target Families

| target_family | Primary use | Default runtime proof |
| --- | --- | --- |
| `browser-app` | Browser-only app or site | browser URL plus optional screenshot/test evidence |
| `dashboard` | Browser analytics/admin dashboard | browser URL plus API/test evidence when requested |
| `browser-editor` | Canvas, builder, editor, storyboard | browser URL plus workflow/screenshot evidence |
| `editor-app` | Legacy editor alias kept for compatibility | browser URL plus workflow/screenshot evidence |
| `fullstack-app` | Browser UI with backend/API support | browser and API URLs |
| `api-service` | Backend/API service | API base or health URL |
| `crud-api` | Resource-oriented API | API base or health URL |
| `chat-agent` | Agent/chat workflow | command, transcript, file, or test evidence unless API is explicit |
| `cli-tool` | Command-line tool | `run_command` / `check_command`, stdout/file/test evidence |
| `command-artifact` | Non-web package, pipeline, document, or automation | command/file/test/package/document evidence |
| `generic-core` | Harness-only or no target product | no product adapter defaults |

## Project Kind Mapping

| project_kind | Default target_family | Default evidence surfaces |
| --- | --- | --- |
| `browser_ui` | `browser-app`, `dashboard`, or `browser-editor` by request | `browser`, `screenshot`, `test` |
| `mobile_ui` | `browser-app` until a mobile adapter exists | `browser`, `screenshot`, `test` |
| `api_service` | `api-service` or `crud-api` | `api`, `test`, `file` |
| `cli_tool` | `cli-tool` | `cli`, `file`, `test` |
| `library_package` | `command-artifact` | `package_import`, `test`, `file` |
| `data_pipeline` | `command-artifact` | `cli`, `file`, `test` |
| `agent_workflow` | `chat-agent` | `agent_conversation`, `file`, `test` |
| `document_artifact` | `command-artifact` | `document`, `file`, `manual_review` |
| `automation` | `command-artifact` | `shell`, `file`, `test` |
| `generic` | family inferred from other signals | `file`, `test`, `manual_review` |

## Invariants

- Command-first project kinds must not inherit browser runtime defaults.
- `library_package`, `data_pipeline`, `document_artifact`, and `automation`
  intentionally map to `command-artifact`; there is no separate
  `library-package` target family yet.
- CLI and command-artifact plans should not synthesize `ready_url`, `app_url`,
  `health_url`, or `api_base_url` unless the user explicitly requests a URL or
  API surface.
- `verification_surfaces` wins over `evidence_surfaces`; both win over
  target-family fallback.
- Every product run should have an evaluation policy and per-round scorecard,
  even when no explicit custom policy was supplied.
- Browser/API families still require URL hints for existing targets when their
  selected surfaces need browser or API proof.
