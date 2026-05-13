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
import { validateAiOutput } from "@anvilkit/validator";
import { validateAiSectionPatch } from "@anvilkit/validator/section";

import { applySectionPatch } from "./apply-section-patch.js";
import { findCurrentNodes } from "./internal/find-current-nodes.js";
import { irToPuckPatch } from "./ir-to-puck-patch.js";
import type {
	AiCopilotErrorPayload,
	AiCopilotOptions,
	AiCopilotPluginInstance,
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
 * Create the headless AI copilot plugin.
 *
 * The host must pass the same `puckConfig` object it gives to
 * `<Studio />` so `configToAiContext()` can derive the AI-safe schema
 * once during `onInit`.
 */
export function createAiCopilotPlugin(
	opts: AiCopilotOptions,
): AiCopilotPluginInstance {
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
	 * Shared error-classification path used by both `runGeneration` and
	 * `regenerateSelection`. Surfaces `TimeoutError` as `TIMEOUT` and
	 * everything else as `GENERATE_FAILED`, mapping the message to the
	 * underlying `Error` or coerced string.
	 */
	function reportRunError(ctx: StudioPluginContext, err: unknown): void {
		if (err instanceof TimeoutError) {
			reportError(ctx, {
				code: "TIMEOUT",
				message: `AI generation did not respond within ${timeoutMs}ms`,
			});
			return;
		}
		reportError(ctx, {
			code: "GENERATE_FAILED",
			message: err instanceof Error ? err.message : String(err),
		});
	}

	let plugin!: AiCopilotPluginInstance;
	let latestGenerationId = 0;

	async function runGeneration(prompt: string): Promise<void> {
		const cached = cachedStateByPlugin.get(plugin);
		if (!cached) {
			throw new Error(
				"createAiCopilotPlugin: runGeneration called before plugin onInit",
			);
		}
		const generationId = ++latestGenerationId;
		const isCurrentGeneration = () =>
			generationId === latestGenerationId && cachedStateByPlugin.has(plugin);

		let forwardedData;
		if (opts.forwardCurrentData) {
			const live = cached.ctx.getData();
			forwardedData = opts.sanitizeCurrentData
				? opts.sanitizeCurrentData(live)
				: live;
		}

		const fullContext: AiGenerationContext = {
			...cached.aiContext,
			...(opts.forwardCurrentData ? { currentData: forwardedData } : {}),
		};

		let response: PageIR;
		try {
			response = await withTimeout(
				opts.generatePage(prompt, fullContext),
				timeoutMs,
			);
		} catch (err) {
			if (!isCurrentGeneration()) {
				return;
			}
			reportRunError(cached.ctx, err);
			return;
		}

		if (!isCurrentGeneration()) {
			return;
		}

		const validation = validateAiOutput(
			response,
			cached.aiContext.availableComponents,
		);
		if (!validation.valid) {
			reportError(cached.ctx, {
				code: "VALIDATION_FAILED",
				message: "AI response failed validation",
				issues: validation.issues,
			});
			return;
		}

		try {
			const data = irToPuckPatch(response);
			if (!isCurrentGeneration()) {
				return;
			}
			cached.ctx.getPuckApi().dispatch({ type: "setData", data });
		} catch (err) {
			if (!isCurrentGeneration()) {
				return;
			}

			reportError(cached.ctx, {
				code: "APPLY_FAILED",
				message: err instanceof Error ? err.message : String(err),
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
		const isCurrentGeneration = () =>
			generationId === latestGenerationId && cachedStateByPlugin.has(plugin);

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
			return;
		}

		let patch: AiSectionPatch;
		try {
			patch = await withTimeout(
				generateSection(prompt, sectionContext),
				timeoutMs,
			);
		} catch (err) {
			if (!isCurrentGeneration()) return;
			reportRunError(cached.ctx, err);
			return;
		}

		if (!isCurrentGeneration()) return;

		const validation = validateAiSectionPatch(patch, sectionContext);
		if (!validation.valid) {
			reportError(cached.ctx, {
				code: "VALIDATION_FAILED",
				message: "AI section patch failed validation",
				issues: validation.issues
					.filter((i) => i.level === "error")
					.map((i) => ({
						path: i.path.join("."),
						message: `[${i.code}] ${i.message}`,
						severity: "error" as const,
					})),
			});
			return;
		}

		try {
			const currentData = cached.ctx.getData();
			const nextData = applySectionPatch(currentData, patch);
			if (!isCurrentGeneration()) return;
			cached.ctx.getPuckApi().dispatch({ type: "setData", data: nextData });
		} catch (err) {
			if (!isCurrentGeneration()) return;
			reportError(cached.ctx, {
				code: "APPLY_FAILED",
				message: err instanceof Error ? err.message : String(err),
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
