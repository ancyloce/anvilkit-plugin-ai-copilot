# @anvilkit/plugin-ai-copilot

## 0.1.2

### Patch Changes

- Updated dependencies
  - @anvilkit/core@0.1.2
  - @anvilkit/schema@0.1.2
  - @anvilkit/validator@0.1.2
  - @anvilkit/utils@0.1.2
  - @anvilkit/ui@0.1.2

## 0.1.1

### Patch Changes

- Routine `0.1.1` patch — coordinated fixed-group bump.

  Aligns the lockstep fixed group at `0.1.1`. Additive only; no breaking
  changes. New surface area in this cut:
  - Section-level AI regeneration (`regenerateSelection`) via
    `@anvilkit/plugin-ai-copilot`, with a reusable `<AiPromptPanel>` in
    `@anvilkit/ui`.
  - `PageIRNode.meta` (locked / owner / notes / version) with diff/apply
    parity across `@anvilkit/ir`, `@anvilkit/schema`, `@anvilkit/validator`,
    and `@anvilkit/plugin-version-history`.
  - Realtime collab integration points (host plugins remain alpha).
  - Marketplace registry feed under the docs site.

- Updated dependencies
  - @anvilkit/core@0.1.1
  - @anvilkit/schema@0.1.1
  - @anvilkit/validator@0.1.1
  - @anvilkit/utils@0.1.1

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
