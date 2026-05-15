import type {
	AiGenerationContext,
	AiSectionContext,
	AiSectionPatch,
	AiSectionSelection,
	PageIR,
	StudioPluginContext,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import { configToAiContext } from "@anvilkit/schema";
import { configToAiSectionContext } from "@anvilkit/schema/section";
import type { Data as PuckData } from "@puckeditor/core";
import { validateAiOutput } from "@anvilkit/validator";
import type { ValidationIssue } from "@anvilkit/validator";
import { validateAiSectionPatch } from "@anvilkit/validator/section";

import { applySectionPatch } from "./apply-section-patch.js";
import { findCurrentNodes } from "./internal/find-current-nodes.js";
import { irToPuckPatch } from "./ir-to-puck-patch.js";
import type {
	AiCopilotErrorPayload,
	AiCopilotOptions,
	AiCopilotPluginInstance,
	AiCopilotTraceEvent,
	AiErrorCode,
	RegenerateSelectionOptions,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

interface CachedState {
	readonly aiContext: AiGenerationContext;
	readonly ctx: StudioPluginContext;
}

class TimeoutError extends Error {
	constructor(message = "AI generation timed out") {
		super(message);
		this.name = "TimeoutError";
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeoutId = setTimeout(() => reject(new TimeoutError()), timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

const META = {
	id: "anvilkit-plugin-ai-copilot",
	name: "AI Copilot",
	version: "0.1.0-alpha.0",
	coreVersion: "^0.1.0-alpha",
	description:
		"Headless AI copilot - generate pages from natural-language prompts via a host-supplied callback.",
} as const;

const cachedStateByPlugin = new WeakMap<AiCopilotPluginInstance, CachedState>();

/**
 * Structural validation of {@link AiCopilotOptions}. Throws synchronously
 * with a `CONFIG_INVALID`-tagged message when an obviously-bad config is
 * passed, so misuse fails fast at construction instead of waiting for the
 * first generation to surface a confusing runtime error.
 */
function assertValidOptions(opts: AiCopilotOptions): void {
	if (typeof opts.generatePage !== "function") {
		throw new Error(
			"createAiCopilotPlugin: [CONFIG_INVALID] `generatePage` must be a function",
		);
	}
	if (
		opts.generateSection !== undefined &&
		typeof opts.generateSection !== "function"
	) {
		throw new Error(
			"createAiCopilotPlugin: [CONFIG_INVALID] `generateSection`, when provided, must be a function",
		);
	}
	if (
		opts.timeoutMs !== undefined &&
		!(Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0)
	) {
		throw new Error(
			`createAiCopilotPlugin: [CONFIG_INVALID] \`timeoutMs\` must be a positive finite number (got ${String(opts.timeoutMs)})`,
		);
	}
	if (
		opts.puckConfig === null ||
		opts.puckConfig === undefined ||
		typeof opts.puckConfig !== "object"
	) {
		throw new Error(
			"createAiCopilotPlugin: [CONFIG_INVALID] `puckConfig` must be the same Puck config object passed to <Studio />",
		);
	}
	if (
		opts.sanitizeCurrentData !== undefined &&
		typeof opts.sanitizeCurrentData !== "function"
	) {
		throw new Error(
			"createAiCopilotPlugin: [CONFIG_INVALID] `sanitizeCurrentData`, when provided, must be a function",
		);
	}
	if (opts.onTrace !== undefined && typeof opts.onTrace !== "function") {
		throw new Error(
			"createAiCopilotPlugin: [CONFIG_INVALID] `onTrace`, when provided, must be a function",
		);
	}
}

/**
 * Create the headless AI copilot plugin.
 *
 * The host must pass the same `puckConfig` object it gives to
 * `<Studio />` so `configToAiContext()` can derive the AI-safe schema
 * once during `onInit`.
 */
export function createAiCopilotPlugin(
	opts: AiCopilotOptions,
): AiCopilotPluginInstance {
	assertValidOptions(opts);

	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	/**
	 * `StudioPluginContext` intentionally does not expose `setAiError()`.
	 * Architecture section 9 also forbids plugins from importing the AI
	 * store directly, so the plugin reports failures through the event
	 * bus plus structured logging instead.
	 */
	function reportError(
		ctx: StudioPluginContext,
		payload: AiCopilotErrorPayload,
	): void {
		ctx.emit("ai-copilot:error", payload);
		ctx.log("error", payload.message, {
			code: payload.code satisfies AiErrorCode,
			...(payload.issues ? { issues: payload.issues } : {}),
		});
	}

	/**
	 * Safely invoke `opts.onTrace` if configured. Observer failures are
	 * logged via `ctx.log` and swallowed — a faulty trace sink must never
	 * disrupt the generation pipeline.
	 */
	function trace(ctx: StudioPluginContext, event: AiCopilotTraceEvent): void {
		if (!opts.onTrace) return;
		try {
			opts.onTrace(event);
		} catch (err) {
			ctx.log("warn", "ai-copilot: onTrace handler threw", {
				event: event.type,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Shared error-classification path used by both `runGeneration` and
	 * `regenerateSelection`. Surfaces `TimeoutError` as `TIMEOUT` and
	 * everything else as `GENERATE_FAILED`, mapping the message to the
	 * underlying `Error` or coerced string.
	 */
	function reportRunError(ctx: StudioPluginContext, err: unknown): AiErrorCode {
		if (err instanceof TimeoutError) {
			reportError(ctx, {
				code: "TIMEOUT",
				message: `AI generation did not respond within ${timeoutMs}ms`,
			});
			return "TIMEOUT";
		}
		reportError(ctx, {
			code: "GENERATE_FAILED",
			message: err instanceof Error ? err.message : String(err),
		});
		return "GENERATE_FAILED";
	}

	/**
	 * Wrap a host callback in the timeout + stale-check pattern used by
	 * both flows. Returns `{ ok: true, value }` on success, `{ ok: false }`
	 * when the run was cancelled (stale or destroyed), or `{ ok: false }`
	 * after surfacing the failure via `reportRunError` + `onTrace`.
	 *
	 * Centralizing the pattern keeps `runGeneration` and `regenerateSelection`
	 * focused on flow-specific concerns (validation, dispatch) instead of
	 * re-implementing cancellation bookkeeping.
	 */
	async function cancellableRun<T>(
		flow: "page" | "section",
		generationId: number,
		ctx: StudioPluginContext,
		isCurrent: () => boolean,
		promise: Promise<T>,
	): Promise<{ ok: true; value: T } | { ok: false }> {
		try {
			const value = await withTimeout(promise, timeoutMs);
			if (!isCurrent()) {
				trace(ctx, {
					type: "generation-stale-drop",
					flow,
					generationId,
					stage: "after-generate",
				});
				return { ok: false };
			}
			return { ok: true, value };
		} catch (err) {
			if (!isCurrent()) {
				trace(ctx, {
					type: "generation-stale-drop",
					flow,
					generationId,
					stage: "after-generate",
				});
				return { ok: false };
			}
			const code = reportRunError(ctx, err);
			trace(ctx, { type: "generation-failed", flow, generationId, code });
			return { ok: false };
		}
	}

	/**
	 * Atomically replace the entire Puck canvas. Used by the page flow
	 * after IR validation and conversion succeed.
	 */
	function dispatchPageReplace(ctx: StudioPluginContext, data: PuckData): void {
		// Functional `setData` form: Puck's reducer only logs the
		// "`setData` is expensive" advisory when `action.data` is a
		// plain object. Passing the next snapshot as a thunk takes the
		// non-warning branch.
		//
		// NOTE: both `setData` forms shallow-merge the payload over the
		// existing `state.data` — neither is a true replace. Replace
		// semantics depend on `irToPuckPatch` returning a *complete*
		// snapshot (explicit `zones`, `root.props`) so the shallow merge
		// overwrites every top-level key. Without that, stale ghost
		// zones survive into the collab outbound IR and AI-generated
		// pages fail to sync to other collaborators.
		ctx.getPuckApi().dispatch({ type: "setData", data: () => data });
	}

	/**
	 * Filter the validator's mixed-severity issue list down to errors,
	 * project them onto the {@link AiCopilotErrorPayload} shape, and
	 * surface a `VALIDATION_FAILED` event. Section flow only — the page
	 * flow's validator already returns the expected shape.
	 */
	function reportSectionValidationFailure(
		ctx: StudioPluginContext,
		issues: readonly ValidationIssue[],
	): void {
		reportError(ctx, {
			code: "VALIDATION_FAILED",
			message: "AI section patch failed validation",
			issues: issues
				.filter((i) => i.level === "error")
				.map((i) => ({
					path: i.path.join("."),
					message: `[${i.code}] ${i.message}`,
					severity: "error" as const,
				})),
		});
	}

	let plugin!: AiCopilotPluginInstance;
	let latestGenerationId = 0;

	function buildIsCurrent(generationId: number): () => boolean {
		return () =>
			generationId === latestGenerationId && cachedStateByPlugin.has(plugin);
	}

	async function runGeneration(prompt: string): Promise<void> {
		const cached = cachedStateByPlugin.get(plugin);
		if (!cached) {
			throw new Error(
				"createAiCopilotPlugin: runGeneration called before plugin onInit",
			);
		}
		const generationId = ++latestGenerationId;
		const isCurrent = buildIsCurrent(generationId);
		trace(cached.ctx, {
			type: "generation-start",
			flow: "page",
			generationId,
			promptLength: prompt.length,
		});

		const fullContext: AiGenerationContext = {
			...cached.aiContext,
			...(opts.forwardCurrentData
				? {
						currentData: opts.sanitizeCurrentData
							? opts.sanitizeCurrentData(cached.ctx.getData())
							: cached.ctx.getData(),
					}
				: {}),
		};

		const generated = await cancellableRun<PageIR>(
			"page",
			generationId,
			cached.ctx,
			isCurrent,
			opts.generatePage(prompt, fullContext),
		);
		if (!generated.ok) return;

		const validation = validateAiOutput(
			generated.value,
			cached.aiContext.availableComponents,
		);
		if (!validation.valid) {
			reportError(cached.ctx, {
				code: "VALIDATION_FAILED",
				message: "AI response failed validation",
				issues: validation.issues,
			});
			trace(cached.ctx, {
				type: "generation-failed",
				flow: "page",
				generationId,
				code: "VALIDATION_FAILED",
			});
			return;
		}
		trace(cached.ctx, {
			type: "generation-validated",
			flow: "page",
			generationId,
		});

		try {
			const data = irToPuckPatch(generated.value);
			if (!isCurrent()) {
				trace(cached.ctx, {
					type: "generation-stale-drop",
					flow: "page",
					generationId,
					stage: "after-validate",
				});
				return;
			}
			dispatchPageReplace(cached.ctx, data);
			trace(cached.ctx, {
				type: "generation-dispatched",
				flow: "page",
				generationId,
			});
		} catch (err) {
			if (!isCurrent()) {
				trace(cached.ctx, {
					type: "generation-stale-drop",
					flow: "page",
					generationId,
					stage: "after-apply",
				});
				return;
			}
			reportError(cached.ctx, {
				code: "APPLY_FAILED",
				message: err instanceof Error ? err.message : String(err),
			});
			trace(cached.ctx, {
				type: "generation-failed",
				flow: "page",
				generationId,
				code: "APPLY_FAILED",
			});
		}
	}

	async function regenerateSelection(
		prompt: string,
		selection: AiSectionSelection,
		sectionOpts?: RegenerateSelectionOptions,
	): Promise<void> {
		const cached = cachedStateByPlugin.get(plugin);
		if (!cached) {
			throw new Error(
				"createAiCopilotPlugin: regenerateSelection called before plugin onInit",
			);
		}

		const generateSection = opts.generateSection;
		if (!generateSection) {
			reportError(cached.ctx, {
				code: "GENERATE_FAILED",
				message:
					"createAiCopilotPlugin: regenerateSelection called but no generateSection callback was configured.",
			});
			return;
		}

		// Section flow gets its own monotonic id so a stale section run
		// is also dropped at apply time. Reusing `latestGenerationId`
		// across both flows means a fresh page-generation cancels an
		// in-flight section run and vice versa, which matches the
		// semantics the host UI expects ("most recent intent wins").
		const generationId = ++latestGenerationId;
		const isCurrent = buildIsCurrent(generationId);
		trace(cached.ctx, {
			type: "generation-start",
			flow: "section",
			generationId,
			promptLength: prompt.length,
		});

		// Auto-populate `selection.currentNodes` from the live Puck data
		// when the host omitted them. Hosts driving the plugin from a UI
		// shouldn't have to re-walk Puck's tree just to pass an LLM
		// prompt the "before" content — the plugin already needs to read
		// the data for `applySectionPatch`, so reusing it here is free.
		const enrichedSelection: AiSectionSelection =
			selection.currentNodes === undefined
				? {
						...selection,
						currentNodes: findCurrentNodes(
							cached.ctx.getData(),
							selection.nodeIds,
						),
					}
				: selection;

		let sectionContext: AiSectionContext;
		try {
			sectionContext = configToAiSectionContext(
				opts.puckConfig,
				enrichedSelection,
				sectionOpts,
			);
		} catch (err) {
			reportError(cached.ctx, {
				code: "VALIDATION_FAILED",
				message: err instanceof Error ? err.message : String(err),
			});
			trace(cached.ctx, {
				type: "generation-failed",
				flow: "section",
				generationId,
				code: "VALIDATION_FAILED",
			});
			return;
		}

		const generated = await cancellableRun<AiSectionPatch>(
			"section",
			generationId,
			cached.ctx,
			isCurrent,
			generateSection(prompt, sectionContext),
		);
		if (!generated.ok) return;

		const validation = validateAiSectionPatch(generated.value, sectionContext);
		if (!validation.valid) {
			reportSectionValidationFailure(cached.ctx, validation.issues);
			trace(cached.ctx, {
				type: "generation-failed",
				flow: "section",
				generationId,
				code: "VALIDATION_FAILED",
			});
			return;
		}
		trace(cached.ctx, {
			type: "generation-validated",
			flow: "section",
			generationId,
		});

		try {
			const currentData = cached.ctx.getData();
			const nextData = applySectionPatch(currentData, generated.value);
			if (!isCurrent()) {
				trace(cached.ctx, {
					type: "generation-stale-drop",
					flow: "section",
					generationId,
					stage: "after-validate",
				});
				return;
			}
			cached.ctx
				.getPuckApi()
				.dispatch({ type: "setData", data: () => nextData });
			trace(cached.ctx, {
				type: "generation-dispatched",
				flow: "section",
				generationId,
			});
		} catch (err) {
			if (!isCurrent()) {
				trace(cached.ctx, {
					type: "generation-stale-drop",
					flow: "section",
					generationId,
					stage: "after-apply",
				});
				return;
			}
			reportError(cached.ctx, {
				code: "APPLY_FAILED",
				message: err instanceof Error ? err.message : String(err),
			});
			trace(cached.ctx, {
				type: "generation-failed",
				flow: "section",
				generationId,
				code: "APPLY_FAILED",
			});
		}
	}

	plugin = {
		meta: META,
		register(_ctx) {
			const registration: StudioPluginRegistration = {
				meta: META,
				hooks: {
					onInit(initCtx) {
						const aiContext = configToAiContext(opts.puckConfig);
						cachedStateByPlugin.set(plugin, { aiContext, ctx: initCtx });
					},
					onDestroy() {
						cachedStateByPlugin.delete(plugin);
					},
				},
			};

			return registration;
		},
		runGeneration,
		regenerateSelection,
	};

	return plugin;
}
