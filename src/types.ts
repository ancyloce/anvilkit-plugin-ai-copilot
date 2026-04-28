import type {
	AiGenerationContext,
	AiSectionContext,
	AiSectionPatch,
	AiSectionSelection,
	ConfigToAiSectionContextOptions,
	PageIR,
	StudioPlugin,
} from "@anvilkit/core/types";
import type { Config as PuckConfig } from "@puckeditor/core";

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
	 * Defaults to `false`.
	 */
	readonly forwardCurrentData?: boolean;
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
 */
export type AiErrorCode =
	| "VALIDATION_FAILED"
	| "TIMEOUT"
	| "GENERATE_FAILED"
	| "APPLY_FAILED";

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
