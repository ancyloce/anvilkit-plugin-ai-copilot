# @anvilkit/plugin-ai-copilot

Headless AI copilot for Anvilkit Studio. The plugin caches a per-session
`AiGenerationContext` derived from the host's Puck config, calls a
host-supplied `generatePage(prompt, ctx)` function, validates the
response with `@anvilkit/validator`, and dispatches the result atomically
via `setData`.

> **Status:** alpha. API may change before `1.0`.

## Install

```bash
pnpm add @anvilkit/plugin-ai-copilot
```

## Usage

```ts
import { createAiCopilotPlugin } from "@anvilkit/plugin-ai-copilot";
import { puckConfig } from "./puck-config";

const aiCopilot = createAiCopilotPlugin({
  puckConfig,
  generatePage: async (prompt, ctx) => {
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, availableComponents: ctx.availableComponents }),
    });
    return response.json();
  },
  timeoutMs: 30_000,
  forwardCurrentData: true,
});

<Studio plugins={[aiCopilot]} ... />

await aiCopilot.runGeneration("Build a hero with a CTA");
```

## Security model

- The plugin **never sees credentials**. API keys, auth headers, and
  endpoints belong to the host backend.
- `generatePage` is invoked with exactly two arguments: `(prompt, ctx)`.
- Every LLM response runs through `validateAiOutput` before being
  dispatched.
- The dispatch is atomic.

## License

MIT.
