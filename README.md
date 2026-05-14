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

## Plugin shape

Unlike sibling plugins (`@anvilkit/plugin-export-html`, etc.) that
register declarative `exportFormats` / `headerActions` maps, this
plugin returns two **imperative methods** — `runGeneration(prompt)`
and `regenerateSelection(prompt, selection)`. The reason: an AI
copilot is prompt-driven. Host UI code typically renders a textarea
plus submit button and must `await` the run to drive progress state,
disable the input mid-generation, and surface errors inline. A
declarative `aiActions` map would still require a host-side
`await invoke()` at the call site, so we expose the methods directly.

## Security model

- The plugin **never sees credentials**. API keys, auth headers, and
  endpoints belong to the host backend.
- `generatePage` is invoked with exactly two arguments: `(prompt, ctx)`.
- Every LLM response runs through `validateAiOutput` before being
  dispatched.
- The dispatch is atomic.

### `forwardCurrentData` and `sanitizeCurrentData`

When `forwardCurrentData: true` is set, the plugin includes the entire
Puck canvas in the context handed to your `generatePage` /
`generateSection` callback. This materially improves regeneration
quality (the LLM can see what's already on the page), but it also
means the full tree — component props, asset URLs, embedded text —
crosses the boundary into the host's LLM adapter on every prompt.

If any component props can contain PII, signed asset URLs, embedded
secrets, or internal customer identifiers, pair `forwardCurrentData`
with the `sanitizeCurrentData` option:

```ts
createAiCopilotPlugin({
  puckConfig,
  generatePage,
  forwardCurrentData: true,
  sanitizeCurrentData: (data) => ({
    ...data,
    content: data.content.map(stripInternalProps),
  }),
});

function stripInternalProps(item) {
  const safe = {};
  for (const [key, value] of Object.entries(item.props ?? {})) {
    // Drop props prefixed with `_` (convention for internal-only
    // fields) and any known PII keys.
    if (key.startsWith("_") || key === "email" || key === "phone") continue;
    safe[key] = value;
  }
  return { ...item, props: safe };
}
```

`sanitizeCurrentData` runs synchronously on every generation that
forwards data and defaults to identity. Keep it cheap.

## Observability — `onTrace`

The plugin exposes a single observability hook,
`onTrace?: (event: AiCopilotTraceEvent) => void`, called synchronously
at every decision point inside `runGeneration` and `regenerateSelection`.
It carries only structural metadata — flow (`"page"` | `"section"`),
the monotonic `generationId`, an error code on failure, and a stage
discriminant on stale drops. **Forwarded Puck data never flows through
this channel.**

Event shapes:

| `type` | When it fires | Extra fields |
| ------ | ------------- | ------------ |
| `generation-start` | A `runGeneration` / `regenerateSelection` call begins | `promptLength` |
| `generation-validated` | Validator accepted the host response | — |
| `generation-dispatched` | `setData` dispatched to the canvas | — |
| `generation-stale-drop` | A run resolved after a newer run preempted it | `stage` |
| `generation-failed` | Run terminated with an `AiErrorCode` | `code` |

Throwing from an `onTrace` handler is caught and reported via `ctx.log`;
a faulty observer never disrupts the generation pipeline.

### Sentry breadcrumbs

```ts
createAiCopilotPlugin({
  puckConfig,
  generatePage,
  onTrace: (event) => {
    Sentry.addBreadcrumb({
      category: "ai-copilot",
      level: event.type === "generation-failed" ? "error" : "info",
      message: event.type,
      data: event,
    });
  },
});
```

### OpenTelemetry span events

```ts
const tracer = trace.getTracer("anvilkit");
createAiCopilotPlugin({
  puckConfig,
  generatePage,
  onTrace: (event) => {
    trace.getActiveSpan()?.addEvent(`ai-copilot.${event.type}`, { ...event });
  },
});
```

### Local development with `console.debug`

```ts
createAiCopilotPlugin({
  puckConfig,
  generatePage,
  onTrace: (event) => console.debug("[ai-copilot]", event),
});
```

## Runtime config validation

Bad option shapes fail fast at construction with a `[CONFIG_INVALID]`-
tagged `Error`:

- `generatePage` must be a function
- `generateSection`, when provided, must be a function
- `timeoutMs`, when provided, must be a positive finite number
- `puckConfig` must be a non-null object
- `sanitizeCurrentData` / `onTrace`, when provided, must be functions

The `CONFIG_INVALID` code is part of the `AiErrorCode` union but is
surfaced through the synchronous constructor throw rather than the
`ai-copilot:error` event bus — no Studio context exists yet.

## License

MIT.
