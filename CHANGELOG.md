# @anvilkit/plugin-ai-copilot

## 0.1.0-alpha.0 — 2026-04-14

### Added

- **Plugin surface** — `createAiCopilotPlugin` plus the
  `AiCopilotOptions`, `AiCopilotPluginInstance`,
  `AiCopilotErrorPayload`, `AiErrorCode`, and `GeneratePageFn`
  types for host-side AI generation wiring.
- **Mock harness** — `@anvilkit/plugin-ai-copilot/mock` with
  `createMockGeneratePage`, `CreateMockGeneratePageOptions`,
  fixture helpers, and the `./mock` subpath for CI and deterministic
  local testing.
- **Quality gates** — `check:publint`, `check:circular`,
  `check:peer-deps`, `check:bundle-budget` (10 KB gzipped limit),
  and `check:api-snapshot`.

### Notes

- **Alpha release.** The plugin API may still change during the
  prerelease line; consumers should pin exact versions.
- **Host-owned transport remains the boundary.** The plugin never
  ships an LLM client; hosts must supply `generatePage()` and keep
  auth, retries, and provider-specific transport outside the package.
