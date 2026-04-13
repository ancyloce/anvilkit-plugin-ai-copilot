import type {
	AiGenerationContext,
	PageIR,
	StudioPluginContext,
	StudioPluginRegistration,
} from "@anvilkit/core/types";
import { configToAiContext } from "@anvilkit/schema";
import { validateAiOutput } from "@anvilkit/validator";

import { irToPuckPatch } from "./ir-to-puck-patch.js";
import type {
	AiCopilotErrorPayload,
	AiCopilotOptions,
	AiCopilotPluginInstance,
	AiErrorCode,
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

	let plugin!: AiCopilotPluginInstance;

	async function runGeneration(prompt: string): Promise<void> {
		const cached = cachedStateByPlugin.get(plugin);
		if (!cached) {
			throw new Error(
				"createAiCopilotPlugin: runGeneration called before plugin onInit",
			);
		}

		const fullContext: AiGenerationContext = {
			...cached.aiContext,
			...(opts.forwardCurrentData
				? { currentData: cached.ctx.getData() }
				: {}),
		};

		let response: PageIR;
		try {
			response = await Promise.race([
				opts.generatePage(prompt, fullContext),
				new Promise<never>((_resolve, reject) => {
					setTimeout(() => reject(new TimeoutError()), timeoutMs);
				}),
			]);
		} catch (err) {
			if (err instanceof TimeoutError) {
				reportError(cached.ctx, {
					code: "TIMEOUT",
					message: `AI generation did not respond within ${timeoutMs}ms`,
				});
				return;
			}

			reportError(cached.ctx, {
				code: "GENERATE_FAILED",
				message: err instanceof Error ? err.message : String(err),
			});
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

		const data = irToPuckPatch(response);
		cached.ctx.getPuckApi().dispatch({ type: "setData", data });
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
	};

	return plugin;
}
