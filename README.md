# @anvilkit/plugin-ai-copilot

> **Alpha (`0.1.3`).** API may change before `1.0`. The plugin sits behind the host's LLM adapter — no credentials or model identifiers cross the plugin boundary.

Headless AI copilot for Anvilkit Studio. The plugin caches a per-session `AiGenerationContext` derived from the host's Puck config, calls a host-supplied `generatePage(prompt, ctx)` (and optionally `generateSection`), validates the response with `@anvilkit/validator`, and dispatches the result atomically via `setData`. React UI primitives ship under `/react`; deterministic mock generators ship under `/mock` for tests and demos.

## Installation

```bash
pnpm add @anvilkit/plugin-ai-copilot @anvilkit/core react react-dom @puckeditor/core
```

Non-optional peers: `react ^18.2.0`, `react-dom ^18.2.0`, `@puckeditor/core ^0.21.2`. `@anvilkit/ui` is an optional peer — install it if you use the React components.

Subpath imports:

- `@anvilkit/plugin-ai-copilot` — plugin factory, `applySectionPatch`, types.
- `@anvilkit/plugin-ai-copilot/react` — React components and the `useAiCopilot` hook.
- `@anvilkit/plugin-ai-copilot/mock` — deterministic fixtures and mock generators for CI / demos.

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
      body: JSON.stringify({
        prompt,
        availableComponents: ctx.availableComponents,
      }),
    }).then((response) => response.json()),
  timeoutMs: 30_000,
});

<Studio puckConfig={puckConfig} plugins={[aiCopilot]} />;
```

Host UI calls `aiCopilot.runGeneration(prompt)` (or `regenerateSelection(prompt, selection)`) on submit — both are imperative because they're prompt-driven. Subscribe to the `ai-copilot:error` event bus for typed failures.

## Core features

- **Imperative generation API** — `runGeneration(prompt)` and `regenerateSelection(prompt, selection)` so host UI can drive progress state, disable input mid-run, and surface errors inline.
- **Strict validation boundary** — every LLM response runs through `validateAiOutput` (page flow) or `validateAiSectionPatch` (section flow) before dispatch.
- **Atomic dispatch** — a single `setData` action per successful generation; concurrent runs are tracked by a monotonic `generationId` and stale resolves are dropped.
- **Egress controls** — `forwardCurrentData` is `false` by default; pair with `sanitizeCurrentData` to strip PII before the LLM sees the canvas.
- **Observable** — synchronous `onTrace` hook fires at every decision point with structural metadata only (no forwarded data crosses the channel).
- **Section-level patches** — Phase 6 / M9 flow regenerates a contiguous selection without rebuilding the whole page.
- **Deterministic mocks** — `createMockGeneratePage` / `createMockGenerateSection` provide fixture-backed generators for tests and demos.
- **React primitives** — headless `useAiCopilot` hook plus `AiCopilotPanel` / `CopilotChatPanel` / `CopilotComposer` / `CopilotModelMenu` components.

## API reference

### Factory

```ts
function createAiCopilotPlugin(
  options: AiCopilotOptions,
): AiCopilotPluginInstance;

interface AiCopilotPluginInstance extends StudioPlugin {
  runGeneration(prompt: string): Promise<void>;
  regenerateSelection(
    prompt: string,
    selection: AiSectionSelection,
    opts?: RegenerateSelectionOptions,
  ): Promise<void>;
}
```

### `AiCopilotOptions`

| Field                 | Type                                   | Default    | Purpose                                                                                                                              |
| --------------------- | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `generatePage`        | `GeneratePageFn`                       | _required_ | Page-flow callback. `(prompt, ctx) => Promise<PageIR>`.                                                                              |
| `generateSection`     | `GenerateSectionFn`                    | none       | Section-flow callback. `(prompt, ctx) => Promise<AiSectionPatch>`. When omitted, `regenerateSelection` fails with `GENERATE_FAILED`. |
| `puckConfig`          | `Config`                               | _required_ | Same Puck config passed to `<Studio>`. The AI-safe schema is derived from it once.                                                   |
| `timeoutMs`           | `number`                               | `30_000`   | Applied to each host callback.                                                                                                       |
| `forwardCurrentData`  | `boolean`                              | `false`    | When `true`, the current canvas is included in the context (subject to `sanitizeCurrentData`).                                       |
| `sanitizeCurrentData` | `(data: PuckData) => PuckData`         | identity   | Sync sanitizer applied before forwarding. Keep it cheap.                                                                             |
| `onTrace`             | `(event: AiCopilotTraceEvent) => void` | no-op      | Observability hook. Throws are caught and reported via `ctx.log`.                                                                    |

Constructor performs synchronous structural validation and throws `[CONFIG_INVALID]`-tagged `Error` on bad shapes. The thrown `Error.message` carries the failure code because no Studio context exists yet — once the plugin is constructed, errors surface on the `ai-copilot:error` event bus instead.

### `AiErrorCode`

| Code                | Trigger                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED` | Host response failed `validateAiOutput` / `validateAiSectionPatch`. Carries `issues[]`.                       |
| `TIMEOUT`           | Host callback did not resolve within `timeoutMs`.                                                             |
| `GENERATE_FAILED`   | Host callback rejected, threw, or was missing (e.g., `regenerateSelection` called without `generateSection`). |
| `APPLY_FAILED`      | Post-validation apply step failed (non-contiguous `nodeIds`, missing zone, etc.).                             |
| `CONFIG_INVALID`    | Constructor-time option validation rejected the input.                                                        |

### `AiCopilotTraceEvent`

| `type`                  | When                                        | Extra fields                                                   |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `generation-start`      | Run begins                                  | `promptLength`                                                 |
| `generation-validated`  | Validator accepted response                 | —                                                              |
| `generation-dispatched` | `setData` dispatched                        | —                                                              |
| `generation-stale-drop` | Run resolved after a newer run preempted it | `stage: "after-generate" \| "after-validate" \| "after-apply"` |
| `generation-failed`     | Run terminated with an error                | `code: AiErrorCode`                                            |

Every event also carries `flow: "page" \| "section"` and a monotonic `generationId`.

### `AiCopilotErrorPayload`

```ts
interface AiCopilotErrorPayload {
  readonly code: AiErrorCode;
  readonly message: string;
  readonly issues?: readonly {
    readonly path: string;
    readonly message: string;
    readonly severity: "error" | "warn";
  }[];
}
```

Emitted on the `ai-copilot:error` event bus.

### Helper

```ts
function applySectionPatch(
  current: PuckData,
  patch: AiSectionPatch,
  selection: AiSectionSelection,
): PuckData;
```

Converts an `AiSectionPatch` into a Puck-compatible `setData` payload, validating contiguity and zone location.

### React API (`./react`)

```ts
function useAiCopilot(
  plugin: AiCopilotPluginInstance,
  options?: UseAiCopilotOptions,
): UseAiCopilotResult;
```

`UseAiCopilotResult` (selected fields):

| Field             | Type                                                          | Purpose                                                            |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `prompt`          | `string`                                                      | Composer textarea value.                                           |
| `onPromptChange`  | `(next: string) => void`                                      | Composer onChange.                                                 |
| `status`          | `"idle" \| "pending"`                                         | Generation lifecycle.                                              |
| `error`           | `string \| null`                                              | Last error message.                                                |
| `issues`          | `readonly AiPromptPanelIssue[]`                               | Validator issues from the last failed run.                         |
| `onGenerate`      | `(prompt: string) => void`                                    | Submit handler — calls `plugin.runGeneration`.                     |
| `onRegenerate`    | `(prompt: string, selection: AiPromptPanelSelection) => void` | Submit handler — calls `plugin.regenerateSelection`.               |
| `messages`        | `readonly CopilotMessage[]`                                   | Local chat history.                                                |
| `toolCalls`       | `readonly CopilotToolCall[]`                                  | Generation lifecycle rendered as tool calls.                       |
| `selectedModelId` | `string \| undefined`                                         | Currently selected model (UI-only — the plugin is model-agnostic). |
| `onModelChange`   | `(id: string) => void`                                        | Model selector handler.                                            |
| `pushTrace`       | `(event: AiCopilotTraceEvent) => void`                        | Sink for the plugin's trace events; wire it to `onTrace`.          |

Components:

| Component              | Key props                                             |
| ---------------------- | ----------------------------------------------------- |
| `AiCopilotPanel`       | `{ plugin: AiCopilotPluginInstance }`                 |
| `CopilotComposer`      | `{ prompt, onPromptChange, onSubmit, status, error }` |
| `CopilotChatPanel`     | `{ messages, toolCalls }`                             |
| `CopilotMessageBubble` | `{ message, role }`                                   |
| `CopilotToolCallRow`   | `{ toolCall }`                                        |
| `CopilotModelMenu`     | `{ selectedId, models?, onSelect }`                   |

### Mock generators (`./mock`)

```ts
function createMockGeneratePage(
  options?: CreateMockGeneratePageOptions,
): GeneratePageFn;
function createMockGenerateSection(
  options?: CreateMockGenerateSectionOptions,
): GenerateSectionFn;

function matchPromptToFixture(prompt: string): Fixture | undefined;
const allFixtures: readonly Fixture[];
```

Fixtures match the demo component catalog. `matchPromptToFixture` performs partial prompt matching — useful for E2E tests that need a deterministic generation result for a known phrase.

## Usage examples

### Whole-page generation against a host backend

```ts
createAiCopilotPlugin({
  puckConfig,
  generatePage: async (prompt, ctx) => {
    const response = await fetch("/api/ai/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, available: ctx.availableComponents }),
    });
    if (!response.ok) throw new Error(`AI backend ${response.status}`);
    return response.json();
  },
});
```

### Section-level regeneration with current canvas

```ts
createAiCopilotPlugin({
  puckConfig,
  generatePage,
  generateSection: async (prompt, ctx) => {
    return fetch("/api/ai/section", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        selection: ctx.selection,
        availableComponents: ctx.availableComponents,
        currentSnapshot: ctx.currentData,
      }),
    }).then((response) => response.json());
  },
  forwardCurrentData: true,
  sanitizeCurrentData: stripInternalProps,
});

function stripInternalProps(data: PuckData): PuckData {
  return {
    ...data,
    content: data.content.map((item) => ({
      ...item,
      props: Object.fromEntries(
        Object.entries(item.props ?? {}).filter(([key]) => {
          if (key.startsWith("_")) return false;
          if (key === "email" || key === "phone") return false;
          return true;
        }),
      ),
    })),
  };
}
```

### Sentry breadcrumbs from `onTrace`

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

### Deterministic mock generator in tests

```ts
import { createMockGeneratePage } from "@anvilkit/plugin-ai-copilot/mock";
import { createAiCopilotPlugin } from "@anvilkit/plugin-ai-copilot";

const aiCopilot = createAiCopilotPlugin({
  puckConfig,
  generatePage: createMockGeneratePage(),
});

await aiCopilot.runGeneration(
  "a marketing landing page with a hero and pricing grid",
);
```

### React UI panel

```tsx
import { AiCopilotPanel } from "@anvilkit/plugin-ai-copilot/react";

function Sidebar({ aiCopilot }: { aiCopilot: AiCopilotPluginInstance }) {
  return <AiCopilotPanel plugin={aiCopilot} />;
}
```

## Notes & FAQ

### Why imperative, not declarative?

Sibling plugins (`@anvilkit/plugin-export-html`, etc.) register declarative `exportFormats` / `headerActions` maps that host UI pulls from. The AI copilot returns imperative methods instead because it is prompt-driven: host UI typically renders a textarea + submit button and must `await` the run to drive progress state, disable input mid-generation, and surface errors inline. A declarative `aiActions` map would still require a host-side `await invoke()` at the call site, so we expose the methods directly. See `docs/decisions/005-ai-copilot-imperative-api.md` for the long-form rationale.

### Security model

- The plugin **never sees credentials**. API keys, auth headers, and endpoints belong to the host backend.
- `generatePage` and `generateSection` receive exactly `(prompt, ctx)` — no global state, no implicit data.
- Every LLM response runs through validation before any canvas mutation.
- The dispatch is atomic: a single `setData` action per successful generation, so partial / interleaved updates are impossible.

### `forwardCurrentData` requires opt-in plus sanitization

When `forwardCurrentData: true`, the entire Puck canvas — component props, asset URLs, embedded text — crosses into the host's LLM adapter on every prompt. This materially improves regeneration quality, but if any component props can contain PII, signed asset URLs, embedded secrets, or internal customer identifiers, pair the flag with `sanitizeCurrentData` to strip anything that must not leave the application. See `docs/decisions/004-ai-copilot-data-egress.md`.

### Stale-drop semantics

Each call increments an internal `generationId`. If a slower earlier run resolves after a faster later run has dispatched, the earlier result is discarded and `generation-stale-drop` fires with the `stage` at which the drop happened (`after-generate` / `after-validate` / `after-apply`). The canvas only ever reflects the latest accepted generation.

### `onTrace` payloads never include forwarded data

Only structural metadata flows through the trace channel: flow (`"page"` / `"section"`), `generationId`, `promptLength`, error codes, stale-drop stage. Wire it into Sentry breadcrumbs, OpenTelemetry span events, or `console.debug` without worrying about secret leakage.

### Construction errors throw synchronously

Bad option shapes fail fast with a `[CONFIG_INVALID]`-tagged `Error`. The `CONFIG_INVALID` code is part of the `AiErrorCode` union but surfaces through the constructor's thrown `Error.message` rather than the event bus — no Studio context exists yet at construction time.

### Mock vs production generators

The mock generators emit `PageIR` documents shaped against the demo component catalog. If your host components diverge from the demo set, write a custom mock or extend `allFixtures` rather than relying on the bundled fixtures verbatim.

### Architecture context

See the `anvilkit-architecture` AI-context doc on the Anvilkit docs site for the full package catalog and trust-boundary discussion. The AI generation flow runs entirely through this plugin boundary — `@anvilkit/core` exposes no first-party AI primitives beyond the `AiGenerationContext` types.
