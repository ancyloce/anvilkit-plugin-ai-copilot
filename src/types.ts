import type {
	AiGenerationContext,
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
 * Configuration for {@link createAiCopilotPlugin}.
 */
export interface AiCopilotOptions {
	/**
	 * Host-owned generation callback that turns a prompt plus context
	 * into a page IR document.
	 */
	readonly generatePage: GeneratePageFn;

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
 * Returned plugin instance, including the public `runGeneration()`
 * entry point used by host UI code and tests.
 */
export interface AiCopilotPluginInstance extends StudioPlugin {
	readonly runGeneration: (prompt: string) => Promise<void>;
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
