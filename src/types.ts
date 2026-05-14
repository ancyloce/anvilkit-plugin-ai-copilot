import type {
	AiGenerationContext,
	AiSectionContext,
	AiSectionPatch,
	AiSectionSelection,
	ConfigToAiSectionContextOptions,
	PageIR,
	StudioPlugin,
} from "@anvilkit/core/types";
import type { Config as PuckConfig, Data as PuckData } from "@puckeditor/core";

/**
 * Host-supplied generation callback used by the AI copilot plugin.
 *
 * The plugin passes exactly two arguments: the user's prompt and an
 * AI-safe generation context derived from the Puck config.
 */
export type GeneratePageFn = (
	prompt: string,
	ctx: AiGenerationContext,
) => Promise<PageIR>;

/**
 * Host-supplied callback for the Phase 6 / M9 section-level flow.
 *
 * Receives the user's prompt and a section-scoped {@link AiSectionContext}
 * describing the selected nodes plus the components the LLM is allowed
 * to emit inside the targeted zone. Returns an {@link AiSectionPatch}
 * the plugin then validates with `validateAiSectionPatch` and applies
 * via `puckApi.dispatch({ type: "setData", … })`.
 *
 * Same `(prompt, ctx)` argument order as {@link GeneratePageFn} for
 * symmetry across the page and section flows.
 */
export type GenerateSectionFn = (
	prompt: string,
	ctx: AiSectionContext,
) => Promise<AiSectionPatch>;

/**
 * Discriminated trace event emitted by {@link AiCopilotOptions.onTrace}
 * at every decision point inside `runGeneration` and `regenerateSelection`.
 *
 * Hosts wire this into Sentry, OpenTelemetry, or `console.debug` to make
 * the otherwise-opaque concurrency/cancellation behaviour observable in
 * production. The plugin remains transport-agnostic — the host decides
 * whether `onTrace` ships to a metrics sink, a log line, or nowhere.
 *
 * Every event carries a `flow` ("page" or "section") and a numeric
 * `generationId` matching the plugin's internal monotonic counter, so
 * downstream sinks can correlate the lifecycle of a single run.
 *
 * @see docs/decisions/004-ai-copilot-data-egress.md for related egress
 *      considerations — `onTrace` event payloads never include forwarded
 *      Puck data, only structural metadata.
 */
export type AiCopilotTraceEvent =
	| {
			readonly type: "generation-start";
			readonly flow: "page" | "section";
			readonly generationId: number;
			readonly promptLength: number;
	  }
	| {
			readonly type: "generation-validated";
			readonly flow: "page" | "section";
			readonly generationId: number;
	  }
	| {
			readonly type: "generation-stale-drop";
			readonly flow: "page" | "section";
			readonly generationId: number;
			readonly stage: "after-generate" | "after-validate" | "after-apply";
	  }
	| {
			readonly type: "generation-dispatched";
			readonly flow: "page" | "section";
			readonly generationId: number;
	  }
	| {
			readonly type: "generation-failed";
			readonly flow: "page" | "section";
			readonly generationId: number;
			readonly code: AiErrorCode;
	  };

/**
 * Configuration for {@link createAiCopilotPlugin}.
 */
export interface AiCopilotOptions {
	/**
	 * Host-owned generation callback that turns a prompt plus context
	 * into a page IR document.
	 */
	readonly generatePage: GeneratePageFn;

	/**
	 * Host-owned callback for the Phase 6 section-level flow. When
	 * omitted, calls to {@link AiCopilotPluginInstance.regenerateSelection}
	 * surface a `GENERATE_FAILED` error so the host UI can hide the
	 * "Regenerate selection" button — the page-level
	 * {@link generatePage} flow remains fully functional.
	 *
	 * Optional by design: hosts that only want whole-page generation
	 * keep their `1.0.0` integration unchanged.
	 */
	readonly generateSection?: GenerateSectionFn;

	/**
	 * The same Puck config object the host passes to `<Studio />`.
	 *
	 * The plugin derives and caches its AI-safe schema from this config
	 * during `onInit`.
	 */
	readonly puckConfig: PuckConfig;

	/**
	 * Optional timeout applied to the `generatePage()` call.
	 *
	 * Defaults to `30_000`.
	 */
	readonly timeoutMs?: number;

	/**
	 * Whether to forward the current Puck data snapshot on each run.
	 *
	 * Defaults to `false`. **Security note:** when `true`, the entire
	 * Puck canvas — including component props that may contain PII,
	 * signed asset URLs, or internal identifiers — is handed to the
	 * host's `generatePage` / `generateSection` callback, which is
	 * typically the boundary that ships data to an LLM. Pair with
	 * {@link sanitizeCurrentData} to strip anything that must not
	 * leave the application. See README §Security model.
	 */
	readonly forwardCurrentData?: boolean;

	/**
	 * Optional sanitizer applied to the Puck data snapshot before it
	 * is forwarded to `generatePage` / `generateSection`. Only invoked
	 * when {@link forwardCurrentData} is `true`. Defaults to identity.
	 *
	 * Use this to strip PII, embedded secrets, signed asset URLs, or
	 * any internal fields that must never reach the LLM. The
	 * recommended pattern is to clone the data, redact known PII keys
	 * (e.g. `email`, `phone`), and drop props prefixed with `_`
	 * (a convention the demo uses for internal-only fields).
	 *
	 * @see docs/decisions/004-ai-copilot-data-egress.md for the
	 *      egress-contract decision record.
	 */
	readonly sanitizeCurrentData?: (data: PuckData) => PuckData;

	/**
	 * Optional observability hook. Called synchronously at every
	 * decision point inside `runGeneration` / `regenerateSelection`
	 * with a structured {@link AiCopilotTraceEvent}.
	 *
	 * Purely additive — defaults to a no-op. The plugin never logs the
	 * forwarded Puck data through this channel; only structural metadata
	 * (flow, generationId, error code, etc.) flows through.
	 *
	 * Typical wirings: emit to Sentry breadcrumbs, OpenTelemetry spans,
	 * or `console.debug` during development. Throwing from `onTrace` is
	 * caught and reported via `ctx.log` so a faulty observer cannot
	 * break the generation pipeline.
	 */
	readonly onTrace?: (event: AiCopilotTraceEvent) => void;
}

/**
 * Per-call options for {@link AiCopilotPluginInstance.regenerateSelection}.
 *
 * Forwards onto {@link ConfigToAiSectionContextOptions} so callers can
 * thread theme / locale / `allowResize` hints into the context the LLM
 * sees without reaching for a separate API.
 */
export interface RegenerateSelectionOptions
	extends ConfigToAiSectionContextOptions {}

/**
 * Returned plugin instance, including the public `runGeneration()`
 * entry point used by host UI code and tests.
 *
 * ## Plugin shape — why imperative rather than declarative
 *
 * Sibling plugins like `@anvilkit/plugin-export-html` use a purely
 * declarative shape: they return an `exportFormats` / `headerActions`
 * map from `register()` and host UI pulls from it. This plugin
 * intentionally extends that pattern with two imperative methods —
 * `runGeneration` and `regenerateSelection` — because the AI copilot
 * is prompt-driven: host UI code typically renders a textarea + submit
 * button and must `await` the run to drive progress state, disable
 * the input mid-generation, and surface errors inline. A declarative
 * `aiActions` map would still require a host-side `await invoke()` at
 * the call site, so we expose the imperative methods directly.
 *
 * The trade-off is that host UI cannot enumerate copilot capabilities
 * without instantiating the plugin. This is acceptable because there
 * is exactly one copilot per host integration today; if multiple
 * copilots are needed in future, a registry surface will be added.
 *
 * @see docs/decisions/005-ai-copilot-imperative-api.md for the long-form
 *      decision record.
 */
export interface AiCopilotPluginInstance extends StudioPlugin {
	readonly runGeneration: (prompt: string) => Promise<void>;
	/**
	 * Phase 6 / M9 section-level entry point. Reads the current Puck
	 * canvas, derives an {@link AiSectionContext} from the host's
	 * Puck config plus the supplied {@link AiSectionSelection}, calls
	 * the host's {@link GenerateSectionFn} (when configured), validates
	 * the response with `validateAiSectionPatch`, and on success
	 * atomically dispatches the patched canvas via
	 * `puckApi.dispatch({ type: "setData", … })`.
	 *
	 * Resolves whether the run succeeded or failed — failures surface
	 * on the `ai-copilot:error` event bus the same way as the page
	 * flow, so callers should subscribe to that bus rather than
	 * inspecting the return value.
	 */
	readonly regenerateSelection: (
		prompt: string,
		selection: AiSectionSelection,
		opts?: RegenerateSelectionOptions,
	) => Promise<void>;
}

/**
 * Stable error codes emitted by the AI copilot plugin.
 *
 * - `VALIDATION_FAILED` — the host's `generatePage` / `generateSection`
 *   callback returned a payload that failed `validateAiOutput` /
 *   `validateAiSectionPatch`. Carries an `issues[]` array.
 * - `TIMEOUT` — the host callback did not resolve within
 *   {@link AiCopilotOptions.timeoutMs} (default 30 s).
 * - `GENERATE_FAILED` — the host callback rejected, threw, or was
 *   missing (e.g. `regenerateSelection` called without a
 *   `generateSection` configured).
 * - `APPLY_FAILED` — the post-validation apply step failed (e.g. a
 *   section patch's `nodeIds` were not contiguous, or the targeted
 *   zone could not be located in the live Puck data).
 * - `CONFIG_INVALID` — `createAiCopilotPlugin` was called with options
 *   that fail runtime structural validation (e.g. a non-function
 *   `generatePage`, a non-positive `timeoutMs`). Surfaced through the
 *   constructor's thrown `Error.message` rather than the event bus,
 *   since no Studio context exists yet.
 */
export type AiErrorCode =
	| "VALIDATION_FAILED"
	| "TIMEOUT"
	| "GENERATE_FAILED"
	| "APPLY_FAILED"
	| "CONFIG_INVALID";

/**
 * Structured error payload emitted on the Studio plugin event bus and
 * logged through the plugin context.
 */
export interface AiCopilotErrorPayload {
	readonly code: AiErrorCode;
	readonly message: string;
	readonly issues?: readonly {
		readonly path: string;
		readonly message: string;
		readonly severity: "error" | "warn";
	}[];
}
