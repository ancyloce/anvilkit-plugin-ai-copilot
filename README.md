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

## Architecture context

The AI generation flow runs entirely through the plugin boundary —
`@anvilkit/core` exposes no first-party AI primitives beyond the
`AiGenerationContext` types. See
[`anvilkit-architecture.md`](https://github.com/ancyloce/anvilkit-studio/blob/main/docs/ai-context/anvilkit-architecture.md)
for the full package catalog and trust-boundary discussion.

## Peer dependencies

| Package | Version |
| ------- | ------- |
| `react` | `^18.2.0` |
| `react-dom` | `^18.2.0` |
| `@puckeditor/core` | `^0.21.2` |

## Security model

- The plugin **never sees credentials**. API keys, auth headers, and
  endpoints belong to the host backend.
- `generatePage` is invoked with exactly two arguments: `(prompt, ctx)`.
- Every LLM response runs through `validateAiOutput` before being
  dispatched.
- The dispatch is atomic.

## License

MIT.
