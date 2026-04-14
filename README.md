# @anvilkit/plugin-ai-copilot

Headless AI copilot for Anvilkit Studio. The plugin caches a per-session
`AiGenerationContext` derived from the host's Puck config, calls a
host-supplied `generatePage(prompt, ctx)` function, validates the
response with `@anvilkit/validator`, and dispatches the result atomically
via `setData`.

> **Status:** alpha. API may change before `1.0`.

## Install

```bash
pnpm add @anvilkit/plugin-ai-copilot @anvilkit/core react react-dom @puckeditor/core
```

## Quickstart

```ts
import { Studio } from "@anvilkit/core";
import { createAiCopilotPlugin } from "@anvilkit/plugin-ai-copilot";
import { puckConfig } from "./puck-config";

const aiCopilot = createAiCopilotPlugin({
  puckConfig,
  generatePage: (prompt, ctx) =>
    fetch("/api/ai/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, availableComponents: ctx.availableComponents }),
    }).then((response) => response.json()),
  timeoutMs: 30_000,
});

<Studio puckConfig={puckConfig} plugins={[aiCopilot]} />
```

For CI and local demos, `@anvilkit/plugin-ai-copilot/mock` also ships
`createMockGeneratePage()` and deterministic fixtures that match the
demo component catalog.

## Phase 3 references

See the [Phase 3 plan](../../../docs/plans/phase-3-export-ai-pipeline-plan.md)
(`M5 — @anvilkit/plugin-ai-copilot`) and the
[architecture package catalog](../../../docs/ai-context/anvilkit-architecture.md)
(`§7 — @anvilkit/plugins [Stubs Exist]`) for the plugin boundary and
Phase 3 AI generation flow.

## Peer dependencies

| Package | Version |
| ------- | ------- |
| `react` | `^18.2.0` |
| `react-dom` | `^18.2.0` |
| `@puckeditor/core` | `^0.19.0` |

## Security model

- The plugin **never sees credentials**. API keys, auth headers, and
  endpoints belong to the host backend.
- `generatePage` is invoked with exactly two arguments: `(prompt, ctx)`.
- Every LLM response runs through `validateAiOutput` before being
  dispatched.
- The dispatch is atomic.

## License

MIT.
